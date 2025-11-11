# @ar.io/wayfinder-core

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
