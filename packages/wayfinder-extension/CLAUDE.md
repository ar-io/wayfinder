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
- `fastestPing` - Tests gateways and picks lowest latency (cached 15 min)
- `random` - Balanced load distribution
- `static` - User-specified gateway only

### Build Configuration
- Vite builds with `manifest.json` as entry
- Outputs to `dist/` directory
- Uses `vite-plugin-static-copy` for HTML/assets
- Bundles core dependencies into `webIndex.js`

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
