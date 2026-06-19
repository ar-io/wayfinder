# @ar.io/wayfinder-extension

## 3.0.0

### Major Changes

- a5fb586: BREAKING: Wayfinder extension is now Solana-only. AO support has been
  removed.

  **Storage schema (breaking for AO-era users):**

  - The `processId` and `aoCuUrl` keys in `chrome.storage.local` are no
    longer used. On first run after upgrade, the extension detects them,
    silently deletes them, drops the cached `localGatewayAddressRegistry`
    (the AO gateway snapshot is irrelevant on Solana), and writes Solana
    devnet defaults: `network`, `rpcUrl`, `coreProgramId`, `garProgramId`,
    `arnsProgramId`, `antProgramId`. The next gateway sync repopulates the
    registry from the Solana network.
  - A single info-level log line is emitted on migration so the migration
    is visible in devtools.

  **Settings UI:**

  - "AR.IO Process ID" and "AO Compute Unit URL" fields removed.
  - Replaced with: a Network preset selector
    (`mainnet | devnet | custom`), a Solana RPC URL input, and a
    collapsible "Advanced: AR.IO Program IDs" panel exposing the four
    per-program addresses (core / GAR / ArNS / ANT). Preset modes auto-
    fill the RPC + program IDs and disable those inputs; Custom mode
    re-enables them for advanced operators (e.g., localnet developers).
  - All three presets are now selectable (`mainnet`, `devnet`, `custom`);
    the default preset on a fresh install is `devnet`.

  **Dependencies:**

  - Bumped `@ar.io/sdk` from `^3.21.0` to `^4.0.2`.
  - Bumped `@solana/kit` to `^6.8.0` (matches SDK v4.0.2 requirement).
  - Removed `@permaweb/aoconnect` (no longer needed).

  **Code:**

  - `src/background.ts`: dropped `AOProcess` / `connect` / AO process
    constants imports; added `arioFromStorage()` helper that constructs
    a Solana-backed `ARIO.init({rpc, ...programIds})`
    from `chrome.storage.local`; rewrote the four `ARIO.init` call sites
    to use the helper; added `migrateStorageFromAOEra()` to handle the
    storage schema bump.
  - `src/settings.ts`: replaced `handleProcessIdChange` /
    `handleAoCuUrlChange` with a single `handleNetworkConfigChange`
    routed to all six new field IDs; preset selection auto-fills RPC and
    program IDs; per-field edits validate the input
    (URL parsing for RPC, base58 Solana address parsing for program IDs).
  - `src/constants.ts`: removed `ARIO_MAINNET_PROCESS_ID`,
    `DEFAULT_AO_CU_URL`.
  - `src/config/defaults.ts`: replaced AO defaults
    (`processId`, `aoCuUrl`) with Solana devnet defaults
    (`network`, `rpcUrl`, four program IDs).

### Patch Changes

- a5fb586: Follow-up fixes after the Solana migration:

  - **Stop falling back to a mainnet gateway when the user is on a
    non-mainnet network.** `FALLBACK_GATEWAY` is hardcoded to a mainnet
    gateway (turbo-gateway.com); using it from a devnet or custom-network
    install would silently serve mainnet content under the user's
    chosen network. `routing.ts` now reads the `network` preset from
    storage and only triggers the mainnet fallback when
    `network === 'mainnet'`. On devnet or custom, the original routing
    error is propagated instead.

  - **Tolerate invalid stored network config on startup.** The IIFE that
    initializes the read-only `ARIO` instance on service-worker boot
    now wraps `arioFromStorage()` in a try/catch and falls back to the
    bundled devnet defaults if the user previously persisted a bad RPC
    URL or program ID via the custom-network preset. Previously, a
    single bad value could brick `debouncedInitializeWayfinder()` and
    leave routing inoperable until manual settings reset.

  - **Drop two orphan message-handler allowlist entries**
    (`resetAdvancedSettings`, `updateVerificationMode`) plus the
    unreachable `resetAdvancedSettings` handler body. Neither was wired
    to a UI control after the AO → Solana migration and the latter's
    responsibilities are covered by the existing
    `updateAdvancedSettings` flow.

- a5fb586: Internal: add Solana-network type definitions, constants, and defaults
  in preparation for the AO → Solana migration.

  - New `NetworkPreset` type (`'mainnet' | 'devnet' | 'custom'`) and
    `SolanaNetworkConfig` shape in `src/types.ts`.
  - `AR_IO_SOLANA_DEVNET` preset constant in `src/constants.ts` carrying
    the public devnet RPC URL and the four AR.IO program addresses (core,
    GAR, ArNS, ANT). `AR_IO_SOLANA_MAINNET` placeholder is `null` until
    AR.IO Solana mainnet deploys (now populated with live values).
  - `SOLANA_NETWORK_DEFAULTS` export in `src/config/defaults.ts` for use
    by the upcoming migration commit.

  This commit is purely additive — no existing code consumes the new
  exports yet, so there is no runtime behavior change. The subsequent
  PR will switch the extension's initialization and settings paths from
  AO to Solana, removing the AO-era constants, dropping
  `@permaweb/aoconnect`, and bumping `@ar.io/sdk` to `^4.0.0-solana.8`.

- Updated dependencies [a5fb586]
- Updated dependencies [a5fb586]
  - @ar.io/wayfinder-core@3.0.0

## 1.0.23

### Patch Changes

- 954e60e: Replace hardcoded gateway defaults with turbo-gateway.com

  - Replace arweave.net and permagate.io defaults with turbo-gateway.com throughout codebase
  - Update all fallback gateways to use AR.IO-compatible gateway
  - Update documentation examples to use turbo-gateway.com
  - Fix integration tests to use turbo-gateway.com instead of permagate.io
  - Fix flaky test by excluding timestamp header from ArNS header comparison
  - No breaking changes - all user configurations still work as before
  - arweave.net is no longer an AR.IO gateway and doesn't support /ar-io/\* endpoints

- Updated dependencies [954e60e]
  - @ar.io/wayfinder-core@1.9.2

## 1.0.22

### Patch Changes

- Updated dependencies [f0ee281]
  - @ar.io/wayfinder-core@1.9.0

## 1.0.22-alpha.0

### Patch Changes

- Updated dependencies [f0ee281]
  - @ar.io/wayfinder-core@1.9.0-alpha.0

## 1.0.21

### Patch Changes

- Updated dependencies [4e1d694]
  - @ar.io/wayfinder-core@1.8.1

## 1.0.21-alpha.0

### Patch Changes

- Updated dependencies [4e1d694]
  - @ar.io/wayfinder-core@1.8.1-alpha.0

## 1.0.20

### Patch Changes

- Updated dependencies [8dff382]
  - @ar.io/wayfinder-core@1.8.0

## 1.0.20-alpha.0

### Patch Changes

- Updated dependencies [8dff382]
  - @ar.io/wayfinder-core@1.8.0-alpha.0

## 1.0.19

### Patch Changes

- Updated dependencies [3f52698]
  - @ar.io/wayfinder-core@1.7.2

## 1.0.19-alpha.0

### Patch Changes

- Updated dependencies [3f52698]
  - @ar.io/wayfinder-core@1.7.2-alpha.0

## 1.0.18

### Patch Changes

- Updated dependencies [75915fd]
- Updated dependencies [3c3c598]
- Updated dependencies [b1c2c48]
- Updated dependencies [4619cad]
  - @ar.io/wayfinder-core@1.7.1

## 1.0.18-alpha.0

### Patch Changes

- Updated dependencies [75915fd]
  - @ar.io/wayfinder-core@1.7.1-alpha.0

## 1.0.17

### Patch Changes

- 19f5d0a: fix(extension): ensure async messages in background return responses
- 398dc74: Update extension to use latest Wayfinder class API

  - Fix static routing strategy assignment bug
  - Remove deprecated gatewaysProvider parameter from Wayfinder constructor
  - Pass gatewaysProvider directly to routing strategies
  - Remove invalid onRoutingFailed event handler
  - Update constructor to use latest API patterns

- Updated dependencies [1e07a31]
  - @ar.io/wayfinder-core@1.7.0

## 1.0.17-alpha.2

### Patch Changes

- 398dc74: Update extension to use latest Wayfinder class API

  - Fix static routing strategy assignment bug
  - Remove deprecated gatewaysProvider parameter from Wayfinder constructor
  - Pass gatewaysProvider directly to routing strategies
  - Remove invalid onRoutingFailed event handler
  - Update constructor to use latest API patterns

## 1.0.17-alpha.1

### Patch Changes

- Updated dependencies [1e07a31]
  - @ar.io/wayfinder-core@1.7.0-alpha.0

## 1.0.17-alpha.0

### Patch Changes

- 19f5d0a: fix(extension): ensure async messages in background return responses

## 1.0.16

### Patch Changes

- a6c3905: Update `@opentelemetry/exporter-trace-otlp-http` to `0.206.0` in `wayfinder-core` to fix `XMLHTTPRequest` errors caused by telemetry in `wayfinder-extension`
- Updated dependencies [a6c3905]
  - @ar.io/wayfinder-core@1.6.1

## 1.0.16-alpha.0

### Patch Changes

- a6c3905: Update `@opentelemetry/exporter-trace-otlp-http` to `0.206.0` in `wayfinder-core` to fix `XMLHTTPRequest` errors caused by telemetry in `wayfinder-extension`
- Updated dependencies [a6c3905]
  - @ar.io/wayfinder-core@1.6.1-alpha.0

## 1.0.15

### Patch Changes

- Updated dependencies [6a872b5]
  - @ar.io/wayfinder-core@1.4.3

## 1.0.15-alpha.0

### Patch Changes

- Updated dependencies [6a872b5]
  - @ar.io/wayfinder-core@1.4.3-alpha.0

## 1.0.14

### Patch Changes

- Updated dependencies [46c3110]
  - @ar.io/wayfinder-core@1.4.2

## 1.0.14-alpha.0

### Patch Changes

- Updated dependencies [46c3110]
  - @ar.io/wayfinder-core@1.4.2-alpha.0

## 1.0.13

### Patch Changes

- Updated dependencies [c3fc591]
- Updated dependencies [eb839e4]
- Updated dependencies [98d47cd]
- Updated dependencies [9fad87b]
  - @ar.io/wayfinder-core@1.4.0

## 1.0.13-alpha.0

### Patch Changes

- Updated dependencies [c3fc591]
- Updated dependencies [9fad87b]
  - @ar.io/wayfinder-core@1.4.0-alpha.0

## 1.0.12

### Patch Changes

- Updated dependencies [e3990c3]
  - @ar.io/wayfinder-core@1.3.1

## 1.0.12-alpha.0

### Patch Changes

- Updated dependencies [e3990c3]
  - @ar.io/wayfinder-core@1.3.1-alpha.0

## 1.0.11

### Patch Changes

- Updated dependencies [2779d52]
  - @ar.io/wayfinder-core@1.3.0

## 1.0.11-alpha.0

### Patch Changes

- Updated dependencies [2779d52]
  - @ar.io/wayfinder-core@1.3.0-alpha.0

## 1.0.10

### Patch Changes

- 736b5e3: Default `showVerificationToasts` to false

## 1.0.9

### Patch Changes

- 96e99d2: Wrap routing strategies in PingRoutingStrategy to avoid being directed to gateways that do not work.'

## 1.0.8

### Patch Changes

- 2d19291: Fix rendering race condition with verification toasts
- Updated dependencies [2d5970f]
  - @ar.io/wayfinder-core@1.2.0

## 1.0.8-alpha.0

### Patch Changes

- 2d19291: Fix rendering race condition with verification toasts
- Updated dependencies [2d5970f]
  - @ar.io/wayfinder-core@1.2.0-alpha.0

## 1.0.7

### Patch Changes

- Updated dependencies [69ddbfb]
  - @ar.io/wayfinder-core@1.1.0

## 1.0.7-alpha.0

### Patch Changes

- Updated dependencies [69ddbfb]
  - @ar.io/wayfinder-core@1.1.0-alpha.0

## 1.0.6

### Patch Changes

- Updated dependencies [a42d57c]
  - @ar.io/wayfinder-core@1.0.6

## 1.0.6-alpha.0

### Patch Changes

- Updated dependencies [a42d57c]
  - @ar.io/wayfinder-core@1.0.6-alpha.0

## 1.0.5

### Patch Changes

- Updated dependencies [73aa1b9]
- Updated dependencies [b7299cc]
- Updated dependencies [b81b54e]
  - @ar.io/wayfinder-core@1.0.5

## 1.0.5-alpha.0

### Patch Changes

- Updated dependencies [73aa1b9]
  - @ar.io/wayfinder-core@1.0.5-alpha.0

## 1.0.4

### Patch Changes

- 79a46d1: Performance improvements for wayfinder-extension

## 1.0.3

### Patch Changes

- aed86bb: Performance improvements for wayfinder-extension

## 1.0.3-alpha.0

### Patch Changes

- aed86bb: Performance improvements for wayfinder-extension

## 1.0.2

### Patch Changes

- Updated dependencies [86bdc2f]
- Updated dependencies [226f3af]
  - @ar.io/wayfinder-core@1.0.3

## 1.0.2-alpha.0

### Patch Changes

- Updated dependencies [86bdc2f]
  - @ar.io/wayfinder-core@1.0.3-alpha.0

## 1.0.1

### Patch Changes

- Updated dependencies [8f79caf]
- Updated dependencies [a3e69af]
- Updated dependencies [cfcfb66]
  - @ar.io/wayfinder-core@1.0.2

## 1.0.1-alpha.0

### Patch Changes

- Updated dependencies [a3e69af]
  - @ar.io/wayfinder-core@1.0.2-alpha.0

## 1.0.0

### Major Changes

- 147f087: Initial release of wayfinder-extension

### Patch Changes

- f823114: Update manifest.json
- f00c8a1: Update build script for wayfinder-extension
- 9629604: Initial wayfinder-extension@1.0.0
- Updated dependencies [aa5700e]
- Updated dependencies [2c170be]
- Updated dependencies [c78effa]
  - @ar.io/wayfinder-core@1.0.1

## 1.0.0-alpha.3

### Patch Changes

- f00c8a1: Update build script for wayfinder-extension

## 1.0.0-alpha.2

### Patch Changes

- f823114: Update manifest.json

## 1.0.0-alpha.1

### Major Changes

- 147f087: Initial release of wayfinder-extension

### Patch Changes

- 9629604: Initial wayfinder-extension@1.0.0
- Updated dependencies [2c170be]
  - @ar.io/wayfinder-core@1.0.1-alpha.1

## 0.0.19-alpha.0

### Patch Changes

- Updated dependencies [aa5700e]
  - @ar.io/wayfinder-core@1.0.1-alpha.0

## 0.0.18

### Patch Changes

- Updated dependencies [dc90515]
- Updated dependencies [09b3759]
- Updated dependencies [2d72bba]
- Updated dependencies [79254d1]
- Updated dependencies [89c0efe]
- Updated dependencies [4f062ad]
- Updated dependencies [e9245df]
- Updated dependencies [063e480]
  - @ar.io/wayfinder-core@1.0.0

## 0.0.18-alpha.8

### Patch Changes

- Updated dependencies [09b3759]
- Updated dependencies [89c0efe]
- Updated dependencies [e9245df]
  - @ar.io/wayfinder-core@1.0.0-alpha.8

## 0.0.18-alpha.7

### Patch Changes

- Updated dependencies [4f062ad]
  - @ar.io/wayfinder-core@0.0.5-alpha.7

## 0.0.18-alpha.6

### Patch Changes

- Updated dependencies [dc90515]
  - @ar.io/wayfinder-core@0.0.5-alpha.6

## 0.0.18-alpha.5

### Patch Changes

- Updated dependencies [79254d1]
  - @ar.io/wayfinder-core@0.0.5-alpha.5

## 0.0.18-alpha.4

### Patch Changes

- Updated dependencies [2d72bba]
  - @ar.io/wayfinder-core@0.0.5-alpha.4

## 0.0.18-alpha.3

### Patch Changes

- Updated dependencies [063e480]
  - @ar.io/wayfinder-core@0.0.5-alpha.3

## 0.0.18-alpha.2

### Patch Changes

- Updated dependencies [b85ec7e]
  - @ar.io/wayfinder-core@0.0.5-alpha.2

## 0.0.18-alpha.1

### Patch Changes

- Updated dependencies [aba2beb]
  - @ar.io/wayfinder-core@0.0.5-alpha.1

## 0.0.18-alpha.0

### Patch Changes

- Updated dependencies [4afd953]
  - @ar.io/wayfinder-core@0.0.5-alpha.0

## 0.0.17

### Patch Changes

- Updated dependencies [e43548d]
  - @ar.io/wayfinder-core@0.0.4

## 0.0.17-alpha.1

### Patch Changes

- Updated dependencies [78ad2b2]
  - @ar.io/wayfinder-core@0.0.4-alpha.1

## 0.0.17-alpha.0

### Patch Changes

- Updated dependencies [7c81839]
  - @ar.io/wayfinder-core@0.0.4-alpha.0

## 0.0.16

### Patch Changes

- Updated dependencies [53613fb]
- Updated dependencies [c12a8f8]
- Updated dependencies [45d2884]
- Updated dependencies [8e7facb]
- Updated dependencies [2605cdb]
- Updated dependencies [d431437]
- Updated dependencies [1ceb8df]
- Updated dependencies [2109250]
  - @ar.io/wayfinder-core@0.0.3

## 0.0.16-alpha.6

### Patch Changes

- Updated dependencies [1ceb8df]
  - @ar.io/wayfinder-core@0.0.3-alpha.6

## 0.0.16-alpha.5

### Patch Changes

- Updated dependencies [53613fb]
  - @ar.io/wayfinder-core@0.0.3-alpha.5

## 0.0.16-alpha.4

### Patch Changes

- Updated dependencies [8e7facb]
  - @ar.io/wayfinder-core@0.0.3-alpha.4

## 0.0.16-alpha.3

### Patch Changes

- Updated dependencies [d431437]
  - @ar.io/wayfinder-core@0.0.3-alpha.3

## 0.0.16-alpha.2

### Patch Changes

- Updated dependencies [2109250]
  - @ar.io/wayfinder-core@0.0.3-alpha.2

## 0.0.16-alpha.1

### Patch Changes

- Updated dependencies [c12a8f8]
- Updated dependencies [2605cdb]
  - @ar.io/wayfinder-core@0.0.3-alpha.1

## 0.0.16-beta.0

### Patch Changes

- Updated dependencies [45d2884]
  - @ar.io/wayfinder-core@0.0.3-beta.0

## 0.0.15

### Patch Changes

- Updated dependencies
  - @ar.io/wayfinder-core@0.0.2

## 0.0.15-beta.0

### Patch Changes

- Updated dependencies
  - @ar.io/wayfinder-core@0.0.2-beta.0
