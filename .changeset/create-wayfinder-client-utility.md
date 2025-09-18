---
"@ar.io/wayfinder-core": minor
---

Add createWayfinderClient utility function with simplified API

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
  gatewaySelection: 'top-ranked',
  routing: 'fastest',
  verification: 'hash',
  cache: { ttlSeconds: 600 }
});
```
