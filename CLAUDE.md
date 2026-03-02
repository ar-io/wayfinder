# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Wayfinder is a client-side routing and verification protocol for accessing data on Arweave through the AR.IO Network. It provides decentralized, cryptographically verified access to `ar://` URLs.

## Monorepo Structure

- **packages/wayfinder-core**: Core TypeScript library - routing strategies, verification, gateway providers
- **packages/wayfinder-react**: React hooks and context providers wrapping wayfinder-core
- **packages/wayfinder-extension**: Chrome extension for intercepting ar:// URLs
- **experimental/wayfinder-cli**: CLI tool for fetching files via Wayfinder
- **experimental/wayfinder-x402-fetch**: x402 payment protocol integration

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

The core library uses a strategy pattern with three main extension points:

1. **Gateway Providers** (`src/gateways/`): Supply lists of AR.IO gateways
   - `NetworkGatewaysProvider`: Fetches from AR.IO on-chain registry (requires @ar.io/sdk)
   - `TrustedPeersGatewaysProvider`: Fetches from gateway's `/ar-io/peers` endpoint
   - `StaticGatewaysProvider`: Returns a fixed list
   - `SimpleCacheGatewaysProvider` / `LocalStorageGatewaysProvider`: Caching wrappers

2. **Routing Strategies** (`src/routing/`): Select which gateway to use
   - `RandomRoutingStrategy`: Random selection for load balancing
   - `PingRoutingStrategy`: Selects fastest responding gateway
   - `StaticRoutingStrategy`: Always uses one gateway
   - `RoundRobinRoutingStrategy`: Cycles through gateways
   - `PreferredWithFallbackRoutingStrategy`: Primary gateway with fallback
   - `CompositeRoutingStrategy`: Chains multiple strategies

3. **Verification Strategies** (`src/verification/`): Verify data integrity
   - `HashVerificationStrategy`: SHA-256 hash comparison against trusted gateway
   - `DataRootVerificationStrategy`: Computes Arweave data root
   - `SignatureVerificationStrategy`: Verifies tx/data-item signatures
   - `RemoteVerificationStrategy`: Trusts gateway's `x-ar-io-verified` header

4. **Data Retrieval Strategies** (`src/retrieval/`): How to fetch data
   - `ContiguousDataRetrievalStrategy`: Direct GET request (default)
   - `ChunkDataRetrievalStrategy`: Assembles data from chunk API

### Main Entry Point

`Wayfinder` class (`src/wayfinder.ts`) orchestrates everything:
- `request(url)`: Fetch with routing + optional verification
- `resolveUrl(params)`: Get gateway URL without fetching

### Chrome Extension (wayfinder-extension)

- **Background script** (`src/background.ts`): Service worker intercepting ar:// navigation
- **Content script** (`src/content.ts`): Converts ar:// links on pages
- **Routing module** (`src/routing.ts`): Manages singleton Wayfinder instance
- Uses Vite for building, outputs to `dist/`

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
- Uses Biome for formatting (2-space indent, single quotes)
- ESLint enforces Apache 2.0 license headers on all `.ts` files
- Pre-commit hook automatically formats staged files with Biome
- Architecture: Code to interfaces, prefer composition over inheritance, prefer type safety
- Testing: Prefer integration tests over unit tests
  - Core packages use `tsx --test` (Node.js native test runner)
  - CLI uses vitest for testing

### Chunk API Usage
**CRITICAL**: When making chunk requests to `/chunk/<offset>/data`, DO NOT include the root transaction ID in the URL path. The correct format is just `/chunk/<offset>/data`.

## Contributing

1. Branch from `alpha` (not `main`)
2. Make changes and create a changeset: `npx changeset`
3. PR to `alpha` for prereleases, `main` for stable releases
4. Releases are automated via GitHub Actions using Changesets
