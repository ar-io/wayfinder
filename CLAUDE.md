# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Wayfinder is a client-side routing and verification protocol for accessing data on Arweave through the AR.IO Network. It provides decentralized, cryptographically verified access to `ar://` URLs.

The AR.IO on-chain registry has migrated from AO (Arweave) to **Solana**. The extension routes through Solana exclusively (`@ar.io/sdk@4.x` + `@solana/kit`). The core library remains chain-agnostic (strategy pattern) — it never imports the AR.IO SDK except in `src/gateways/network.ts`.

## Monorepo Structure

npm/yarn workspaces over `packages/*` and `experimental/*`:

- **packages/wayfinder-core** (`@ar.io/wayfinder-core`, Apache-2.0) — the protocol: routing, verification, retrieval, gateway discovery
- **packages/wayfinder-react** (`@ar.io/wayfinder-react`, MIT) — `WayfinderProvider` + `useWayfinder` / `useWayfinderRequest` / `useWayfinderUrl`
- **packages/wayfinder-extension** — Chrome MV3 extension (private, not published to npm)
- **experimental/wayfinder-cli**, **experimental/wayfinder-x402-fetch** — not in CI, exempt from the ESLint license-header rule

`packages/core/`, `packages/extension/`, `packages/react/` and the root `src/popup/` are **stale leftovers** (build output / empty dirs, no `package.json`). Real code lives only in the `wayfinder-*` directories.

## Commands

CI uses **npm** (`npm i`, `npm run <script> -w @ar.io/<pkg>`) with the Node version pinned in `.nvmrc` (v24.11.0). Both `yarn.lock` and `package-lock.json` exist; prefer npm to match CI.

```bash
npm i                                     # install (root)
npm run build --workspaces                # build all (yarn build also works)
npm run lint:check                        # biome + eslint over packages/*/src
npm run lint:fix
npm run format:check / format:fix         # biome only
npx changeset                             # required for any release-worthy change
```

**Build order matters**: `wayfinder-react` and `wayfinder-extension` consume `wayfinder-core`'s built `dist/`, so build core first when working across packages:

```bash
npm run build -w @ar.io/wayfinder-core
npm run build -w @ar.io/wayfinder-extension     # or -w @ar.io/wayfinder-react
```

### Tests

`wayfinder-core` is the only package with a real test suite. `wayfinder-react` has zero test files, `wayfinder-extension`'s `test` script is a stub (`echo "Passing"`), and `wayfinder-cli` declares vitest but has no tests yet — so root `npm run test --workspaces` fails on the CLI package. Run per-package instead.

```bash
npm run test:unit -w @ar.io/wayfinder-core          # what CI runs
npm run test:integration -w @ar.io/wayfinder-core   # src/wayfinder.test.ts — hits live gateways, NOT in CI
npm run test:e2e -w @ar.io/wayfinder-core           # src/e2e/ — live Solana registry + gateways, NOT in CI
npm run test:package -w @ar.io/wayfinder-core       # packs, installs into a clean project, imports

cd packages/wayfinder-core && npx tsx --test src/routing/random.test.ts   # single file
```

`test:package` is the only check that can catch a dependency the package fails
to declare. Anything a transitive package imports without declaring still
resolves inside the monorepo, because some other workspace hoisted it into the
root `node_modules` — so the whole test suite can pass while
`npm i @ar.io/wayfinder-core && import '@ar.io/wayfinder-core'` is broken for
every consumer. Run it before publishing.

Note that `test:unit` enumerates globs explicitly and deliberately excludes `src/wayfinder.test.ts`; a new test file outside those globs (`src/{client,routing/*,gateways/*,retrieval/*,verification/*,utils/*}.test.ts`) will silently never run.

`src/e2e/` is the live-network health check — it covers all four extension points against the real AR.IO Solana registry and real gateways, which the mocked suites never touch. It is excluded from the build via `tsconfig.json` (`src/e2e`), since `fixtures.ts` is not a `.test.ts` and would otherwise ship in `dist`. Point it at a dedicated Solana RPC (`SOLANA_RPC_URL=…`) — the public mainnet endpoint rate-limits bursts and produces false failures. See `src/e2e/README.md` for the knobs and for which tests are expected to fail against the current network.

### Extension development

```bash
npm run dev -w @ar.io/wayfinder-extension    # vite build --watch, outputs to dist/
./build_artifact.sh                          # from the package dir: syncs manifest version, lints, builds, zips
```

Then load `packages/wayfinder-extension/dist` unpacked at `chrome://extensions`.

### Manual verification harness

`yarn verify <txIdOrArNSName> [hash|data-root|remote|signature] [gatewayUrl]` (`scripts/verify.ts`) runs a real fetch+verify against a gateway (defaults to `http://localhost:3000`), importing core from source rather than `dist`.

## Architecture

### Core (`packages/wayfinder-core`)

Everything is composed through four interfaces defined in `src/types.ts`. New behavior should almost always be a new implementation of one of these, not a change to `Wayfinder`:

1. **`GatewaysProvider`** (`src/gateways/`) — where the gateway list comes from: `NetworkGatewaysProvider` (AR.IO on-chain registry, the only place `@ar.io/sdk` is used), `TrustedPeersGatewaysProvider` (a gateway's `/ar-io/peers`), `StaticGatewaysProvider`, plus `Composite` / `SimpleCache` / `LocalStorageCache` wrappers.
2. **`RoutingStrategy`** (`src/routing/`) — which gateway to use: `Random`, `Ping` / `FastestPing`, `Static`, `RoundRobin`, `PreferredWithFallback`, plus `SimpleCache` and `Composite` wrappers. The wrappers take another strategy, so real configs are usually nested (see the extension's `routing.ts`).
3. **`VerificationStrategy`** (`src/verification/`) — `Hash` (SHA-256 vs. trusted gateways), `DataRoot` (computes the Arweave data root), `Signature` (ANS-104 data items and L1 transactions), `Remote` (trusts the gateway's `x-ar-io-verified` header).
4. **`DataRetrievalStrategy`** (`src/retrieval/`) — `ContiguousDataRetrievalStrategy` (plain GET, default) or `ChunkDataRetrievalStrategy` (assembles from the chunk API).

Entry points:

- **`Wayfinder`** (`src/wayfinder.ts`) — the orchestrator: `request(url)`, `resolveUrl(params)`, plus runtime `setRoutingStrategy` / `setVerificationStrategy` / `enableVerification` / `disableVerification`. Constructor-injected strategies that lack their own `gatewaysProvider` get the instance's injected into them.
- **`createWayfinderClient()`** (`src/client.ts`) — opinionated factory. Defaults: `TrustedPeersGatewaysProvider` seeded from `https://turbo-gateway.com`, wrapped in `LocalStorageGatewaysProvider` in browsers / `SimpleCacheGatewaysProvider` in Node (300s TTL), with `RandomRoutingStrategy`. It also accepts the flatter `WayfinderFetchOptions` shape, and exports `createRoutingStrategy` / `createVerificationStrategy`, which map friendly names (`'random' | 'fastest' | 'balanced' | 'preferred'`, `'hash' | 'data-root' | 'remote' | 'disabled'`) onto the classes above.

Cross-cutting:

- **`WayfinderEmitter`** (`src/emitter.ts`) — `routing-started|skipped|succeeded` and `verification-started|succeeded|failed|progress|skipped` events; supports a `parentEmitter` so per-request emitters re-emit onto a shared one.
- **`src/telemetry.ts`** — OpenTelemetry tracing, **disabled by default**, 10% sampling, OTLP to Honeycomb.
- **Public API is exactly `src/index.ts`.** `src/fetch/` (`createWayfinderFetch`) and `src/classifiers/` (`GqlClassifier`) are intentionally *not* re-exported — don't assume something is public because it exists in `src/`.

### Chrome extension (`packages/wayfinder-extension`)

MV3, built by Vite into six entry points (`background`, `content`, `popup`, `settings`, `gateways`, `performance`). `manifest.json` sits at the **package root** (not `public/`) and its version is rewritten from `package.json` by `build_artifact.sh`; HTML files, assets, and the manifest are copied by `viteStaticCopy`.

- **`src/background.ts`** (~1.2k lines) — service worker: intercepts `ar://` navigation, syncs the gateway registry from Solana via `arioFromStorage()`, resolves ArNS, and reads the `x-ar-io-verified` response header.
- **`src/routing.ts`** — thread-safe singleton `Wayfinder` (an in-flight promise is cached alongside the instance so concurrent callers can't double-initialize); `resetWayfinderInstance()` is what settings changes call.
- **`src/adapters/chrome-storage-gateway-provider.ts`** — the extension does **not** use core's `NetworkGatewaysProvider` at request time. It reads the `localGatewayAddressRegistry` that the background worker syncs into `chrome.storage.local`, filtering blacklisted gateways, non-`joined` gateways, and (when possible) gateways with `failedConsecutiveEpochs > 0`.
- **Verification is `RemoteVerificationStrategy` only.** The service worker never sees response bytes, so hash/data-root/signature verification is impossible there; trust comes from the `x-ar-io-verified` header.

The extension's user-facing `routingMethod` values are its own vocabulary, mapped to nested core strategies in `routing.ts`:

| `routingMethod` | Composition |
|---|---|
| `topStaked` (default) | `Ping(RoundRobin)` over the top 20 by `totalDelegatedStake` |
| `fastestPing` | `SimpleCache(FastestPing)`, 120s TTL |
| `random` | `Ping(Random)` |
| `static` | `Static` (throws if no `staticGateway` is set) |

#### Solana configuration

Flat keys in `chrome.storage.local`: `network` (`'mainnet' | 'devnet' | 'custom'`), `rpcUrl`, `coreProgramId`, `garProgramId`, `arnsProgramId`, `antProgramId`. Presets `AR_IO_SOLANA_MAINNET` / `AR_IO_SOLANA_DEVNET` live in `src/constants.ts`; defaults applied on install are in `src/config/defaults.ts` and are **mainnet**. Legacy AO keys (`processId`, `aoCuUrl`) are dropped on startup by `migrateStorageFromAOEra()`.

#### Vite `@solana/*` aliasing

`vite.config.js` resolves a list of `@solana/*` packages through `createRequire` anchored at `@solana/kit`, because `experimental/wayfinder-x402-fetch` can pull in older `@solana/*` v5 copies that hoisting may hand to Rollup, producing missing-export build failures. If you add a `@solana/*` import to the extension and the build fails on a missing export, add it to that list.

### React (`packages/wayfinder-react`)

Thin layer: `WayfinderProvider` holds a `Wayfinder` instance in context; the three hooks read from it. It also re-exports `LocalStorageGatewaysProvider` from core for browser use.

## Coding Guidelines

### Function parameters

Object parameters for anything with 3+ params or any optional param:

```typescript
// Good
type CreateFunctionParams = { name: string; logger?: Logger; timeout?: number };
function createFunction({ name, logger, timeout = 5000 }: CreateFunctionParams): void {}

// Bad
function createFunction(name: string, logger?: Logger, timeout?: number): void {}
```

### Style and lint

- Biome formats (2-space, single quotes, organized imports) and lints with a hand-picked rule set; `chrome` is a registered global. Husky formats staged files pre-commit.
- ESLint runs only over `packages/*/src` and enforces one thing: the Apache-2.0 header from `resources/license.header.mjs` on every `.ts`/`.tsx`. **New files in `packages/` must start with that exact header** or `lint:check` fails. `experimental/` is exempt. (Some config files at the repo root still carry an old AGPL header — don't copy those.)
- Code to interfaces, prefer composition over inheritance, prefer type safety.
- Tests use the Node runner via `tsx --test` (`node:test`: `describe`/`it`/`mock`/`beforeEach`); prefer integration tests over unit tests.

### Chunk API

**CRITICAL**: chunk requests are `/chunk/<offset>/data` — do **not** include the root transaction ID in the path.

## Contributing and releases

- Create a changeset (`npx changeset`) for any change to a published package; releases are automated by Changesets in GitHub Actions.
- Branch targets are inconsistent across sources: `origin/HEAD` is `develop`, the README says to branch from `alpha`, and CI/release workflows only trigger on `main`, `alpha`, and `solana`. Confirm the intended target branch before opening a PR rather than assuming.
- Release flow: merging to `alpha` publishes a prerelease, merging to `main` publishes a stable release. The Chrome Web Store upload (`chrome.yml`) is `workflow_dispatch` only.
