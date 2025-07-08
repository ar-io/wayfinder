# Wayfinder Core Integration Documentation

This document describes how the Wayfinder browser extension integrates with the @ar.io/wayfinder-core library for routing AR.IO requests to optimal gateways.

## Overview

The Wayfinder extension uses the core library to intelligently route `ar://` URLs to the best available AR.IO gateway based on various strategies and configurations. The extension focuses solely on routing without any data verification features.

## Core Components

### 1. Wayfinder Instance Management (`src/routing.ts`)

The extension creates a singleton Wayfinder instance with thread-safe initialization:

```typescript
async function getWayfinderInstance(): Promise<Wayfinder> {
  // Return existing instance immediately
  if (wayfinderInstance) return wayfinderInstance;
  
  // Return existing initialization promise to prevent race conditions
  if (wayfinderPromise) return wayfinderPromise;
  
  // Create new initialization promise
  wayfinderPromise = createWayfinderInstance();
  
  try {
    wayfinderInstance = await wayfinderPromise;
    return wayfinderInstance;
  } catch (error) {
    wayfinderPromise = null;
    throw error;
  }
}
```

### 2. Gateway Provider Configuration

The extension uses a custom Chrome storage-based gateway provider:

```typescript
class ChromeStorageGatewayProvider implements GatewaysProvider {
  constructor(options: {
    sortBy: 'operatorStake' | 'totalDelegatedStake';
    sortOrder: 'asc' | 'desc';
  });
  
  async getGateways(): Promise<URL[]> {
    // Fetches from localGatewayAddressRegistry
    // Filters out blacklisted gateways
    // Sorts based on configuration
    // Returns array of gateway URLs
  }
}
```

### 3. Routing Strategies

The extension supports multiple routing strategies from wayfinder-core:

#### Fastest Ping (Default)
```typescript
const fastestPing = new FastestPingRoutingStrategy({
  timeoutMs: 2000,
  maxConcurrency: 5,
  logger
});

// Wrapped with cache for 15 minutes TTL
const cachedStrategy = new SimpleCacheRoutingStrategy({
  routingStrategy: fastestPing,
  ttlSeconds: 15 * 60,
  logger
});
```

#### Random (Balanced)
```typescript
const random = new RandomRoutingStrategy();
```

#### Static Gateway
```typescript
const static = new StaticRoutingStrategy({
  gateway: 'https://custom.gateway.io'
});
```

Note: Round Robin strategy has been deprecated and now falls back to Random (Balanced) strategy.

## Configuration Management

### Storage Keys

```typescript
// Core routing configuration
{
  routingMethod: 'fastestPing' | 'random' | 'static',
  staticGateway: {
    settings: {
      protocol: 'https',
      fqdn: 'gateway.domain.com',
      port: 443
    }
  },
  gatewayCacheTTL: 3600, // seconds
  gatewaySortBy: 'operatorStake' | 'totalDelegatedStake',
  gatewaySortOrder: 'asc' | 'desc',
  blacklistedGateways: string[],
  localGatewayAddressRegistry: Record<string, GatewayData>,
  telemetryEnabled: boolean,
  ensResolutionEnabled: boolean
}
```

### Gateway Performance Tracking

The extension tracks gateway performance using exponential moving average:

```typescript
async function updateGatewayPerformance(
  fqdn: string,
  responseTime: number,
  success: boolean = true
) {
  const alpha = 0.2; // EMA smoothing factor
  const prevAvg = gatewayPerformance[fqdn]?.avgResponseTime || responseTime;
  
  gatewayPerformance[fqdn] = {
    avgResponseTime: alpha * responseTime + (1 - alpha) * prevAvg,
    successCount: success ? (prev.successCount + 1) : prev.successCount,
    failures: success ? prev.failures : (prev.failures + 1)
  };
}
```

## URL Resolution Flow

### 1. AR:// URL Interception (`src/background.ts`)

```typescript
chrome.webNavigation.onBeforeNavigate.addListener(async (details) => {
  const url = new URL(details.url);
  const arUrl = url.searchParams.get('q');
  
  if (arUrl?.startsWith('ar://')) {
    const result = await getRoutableGatewayUrl(arUrl);
    if (result?.url) {
      chrome.tabs.update(details.tabId, { url: result.url });
    }
  }
});
```

### 2. Resolution Process (`src/routing.ts`)

```typescript
async function getRoutableGatewayUrl(arUrl: string) {
  const wayfinder = await getWayfinderInstance();
  
  // Handle ENS resolution if enabled
  if (baseName.endsWith('.eth') && ensResolutionEnabled) {
    const txId = await fetchEnsArweaveTxId(baseName);
    if (txId) processedUrl = `ar://${txId}${path}`;
  }
  
  // Handle ArNS resolution via DNS TXT
  if (baseName.includes('.')) {
    const txId = await lookupArweaveTxIdForDomain(baseName);
    if (txId) processedUrl = `ar://${txId}${path}`;
  }
  
  // Use Wayfinder to resolve to gateway URL
  const resolvedUrl = await wayfinder.resolveUrl({
    originalUrl: processedUrl
  });
  
  return {
    url: resolvedUrl.toString(),
    gatewayFQDN: resolvedUrl.hostname,
    gatewayProtocol: resolvedUrl.protocol.slice(0, -1),
    gatewayPort: resolvedUrl.port ? parseInt(resolvedUrl.port) : null,
    gatewayAddress: 'CORE_LIBRARY',
    selectedGateway: { settings: { ... } }
  };
}
```

### 3. ENS Resolution (`src/ens.ts`)

```typescript
async function fetchEnsArweaveTxId(ensName: string): Promise<string | null> {
  const response = await fetch(`https://api.ensdata.net/${ensName}`);
  const data = await response.json();
  return data['ar://'] || data.contentHash || null;
}
```

### 4. ArNS Resolution (DNS TXT)

```typescript
async function lookupArweaveTxIdForDomain(domain: string): Promise<string | null> {
  const cacheKey = `dnsCache_${domain}`;
  
  // Check cache first
  const cached = await chrome.storage.local.get([cacheKey]);
  if (cached && Date.now() - cached.timestamp < GASLESS_ARNS_DNS_EXPIRATION_TIME) {
    return cached.txId;
  }
  
  // Query DNS TXT records
  const response = await fetch(
    `https://dns.google/resolve?name=${domain}&type=TXT`
  );
  const data = await response.json();
  
  // Look for ARTX record
  const match = data.Answer?.map((record: any) => {
    const result = record.data.match(/ARTX ([a-zA-Z0-9_-]{43})/);
    return result ? result[1] : null;
  }).find((txId: string) => txId !== null);
  
  if (match) {
    // Cache the result
    await chrome.storage.local.set({
      [cacheKey]: { txId: match, timestamp: Date.now() }
    });
    return match;
  }
  
  return null;
}
```

## Gateway Registry Synchronization

The extension periodically syncs with the AR.IO gateway registry:

```typescript
async function syncGatewayAddressRegistry() {
  const { processId, aoCuUrl } = await chrome.storage.local.get([
    'processId', 'aoCuUrl'
  ]);
  
  const arIO = ARIO.init({
    process: new AOProcess({
      processId: processId || ARIO_MAINNET_PROCESS_ID,
      ao: connect({ CU_URL: aoCuUrl || DEFAULT_AO_CU_URL })
    })
  });
  
  const gateways = {};
  let cursor;
  
  do {
    const batch = await arIO.getGateways({ 
      limit: 1000, 
      cursor 
    });
    
    batch.items.forEach(({ gatewayAddress, ...data }) => {
      gateways[gatewayAddress] = data;
    });
    
    cursor = batch.nextCursor;
  } while (cursor);
  
  await chrome.storage.local.set({
    localGatewayAddressRegistry: gateways,
    lastSyncTime: Date.now()
  });
}
```

## Circuit Breaker Pattern

The extension implements a circuit breaker to handle failing gateways:

```typescript
class CircuitBreaker {
  private states = new Map<string, CircuitState>();
  private failureThreshold = 3;
  private resetTimeoutMs = 120000; // 2 minutes
  
  canExecute(gatewayUrl: string): boolean {
    const state = this.states.get(gatewayUrl);
    if (!state || !state.isOpen) return true;
    
    // Check if enough time has passed to retry
    if (Date.now() >= state.nextRetryTime) {
      state.isOpen = false;
      return true;
    }
    
    return false;
  }
  
  onFailure(gatewayUrl: string) {
    let state = this.states.get(gatewayUrl);
    if (!state) {
      state = { failureCount: 0, isOpen: false, nextRetryTime: 0 };
    }
    
    state.failureCount++;
    
    if (state.failureCount >= this.failureThreshold) {
      state.isOpen = true;
      state.nextRetryTime = Date.now() + this.resetTimeoutMs;
    }
    
    this.states.set(gatewayUrl, state);
  }
}
```

## Performance Monitoring

### Request Tracking

```typescript
// Track request start times
chrome.webRequest.onBeforeRequest.addListener((details) => {
  requestTimings.set(details.requestId.toString(), performance.now());
});

// Calculate response times on completion
chrome.webRequest.onCompleted.addListener(async (details) => {
  const startTime = requestTimings.get(details.requestId.toString());
  if (startTime) {
    const responseTime = performance.now() - startTime;
    await updateGatewayPerformance(
      details.url.hostname,
      responseTime,
      true
    );
    requestTimings.delete(details.requestId.toString());
  }
});
```

### Usage History

```typescript
async function updateGatewayUsageHistory(fqdn: string) {
  const timestamp = new Date().toISOString();
  const { gatewayUsageHistory = {} } = await chrome.storage.local.get([
    'gatewayUsageHistory'
  ]);
  
  if (gatewayUsageHistory[fqdn]) {
    gatewayUsageHistory[fqdn].requestCount += 1;
    gatewayUsageHistory[fqdn].lastUsed = timestamp;
  } else {
    gatewayUsageHistory[fqdn] = {
      requestCount: 1,
      firstUsed: timestamp,
      lastUsed: timestamp
    };
  }
  
  await chrome.storage.local.set({ gatewayUsageHistory });
}
```

## Settings Page Integration

The settings page (`src/settings.js`) allows users to configure:

1. **Routing Strategy**: Select between fastestPing, random (Balanced), or static
2. **Static Gateway**: Configure and test a specific gateway URL
3. **Gateway Sorting**: Choose sort by operatorStake or totalDelegatedStake
4. **Cache TTL**: Set gateway cache time-to-live (seconds)
5. **Registry Sync**: Manually trigger gateway registry sync
6. **ENS Resolution**: Enable/disable ENS name resolution
7. **Telemetry**: Enable/disable anonymous usage tracking (10% sample rate)
8. **Data Management**: Clear cache and reset extension

## Error Handling

### Fallback Gateway

When all routing fails, the extension falls back to arweave.net:

```typescript
const FALLBACK_GATEWAY = {
  operatorStake: 0,
  settings: {
    fqdn: 'arweave.net',
    label: 'Arweave.net (Fallback)',
    protocol: 'https',
    port: 443,
    note: 'Last resort fallback gateway when AR.IO network is unreachable.'
  },
  status: 'joined',
  gatewayAddress: 'FALLBACK'
};
```

### Error Page

For unrecoverable errors, the extension displays a user-friendly error page with options to go back or open settings.

## Content Script Integration (`src/content.ts`)

The content script converts ar:// links in web pages:

```typescript
async function processArUrl(
  element: Element,
  arUrl: string,
  attribute: string
): Promise<void> {
  const convertResponse = await chrome.runtime.sendMessage({
    type: 'convertArUrlToHttpUrl',
    arUrl
  });
  
  if (convertResponse && !convertResponse.error) {
    element[attribute] = convertResponse.url;
  }
}
```

## Telemetry Integration

When enabled, the extension configures telemetry settings:

```typescript
const telemetrySettings = telemetryEnabled ? {
  enabled: true,
  sampleRate: 0.1 // 10% of requests
} : undefined;
```

Note: Telemetry may fail to initialize in some browser environments due to AsyncLocalStorage compatibility issues. The extension handles this gracefully by retrying without telemetry.

## Daily Statistics

The extension tracks daily usage statistics:

```typescript
{
  date: string,           // Today's date
  requestCount: number,   // ar:// requests today
  totalRequestCount: number // All HTTP requests today
}
```

## Best Practices

1. **Thread-Safe Initialization**: Use singleton pattern with promise tracking
2. **Gateway Caching**: Use TTL-based caching to reduce network requests
3. **Performance Tracking**: Monitor gateway response times with EMA
4. **Circuit Breaking**: Temporarily disable failing gateways
5. **Graceful Degradation**: Always have a fallback gateway
6. **User Control**: Allow users to override automatic selection

## Testing

To test the integration:

1. Install the extension in Chrome
2. Navigate to Settings > Network Configuration
3. Sync the gateway registry
4. Visit any `ar://` URL or type `ar://` in the search bar
5. Monitor gateway selection in browser DevTools console
6. Check performance stats on the Performance page
7. View gateway list and health on the Gateways page