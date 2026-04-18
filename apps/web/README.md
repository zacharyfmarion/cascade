# Cascade Web

`apps/web` contains the browser frontend for Cascade.
This is the primary supported surface of the project today and the best place to explore, test, and contribute to the application.

## Stack

- React 19
- Vite
- Zustand
- `@xyflow/react`
- Rust compiled to WebAssembly through `cascade-wasm`

## Prerequisites

- Node.js 22+
- Rust stable
- `wasm-pack`
- Nightly Rust with `rust-src` if you want to build the threaded WASM bundle locally

## Local Development

From the repository root:

```bash
yarn install
cd apps/web
yarn dev
```

`yarn dev` runs `predev`, which builds:

- `src/wasm-pkg/` for the stable single-threaded bundle
- `src/wasm-pkg-threads/` for the threaded bundle

Those generated directories are ignored in git and should not be committed.

## Common Commands

```bash
yarn build:wasm
yarn lint
yarn lint:css
yarn test
npx tsc -b --noEmit
npx playwright test
```

## Runtime Behavior

- The app prefers a worker-backed threaded WASM engine when cross-origin isolation is available.
- If the environment does not support threaded WASM, it falls back to a single-threaded engine automatically.
- In development and preview, Vite is configured to send the headers needed for cross-origin isolation.

## Deployment Notes

If you host the web app yourself and want threaded WASM support, your server needs to send:

```text
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: require-corp
```

Without those headers, the app still runs, but it uses the single-threaded engine path.

## AI Features

The web app includes optional AI-assisted workflows.

- Replicate API keys enable supported AI nodes
- Anthropic API keys enable the in-app AI assistant and script-generation helpers
- Keys are stored locally in browser storage for the current user profile

If you are evaluating the project for open-source use, it is reasonable to ignore AI features entirely and work only with the local graph engine.

## Testing Expectations

Before opening a PR that touches the web app, try to run:

```bash
yarn lint
yarn lint:css
yarn test
npx playwright test
```

If your change touches Rust code used by the web app, also run:

```bash
cargo check --workspace
cargo test --workspace
```

## Related Files

- Root overview: [README.md](../../README.md)
- CI workflow: [.github/workflows/ci.yml](../../.github/workflows/ci.yml)
- Frontend source: [apps/web/src](./src)
