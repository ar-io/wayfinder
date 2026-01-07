# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Wayfinder is a monorepo containing tools and libraries for decentralized, cryptographically verified access to data stored on Arweave via the AR.IO Network. It enables routing to optimal AR.IO gateways and provides verification strategies for data integrity.

## Monorepo Structure

This is a Yarn workspaces monorepo with the following packages:

- **packages/wayfinder-core** - Core TypeScript library for routing and verification protocol
- **packages/wayfinder-react** - React components, hooks, and context provider
- **packages/wayfinder-extension** - Chrome browser extension for ar:// protocol support
- **experimental/** - Experimental packages (e.g., x402 payment integration)

## Common Development Commands

### Building
```bash
# Build all packages
npm run build

# Build specific package
npm run build --workspace=packages/wayfinder-core

# Clean all build artifacts
npm run clean
```

### Testing
```bash
# Run all tests across monorepo
npm test

# Run tests in specific package
npm test --workspace=packages/wayfinder-core

# Run unit tests with coverage (in wayfinder-core)
cd packages/wayfinder-core && npm run test:unit

# Run single test file
cd packages/wayfinder-core && tsx --test src/path/to/file.test.ts
```

### Linting and Formatting
```bash
# Check and fix linting issues
npm run lint:check
npm run lint:fix

# Check and fix formatting issues
npm run format:check
npm run format:fix
```

### Browser Extension Development
```bash
cd packages/wayfinder-extension

# Build extension for Chrome
npm run build

# Development mode with file watching
npm run dev

# Load unpacked extension from packages/wayfinder-extension/dist in chrome://extensions/
```

## Architecture Principles

1. **Code to interfaces** - Design around abstractions, not implementations
2. **Prefer type safety over runtime safety** - Leverage TypeScript's type system
3. **Prefer composition over inheritance** - Use strategy pattern extensively
4. **Prefer integration tests over unit tests** - Focus on real-world scenarios

## Core Architecture Concepts

### Strategy Pattern Design

Wayfinder is built around the Strategy pattern with three primary strategy types:

1. **Gateway Providers** (`GatewaysProvider` interface)
   - Supply lists of available AR.IO gateways
   - Examples: `NetworkGatewaysProvider`, `TrustedPeersGatewaysProvider`, `StaticGatewaysProvider`
   - Can be wrapped with caching: `SimpleCacheGatewaysProvider`, `LocalStorageGatewaysProvider`

2. **Routing Strategies** (`RoutingStrategy` interface)
   - Select optimal gateway from available options
   - Examples: `RandomRoutingStrategy`, `PingRoutingStrategy`, `RoundRobinRoutingStrategy`
   - Advanced: `CompositeRoutingStrategy` (chains strategies), `PreferredWithFallbackRoutingStrategy`

3. **Verification Strategies** (`VerificationStrategy` interface)
   - Verify data integrity from gateways
   - Examples: `HashVerificationStrategy`, `DataRootVerificationStrategy`, `SignatureVerificationStrategy`, `RemoteVerificationStrategy`, `ManifestVerificationStrategy`
   - Trade-offs between performance, complexity, and security

4. **Data Retrieval Strategies** (`DataRetrievalStrategy` interface)
   - Fetch transaction data from gateways
   - `ContiguousDataRetrievalStrategy` - Standard GET requests (default)
   - `ChunkDataRetrievalStrategy` - Chunk-based assembly via `/chunk/<offset>/data`

### Manifest Verification

The `ManifestVerificationStrategy` (packages/wayfinder-core/src/verification/manifest-verification.ts) provides special handling for Arweave manifests:
- Parses manifest structure via `ManifestParser` (packages/wayfinder-core/src/manifest/parser.ts)
- Verifies individual manifest entries using underlying verification strategy
- Caches verification results via `ManifestVerificationCache` (packages/wayfinder-core/src/manifest/verification-cache.ts)
- Ensures path resolution within manifests is secure and verified

### URL Resolution Flow

1. Client provides URL in various formats (ar://, txId, arnsName, legacy arweave.net)
2. `createWayfinderUrl()` normalizes to `ar://<identifier>` format (packages/wayfinder-core/src/wayfinder.ts:~72)
3. `extractRoutingInfo()` parses subdomain and path from ar:// URL (packages/wayfinder-core/src/wayfinder.ts:~118)
   - Transaction IDs → sandbox subdomain (for security isolation via `sandboxFromId()`)
   - ArNS names → name as subdomain
4. Routing strategy selects gateway from available options
5. `constructGatewayUrl()` builds final URL with subdomain routing (packages/wayfinder-core/src/wayfinder.ts:~176)
   - Special handling for localhost (port-based, not subdomain-based)

### Request Processing Flow

1. `Wayfinder.request()` → `createWayfinderFetch()` (packages/wayfinder-core/src/fetch/wayfinder-fetch.ts)
2. URL resolution via routing strategy
3. Data retrieval via selected strategy
4. Optional verification via verification strategy (can be strict/blocking or async)
5. Events emitted via `WayfinderEmitter` throughout process

### Event System

The `WayfinderEmitter` (packages/wayfinder-core/src/emitter.ts) extends EventEmitter3 and provides:
- Global event listeners on Wayfinder instance
- Request-specific event handlers via `WayfinderRequestInit`
- Event types: routing-started/succeeded/failed, verification-succeeded/failed/progress

### Browser Extension Architecture

The Chrome extension (packages/wayfinder-extension) intercepts ar:// URLs:

1. **Background Script** (src/background.ts) - Manifest V3 service worker
   - Intercepts ar:// navigation via `chrome.tabs.onUpdated`
   - Manages singleton WayFinder instance lifecycle
   - Tracks gateway performance metrics and circuit breaking
   - Syncs with AR.IO gateway registry

2. **Content Script** (src/content.ts)
   - Converts ar:// links on pages to gateway URLs
   - Minimal logic, delegates to background script

3. **Routing Module** (src/routing.ts)
   - Thread-safe singleton initialization with promise tracking
   - Handles ENS and ArNS name resolution

4. **UI Pages** - popup.ts, settings.ts, gateways.ts, performance.ts

## Function Argument Convention

**CRITICAL**: Always prefer object parameters over positional arguments for functions with:
- More than 2 parameters
- Optional parameters
- Potential for future expansion
- Public API functions

### Good Example
```typescript
type CreateFunctionParams = {
  name: string;
  logger?: Logger;
  timeout?: number;
};

function createFunction({ name, logger, timeout = 5000 }: CreateFunctionParams) {
  // implementation
}
```

### Bad Example
```typescript
function createFunction(name: string, logger?: Logger, timeout?: number) {
  // usage requires: createFunction('name', undefined, 10000)
}
```

## Critical Implementation Details

### Chunk API Usage

When making chunk requests to AR.IO gateways:

**CRITICAL**: Use `/chunk/<offset>/data` format WITHOUT the root transaction ID in the path.

❌ Incorrect: `/chunk/<root-tx-id>/<offset>/data`
✅ Correct: `/chunk/<offset>/data`

The gateway determines the root transaction internally based on the offset.

### TypeScript Configuration

- Target: `esnext`
- Module: `nodenext` with `nodenext` resolution
- Strict mode enabled
- Each package has its own tsconfig.json extending root

### Testing Conventions

- Tests located alongside source files: `*.test.ts`
- Use Node.js built-in test runner: `tsx --test`
- Coverage via c8: `c8 tsx --test 'src/**/*.test.ts'`
- Focus on integration tests over isolated unit tests

### Changesets for Versioning

This project uses changesets for version management:

1. Create changesets when making changes: `npx changeset`
2. Select affected packages during changeset creation
3. Changesets are consumed during release process
4. Two release tracks:
   - `alpha` branch → alpha prereleases
   - `main` branch → stable releases

## Package-Specific Details

### wayfinder-core

Entry point: `src/index.ts` exports all public APIs
Main class: `Wayfinder` (src/wayfinder.ts)
Client factory: `createWayfinderClient` (src/client.ts)

Key directories:
- `src/routing/` - Routing strategy implementations
- `src/verification/` - Verification strategy implementations
- `src/gateways/` - Gateway provider implementations
- `src/retrieval/` - Data retrieval strategies
- `src/manifest/` - Manifest parsing and verification
- `src/fetch/` - Fetch wrappers and request handling
- `src/utils/` - Shared utilities (hashing, base64, verification helpers)

### wayfinder-react

Provides React bindings for wayfinder-core:
- `WayfinderProvider` - Context provider wrapping Wayfinder instance
- `useWayfinderUrl` - Hook to resolve ar:// URLs to gateway URLs
- `useWayfinderRequest` - Hook to fetch and optionally verify data

### wayfinder-extension

Chrome extension with Manifest V3:
- Uses Vite for bundling with `vite-plugin-static-copy` for assets
- `manifest.json` as build entry point
- Outputs to `dist/` directory

Key modules:
- `src/background.ts` - Service worker handling ar:// navigation interception
- `src/routing.ts` - Singleton WayFinder instance with thread-safe initialization
- `src/content.ts` - Content script for converting ar:// links on web pages
- `src/ens.ts` - ENS (Ethereum Name Service) resolution support
- `src/adapters/chrome-storage-gateway-provider.ts` - Chrome storage adapter for gateway caching

Chrome storage keys:
- `localGatewayAddressRegistry` - Cached gateway data from AR.IO network
- `gatewayPerformance` - Response times and success rates (Exponential Moving Average)
- `routingMethod` - Current routing strategy (fastestPing/random/static)
- `dailyStats` - Usage metrics reset daily
- `ensResolutionEnabled` - ENS resolution toggle
- `arIOProcessId` - Custom AR.IO process ID
- `aoCuUrl` - Custom AO Compute Unit URL

## Development Workflow

1. Branch from `alpha` (not `main`)
2. Make changes and create changeset: `npx changeset`
3. Push branch and create PR to `alpha`
4. After review, merge to `alpha`
5. Automated release PR will be created with pending changesets
6. Maintainer merges release PR to trigger publish

## Important Patterns

### ar:// URL Format Support

- `ar://TRANSACTION_ID` - Direct transaction ID
- `ar://arns-name` - ArNS name resolution
- `ar://arns-name/path` - ArNS with path
- `ar:///info` - Gateway endpoint access

### Sandbox Subdomain Generation

Transaction IDs use sandboxed subdomains for security isolation. Generation logic in `src/utils/base64.ts` (`sandboxFromId` function).

### Gateway Provider Caching

Gateway providers are typically wrapped with caching to reduce network calls:
- `SimpleCacheGatewaysProvider` - In-memory with TTL (default: 5 min)
- `LocalStorageGatewaysProvider` - Browser localStorage with TTL

### Telemetry (Optional)

OpenTelemetry integration (disabled by default):
- Initialized in `src/telemetry.ts`
- Spans track wayfinder operations
- Can export to custom OTLP endpoints
- Uses different providers based on environment:
  - Node: `NodeTracerProvider`
  - Web: `WebTracerProvider`
  - Basic: `BasicTracerProvider` (fallback)
- Note: May have browser compatibility issues with AsyncLocalStorage

### Extension Performance Tracking

The extension (packages/wayfinder-extension) tracks gateway performance:
- Uses Chrome's `webRequest` API to measure response times
- Circuit breaker: 3 consecutive failures = 2 minute timeout
- Performance metrics use Exponential Moving Average (α=0.2)
- `TabStateManager` class tracks redirected tabs with automatic cleanup
- Debounced gateway registry syncing to avoid excessive API calls
