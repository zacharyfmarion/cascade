import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import wasm from 'vite-plugin-wasm';
import topLevelAwait from 'vite-plugin-top-level-await';
import { type PluginOption } from 'vite';
import { exec } from 'child_process';
import fs from 'fs';
import path from 'path';

function wasmHotRebuild(): PluginOption {
  const cratesDir = path.resolve(__dirname, '../../crates');
  const wasmCrate = path.resolve(cratesDir, 'compositor-wasm');
  const outDir = path.resolve(__dirname, 'src/wasm-pkg');

  let building = false;
  let pendingRebuild = false;
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;

  function rebuild(server: import('vite').ViteDevServer) {
    if (building) {
      pendingRebuild = true;
      return;
    }
    building = true;

    const cmd = `wasm-pack build ${wasmCrate} --target web --out-dir ${outDir}`;
    server.config.logger.info('\x1b[36m[wasm] Rebuilding...\x1b[0m');
    const start = Date.now();

    exec(cmd, (error, _stdout, stderr) => {
      building = false;
      const elapsed = Date.now() - start;

      if (error) {
        server.config.logger.error(`\x1b[31m[wasm] Build failed (${elapsed}ms)\x1b[0m`);
        server.config.logger.error(stderr);
      } else {
        server.config.logger.info(`\x1b[32m[wasm] Built successfully (${elapsed}ms)\x1b[0m`);
        server.ws.send({ type: 'full-reload', path: '*' });
      }

      if (pendingRebuild) {
        pendingRebuild = false;
        rebuild(server);
      }
    });
  }

  return {
    name: 'wasm-hot-rebuild',
    apply: 'serve',
    configureServer(server) {
      fs.watch(cratesDir, { recursive: true }, (_event, filename) => {
        if (!filename) return;
        if (filename.includes('target/') || filename.includes('wasm-pkg/')) return;
        if (!filename.endsWith('.rs') && !filename.endsWith('Cargo.toml')) return;

        if (debounceTimer) clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => {
          server.config.logger.info(`\x1b[36m[wasm] Change detected: ${filename}\x1b[0m`);
          rebuild(server);
        }, 100);
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), wasm(), topLevelAwait(), wasmHotRebuild()],
  server: {
    proxy: {
      '/api/replicate': {
        target: 'https://api.replicate.com',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/replicate/, ''),
      },
      '/api/anthropic': {
        target: 'https://api.anthropic.com',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/anthropic/, ''),
      },
    },
  },
});
