# Contributing To Cascade

Thanks for considering a contribution.

## Before You Start

- The project is currently web-first. If you want the smoothest setup and feedback loop, start with `apps/web`.
- Desktop support is still evolving, so web-focused improvements are the lowest-friction place to contribute.
- Please keep changes scoped. Smaller pull requests are much easier to review and merge.

## Setup

### Prerequisites

- Rust stable
- Node.js 22+
- `wasm-pack`
- Nightly Rust plus `rust-src` for threaded WASM builds
- Optional native dependencies for desktop/color/video workflows as needed by the crate you are touching

### Install Dependencies

```bash
yarn install
```

### Run The App

```bash
cd apps/web
yarn dev
```

## Development Guidelines

- Read the project overview in [README.md](./README.md) and the deeper architecture notes in [ARCHITECTURE.md](./docs/architecture/ARCHITECTURE.md) when you need more context
- Prefer architecturally correct fixes over narrow workarounds
- Keep color processing in linear space, not sRGB
- Route frontend state mutations through the store rather than bypassing it
- Avoid swallowing errors or adding silent fallbacks without explanation

## Validation

For frontend work:

```bash
cd apps/web
yarn lint
yarn lint:css
yarn test
npx playwright test
```

For Rust or shared-engine work:

```bash
cargo check --workspace
cargo test --workspace
cargo clippy --workspace --all-targets -- -D warnings
cargo fmt --all -- --check
```

Some CI jobs exclude system-dependent desktop and color-management crates that are not available on GitHub-hosted Linux runners. If you are touching those areas, run the relevant local checks on a machine with the needed native dependencies installed.

## Pull Requests

- Open focused pull requests with a clear description of what changed and why
- Call out any known follow-up work or limitations honestly
- Include the validation commands you ran
- If your change affects the public UX, add screenshots or a short video when practical

## Docs And Roadmaps

There are several planning and architecture documents in this repository.
Treat them as living documents: if your change materially alters how the system works, updating the relevant docs is appreciated.

## Questions

If you are unsure whether a change belongs in scope, start with a draft PR or open an issue describing the intended direction.
