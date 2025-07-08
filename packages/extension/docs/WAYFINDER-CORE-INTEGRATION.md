# Wayfinder Core Integration Documentation

This document describes how the Wayfinder browser extension integrates with the @ar.io/wayfinder-core library for routing AR.IO requests to optimal gateways.

## Overview

The Wayfinder extension uses the core library to intelligently route `ar://` URLs to the best available AR.IO gateway based on various strategies and configurations.

## Core Components

### 1. Wayfinder Instance Creation (`src/background.ts`)

The extension creates a singleton Wayfinder instance that persists throughout the extension's lifecycle:

```typescript
async function getOrCreateWayfinder(): Promise<Wayfinder> {
  const config = await chrome.storage.local.get([
    'routingMethod',
    'staticGateway',
    'verificationStrategy',
    'gatewayCacheTTL',
    'gatewaySortBy',
    'gatewaySortOrder',
    'telemetryEnabled'
  ]);

  const wayfinder = new Wayfinder({
    logger: customLogger,
    gatewaysProvider: gatewayProvider,
    routingSettings: {
      strategy: routingStrategy,
      events: {
        onRoutingSucceeded: (event) => {
          // Track performance metrics
        }
      }
    },
    telemetrySettings: telemetryEnabled ? {
      enabled: true,
      sampleRate: 0.1  // 10% sampling
    } : undefined
  });
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
const pingStrategy = new FastestPingRoutingStrategy({
  timeoutMs: 2000,
  maxConcurrency: 5,
  logger: customLogger
});
```

#### Round Robin
```typescript
const roundRobin = new RoundRobinRoutingStrategy({
  gateways: availableGateways
});
```

#### Random
```typescript
const random = new RandomRoutingStrategy();
```

#### Static Gateway
```typescript
const static = new StaticRoutingStrategy({
  gateway: 'https://custom.gateway.io'
});
```

## Configuration Management

### Storage Keys

```typescript
// Core routing configuration
{
  routingMethod: 'fastestPing' | 'roundRobin' | 'random' | 'static',
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
  localGatewayAddressRegistry: Record<string, GatewayData>
}
```

### Gateway Performance Tracking

The extension tracks gateway performance using exponential moving average:

```typescript
async function updateGatewayPerformance(
  fqdn: string,
  responseTime: number,
  success: boolean
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

### 1. AR:// URL Interception

```typescript
chrome.webNavigation.onBeforeNavigate.addListener(async (details) => {
  const url = new URL(details.url);
  const arUrl = url.searchParams.get('q');
  
  if (arUrl?.startsWith('ar://')) {
    const resolved = await resolveArUrl(arUrl);
    chrome.tabs.update(details.tabId, { url: resolved.url });
  }
});
```

### 2. Resolution Process

```typescript
async function resolveArUrl(arUrl: string) {
  const wayfinder = await getOrCreateWayfinder();
  
  // Handle ENS resolution if enabled
  if (identifier.endsWith('.eth') && ensResolutionEnabled) {
    const txId = await resolveENS(identifier);
    arUrl = `ar://${txId}${path}`;
  }
  
  // Handle ArNS resolution
  if (identifier.includes('.')) {
    const txId = await resolveDNSTxt(identifier);
    if (txId) arUrl = `ar://${txId}${path}`;
  }
  
  // Use Wayfinder to resolve to gateway URL
  const resolvedUrl = await wayfinder.resolveUrl({ originalUrl: arUrl });
  
  return {
    url: resolvedUrl.toString(),
    gatewayFQDN: resolvedUrl.hostname,
    gatewayProtocol: resolvedUrl.protocol,
    gatewayPort: resolvedUrl.port
  };
}
```

### 3. ENS Resolution

```typescript
async function resolveENS(ensName: string): Promise<string | null> {
  const response = await fetch(`https://api.ensdata.net/${ensName}`);
  const data = await response.json();
  return data['ar://'] || data.contentHash || null;
}
```

### 4. ArNS Resolution (DNS TXT)

```typescript
async function resolveDNSTxt(hostname: string): Promise<string | null> {
  const cacheKey = `dnsCache_${hostname}`;
  
  // Check cache first
  const cached = await chrome.storage.local.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < DNS_CACHE_TTL) {
    return cached.txId;
  }
  
  // Query DNS TXT records
  const response = await fetch(
    `https://dns.google/resolve?name=${hostname}&type=TXT`
  );
  const data = await response.json();
  
  // Look for ARTX record
  const artxRecord = data.Answer?.find(record => 
    record.data.includes('ARTX')
  );
  
  if (artxRecord) {
    const match = artxRecord.data.match(/ARTX ([a-zA-Z0-9_-]{43})/);
    if (match) {
      // Cache the result
      await chrome.storage.local.set({
        [cacheKey]: { txId: match[1], timestamp: Date.now() }
      });
      return match[1];
    }
  }
  
  return null;
}
```

## Gateway Registry Synchronization

The extension periodically syncs with the AR.IO gateway registry:

```typescript
async function syncGatewayAddressRegistry() {
  const arIO = ARIO.init({
    process: new AoIORead({
      processId: ARIO_PROCESS_ID,
      ao: connect({ CU_URL: aoConfig.cuUrl })
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
    const state = this.states.get(gatewayUrl) || { 
      failureCount: 0 
    };
    
    state.failureCount++;
    
    if (state.failureCount >= this.failureThreshold) {
      state.isOpen = true;
      state.nextRetryTime = Date.now() + this.resetTimeoutMs;
    }
  }
}
```

## Performance Monitoring

### Request Tracking

```typescript
chrome.webRequest.onBeforeRequest.addListener((details) => {
  requestTimings.set(details.requestId, performance.now());
});

chrome.webRequest.onCompleted.addListener(async (details) => {
  const startTime = requestTimings.get(details.requestId);
  if (startTime) {
    const responseTime = performance.now() - startTime;
    await updateGatewayPerformance(
      details.url.hostname,
      responseTime,
      true
    );
  }
});
```

### Usage History

```typescript
async function updateGatewayUsageHistory(fqdn: string) {
  const history = await chrome.storage.local.get(['gatewayUsageHistory']);
  const gatewayHistory = history.gatewayUsageHistory || {};
  
  if (!gatewayHistory[fqdn]) {
    gatewayHistory[fqdn] = {
      requestCount: 0,
      firstUsed: new Date().toISOString(),
      lastUsed: new Date().toISOString()
    };
  }
  
  gatewayHistory[fqdn].requestCount++;
  gatewayHistory[fqdn].lastUsed = new Date().toISOString();
  
  await chrome.storage.local.set({ 
    gatewayUsageHistory: gatewayHistory 
  });
}
```

## Settings Page Integration

The settings page (`src/settings.js`) allows users to configure:

1. **Routing Strategy**: Select between fastestPing, roundRobin, random, or static
2. **Static Gateway**: Configure a specific gateway URL
3. **Gateway Sorting**: Choose sort by operatorStake or totalDelegatedStake
4. **Cache TTL**: Set gateway cache time-to-live (seconds)
5. **Blacklist Management**: Add/remove gateways from blacklist
6. **Registry Sync**: Manually trigger gateway registry sync

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
    note: 'Last resort fallback gateway'
  },
  status: 'joined'
};
```

### Error Page

For unrecoverable errors, the extension displays a user-friendly error page:

```typescript
chrome.tabs.update(tabId, {
  url: `data:text/html,<!DOCTYPE html>
    <html>
      <body>
        <h1>Error Processing AR.IO URL</h1>
        <p>${errorMessage}</p>
        <button onclick="history.back()">Go Back</button>
      </body>
    </html>`
});
```

## Telemetry Integration

When enabled, the extension sends anonymous usage data:

```typescript
const telemetrySettings = telemetryEnabled ? {
  enabled: true,
  sampleRate: 0.1, // 10% of requests
  events: {
    onRoutingSucceeded: (event) => {
      // Telemetry data sent to AR.IO network
    }
  }
} : undefined;
```

## Best Practices

1. **Gateway Caching**: Use TTL-based caching to reduce network requests
2. **Performance Tracking**: Monitor gateway response times with EMA
3. **Circuit Breaking**: Temporarily disable failing gateways
4. **Graceful Degradation**: Always have a fallback gateway
5. **User Control**: Allow users to override automatic selection

## Testing

To test the integration:

1. Install the extension in Chrome
2. Navigate to Settings > Network Configuration
3. Sync the gateway registry
4. Visit any `ar://` URL or use the search bar
5. Monitor gateway selection in browser console
6. Check performance stats in Settings > Performance