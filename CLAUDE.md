# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Wayfinder is a client-side routing and verification protocol for accessing data on Arweave through the AR.IO Network. It provides decentralized, cryptographically verified access to `ar://` URLs.

The AR.IO on-chain registry has migrated from AO (Arweave) to **Solana**. The extension routes through Solana exclusively (`@ar.io/sdk@4.x`). The core library remains chain-agnostic (strategy pattern), but SDK examples use Solana backend. Both Solana mainnet and devnet are supported — the extension defaults to `devnet`.

## Monorepo Structure

- **packages/wayfinder-core**: Core TypeScript library - routing strategies, verification, gateway providers
- **packages/wayfinder-react**: React hooks (`useWayfinder`, `useWayfinderRequest`, `useWayfinderUrl`) and `WayfinderProvider` context wrapping wayfinder-core
- **packages/wayfinder-extension**: Chrome extension for intercepting ar:// URLs (Solana-backed)
- **experimental/wayfinder-cli**: CLI tool for fetching files via Wayfinder
- **experimental/wayfinder-x402-fetch**: Wraps fetch with `x402-fetch` to handle 402 Payment Required responses via EVM wallet

## Common Commands

```bash
# Install dependencies
yarn install

# Build all packages
yarn build

# Run all tests
yarn test

# Run single package tests
npm run test --workspace=packages/wayfinder-core

# Run a single test file (in wayfinder-core)
cd packages/wayfinder-core && npx tsx --test src/path/to/file.test.ts

# Run CLI tests (uses vitest instead of tsx)
cd experimental/wayfinder-cli && npm run test

# Linting and formatting (uses Biome + ESLint)
yarn lint:check
yarn lint:fix
yarn format:check
yarn format:fix

# Pre-commit hooks (Husky)
# Automatically run on commit: formats staged files with Biome

# Build extension for development (with watch)
cd packages/wayfinder-extension && npm run dev

# Create a changeset for releases
npx changeset
```

## Architecture

### Core Library (wayfinder-core)

The core library uses a strategy pattern with four extension points, all defined as interfaces in `src/types.ts`:

1. **Gateway Providers** (`src/gateways/`): Supply lists of AR.IO gateways (`GatewaysProvider` interface)
   - `NetworkGatewaysProvider`: Fetches from AR.IO on-chain registry (requires @ar.io/sdk)
   - `TrustedPeersGatewaysProvider`: Fetches from gateway's `/ar-io/peers` endpoint
   - `StaticGatewaysProvider`: Returns a fixed list
   - `CompositeGatewaysProvider`: Chains multiple providers
   - `SimpleCacheGatewaysProvider` / `LocalStorageGatewaysProvider`: Caching wrappers

2. **Routing Strategies** (`src/routing/`): Select which gateway to use (`RoutingStrategy` interface)
   - `RandomRoutingStrategy`: Random selection for load balancing
   - `PingRoutingStrategy` / `FastestPingRoutingStrategy`: Selects fastest responding gateway
   - `StaticRoutingStrategy`: Always uses one gateway
   - `RoundRobinRoutingStrategy`: Cycles through gateways
   - `PreferredWithFallbackRoutingStrategy`: Primary gateway with fallback
   - `SimpleCacheRoutingStrategy`: Caches routing decisions
   - `CompositeRoutingStrategy`: Chains multiple strategies

3. **Verification Strategies** (`src/verification/`): Verify data integrity (`VerificationStrategy` interface)
   - `HashVerificationStrategy`: SHA-256 hash comparison against trusted gateway
   - `DataRootVerificationStrategy`: Computes Arweave data root
   - `SignatureVerificationStrategy`: Verifies tx/data-item signatures (ANS-104 bundles and L1 transactions)
   - `RemoteVerificationStrategy`: Trusts gateway's `x-ar-io-verified` header

4. **Data Retrieval Strategies** (`src/retrieval/`): How to fetch data (`DataRetrievalStrategy` interface)
   - `ContiguousDataRetrievalStrategy`: Direct GET request (default)
   - `ChunkDataRetrievalStrategy`: Assembles data from chunk API

### Entry Points

- `Wayfinder` class (`src/wayfinder.ts`): Low-level orchestrator — `request(url)`, `resolveUrl(params)`
- `createWayfinderClient()` (`src/client.ts`): High-level factory with sensible defaults (cached gateways, random routing). Also accepts `WayfinderFetchOptions` for simpler configuration.

### Chrome Extension (wayfinder-extension)

- **Background script** (`src/background.ts`): Service worker intercepting ar:// navigation, manages Wayfinder lifecycle and Solana ARIO initialization (`arioFromStorage()` with fallback to devnet defaults)
- **Content script** (`src/content.ts`): Converts ar:// links on pages
- **Routing module** (`src/routing.ts`): Thread-safe singleton Wayfinder instance with promise tracking to prevent duplicate initialization
- Uses Vite for building, outputs to `dist/`

#### Solana Configuration (Extension)

The extension stores Solana network config in `chrome.storage.local`:
- `network` (`NetworkPreset`: `'mainnet' | 'devnet' | 'custom'`) — defaults to `devnet`
- `rpcUrl`, `coreProgramId`, `garProgramId`, `arnsProgramId`, `antProgramId` — Solana program addresses
- Presets defined in `src/constants.ts`: `AR_IO_SOLANA_DEVNET`, `AR_IO_SOLANA_MAINNET`
- Legacy AO keys (`processId`, `aoCuUrl`) are auto-migrated away on startup via `migrateStorageFromAOEra()`

## Coding Guidelines

### Function Parameters
Always prefer object parameters over positional arguments for functions with 3+ parameters or optional parameters:

```typescript
// Good
type CreateFunctionParams = {
  name: string;
  logger?: Logger;
  timeout?: number;
};

function createFunction({ name, logger, timeout = 5000 }: CreateFunctionParams): void {}

// Bad
function createFunction(name: string, logger?: Logger, timeout?: number): void {}
```

### Code Style
- Uses Biome for formatting (2-space indent, single quotes, import organization enabled)
- ESLint enforces Apache 2.0 license headers on all `.ts`/`.tsx` files (except `experimental/`). Header template: `resources/license.header.mjs`
- Pre-commit hook automatically formats staged files with Biome
- Biome config registers `chrome` as a global (for extension code)
- Architecture: Code to interfaces, prefer composition over inheritance, prefer type safety
- Testing: Prefer integration tests over unit tests
  - Core packages use `tsx --test` (Node.js native test runner with `node:test` module — `describe`/`it`/`mock`/`beforeEach`)
  - CLI uses vitest for testing

### Chunk API Usage
**CRITICAL**: When making chunk requests to `/chunk/<offset>/data`, DO NOT include the root transaction ID in the URL path. The correct format is just `/chunk/<offset>/data`.

## Contributing

1. Branch from `develop` (default branch)
2. Make changes and create a changeset: `npx changeset`
3. PR to `alpha` for prereleases, `main` for stable releases
4. Releases are automated via GitHub Actions using Changesets
5. CI tracks `main`, `alpha`, and `solana` branches
