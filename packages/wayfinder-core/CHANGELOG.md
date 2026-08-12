# @ar.io/wayfinder-core

## 2.0.2

### Patch Changes

- Fix defects that only reproduce outside the monorepo, under strict verification,
  or via the zero-argument constructor:

  - **The default gateway source had no fallback.** Peer discovery is a single
    point of failure: `turbo-gateway.com/ar-io/peers` has been observed
    answering `200` with an empty `gateways` map for sustained periods, which
    left `createWayfinderClient()` and `new Wayfinder()` unable to serve any
    request. Both now default to a `CompositeGatewaysProvider` that falls back
    to the trusted gateway itself, turning that outage into a degradation.
    Exposed as `createDefaultGatewaysProvider()`.

  - **`NetworkGatewaysProvider` could return a partial registry.** A failed page
    exited the pagination loop and the remaining gateways were sorted and
    returned as if complete. Because `limit` is applied after sorting, that
    returned the *wrong* gateways rather than merely fewer. It now retries the
    failed page and throws once retries are exhausted, so a composite provider
    can fall through.

  - **`new Wayfinder()` could not serve a single request.** The default routing
    strategy is a `PingRoutingStrategy` wrapping a `RandomRoutingStrategy`. The
    gateways provider was passed only to the inner strategy, and the provider
    injection in the constructor runs solely when the caller supplies their own
    strategy — so the wrapper resolved an empty candidate list and threw
    "No gateways available" on every call. The default now receives the provider,
    and `PingRoutingStrategy` falls back to its wrapped strategy when it has no
    candidate list of its own instead of failing (an explicitly empty `gateways`
    array still throws). `createWayfinderClient()` was unaffected.

  - **The published package could not be imported in Node.** `@dha-team/arbundles`
    imports `axios` without declaring it as a dependency, and its Node ESM entry is
    reached from `src/index.ts` via the signature verification strategy. A clean
    `npm i @ar.io/wayfinder-core` followed by `import '@ar.io/wayfinder-core'`
    failed with `ERR_MODULE_NOT_FOUND: Cannot find package 'axios'`. This was masked
    in-repo because another dependency hoists axios into the monorepo's
    `node_modules`. `axios` is now declared explicitly.

  - **`NetworkGatewaysProvider` ignored `sortBy` / `sortOrder`.** The Solana
    backend of `@ar.io/sdk` accepts both parameters but its `paginate()` helper
    slices the account list without applying either, so gateways arrived in
    on-chain account order. Combined with an early exit from pagination, any
    `limit` smaller than the registry returned an arbitrary subset rather than the
    top-ranked gateways — `limit: 20` with the default `operatorStake` / `desc`
    did not give you the 20 highest-staked gateways. Sorting is now applied
    client-side over the full registry (including dotted paths such as
    `weights.stakeWeight`), and paging is done at the SDK maximum so a small
    `limit` still costs a single request.

  - **Ping strategies probed the sandboxed content URL instead of the gateway.**
    `PingRoutingStrategy` and `FastestPingRoutingStrategy` HEAD-checked
    `<sandbox>.<gateway>/<txid>`, which forces the gateway to resolve the data
    before it can answer and requires wildcard DNS/TLS on the sandbox host. With
    the default 1s budget that succeeded for ~23% of peers, against ~85% for a
    HEAD of the gateway root — and the gap is latency, not breakage, since the
    sandboxed URL reaches ~78% given 10s. The probe now targets the gateway root,
    configurable via a new `probePath` option on both strategies.

  - **`TrustedPeersGatewaysProvider` returned an empty list silently.** A gateway
    serving `/ar-io/peers` can respond 200 with an empty `gateways` map, which
    surfaced much later as an opaque "No gateways available" from whichever
    routing strategy consumed it. It now retries (configurable via `retries`,
    default 3) and then throws an error naming the endpoint. `CompositeGatewaysProvider`
    and `SimpleCacheGatewaysProvider` both treat that as a signal to fall back.

  - **Chunk retrieval blamed the data for an unsupported endpoint.** A gateway
    that doesn't implement `/chunk/<offset>/data` may still answer 200 without
    the `X-Arweave-Chunk-*` headers; that produced a confusing
    "Chunk transaction ID mismatch … Got: null". It now reports that the gateway
    did not return a chunk response.

  - **Strict-mode verification failures emitted an unhandled promise rejection.**
    The verification promise is created eagerly but only awaited once the client
    stream drains, so a strategy that rejects immediately (such as
    `RemoteVerificationStrategy`, which inspects response headers) left the
    rejection unhandled — terminating Node processes running under the default
    `--unhandled-rejections=throw`. The rejection is now marked handled at creation;
    callers still observe the failure exactly as before.

## 2.0.1

### Patch Changes

- ad4e883: Resiliency improvements for gateway routing and data retrieval.

  - Gateway retry: automatically re-selects a different gateway and retries
    (up to 3 attempts) on 5xx errors or network failures. 4xx client errors
    are returned immediately without retry.
  - Smart pagination: NetworkGatewaysProvider stops fetching from the on-chain
    registry once enough gateways pass the filter, avoiding unnecessary RPC calls.
  - Fetch timeouts: configurable timeouts on all outbound requests (10s metadata, 30s data).
  - Updated gateway header constants for Solana-era responses.

## 1.9.2

### Patch Changes

- 954e60e: Replace hardcoded gateway defaults with turbo-gateway.com

  - Replace arweave.net and permagate.io defaults with turbo-gateway.com throughout codebase
  - Update all fallback gateways to use AR.IO-compatible gateway
  - Update documentation examples to use turbo-gateway.com
  - Fix integration tests to use turbo-gateway.com instead of permagate.io
  - Fix flaky test by excluding timestamp header from ArNS header comparison
  - No breaking changes - all user configurations still work as before
  - arweave.net is no longer an AR.IO gateway and doesn't support /ar-io/\* endpoints

## 1.9.1

### Patch Changes

- b8c9a9f: Fix verification for manifest and raw data endpoints

  - Add automatic manifest detection via x-ar-io-data-id and x-arns-resolved-id headers
  - When dataId !== resolvedId, verify against the actual served content (e.g., index.html)
  - Add raw parameter support for /raw/{txId} endpoint verification
  - Add normalizeHeaders utility to reduce code duplication

<<<<<<< HEAD

## 1.9.0-alpha.1

### Patch Changes

- b8c9a9f: Fix verification for manifest and raw data endpoints

  - Add automatic manifest detection via x-ar-io-data-id and x-arns-resolved-id headers
  - When dataId !== resolvedId, verify against the actual served content (e.g., index.html)
  - Add raw parameter support for /raw/{txId} endpoint verification
  - # Add normalizeHeaders utility to reduce code duplication

## 1.9.0

### Minor Changes

- f0ee281: Add CompositeGatewaysProvider for fallback gateway resolution

  - Tries multiple GatewaysProvider instances in order until one succeeds
  - Skips providers that fail or return empty gateway lists
  - Includes addProvider() and getProviders() helper methods
    > > > > > > > origin/main

## 1.9.0-alpha.0

### Minor Changes

- f0ee281: Add CompositeGatewaysProvider for fallback gateway resolution

  - Tries multiple GatewaysProvider instances in order until one succeeds
  - Skips providers that fail or return empty gateway lists
  - Includes addProvider() and getProviders() helper methods

## 1.8.1

### Patch Changes

- 4e1d694: Export retrieval strategies, add utility for converting legacy config to newest `WayfinderFetchOptions` type

## 1.8.1-alpha.0

### Patch Changes

- 4e1d694: Export retrieval strategies, add utility for converting legacy config to newest `WayfinderFetchOptions` type

## 1.8.0

### Minor Changes

- 8dff382: Add `DataRetrievalStrategy` interface for fetching data from AR.IO gateways. Implement `ContiguousDataRetrievalStrategy` (default) and `ChunkDataRetrievalStrategy`.

## 1.8.0-alpha.0

### Minor Changes

- 8dff382: Add `DataRetrievalStrategy` interface for fetching data from AR.IO gateways. Implement `ContiguousDataRetrievalStrategy` (default) and `ChunkDataRetrievalStrategy`.

## 1.7.2

### Patch Changes

- 3f52698: fix infinite recursion in `preferred` routing strategy fallback resolution

## 1.7.2-alpha.0

### Patch Changes

- 3f52698: fix infinite recursion in `preferred` routing strategy fallback resolution

## 1.7.1

### Patch Changes

- 75915fd: Update README.md to include x402 support
- 3c3c598: Expose `TrustedPeersGatewaysProvider` from index.tsx for top level imports
- b1c2c48: Add support for custom `fetch` implementations to be given to Wayfinder. This will pave the way to support fetching via x402, chunk based data retreival, etc.
- 4619cad: Update npm to use OIDC for publishing

## 1.7.1-alpha.2

### Patch Changes

- 3c3c598: Expose `TrustedPeersGatewaysProvider` from index.tsx for top level imports

## 1.7.1-alpha.1

### Patch Changes

- bfea49d: Update npm to use OIDC for publishing

## 1.7.1-alpha.0

### Patch Changes

- 75915fd: Update README.md to include x402 support

## 1.7.0

### Minor Changes

- 1e07a31: feat: deprecate gatewaysProvider parameter on Wayfinder class

  This change deprecates the `gatewaysProvider` parameter on the Wayfinder class while maintaining full backwards compatibility. Routing strategies now manage their own gateways internally, providing better separation of concerns.

  **Breaking Changes**: None - this change is fully backwards compatible

  **Changes**:

  - Mark `gatewaysProvider` as `@deprecated` in Wayfinder class and WayfinderOptions interface
  - Update `wayfinderFetch` to get gateways from routing strategies instead of requiring separate gatewaysProvider
  - Maintain backwards compatibility by automatically injecting gatewaysProvider into routing strategies when provided
  - Update telemetry to remove gatewaysProvider parameter dependency
  - Reorganize `createWayfinderClient` to properly handle gateways provider creation and caching

  **Migration Guide**:
  No immediate action required. The deprecated `gatewaysProvider` parameter will continue to work as before. For new code, prefer creating routing strategies with their own `gatewaysProvider` parameter:

  ```typescript
  // Old (still works, but deprecated)
  const wayfinder = new Wayfinder({
    gatewaysProvider: myGatewaysProvider,
    routingSettings: {
      strategy: new RandomRoutingStrategy(),
    },
  });

  // New (recommended)
  const wayfinder = new Wayfinder({
    routingSettings: {
      strategy: new RandomRoutingStrategy({
        gatewaysProvider: myGatewaysProvider,
      }),
    },
  });
  ```

## 1.7.0-alpha.0

### Minor Changes

- 1e07a31: feat: deprecate gatewaysProvider parameter on Wayfinder class

  This change deprecates the `gatewaysProvider` parameter on the Wayfinder class while maintaining full backwards compatibility. Routing strategies now manage their own gateways internally, providing better separation of concerns.

  **Breaking Changes**: None - this change is fully backwards compatible

  **Changes**:

  - Mark `gatewaysProvider` as `@deprecated` in Wayfinder class and WayfinderOptions interface
  - Update `wayfinderFetch` to get gateways from routing strategies instead of requiring separate gatewaysProvider
  - Maintain backwards compatibility by automatically injecting gatewaysProvider into routing strategies when provided
  - Update telemetry to remove gatewaysProvider parameter dependency
  - Reorganize `createWayfinderClient` to properly handle gateways provider creation and caching

  **Migration Guide**:
  No immediate action required. The deprecated `gatewaysProvider` parameter will continue to work as before. For new code, prefer creating routing strategies with their own `gatewaysProvider` parameter:

  ```typescript
  // Old (still works, but deprecated)
  const wayfinder = new Wayfinder({
    gatewaysProvider: myGatewaysProvider,
    routingSettings: {
      strategy: new RandomRoutingStrategy(),
    },
  });

  // New (recommended)
  const wayfinder = new Wayfinder({
    routingSettings: {
      strategy: new RandomRoutingStrategy({
        gatewaysProvider: myGatewaysProvider,
      }),
    },
  });
  ```

## 1.6.1

### Patch Changes

- a6c3905: Update `@opentelemetry/exporter-trace-otlp-http` to `0.206.0` in `wayfinder-core` to fix `XMLHTTPRequest` errors caused by telemetry in `wayfinder-extension`

## 1.6.1-alpha.0

### Patch Changes

- a6c3905: Update `@opentelemetry/exporter-trace-otlp-http` to `0.206.0` in `wayfinder-core` to fix `XMLHTTPRequest` errors caused by telemetry in `wayfinder-extension`

## 1.6.0

### Minor Changes

- 53f87a1: Add `CompositeRoutingStrategy` for complex routing composition'

## 1.5.0

### Minor Changes

- 93b02c5: Change default gateway provider to TrustedPeersGatewaysProvider for dynamic gateway discovery

## 1.4.3

### Patch Changes

- 6a872b5: Allow providing `telemetry` settings to `createWayfinderClient`

## 1.4.3-alpha.0

### Patch Changes

- 6a872b5: Allow providing `telemetry` settings to `createWayfinderClient`

## 1.4.2

### Patch Changes

- 46c3110: fix: adjust check logic on round-robin strategy initialization with gateways provider

## 1.4.2-alpha.0

### Patch Changes

- 46c3110: fix: adjust check logic on round-robin strategy initialization with gateways provider

## 1.4.1

### Patch Changes

- e57bfb6: Pass custom logger to routing and verification strategies
- cd1719d: fix: allow createWayfinderClient to initialize with default configuration when no arguments are provided

## 1.4.0

### Minor Changes

- c3fc591: Add createWayfinderClient utility function with simplified API

  This release introduces a new `createWayfinderClient` utility function that makes it easy for developers to create Wayfinder instances with sensible defaults and simplified configuration.

  **New Features:**

  - **createWayfinderClient()** - Simple factory function for creating Wayfinder instances
  - **Gateway Selection Options** - Choose from 'top-ranked', 'most-tenured', 'best-performance', 'highest-staked', 'longest-streak' when using AR.IO network
  - **Routing Strategies** - Support for 'random', 'fastest', 'round-robin', 'preferred' routing
  - **Verification Strategies** - Support for 'hash', 'data-root', 'remote', 'disabled' verification
  - **Intelligent Caching** - Automatic localStorage (browser) and memory (Node.js) caching
  - **Optional AR.IO SDK Dependency** - The @ar.io/sdk is now an optional peer dependency

  **Usage:**

  ```javascript
  // Simple usage with defaults
  const wayfinder = createWayfinderClient();

  // With AR.IO network integration
  const wayfinder = createWayfinderClient({
    ario: ARIO.mainnet(),
    gatewaySelection: "top-ranked",
    routing: "fastest",
    verification: "hash",
    cache: { ttlSeconds: 600 },
  });
  ```

- 98d47cd: Add support for providing `cacheKey` to local storage gateways provider'
- 9fad87b: Add support for providing `gatewaysProvider` directly to routing strategies

### Patch Changes

- eb839e4: Relax verification strategy type on Wayfinder client when verification disabled

## 1.4.0-alpha.2

### Patch Changes

- eb839e4: Relax verification strategy type on Wayfinder client when verification disabled

## 1.4.0-alpha.1

### Minor Changes

- 98d47cd: Add support for providing `cacheKey` to local storage gateways provider'

## 1.4.0-alpha.0

### Minor Changes

- c3fc591: Add createWayfinderClient utility function with simplified API

  This release introduces a new `createWayfinderClient` utility function that makes it easy for developers to create Wayfinder instances with sensible defaults and simplified configuration.

  **New Features:**

  - **createWayfinderClient()** - Simple factory function for creating Wayfinder instances
  - **Gateway Selection Options** - Choose from 'highest-performing', 'longest-tenure', 'highest-staked', 'highest-weight', 'longest-streak' when using AR.IO network
  - **Routing Strategies** - Support for 'random', 'fastest', 'round-robin', 'preferred' routing
  - **Verification Strategies** - Support for 'hash', 'data-root', 'remote', 'disabled' verification
  - **Intelligent Caching** - Automatic localStorage (browser) and memory (Node.js) caching
  - **Optional AR.IO SDK Dependency** - The @ar.io/sdk is now an optional peer dependency

  **Usage:**

  ```javascript
  // Simple usage with defaults
  const wayfinder = createWayfinderClient();

  // With AR.IO network integration
  const wayfinder = createWayfinderClient({
    ario: ARIO.mainnet(),
    gatewaySelection: "highest-performing",
    routing: "fastest",
    verification: "hash",
    cache: { ttlSeconds: 600 },
  });
  ```

- 9fad87b: Add support for providing `gatewaysProvider` directly to routing strategies

## 1.3.1

### Patch Changes

- e3990c3: Added debug logs to `PingRoutingStrategy`

## 1.3.1-alpha.0

### Patch Changes

- e3990c3: Added debug logs to `PingRoutingStrategy`

## 1.3.0

### Minor Changes

- 2779d52: Add `TrustedPeersGatewaysProvider` as optional gateway provider

## 1.3.0-alpha.0

### Minor Changes

- 2779d52: Add `TrustedPeersGatewaysProvider` as optional gateway provider

## 1.2.1

### Patch Changes

- d5693fd: Set `timeoutMs` to 1 second for `PingRoutingStrategy`, add `url` to `requestSpan` on fetch'

## 1.2.0

### Minor Changes

- 2d5970f: Add `PingRoutingStrategy` that performs a HEAD check on gateway returned from provided routing strategy

## 1.2.0-alpha.0

### Minor Changes

- 2d5970f: Add `PingRoutingStrategy` that performs a HEAD check on gateway returned from provided routing strategy

## 1.1.1

### Patch Changes

- b246f78: Provide gateways when calling `selectGateway` in `resolveUrl`

## 1.1.0

### Minor Changes

- 69ddbfb: Add runtime configuration methods for routing and verification strategies

## 1.1.0-alpha.0

### Minor Changes

- 69ddbfb: Add runtime configuration methods for routing and verification strategies

## 1.0.7

### Patch Changes

- 658c5f6: Fix `SimpleCacheRoutingStrategy` to avoid duplicate requests to routingStrategy

## 1.0.6

### Patch Changes

- a42d57c: Allow `gatewaysProvider` to be optional, use `StaticGatewaysProvider` by default

## 1.0.6-alpha.0

### Patch Changes

- a42d57c: Allow `gatewaysProvider` to be optional, use `StaticGatewaysProvider` by default

## 1.0.5

### Patch Changes

- 73aa1b9: Adds `RemoteVerificationStrategy` and modifies verifyData interface to support optional response headers to use when verifying data'
- b7299cc: Remove unused parameters from various routing stratgies.
- b81b54e: Remove extra `gateways` arg in `RoundRobinRoutingStrategy`

## 1.0.5-alpha.2

### Patch Changes

- b7299cc: Remove unused parameters from various routing stratgies.

## 1.0.5-alpha.1

### Patch Changes

- b81b54e: Remove extra `gateways` arg in `RoundRobinRoutingStrategy`

## 1.0.5-alpha.0

### Patch Changes

- 73aa1b9: Adds `RemoteVerificationStrategy` and modifies verifyData interface to support optional response headers to use when verifying data'

## 1.0.4

### Patch Changes

- 719acbd: Add `require` and `default` exports to wayfinder-core

## 1.0.3

### Patch Changes

- 86bdc2f: Prevent duplicate requests in LocalStorageGatewaysProvider and SimpleCacheGatewaysProvider
- 226f3af: Fix defaultTtlSeconds in gateway caches'

## 1.0.3-alpha.1

### Patch Changes

- 226f3af: Fix defaultTtlSeconds in gateway caches'

## 1.0.3-alpha.0

### Patch Changes

- 86bdc2f: Prevent duplicate requests in LocalStorageGatewaysProvider and SimpleCacheGatewaysProvider

## 1.0.2

### Patch Changes

- 8f79caf: Fix import of zone.js file, only load once and in browsers if not already available
- a3e69af: Add support for `clientName` and `clientVersion` on telemetry settings
- cfcfb66: Default Wayfinder to use `RandomRoutingStrategy`

## 1.0.2-alpha.2

### Patch Changes

- 8f79caf: Fix import of zone.js file, only load once and in browsers if not already available

## 1.0.2-alpha.1

### Patch Changes

- cfcfb66: Default Wayfinder to use `RandomRoutingStrategy`

## 1.0.2-alpha.0

### Patch Changes

- a3e69af: Add support for `clientName` and `clientVersion` on telemetry settings

## 1.0.1

### Patch Changes

- aa5700e: Improve telemetry configuration for browsers and chrome extensions
- 2c170be: Adds additional telemetry support when calling resolveUrl
- c78effa: Add LocalStorageGatewaysProvider cache as main export from wayfinder-core

## 1.0.1-alpha.2

### Patch Changes

- c78effa: Add LocalStorageGatewaysProvider cache as main export from wayfinder-core

## 1.0.1-alpha.1

### Patch Changes

- 2c170be: Adds additional telemetry support when calling resolveUrl

## 1.0.1-alpha.0

### Patch Changes

- aa5700e: Improve telemetry configuration for browsers and chrome extensions

## 1.0.0

### Major Changes

- 89c0efe: Initial wayfinder-core release
