# Wayfinder Core

`@ar.io/wayfinder-core` is the core library for the Wayfinder project. It provides the core functionality for routing and verifying data through the ar.io network.

## Quick Start

### Installation

To install the latest version, run:

```bash
npm install @ar.io/wayfinder-core
# or
yarn add @ar.io/wayfinder-core
```

### Basic Usage

```javascript
import { createWayfinderClient } from '@ar.io/wayfinder-core';

// Uses trusted peers gateway provider by default
const wayfinder = createWayfinderClient();

// Use Wayfinder to fetch and verify data using ar:// protocol
const response = await wayfinder.request('ar://example-name');
```

### Using with AR.IO Network

```javascript
import { createWayfinderClient } from '@ar.io/wayfinder-core';
import { ARIO } from '@ar.io/sdk';

// Provide ARIO instance to use AR.IO network gateways
const wayfinder = createWayfinderClient({
  ario: ARIO.mainnet(),
  gatewaySelection: 'highest-performing', // Selection criteria for AR.IO network
});
```

### Custom Trusted Gateway

```javascript
import { createWayfinderClient } from '@ar.io/wayfinder-core';

// Use a specific trusted gateway for fetching peers
const wayfinder = createWayfinderClient({
  trustedGateways: ['https://permagate.io'], // First gateway is used for TrustedPeersGatewaysProvider
  routing: 'fastest',
  verification: 'hash',
});
```

### Configuration Options

`createWayfinderClient` accepts the following options:

```javascript
const wayfinder = createWayfinderClient({
  // Routing strategy
  routing: 'fastest', // 'random' | 'fastest' | 'round-robin' | 'preferred'
  
  // Verification strategy  
  verification: 'hash', // 'hash' | 'data-root' | 'remote' | 'disabled' (default: 'disabled')
  
  // Gateway selection (only applies when ario instance is provided)
  gatewaySelection: 'highest-performing', // 'highest-performing' | 'longest-tenure' | etc.
  
  // Enable caching for routing and gateway providers
  cache: true, // Uses default 5-minute TTL
  // OR specify custom TTL:
  // cache: { ttlSeconds: 3600 }, // 1 hour
  
  // List of trusted gateways for verification
  trustedGateways: ['https://arweave.net', 'https://permagate.io'],
});
```

### Gateway Selection Options (with AR.IO Network)

When using the AR.IO Network provider, you can specify how gateways are selected:

```javascript
import { createWayfinderClient } from '@ar.io/wayfinder-core';
import { ARIO } from '@ar.io/sdk';

const wayfinder = createWayfinderClient({
  ario: ARIO.mainnet(),
  
  // Gateway selection (only works with ARIO instance)
  gatewaySelection: 'top-ranked', // Options:
  // 'top-ranked' - Gateways with highest composite weight
  // 'most-tenured' - Gateways with longest service history  
  // 'highest-staked' - Gateways with most stake
  // 'top-ranked' - Gateways with highest composite weight
  // 'best-performance' - Gateways with best performance metrics
  // 'longest-streak' - Gateways with longest uptime streak
  
  routing: 'random', // How to select from the filtered gateways
  cache: { ttlSeconds: 600 }, // Cache for 10 minutes
});
```

## ar:// Protocol

Wayfinder supports several ar:// URL formats:

```bash
ar://TRANSACTION_ID              // Direct transaction ID
ar://NAME                        // ArNS name (paths supported)
ar:///info                       // Gateway endpoint (/info)
```

## Dynamic Routing

Wayfinder supports a `resolveUrl` method which generates dynamic redirect URLs to a target gateway based on the provided routing strategy. This function can be used to directly replace any hard-coded gateway URLs, and instead use Wayfinder's routing logic to select a gateway for the request.

#### ArNS names

Given an ArNS name, the redirect URL will be the same as the original URL, but with the gateway selected by Wayfinder's routing strategy.

```javascript
const redirectUrl = await wayfinder.resolveUrl({
  arnsName: 'ardrive',
});
// results in https://ardrive.<selected-gateway>
```

#### Transaction Ids

Given a txId, the redirect URL will be the same as the original URL, but with the gateway selected by Wayfinder's routing strategy.

```javascript
const redirectUrl = await wayfinder.resolveUrl({
  txId: 'example-tx-id',
});
// results in https://<selected-gateway>/example-tx-id
```

#### Legacy arweave.net or arweave.dev URLs

Given a legacy arweave.net or arweave.dev URL, the redirect URL will be the same as the original URL, but with the gateway selected by Wayfinder's routing strategy.

```javascript
const redirectUrl = await wayfinder.resolveUrl({
  originalUrl: 'https://arweave.net/example-tx-id',
});
// results in https://<selected-gateway>/example-tx-id
```

#### ar:// URLs

Given an ar:// URL, the redirect URL will be the same as the original URL, but with the gateway selected by Wayfinder's routing strategy.

```javascript
const redirectUrl = await wayfinder.resolveUrl({
  originalUrl: 'ar://example-name/subpath?query=value',
});
// results in https://<selected-gateway>/example-name/subpath?query=value
```

## Gateway Providers

Gateway providers are responsible for providing a list of gateways to Wayfinder to choose from when routing requests. By default, Wayfinder will use the `TrustedPeersGatewaysProvider` to fetch available gateways from a trusted gateway's peer list.

| Provider                       | Description                                    | Use Case                                |
| ------------------------------ | ---------------------------------------------- | --------------------------------------- |
| `NetworkGatewaysProvider`      | Returns gateways from AR.IO Network based on on-chain metrics | Leverage AR.IO Network with quality filtering |
| `TrustedPeersGatewaysProvider` | Fetches gateway list from a trusted gateway's `/ar-io/peers` endpoint | Dynamic gateway discovery from network peers |
| `StaticGatewaysProvider`       | Returns a static list of gateways you provide  | Testing or when specific gateways are required |
| `SimpleCacheGatewaysProvider`  | Wraps another provider with in-memory caching  | Reduce API calls and improve performance |
| `LocalStorageGatewaysProvider` | Wraps another provider with browser localStorage caching | Persistent caching across page reloads |

### NetworkGatewaysProvider

Returns a list of gateways from the ARIO Network based on on-chain metrics. You can specify on-chain metrics for gateways to prioritize the highest quality gateways. This requires installing the `@ar.io/sdk` package and importing the `ARIO` object. *It is recommended to use this provider for most use cases to leverage the AR.IO Network.*

```javascript
// requests will be routed to one of the top 10 gateways by operator stake
const gatewayProvider = new NetworkGatewaysProvider({
  ario: ARIO.mainnet(),
  sortBy: 'operatorStake', // sort by 'operatorStake' | 'totalDelegatedStake'
  sortOrder: 'desc', // 'asc'
  limit: 10, // number of gateways to use
  filter: (gateway) => {
    // use only active gateways that did not fail in the last epoch
    return gateway.status === 'joined' && gateway.stats.failedConsecutiveEpochs === 0;
  },
});
```

### TrustedPeersGatewaysProvider

Fetches a dynamic list of trusted peer gateways from an AR.IO gateway's `/ar-io/peers` endpoint. This provider is useful for discovering available gateways from a trusted source.

```javascript
import { TrustedPeersGatewaysProvider } from '@ar.io/wayfinder-core';

const gatewayProvider = new TrustedPeersGatewaysProvider({
  trustedGateway: 'https://arweave.net', // Gateway to fetch peers from
});

// The provider will fetch the peer list from https://arweave.net/ar-io/peers
// and return an array of gateway URLs from the response
```

### StaticGatewaysProvider

The static gateway provider returns a list of gateways that you provide. This is useful for testing or for users who want to use a specific gateway for all requests.

```javascript
import { StaticGatewaysProvider } from '@ar.io/wayfinder-core';

const gatewayProvider = new StaticGatewaysProvider({
  gateways: ['https://arweave.net'],
});
```

## Routing Strategies

Wayfinder supports multiple routing strategies to select target gateways for your requests.

| Strategy                     | Description                                    | Use Case                                |
| ---------------------------- | ---------------------------------------------- | --------------------------------------- |
| `RandomRoutingStrategy`      | Selects a random gateway from a list           | Good for load balancing and resilience  |
| `StaticRoutingStrategy`      | Always uses a single gateway                   | When you need to use a specific gateway |
| `RoundRobinRoutingStrategy`  | Selects gateways in round-robin order          | Good for load balancing and resilience  |
| `FastestPingRoutingStrategy` | Selects the fastest gateway based on ping time | Good for performance and latency        |
| `PreferredWithFallbackRoutingStrategy` | Uses a preferred gateway, with a fallback strategy if the preferred gateway is not available | Good for performance and resilience. Ideal for builders who run their own gateways. |
| `CompositeRoutingStrategy` | Chains multiple routing strategies together, trying each sequentially until one succeeds | Good for complex fallback scenarios and maximum resilience |

### RandomRoutingStrategy

Selects a random gateway from a list of gateways.

```javascript
import { RandomRoutingStrategy, NetworkGatewaysProvider } from '@ar.io/wayfinder-core';
import { ARIO } from '@ar.io/sdk';

// Option 1: Use with static gateways (override gatewaysProvider if provided)
const routingStrategy = new RandomRoutingStrategy();
const gateway = await routingStrategy.selectGateway({
  gateways: [new URL('https://arweave.net'), new URL('https://permagate.io')],
});

// Option 2: Use with gatewaysProvider (fetches dynamically)
const routingStrategy2 = new RandomRoutingStrategy({
  gatewaysProvider: new NetworkGatewaysProvider({
    ario: ARIO.mainnet(),
    sortBy: 'operatorStake',
    limit: 10,
  }),
});
const gateway2 = await routingStrategy2.selectGateway(); // uses gatewaysProvider

// Option 3: Override gatewaysProvider with static gateways
const gateway3 = await routingStrategy2.selectGateway({
  gateways: [new URL('https://custom-gateway.net')], // overrides gatewaysProvider
});
```

### StaticRoutingStrategy

```javascript
import { StaticRoutingStrategy } from '@ar.io/wayfinder-core';

const routingStrategy = new StaticRoutingStrategy({
  gateway: 'https://arweave.net',
});

const gateway = await routingStrategy.selectGateway(); // always returns the same gateway
```

### RoundRobinRoutingStrategy

Selects gateways in round-robin order. The gateway list is stored in memory and is not persisted across instances. You must provide either `gateways` OR `gatewaysProvider` (not both).

```javascript
import { RoundRobinRoutingStrategy, NetworkGatewaysProvider } from '@ar.io/wayfinder-core';
import { ARIO } from '@ar.io/sdk';

// use with a static list of gateways
const routingStrategy = new RoundRobinRoutingStrategy({
  gateways: [new URL('https://arweave.net'), new URL('https://permagate.io')],
});

// use with gatewaysProvider (loaded once and memoized)
const routingStrategy2 = new RoundRobinRoutingStrategy({
  gatewaysProvider: new NetworkGatewaysProvider({
    ario: ARIO.mainnet(),
    sortBy: 'operatorStake',
    sortOrder: 'desc',
    limit: 10,
  }),
});

const gateway = await routingStrategy.selectGateway(); // returns the next gateway in round-robin order
```

### FastestPingRoutingStrategy

Selects the fastest gateway based on simple HEAD request to the specified route.

```javascript
import { FastestPingRoutingStrategy, NetworkGatewaysProvider } from '@ar.io/wayfinder-core';
import { ARIO } from '@ar.io/sdk';

// use with static gateways (override gatewaysProvider if provided)
const routingStrategy = new FastestPingRoutingStrategy({
  timeoutMs: 1000,
});
const gateway = await routingStrategy.selectGateway({
  gateways: [new URL('https://slow.net'), new URL('https://medium.net'), new URL('https://fast.net')],
});

// use with gatewaysProvider (fetches dynamically)
const routingStrategy2 = new FastestPingRoutingStrategy({
  timeoutMs: 1000,
  gatewaysProvider: new NetworkGatewaysProvider({
    ario: ARIO.mainnet(),
    sortBy: 'operatorStake',
    limit: 20,
  }),
});
const gateway2 = await routingStrategy2.selectGateway({ path: '/ar-io/info' }); // uses gatewaysProvider

// override the gatewaysProvider with a static list of gateways
const gateway3 = await routingStrategy2.selectGateway({
  gateways: [new URL('https://priority-gateway.net')], // overrides gatewaysProvider
  path: '/ar-io/info'
});
```

### PreferredWithFallbackRoutingStrategy

Uses a preferred gateway, with a fallback strategy if the preferred gateway is not available. This is useful for builders who run their own gateways and want to use their own gateway as the preferred gateway, but also want to have a fallback strategy in case their gateway is not available.

> **Implementation Note:** This strategy is built using `CompositeRoutingStrategy` internally. It first attempts to ping the preferred gateway (using `PingRoutingStrategy` with `StaticRoutingStrategy`), and if that fails, it falls back to the specified fallback strategy.

```javascript
import { PreferredWithFallbackRoutingStrategy, FastestPingRoutingStrategy } from '@ar.io/wayfinder-core';

const routingStrategy = new PreferredWithFallbackRoutingStrategy({
  preferredGateway: 'https://permagate.io',
  fallbackStrategy: new FastestPingRoutingStrategy({
    timeoutMs: 500,
  }),
});
```

### CompositeRoutingStrategy

Chains multiple routing strategies together, trying each sequentially until one succeeds. This strategy provides maximum resilience by allowing complex fallback scenarios where you can combine different routing approaches.

```javascript
import { 
  CompositeRoutingStrategy, 
  FastestPingRoutingStrategy, 
  RandomRoutingStrategy,
  StaticRoutingStrategy,
  NetworkGatewaysProvider 
} from '@ar.io/wayfinder-core';
import { ARIO } from '@ar.io/sdk';

// Example 1: Try fastest ping first, fallback to random selection
const strategy = new CompositeRoutingStrategy({
  strategies: [
    new FastestPingRoutingStrategy({
      timeoutMs: 500,
      gatewaysProvider: new NetworkGatewaysProvider({
        ario: ARIO.mainnet(),
        sortBy: 'operatorStake',
        limit: 10,
      }),
    }),
    new RandomRoutingStrategy(), // fallback if ping strategy fails
  ],
});

// Example 2: Try preferred gateway, then fastest ping, then any random gateway
const complexStrategy = new CompositeRoutingStrategy({
  strategies: [
    new StaticRoutingStrategy({ gateway: 'https://my-preferred-gateway.com' }),
    new FastestPingRoutingStrategy({ timeoutMs: 1000 }),
    new RandomRoutingStrategy(), // final fallback
  ],
});

const gateway = await strategy.selectGateway({
  gateways: [new URL('https://gateway1.com'), new URL('https://gateway2.com')],
});
```

**How it works:**
1. The composite strategy tries each routing strategy in order
2. If a strategy successfully returns a gateway, that gateway is used
3. If a strategy throws an error, the next strategy is tried
4. If all strategies fail, an error is thrown
5. The first successful strategy short-circuits the process (remaining strategies are not tried)

**Common Use Cases:**
- **Performance + Resilience**: Try fastest ping first, fallback to random if ping fails
- **Preferred + Network**: Use your own gateway first, fallback to AR.IO network selection
- **Multi-tier Fallback**: Try premium gateways, then standard gateways, then any available gateway
- **Development + Production**: Use local gateway in development, fallback to production gateways

### Strategy Composition Examples

Here are a few “lego-style” examples showing how existing routing strategies can
be composed to suit different use cases. Each strategy implements
`RoutingStrategy`, so they can be wrapped and combined freely.

#### Random + Ping health checks

Pick a random gateway, then verify it responds with a `HEAD` request before
returning it.

```ts
import {
  RandomRoutingStrategy,
  PingRoutingStrategy,
} from "@ar.io/wayfinder-core";

const strategy = new PingRoutingStrategy({
  routingStrategy: new RandomRoutingStrategy(),
  retries: 2,
  timeoutMs: 500,
});
```

#### Fastest ping wrapped with a simple cache

Find the lowest-latency gateway and cache the result for five minutes to avoid
constant pings.

```ts
import {
  FastestPingRoutingStrategy,
  SimpleCacheRoutingStrategy,
} from "@ar.io/wayfinder-core";

const strategy = new SimpleCacheRoutingStrategy({
  routingStrategy: new FastestPingRoutingStrategy({ timeoutMs: 500 }),
  ttlSeconds: 300,
});
```

#### Preferred gateway + network fallback strategy

Attempt to use a favorite gateway, but fallback to a fastest pinging strategy using the ARIO Network if it fails.

```ts
import {
  PreferredWithFallbackRoutingStrategy,
  RandomRoutingStrategy,
  PingRoutingStrategy,
  NetworkGatewaysProvider,
} from "@ar.io/wayfinder-core";
import { ARIO } from '@ar.io/sdk';

// these will be our fallback gateways
const gatewayProvider = new NetworkGatewaysProvider({
  ario: ARIO.mainnet(),
  sortBy: 'operatorStake',
  limit: 5,
});

// this is our fallback strategy if our preferred gateway fails
const fastestPingStrategy = new FastestPingRoutingStrategy({
  timeoutMs: 500,
  gatewaysProvider: gatewayProvider,
});

// compose the strategies together, the preferred gateway will be used first, and if it fails, the fallback strategy will be used.
const strategy = new PreferredWithFallbackRoutingStrategy({
  preferredGateway: "https://my-gateway.example",
  fallbackStrategy: fastestPingStrategy,
});
```

#### Round-robin + ping verification

Cycle through gateways sequentially, checking each one’s health before use.

```ts
import {
  RoundRobinRoutingStrategy,
  PingRoutingStrategy,
  NetworkGatewaysProvider,
} from "@ar.io/wayfinder-core";
import { ARIO } from '@ar.io/sdk';

// use static gateways
const strategy = new PingRoutingStrategy({
  routingStrategy: new RoundRobinRoutingStrategy({
    gateways: [new URL("https://gw1"), new URL("https://gw2")],
  }),
});

// use a dynamic list of gateways from the ARIO Network
const strategy2 = new PingRoutingStrategy({
  routingStrategy: new RoundRobinRoutingStrategy({
    gatewaysProvider: new NetworkGatewaysProvider({
      ario: ARIO.mainnet(),
      sortBy: 'operatorStake',
      limit: 5,
    }),
  }),
});
```

#### Cache around any composed strategy

Because `SimpleCacheRoutingStrategy` accepts any `RoutingStrategy`, you can
cache more complex compositions too.

```ts
import {
  RandomRoutingStrategy,
  PingRoutingStrategy,
  SimpleCacheRoutingStrategy,
  NetworkGatewaysProvider,
} from "@ar.io/wayfinder-core";
import { ARIO } from '@ar.io/sdk';

// use a dynamic list of gateways from the ARIO Network
const randomStrategy = new RandomRoutingStrategy({
  gatewaysProvider: new NetworkGatewaysProvider({
    ario: ARIO.mainnet(),
    sortBy: 'operatorStake',
    limit: 20,
  }),
});

// wrap the random strategy with a ping strategy
const pingRandom = new PingRoutingStrategy({
  routingStrategy: randomStrategy,
});

// wrap the ping random strategy with a cache strategy, caching the selected gateway for 10 minutes
const cachedStrategy = new SimpleCacheRoutingStrategy({
  routingStrategy: pingRandom,
  ttlSeconds: 600,
});
```

#### Complex multi-strategy fallback with CompositeRoutingStrategy

Chain multiple strategies together for maximum resilience - try fastest ping first, then fall back to random selection if ping fails.

```ts
import {
  CompositeRoutingStrategy,
  FastestPingRoutingStrategy,
  RandomRoutingStrategy,
  NetworkGatewaysProvider,
} from "@ar.io/wayfinder-core";
import { ARIO } from '@ar.io/sdk';

// Define gateway provider for both strategies
const gatewayProvider = new NetworkGatewaysProvider({
  ario: ARIO.mainnet(),
  sortBy: 'operatorStake',
  limit: 15,
});

// Create a composite strategy that tries fastest ping first, then random
const strategy = new CompositeRoutingStrategy({
  strategies: [
    // Try fastest ping first (high performance, but may fail if all gateways are slow)
    new FastestPingRoutingStrategy({
      timeoutMs: 500,
      gatewaysProvider: gatewayProvider,
    }),
    // Fallback to random selection (guaranteed to work if gateways exist)
    new RandomRoutingStrategy({
      gatewaysProvider: gatewayProvider,
    }),
  ],
});
```

In all cases, you can supply the composed strategy to `Wayfinder` (or whatever
router factory you use) and pass in a gateways provider:

```ts
import { Wayfinder, StaticGatewaysProvider } from "@ar.io/wayfinder-core";

const router = new Wayfinder({
  gatewaysProvider: new StaticGatewaysProvider({
    gateways: [new URL("https://gw1"), new URL("https://gw2")],
  }),
  routingStrategy: strategy, // any of the compositions above
});
```

## Verification Strategies

Wayfinder includes verification mechanisms to ensure the integrity of retrieved data. Verification strategies offer different trade-offs between complexity, performance, and security.

| Verifier                        | Complexity | Performance | Security | Description                                                                                                  |
| ------------------------------- | ---------- | ----------- | -------- | ------------------------------------------------------------------------------------------------------------ |
| `RemoteVerificationStrategy`    | Low        | Low         | Low      | Checks the `x-ar-io-verified` header from the gateway that returned the data. If `true`, the data is considered verified and trusted. |
| `HashVerificationStrategy`      | Low        | High        | Low      | Computes the SHA-256 hash of the returned data and comparing it to the hash of a **trusted gateway** (_**recommended for most users**_).                                   |
| `DataRootVerificationStrategy`  | Medium     | Medium      | Low      | Computes the data root for the transaction (most useful for L1 transactions) and compares it to the data root provided by a **trusted gateway**. |
| `SignatureVerificationStrategy` | Medium     | Medium      | Medium   | - **ANS-104 Data Items**: Fetches signature components (owner, signature type, tags, etc.) from trusted gateways using range requests, then verifies signatures against the data payload using deep hash calculations following the ANS-104 standard.<br/>- **L1 Transactions**: Retrieves transaction metadata from gateway /tx/<tx-id> endpoints, computes the data root from the provided data stream, and verifies the signature using Arweave's cryptographic verification. |

### RemoteVerificationStrategy

This strategy is used to verify data by checking the `x-ar-io-verified` header from the gateway that returned the data. If the header is set to `true`, the data is considered verified and trusted.

> [!IMPORTANT]
> This strategy is only recommended for users fetching data from their own gateways and want to avoid the overhead of the other verification strategies.

```javascript
import { Wayfinder, RemoteVerificationStrategy } from '@ar.io/wayfinder-core';

const wayfinder = new Wayfinder({
  verificationSettings: {
    // no trusted gateways are required for this strategy
    enabled: true,
    strategy: new RemoteVerificationStrategy(),
  },
});
```

### HashVerificationStrategy

Verifies data integrity using SHA-256 hash comparison. This is the default verification strategy and is recommended for most users looking for a balance between security and performance.

```javascript
import { Wayfinder, HashVerificationStrategy } from '@ar.io/wayfinder-core';

const wayfinder = new Wayfinder({
  verificationSettings: {
    enabled: true,
    strategy: new HashVerificationStrategy({
      trustedGateways: ['https://permagate.io'],
    }),
  },
});
```

### DataRootVerificationStrategy

Verifies data integrity using Arweave by computing the data root for the transaction. This is useful for L1 transactions and is recommended for users who want to ensure the integrity of their data.

```javascript
import { Wayfinder, DataRootVerificationStrategy } from '@ar.io/wayfinder-core';

const wayfinder = new Wayfinder({
  verificationSettings: {
    enabled: true,
    strategy: new DataRootVerificationStrategy({
      trustedGateways: ['https://permagate.io'],
    }),
  },
});
```

### SignatureVerificationStrategy

Verifies signatures of Arweave transactions and data items. Headers are retrieved from trusted gateways for use during verification. For a transaction, its data root is computed while streaming its data and then utilized alongside its headers for verification. For data items, the ANS-104 deep hash method of signature verification is used.

```javascript
import { Wayfinder, SignatureVerificationStrategy } from '@ar.io/wayfinder-core';

const wayfinder = new Wayfinder({
  verificationSettings: {
    enabled: true,
    strategy: new SignatureVerificationStrategy({
      trustedGateways: ['https://permagate.io'],
    }),
  },
});
```

## Monitoring and Events

### Global request events

Wayfinder emits events during the routing and verification process for all requests, allowing you to monitor its operation. All events are emitted on the `wayfinder.emitter` event emitter, and are updated for each request.

```javascript
// Provide events to the Wayfinder constructor for tracking all requests
const wayfinder = new Wayfinder({
  routingSettings: {
    events: {
      onRoutingStarted: (event) => {
        console.log('Routing started!', event);
      },
      onRoutingSkipped: (event) => {
        console.log('Routing skipped!', event);
      },
      onRoutingSucceeded: (event) => {
        console.log('Routing succeeded!', event);
      },
    },
  },
  verificationSettings: {
    events: {
      onVerificationSucceeded: (event) => {
        console.log(`Verification passed for transaction: ${event.txId}`);
      },
      onVerificationFailed: (event) => {
        console.error(
          `Verification failed for transaction: ${event.txId}`,
          event.error,
        );
      },
      onVerificationProgress: (event) => {
        const percentage = (event.processedBytes / event.totalBytes) * 100;
        console.log(
          `Verification progress for ${event.txId}: ${percentage.toFixed(2)}%`,
        );
      },
    },
  },
});

// listen to the global wayfinder event emitter for all requests
wayfinder.emitter.on('routing-succeeded', (event) => {
  console.log(`Request routed to: ${event.targetGateway}`);
});

wayfinder.emitter.on('routing-failed', (event) => {
  console.error(`Routing failed: ${event.error.message}`);
});

wayfinder.emitter.on('verification-progress', (event) => {
  console.log(`Verification progress: ${event.progress}%`);
});

wayfinder.emitter.on('verification-succeeded', (event) => {
  console.log(`Verification succeeded: ${event.txId}`);
});

wayfinder.emitter.on('verification-failed', (event) => {
  console.error(`Verification failed: ${event.error.message}`);
});
```

### Request-specific events

You can also provide events to the `request` function to track a single request. These events are called for each request and are not updated for subsequent requests.

> [!INFO]
> Events are still emitted to the global event emitter for all requests. It is recommended to use the global event emitter for tracking all requests, and the request-specific events for tracking a single request.

```javascript
// create a wayfinder instance with verification enabled
const wayfinder = new Wayfinder({
  verificationSettings: {
    enabled: true,
    strategy: new HashVerificationStrategy({
      trustedGateways: ['https://permagate.io'],
    }),
    events: {
      onVerificationProgress: (event) => {
        console.log(`Global callback handler called for: ${event.txId}`);
      },
      onVerificationSucceeded: (event) => {
        console.log(`Global callback handler called for: ${event.txId}`);
      },
    },
  },
});

const response = await wayfinder.request('ar://example-name', {
  verificationSettings: {
    // these callbacks will be triggered for this request only, the global callback handlers are still called
    events: {
      onVerificationProgress: (event) => {
        console.log(`Request-specific callback handler called for: ${event.txId}`);
      },
      onVerificationSucceeded: (event) => {
        console.log(`Request-specific callback handler called for: ${event.txId}`);
      },
    },
  },
});
```

## Installation Notes

### Optional Dependencies

The `@ar.io/sdk` package is an optional peer dependency. To use AR.IO network gateways, you must explicitly provide an `ario` instance:

**With AR.IO SDK (Recommended):**
```bash
npm install @ar.io/wayfinder-core @ar.io/sdk
# or
yarn add @ar.io/wayfinder-core @ar.io/sdk
```
- `createWayfinderClient({ ario: ARIO.mainnet() })` uses AR.IO network gateways
- Supports intelligent gateway selection criteria
- Dynamic gateway discovery and updates

### Caching

Wayfinder supports intelligent caching:

- **In browsers**: Uses localStorage for persistent caching across page reloads
- **In Node.js**: Uses in-memory caching
- **What's cached**: Gateway lists, routing decisions, and more
- **Cache configuration**:
  - `cache: true` - Enable with default 5-minute TTL
  - `cache: { ttlSeconds: 3600 }` - Enable with custom TTL (in seconds)
  - `cache: false` - Disable caching (default)

## Advanced Usage

### Custom Providers and Strategies

For advanced use cases, you can provide custom providers and strategies to `createWayfinderClient`:

```javascript
import { createWayfinderClient, NetworkGatewaysProvider } from '@ar.io/wayfinder-core';
import { ARIO } from '@ar.io/sdk';

const wayfinder = createWayfinderClient({
  ario: ARIO.mainnet()
  
  // Gateway selection
  gatewaySelection: 'top-ranked',
  
  // Enable caching with custom TTL
  cache: { ttlSeconds: 3600 }, // 1 hour

  // Override 'routing' with custom routing strategy
  routingStrategy: new FastestPingRoutingStrategy({
    timeoutMs: 1000,
  }),

  // Override 'verification' with custom verification strategy
  verificationStrategy: new HashVerificationStrategy({
    trustedGateways: ['https://permagate.io'],
  }),
});
```

### Direct Constructor Usage

For complete control, you can use the Wayfinder constructor directly. This is useful when you need fine-grained control over the configuration:

> _Wayfinder client that caches the top 10 gateways by operator stake from the ARIO Network for 1 hour and uses the fastest pinging routing strategy to select the fastest gateway for requests._

```javascript
import { Wayfinder, NetworkGatewaysProvider, SimpleCacheGatewaysProvider, FastestPingRoutingStrategy, HashVerificationStrategy } from '@ar.io/wayfinder-core';
import { ARIO } from '@ar.io/sdk';

const wayfinder = new Wayfinder({
  // cache the top 10 gateways by operator stake from the ARIO Network for 1 hour
  gatewaysProvider: new SimpleCacheGatewaysProvider({
    ttlSeconds: 60 * 60, // cache the gateways for 1 hour
    gatewaysProvider: new NetworkGatewaysProvider({
      ario: ARIO.mainnet(),
      sortBy: 'operatorStake',
      sortOrder: 'desc',
      limit: 10,
    }),
  }),
  // routing settings
  routingSettings: {
    // use the fastest pinging strategy to select the fastest gateway for requests
    strategy: new FastestPingRoutingStrategy({
      timeoutMs: 1000,
    }),
    // events
    events: {
      onRoutingStarted: (event) => {
        console.log('Routing started!', event);
      },
      onRoutingSkipped: (event) => {
        console.log('Routing skipped!', event);
      },
      onRoutingSucceeded: (event) => {
        console.log('Routing succeeded!', event);
      },
    },
  },
  // verification settings
  verificationSettings: {
    // enable verification - if false, verification will be skipped for all requests
    enabled: true,
    // verify the data using the hash of the data against a list of trusted gateways
    strategy: new HashVerificationStrategy({
      trustedGateways: ['https://permagate.io'],
    }),
    // strict verification - if true, verification failures will cause requests to fail
    strict: true,
    // events
    events: {
      onVerificationProgress: (event) => {
        console.log('Verification progress!', event);
      },
      onVerificationSucceeded: (event) => {
        console.log('Verification succeeded!', event);
      },
      onVerificationFailed: (event) => {
        console.log('Verification failed!', event);
      },
    },
  },
});
```

## Telemetry

Wayfinder can optionally emit OpenTelemetry spans for every request. **By default, telemetry is disabled**. You can control this behavior with the `telemetrySettings` option.

```javascript

import { createWayfinderClient } from '@ar.io/wayfinder-core';
import { ARIO } from '@ar.io/sdk';

const wayfinder = createWayfinderClient({
  ario: ARIO.mainnet(),
  // other settings...
  telemetrySettings: {
    enabled: true, // disabled by default (must be explicitly enabled)
    sampleRate: 0.1, // 10% sample rate by default
    exporterUrl: 'https://your-custom-otel-exporter', // optional, defaults to https://api.honeycomb.io/v1/traces
    clientName: 'my-custom-client-name', // optional, defaults to wayfinder-core
    clientVersion: '1.0.0', // optional, defaults to empty
  },
});
```

## Request Flow

The following sequence diagram illustrates how Wayfinder processes requests:

```mermaid
sequenceDiagram
    participant Client
    participant Wayfinder
    participant Gateways Provider
    participant Routing Strategy
    participant Selected Gateway
    participant Verification Strategy
    participant Trusted Gateways

    Client->>Wayfinder: request('ar://example')
    activate Wayfinder

    Wayfinder->>+Gateways Provider: getGateways()
    Gateways Provider-->>-Wayfinder: List of gateway URLs

    Wayfinder->>+Routing Strategy: selectGateway() from list of gateways
    Routing Strategy-->>-Wayfinder: Select gateway for request

    Wayfinder->>+Selected Gateway: Send HTTP request to target gateway
    Selected Gateway-->>-Wayfinder: Response with data & txId

    activate Verification Strategy
    Wayfinder->>+Verification Strategy: verifyData(responseData, txId)
    Verification Strategy->>Wayfinder: Emit 'verification-progress' events
    Verification Strategy->>Trusted Gateways: Request verification headers
    Trusted Gateways-->>Verification Strategy: Return verification headers
    Verification Strategy->>Verification Strategy: Compare computed vs trusted data
    Verification Strategy-->>-Wayfinder: Return request data with verification result

    alt Verification passed
        Wayfinder->>Wayfinder: Emit 'verification-passed' event
        Wayfinder-->>Client: Return verified response
    else Verification failed
        Wayfinder->>Wayfinder: Emit 'verification-failed' event
        Wayfinder-->>Client: Throw verification error
    end

    deactivate Wayfinder
```
