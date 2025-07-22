# @ar.io/wayfinder-core

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
