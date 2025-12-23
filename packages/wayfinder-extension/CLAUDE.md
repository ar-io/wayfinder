# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Extension Overview

WayFinder Extension is a Chrome Manifest V3 extension that intercepts ar:// URLs and routes them through optimal AR.IO gateways. It provides seamless browsing for Arweave content with optional cryptographic verification.

## Common Commands

```bash
# Build extension
npm run build

# Development mode with watch
npm run dev

# Clean build artifacts
npm run clean

# Linting and formatting (uses Biome)
npm run lint:fix
npm run format:fix
```

After building, load the unpacked extension from `dist/` in `chrome://extensions/` with Developer mode enabled.

## Key Architecture

### Core Components

1. **Background Script (`src/background.ts`)**
   - Manifest V3 service worker handling ar:// navigation
   - Manages WayFinder instance lifecycle via debounced initialization
   - Tracks gateway performance with WebRequest API
   - Syncs with AR.IO gateway registry
   - Intercepts fetch events from extension pages for verification via `initializeFetchHandler()`
   - Uses `TabStateManager` class for tracking redirected tabs with automatic cleanup

2. **Routing Module (`src/routing.ts`)**
   - Thread-safe singleton WayFinder instance (promise-based race prevention)
   - ENS and ArNS name resolution
   - DNS TXT record lookup for gasless ArNS domains
   - Fallback gateway handling on routing failures

3. **Content Script (`src/content.ts`)**
   - Converts ar:// links on web pages to gateway URLs
   - Minimal logic - sends messages to background script

4. **Verification System (`src/verification/`)**
   - `fetch-handler.ts` - Intercepts `/ar-proxy/` requests, serves verified content
   - `manifest-verifier.ts` - Manifest-first verification orchestrator with security model
   - `verification-state.ts` - Tracks verification progress per identifier
   - `verified-cache.ts` - LRU cache for verified content
   - `wayfinder-instance.ts` - Manages Wayfinder instance for verification
   - `gateway-health.ts` - Monitors gateway health for verification routing
   - `trusted-gateways.ts` - Provides trusted gateway lists for verification
   - `verified.ts` + `verified.html` - Verified browsing mode page
   - `location-patcher.ts` - Patches `window.location` in sandbox to return ar:// URLs
   - `index.ts` - Public API exports for verification utilities

   Key verification API functions (from `src/verification/index.ts`):
   - `initializeWayfinder` / `waitForInitialization` - SW Wayfinder lifecycle
   - `verifyIdentifier` / `getVerifiedContent` - Core verification workflow
   - `setActiveIdentifier` / `getActiveIdentifier` - Track current verification target
   - `broadcastEvent` - Send verification events to listeners
   - `getTrustedGateways` / `getTopStakedGateways` / `getRoutingGateways` - Gateway selection
   - `setVerificationConcurrency` - Control parallel resource verification (default: 10)

5. **Chrome Storage Adapter (`src/adapters/chrome-storage-gateway-provider.ts`)**
   - Implements `GatewaysProvider` interface for wayfinder-core
   - Filters out blacklisted gateways and those with consecutive failed epochs
   - Sorts gateways by operator stake or delegated stake
   - Updates performance metrics (EMA with α=0.2)

6. **UI Pages**
   - `popup.ts` - Extension popup with daily stats
   - `settings.ts` - Configuration (routing, verification, network)
   - `gateways.ts` - Gateway list and blacklist management
   - `performance.ts` - Usage analytics and metrics

7. **Sandbox System**
   - `sandbox.ts` + `sandbox.html` - Sandboxed page for executing untrusted content
   - `location-patch.ts` - Injected script to patch location in sandbox iframe
   - Uses relaxed CSP (allows `unsafe-inline`, `unsafe-eval`) vs strict extension_pages CSP
   - Comprehensive URL interception for: fetch, XHR, Image, Script, Link, Media, Worker, etc.
   - Stubs unavailable APIs: serviceWorker, caches, localStorage, sessionStorage, cookies
   - Exposes `window.__wayfinder = { verified: true, sandbox: true }` for app detection

8. **Utilities (`src/utils/`)**
   - `logger.ts` - Logging utility with configurable levels
   - `error-handler.ts` - Error handling helpers
   - `time.ts` - Time formatting utilities
   - `version.ts` - Version comparison helpers

### Data Flow

**Standard Mode:**
1. User navigates to ar:// URL → `handleBeforeNavigate` in background
2. Resolve ENS/ArNS names → `getRoutableGatewayUrl` selects gateway
3. `chrome.tabs.update` redirects to gateway URL
4. WebRequest listeners track performance metrics

**Verified Browsing Mode:**
1. ar:// URL → Redirect to `verified.html?q=<identifier>`
2. verified.ts sends `INIT_VERIFICATION` → background initializes Wayfinder
3. Iframe loads `/ar-proxy/<identifier>/` → fetch handler intercepts
4. Manifest verified → Resources fetched and verified → Content served from cache

### Verification Security Model

The manifest-verifier (`src/verification/manifest-verifier.ts`) implements a security-first verification flow:

1. **ArNS Resolution**: Names resolved via trusted gateways with consensus checking (mismatch = security issue)
2. **Manifest Verification**: Manifest content hash-verified BEFORE trusting path→txId mappings
3. **Resource Verification**: All resources verified against trusted gateways before serving
4. **Error Classification**: `NetworkError` (retriable) vs `VerificationError` (hash mismatch = tampering)

Key timeouts:
- `GATEWAY_TIMEOUT_MS`: 10s for gateway requests
- `RESOURCE_FETCH_TIMEOUT_MS`: 5s for resource fetch initiation
- `BODY_DOWNLOAD_TIMEOUT_MS`: 30s for body download (larger for WASM files)

## Chrome Storage Keys

```
localGatewayAddressRegistry  - Cached gateway data from AR.IO network
gatewayPerformance           - Response times, failures, success counts (per FQDN)
gatewayUsageHistory          - Request counts and timestamps per gateway
routingMethod                - Current strategy: 'random' | 'fastestPing' | 'static'
staticGateway                - User-configured gateway for static mode
blacklistedGateways          - Array of gateway addresses to exclude
dailyStats                   - Usage metrics reset daily
ensResolutionEnabled         - ENS resolution toggle
verificationEnabled          - Verified browsing mode toggle
processId                    - AR.IO process ID (advanced)
aoCuUrl                      - AO Compute Unit URL (advanced)
```

## Message Types

Background script handles these `chrome.runtime.sendMessage` types:

**From Content Script:**
- `convertArUrlToHttpUrl` - Resolve ar:// URL to gateway URL
- `contentScriptReady` - Trigger queued message flush

**From Settings/Popup:**
- `syncGatewayAddressRegistry` - Manual registry sync
- `updateRoutingStrategy` - Change routing method
- `updateVerificationEnabled` - Toggle verified browsing
- `resetWayfinder` - Force instance recreation

**From verified.html:**
- `INIT_VERIFICATION` - Initialize Wayfinder with config
- `START_VERIFICATION` - Begin verification for identifier
- `GET_VERIFIED_CONTENT` - Get verified HTML and resource metadata
- `GET_VERIFIED_RESOURCE` - Get single resource (chunked for large files)

## Configuration

All defaults are centralized in `src/config/defaults.ts`:
- `EXTENSION_DEFAULTS` - Core extension settings (routing, verification, stats)
- `WAYFINDER_DEFAULTS` - Wayfinder core configuration
- `ROUTING_STRATEGY_DEFAULTS` - Per-strategy settings (timeouts, concurrency)
- `CACHE_DEFAULTS` - TTL settings for ArNS, gateways, DNS
- `PERFORMANCE_DEFAULTS` - Request timeouts, cleanup intervals

Constants in `src/constants.ts`:
- `ARIO_MAINNET_PROCESS_ID` - AR.IO mainnet process ID
- `DEFAULT_AO_CU_URL` - Default AO Compute Unit URL (cu.ardrive.io)
- `FALLBACK_GATEWAY` - Last resort gateway (arweave.net)

## Build Configuration

Vite config (`vite.config.js`):
- Entry points: background, content, popup, settings, gateways, performance, verified, sandbox, location-patch
- Manual chunk `webIndex` bundles: @ar.io/sdk/web, @permaweb/aoconnect, @ar.io/wayfinder-core
- Node polyfills for crypto, stream, buffer
- Static copy: HTML files, manifest.json, assets, package.json → `dist/`
- Sourcemaps enabled for debugging

## Chrome Permissions

Manifest V3 permissions (see `manifest.json`):
- `storage` - Persist settings and gateway cache
- `webNavigation` - Intercept ar:// navigation
- `webRequest` - Track request performance metrics
- `scripting` - Inject content scripts dynamically
- `host_permissions: <all_urls>` - Access all sites for ar:// link conversion

Content Security Policy notes:
- **extension_pages**: Strict CSP (`script-src 'self'`) - no inline scripts
- **sandbox**: Relaxed CSP (allows `unsafe-inline`, `unsafe-eval`) for executing arbitrary Arweave content

## Key Gotchas

- **MV3 Service Worker Limitations**: No DOM access, must use chrome.storage for persistence
- **Service Worker Restarts**: Can lose in-memory state - always persist to chrome.storage
- **Fetch Handler Registration**: `initializeFetchHandler()` must be called at top level of background.ts (before any async operations) for MV3 compliance
- **Fetch Event Interception**: Only works for extension pages (chrome-extension://), not content scripts
- **Message Queuing**: Content script may not be ready immediately - messages are queued and flushed on `contentScriptReady`
- **Gateway Filtering**: Automatically excludes gateways with `failedConsecutiveEpochs > 0`
- **Debounced Initialization**: Wayfinder instance uses `pDebounce` to prevent rapid re-initialization on settings changes
- **LRU Cache for Request Timings**: Uses `lru-cache` with 24-hour TTL and 10k max entries
- **In-Memory Caching**: `getCachedGatewayRegistry()` in helpers.ts caches registry reads for 1 hour to reduce Chrome storage calls
- **Version Mismatch**: manifest.json version may differ from package.json - use package.json as source of truth
- **WASM Content-Type**: Gateways may return `text/plain` for .wasm files - sandbox.ts fixes this to `application/wasm` for `instantiateStreaming()` compatibility
- **Sandbox Unique Origin**: Many browser APIs throw `SecurityError` in sandbox - use try/catch when stubbing (see `injectSandboxPolyfills()`)
- **Verification vs Network Errors**: Hash mismatch = `VerificationError` (don't retry), connection issues = `NetworkError` (try other gateways)

## Manual Testing

1. Load unpacked extension from `dist/` in `chrome://extensions/`
2. Test ar:// navigation in Chrome address bar
3. Test ar:// links on web pages via content script
4. Verify gateway performance metrics accumulate in storage
5. Test verified browsing mode (Settings → Enable Verified Browsing)
6. Test settings changes trigger `resetWayfinder`
