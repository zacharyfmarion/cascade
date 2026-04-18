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
  const wasmCrate = path.resolve(cratesDir, 'cascade-wasm');
  const stOutDir = path.resolve(__dirname, 'src/wasm-pkg');
  const mtBuildScript = path.resolve(__dirname, 'scripts/build-wasm-mt.sh');

  let building = false;
  let pendingRebuild = false;
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;

  function rebuild(server: import('vite').ViteDevServer) {
    if (building) {
      pendingRebuild = true;
      return;
    }
    building = true;

    const stCmd = `wasm-pack build ${wasmCrate} --target web --out-dir ${stOutDir}`;
    const mtCmd = `bash ${mtBuildScript}`;
    server.config.logger.info('\x1b[36m[wasm] Rebuilding (single-threaded)...\x1b[0m');
    const start = Date.now();

    exec(stCmd, (error, _stdout, stderr) => {
      const elapsed = Date.now() - start;

      if (error) {
        building = false;
        server.config.logger.error(`\x1b[31m[wasm] Build failed (${elapsed}ms)\x1b[0m`);
        server.config.logger.error(stderr);
        server.ws.send({ type: 'full-reload', path: '*' });
      } else {
        server.config.logger.info(`\x1b[32m[wasm] Single-threaded built (${elapsed}ms)\x1b[0m`);
        // Now build threaded bundle
        const mtStart = Date.now();
        server.config.logger.info('\x1b[36m[wasm] Rebuilding (threaded)...\x1b[0m');
        exec(mtCmd, (mtError, _mtStdout, mtStderr) => {
          building = false;
          const mtElapsed = Date.now() - mtStart;
          if (mtError) {
            server.config.logger.warn(`\x1b[33m[wasm] Threaded build failed (${mtElapsed}ms) — single-threaded still available\x1b[0m`);
            server.config.logger.warn(mtStderr);
          } else {
            server.config.logger.info(`\x1b[32m[wasm] Threaded built (${mtElapsed}ms)\x1b[0m`);
          }
          server.ws.send({ type: 'full-reload', path: '*' });

          if (pendingRebuild) {
            pendingRebuild = false;
            rebuild(server);
          }
        });
      }
    });
  }

  return {
    name: 'wasm-hot-rebuild',
    apply: 'serve',
    configureServer(server) {
      fs.watch(cratesDir, { recursive: true }, (_event, filename) => {
        if (!filename) return;
        if (filename.includes('target/') || filename.includes('wasm-pkg/') || filename.includes('wasm-pkg-threads/')) return;
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
  plugins: [react(), wasm(), wasmHotRebuild()],
  worker: {
    format: 'es',
    plugins: () => [wasm(), topLevelAwait()],
  },
  server: {
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
    },
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
  preview: {
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
    },
  },
});
