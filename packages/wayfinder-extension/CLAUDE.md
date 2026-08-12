# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Extension Overview

WayFinder Extension is a Chrome extension that intercepts ar:// URLs and routes them through optimal AR.IO gateways. It provides a seamless browsing experience for Arweave content without requiring users to manually select gateways.

## Key Architecture

### Core Components

1. **Background Script (`src/background.ts`)**
   - Service worker that intercepts ar:// navigation requests
   - Manages WayFinder instance lifecycle
   - Tracks gateway performance and handles circuit breaking
   - Syncs with AR.IO gateway registry

2. **Content Script (`src/content.ts`)**
   - Converts ar:// links on web pages to gateway URLs
   - Minimal logic - just sends messages to background script

3. **Routing Module (`src/routing.ts`)**
   - Creates and manages singleton WayFinder instance
   - Handles ENS and ArNS name resolution
   - Thread-safe initialization with promise tracking

4. **UI Pages**
   - `popup.ts` - Extension popup with stats
   - `settings.ts` - Configuration management
   - `gateways.ts` - Gateway list and blacklist management
   - `performance.ts` - Usage analytics and metrics

### Data Flow

1. User navigates to ar:// URL → Browser intercepts → Background script
2. Background resolves names (ENS/ArNS) → Queries WayFinder for best gateway
3. Updates tab with gateway URL → Tracks performance metrics

## Common Commands

```bash
# Build extension
npm run build

# Development mode with watch
npm run dev

# Clean build artifacts
npm run clean

# Linting and formatting
npm run lint:fix
npm run format:fix
```

## Important Patterns

### Chrome Storage Keys
- `localGatewayAddressRegistry` - Cached gateway data from AR.IO
- `gatewayPerformance` - Response times and success rates
- `routingMethod` - Current routing strategy
- `dailyStats` - Usage metrics reset daily
- `network` - `'mainnet' | 'devnet' | 'custom'`
- `rpcUrl`, `coreProgramId`, `garProgramId`, `arnsProgramId`, `antProgramId` - Solana config

Storage defaults are only written when a key is **absent** (`if (x === undefined)`).
Changing a value in `EXTENSION_DEFAULTS` therefore reaches fresh installs only —
existing users keep whatever was written when they installed. Anything that must
reach current users needs a migration; see the `migrate*` functions at the top of
`background.ts`.

### Message Passing
Background script accepts these message types:
- `convertArUrlToHttpUrl` - From content script
- `syncGatewayAddressRegistry` - Manual sync trigger
- `updateRoutingStrategy` - Settings change
- `resetWayfinder` - Force instance recreation

### Performance Tracking
- Uses Exponential Moving Average (α=0.2) for response times
- Circuit breaker: 3 failures = 2 minute timeout
- Request timings tracked via WebRequest API

## Configuration

### Routing Strategies
- `topStaked` - Round-robin across top 20 highest-staked gateways with ping checks (default)
- `fastestPing` - Tests gateways and picks lowest latency (cached 2 min)
- `random` - Balanced load distribution with ping checks
- `static` - User-specified gateway only

### Solana Network (AR.IO registry)

The AR.IO registry lives on Solana; the extension reads it through
`@ar.io/sdk@4.x` + `@solana/kit`. Presets are in `src/constants.ts`
(`AR_IO_SOLANA_MAINNET` / `AR_IO_SOLANA_DEVNET`), applied on install via
`src/config/defaults.ts`. **Mainnet is the default.**

- RPC URLs come from the SDK's `MAINNET_RPC_URL` / `DEVNET_RPC_URL` — the public
  Solana endpoints. Do **not** hardcode a provider URL with an embedded token: an
  extension bundle is public, so the token is not a secret and only becomes a
  credential to rotate. A v2.0.0 build shipped one, it was later revoked, and
  registry sync silently broke for every mainnet user.
- Program IDs mirror the SDK's `MAINNET_PROGRAM_IDS` / `DEVNET_PROGRAM_IDS`. They
  are a hand-maintained copy — verify against the SDK when bumping it.
- `syncGatewayAddressRegistry()` runs on a 24-hour alarm. One sync is a single
  ~1.9MB `getProgramAccounts` from the user's own IP, which is well within the
  public endpoint's per-IP limits.
- When sync fails there is no user-visible signal: routing quietly falls back to
  the single hardcoded `FALLBACK_GATEWAY` (mainnet only — `routing.ts` refuses to
  cross-contaminate networks). Suspect this whenever routing "works" but always
  lands on the same gateway.

### Build Configuration
- Vite bundles six entry points (`background`, `content`, `popup`, `settings`, `gateways`, `performance`)
- `manifest.json` lives at the **package root** and is copied into `dist/`, not used as a Vite entry; `build_artifact.sh` rewrites its version from `package.json`
- Outputs to `dist/` directory
- Uses `vite-plugin-static-copy` for HTML/assets
- Bundles core dependencies into `webIndex.js`
- `vite.config.js` aliases `@solana/*` to the copies `@solana/kit` resolves, because `experimental/wayfinder-x402-fetch` can hoist older v5 copies. If a new `@solana/*` import fails the build with a missing export, add it to that list

## Testing Approach

1. Load unpacked extension from `dist/`
2. Test ar:// navigation in address bar
3. Verify ar:// links work on web pages
4. Check performance metrics accumulate
5. Test settings changes take effect

## Key Gotchas

- Manifest V3 service workers have no DOM access
- Background script restarts can lose state (use chrome.storage)
- WebRequest API needed for performance tracking
- Some gateways may have CORS issues with HEAD requests
- Telemetry may fail due to AsyncLocalStorage browser compatibility
- Verification is `RemoteVerificationStrategy` only. The service worker never sees response bytes, so hash/data-root/signature verification is impossible here — trust comes from the `x-ar-io-verified` response header
- Gateways come from `ChromeStorageGatewayProvider` (reading the synced `localGatewayAddressRegistry`), **not** core's `NetworkGatewaysProvider`. It sorts client-side, so it is unaffected by the SDK ignoring `sortBy`/`sortOrder`
- The extension has no test suite; its `test` script is a stub (`echo "Passing"`)
