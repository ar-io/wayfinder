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

# Linting and formatting
npm run lint:fix
npm run format:fix
```

After building, load the unpacked extension from `dist/` in `chrome://extensions/`.

## Key Architecture

### Core Components

1. **Background Script (`src/background.ts`)**
   - Manifest V3 service worker handling ar:// navigation
   - Manages WayFinder instance lifecycle via debounced initialization
   - Tracks gateway performance with WebRequest API
   - Syncs with AR.IO gateway registry
   - Intercepts fetch events from extension pages for verification

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
   - `manifest-verifier.ts` - Verifies manifest entries using wayfinder-core
   - `verification-state.ts` - Tracks verification progress per identifier
   - `verified-cache.ts` - LRU cache for verified content
   - `verified.ts` + `verified.html` - Sandbox page for verified browsing mode

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

## Configuration Defaults

Located in `src/config/defaults.ts`:
- `routingMethod: 'random'` - Default to balanced distribution
- `verificationEnabled: false` - Opt-in verified browsing
- `gatewaySortBy: 'totalDelegatedStake'` - Default gateway ordering
- `fastestPing.timeoutMs: 2000` - Ping timeout for fastest ping strategy

## Build Configuration

Vite config (`vite.config.js`):
- Entry points: background, content, popup, settings, gateways, performance, verified, sandbox, location-patch
- Manual chunk `webIndex` bundles: @ar.io/sdk/web, @permaweb/aoconnect, @ar.io/wayfinder-core
- Node polyfills for crypto, stream, buffer
- Static copy: HTML files, manifest.json, assets, package.json → `dist/`

## Key Gotchas

- **MV3 Service Worker Limitations**: No DOM access, must use chrome.storage for persistence
- **Service Worker Restarts**: Can lose in-memory state - always persist to chrome.storage
- **Fetch Event Interception**: Only works for extension pages (chrome-extension://), not content scripts
- **Message Queuing**: Content script may not be ready immediately - messages are queued and flushed on `contentScriptReady`
- **Gateway Filtering**: Automatically excludes gateways with `failedConsecutiveEpochs > 0`
- **CORS Issues**: Some gateways may block HEAD requests used for health checks

## Testing Approach

1. Load unpacked extension from `dist/` in `chrome://extensions/`
2. Test ar:// navigation in Chrome address bar
3. Test ar:// links on web pages via content script
4. Verify gateway performance metrics accumulate in storage
5. Test verified browsing mode (Settings → Enable Verified Browsing)
6. Test settings changes trigger `resetWayfinder`
