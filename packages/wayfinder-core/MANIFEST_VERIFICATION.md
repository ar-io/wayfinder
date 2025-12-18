# Manifest Verification Guide

This guide explains how to use the Wayfinder SDK's manifest verification features to securely verify Arweave manifests and all their nested resources.

## ⚠️ Important Security Notice

**What Manifest Verification Does:**
- ✅ Verifies the manifest transaction is authentic and immutable
- ✅ Verifies all referenced transaction IDs are valid Arweave transactions
- ✅ Confirms content from trusted gateways matches expected cryptographic hashes
- ✅ Detects tampering or corruption in the manifest structure

**What Manifest Verification Does NOT Do:**
- ❌ Does not guarantee that manifest content is safe or non-malicious
- ❌ Does not prevent future requests to malicious gateways from returning different content
- ❌ Does not validate that the application logic is secure

**Critical Security Requirement:**
After manifest verification passes, you **MUST** load the manifest and its resources through a **trusted gateway**, not the potentially malicious gateway that was initially used for verification. Verification confirms the manifest is authentic, but only a trusted gateway ensures you receive the correct content.

## Overview

When an Arweave application uses manifests, it creates a directory-like structure where paths are mapped to transaction IDs. The challenge is that while you can verify the manifest transaction itself, a malicious gateway could serve modified nested resources (JavaScript files, images, etc.) that aren't verified.

**Manifest verification** solves this by:
- Detecting manifest content automatically
- Parsing the manifest structure
- Recursively verifying ALL nested resources against trusted gateways
- Handling nested manifests (manifests that reference other manifests)
- Providing detailed progress tracking
- Using cryptographic verification on original byte streams (not re-encoded data)

## Quick Start

### Basic Usage with wayfinder-core

```typescript
import {
  Wayfinder,
  HashVerificationStrategy,
} from '@ar.io/wayfinder-core';

// Create a Wayfinder instance with verification enabled
const wayfinder = new Wayfinder({
  verificationSettings: {
    enabled: true,
    strategy: new HashVerificationStrategy({
      trustedGateways: [new URL('https://permagate.io')],
    }),
    strict: true, // Fail requests if verification fails
  },
});

// Request a manifest with automatic nested resource verification
const response = await wayfinder.requestWithManifest('ar://manifest-txid', {
  verifyNested: true,
  maxDepth: 5,
  concurrency: 10,
  onProgress: (event) => {
    console.log(`Progress: ${event.type}`, event);
  },
});

console.log('All verified:', response.allVerified);
console.log('Manifest:', response.manifest);
console.log('Verification results:', response.verificationResults);
```

### React Hook Usage

```tsx
import { useManifestRequest } from '@ar.io/wayfinder-react';

function ManifestApp({ txId }: { txId: string }) {
  const {
    data,
    manifest,
    isLoading,
    error,
    verificationProgress,
    allResourcesVerified,
    verificationResults,
  } = useManifestRequest(`ar://${txId}`, {
    verifyNested: true,
    maxDepth: 5,
    concurrency: 10,
  });

  if (isLoading) {
    return (
      <div>
        Loading...
        {verificationProgress && (
          <p>
            {verificationProgress.type === 'resource-verified' &&
              `Verified ${verificationProgress.currentIndex} of ${verificationProgress.totalResources} resources`}
          </p>
        )}
      </div>
    );
  }

  if (error) return <div>Error: {error.message}</div>;

  if (!manifest) return <div>Not a manifest</div>;

  return (
    <div>
      <h2>Manifest</h2>
      <p>All verified: {allResourcesVerified ? '✅ Yes' : '❌ No'}</p>
      <h3>Resources ({Object.keys(manifest.paths).length}):</h3>
      <ul>
        {Object.entries(manifest.paths).map(([path, { id }]) => {
          const result = verificationResults.get(id);
          return (
            <li key={path}>
              {path} → {id}{' '}
              {result?.verified ? '✅' : '❌'}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
```

## How It Works

### Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                   Wayfinder.requestWithManifest                 │
└────────────────────────────┬────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│             ManifestVerificationStrategy                        │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │  1. Detect if content is a manifest                      │   │
│  │  2. Parse manifest JSON                                  │   │
│  │  3. Verify manifest transaction itself                   │   │
│  │  4. Verify each nested resource (parallel)               │   │
│  │  5. Recursively verify nested manifests                  │   │
│  └──────────────────────────────────────────────────────────┘   │
└────────────────────────────┬────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│              Base Verification Strategy                         │
│         (HashVerification, DataRootVerification, etc.)          │
└─────────────────────────────────────────────────────────────────┘
```

### Verification Flow

1. **Manifest Detection**
   - Check `content-type` header for `application/x.arweave-manifest+json`
   - Fallback: Try parsing as JSON manifest

2. **Manifest Parsing**
   - Parse JSON structure
   - Extract all transaction IDs from `paths`
   - Emit `manifest-parsed` event

3. **Manifest Verification**
   - Verify the manifest transaction itself using base strategy
   - Verify all nested resources concurrently (with configurable limit)
   - For each resource:
     - Fetch from trusted gateway
     - Check if it's a nested manifest
     - Recursively verify if nested manifest detected
     - Emit progress events

4. **Result Aggregation**
   - Collect all verification results
   - Return enhanced response with manifest data

### Progress Events

The verification process emits detailed progress events:

```typescript
type ManifestVerificationProgress =
  | { type: 'manifest-detected'; txId: string; totalResources: number }
  | { type: 'manifest-parsed'; txId: string; manifest: ArweaveManifest; totalResources: number }
  | { type: 'resource-verifying'; txId: string; resourceTxId: string; currentIndex: number; totalResources: number }
  | { type: 'resource-verified'; txId: string; resourceTxId: string; verified: boolean; currentIndex: number; totalResources: number }
  | { type: 'nested-manifest-detected'; parentTxId: string; nestedTxId: string; depth: number }
  | { type: 'manifest-complete'; txId: string; totalVerified: number; totalFailed: number; allVerified: boolean };
```

## API Reference

### `ManifestVerificationStrategy`

A verification strategy wrapper that adds manifest-specific logic to any base strategy.

```typescript
import {
  ManifestVerificationStrategy,
  HashVerificationStrategy,
} from '@ar.io/wayfinder-core';

const strategy = new ManifestVerificationStrategy({
  baseStrategy: new HashVerificationStrategy({
    trustedGateways: [new URL('https://permagate.io')],
  }),
  maxDepth: 5,        // Maximum nesting depth for manifests
  concurrency: 10,    // Maximum parallel verifications
  cache: myCache,     // Optional: Custom verification cache
  logger: myLogger,   // Optional: Custom logger
  emitter: myEmitter, // Optional: Event emitter
});
```

### `Wayfinder.requestWithManifest()`

Enhanced request method with manifest verification.

```typescript
const response = await wayfinder.requestWithManifest(url, {
  verifyNested: true,   // Verify all nested resources (default: true)
  maxDepth: 5,          // Max depth for nested manifests (default: 5)
  concurrency: 10,      // Parallel verification limit (default: 10)
  onProgress: (event) => {
    // Handle progress events
  },
});
```

**Returns:** `ManifestResponse`
```typescript
interface ManifestResponse extends Response {
  manifest?: ArweaveManifest;
  verificationResults: Map<string, { verified: boolean; error?: Error }>;
  allVerified: boolean;
}
```

### `ManifestVerificationCache`

In-memory cache for verification results to improve performance.

```typescript
import { ManifestVerificationCache } from '@ar.io/wayfinder-core';

const cache = new ManifestVerificationCache({
  ttlMs: 3600000, // Cache TTL in milliseconds (default: 1 hour)
});

// Store verification result
cache.set({
  txId: 'abc123',
  hash: 'xyz789',
  verified: true,
});

// Retrieve cached result
const result = cache.get({ txId: 'abc123', hash: 'xyz789' });

// Get cache statistics
const stats = cache.getStats(); // { size, expired, valid }

// Prune expired entries
cache.prune();

// Clear all entries
cache.clear();
```

### `ManifestParser`

Utility for parsing and working with Arweave manifests.

```typescript
import { ManifestParser } from '@ar.io/wayfinder-core';

// Check if data is a manifest
const isManifest = ManifestParser.isManifest(data);

// Parse manifest
const manifest = ManifestParser.parse(jsonString);

// Get all transaction IDs
const txIds = ManifestParser.getAllTransactionIds(manifest);

// Resolve a path to transaction ID
const txId = ManifestParser.resolvePath(manifest, 'app.js');

// Get index transaction ID
const indexTxId = ManifestParser.getIndex(manifest);
```

## Performance Considerations

### Concurrency Control

Verifying large manifests can be expensive. Use concurrency control to limit parallel requests:

```typescript
// For a manifest with 100 resources:
const response = await wayfinder.requestWithManifest(url, {
  concurrency: 10, // Verify max 10 resources at a time
});
```

**Performance:**
- Without concurrency control: 100 sequential requests (~10 seconds)
- With concurrency=10: ~1-2 seconds

### Caching

Verification results are cached automatically within a single `requestWithManifest` call. For cross-request caching, provide a shared cache instance:

```typescript
import { ManifestVerificationCache } from '@ar.io/wayfinder-core';

const sharedCache = new ManifestVerificationCache({ ttlMs: 3600000 });

const strategy = new ManifestVerificationStrategy({
  baseStrategy: myBaseStrategy,
  cache: sharedCache, // Reuse across multiple requests
});
```

### Depth Limiting

Prevent infinite recursion with nested manifests:

```typescript
const response = await wayfinder.requestWithManifest(url, {
  maxDepth: 3, // Stop after 3 levels of nested manifests
});
```

## Security Considerations

### Why Manifest Verification Matters

Without manifest verification:
```
✅ Manifest transaction verified
❌ app.js NOT verified (could be malicious!)
❌ style.css NOT verified
❌ logo.png NOT verified
```

With manifest verification:
```
✅ Manifest transaction verified
✅ app.js verified
✅ style.css verified
✅ logo.png verified
```

### Strict vs Non-Strict Mode

**Strict mode** (recommended for security-critical apps):
```typescript
const wayfinder = new Wayfinder({
  verificationSettings: {
    strict: true, // Request fails if ANY verification fails
  },
});
```

**Non-strict mode** (for monitoring/debugging):
```typescript
const wayfinder = new Wayfinder({
  verificationSettings: {
    strict: false, // Verification failures emit events but don't block
  },
});
```

### Trusted Gateways

Manifest verification requires trusted gateways to compare hashes:

```typescript
const strategy = new HashVerificationStrategy({
  trustedGateways: [
    new URL('https://permagate.io'),
    new URL('https://arweave.net'),
  ],
});
```

Choose trusted gateways carefully - they are critical for security.

### Supported Verification Strategies

**ManifestVerificationStrategy works with:**
- ✅ `HashVerificationStrategy` (recommended)
- ✅ `DataRootVerificationStrategy`
- ✅ `SignatureVerificationStrategy`

**NOT supported:**
- ❌ `RemoteVerificationStrategy`

**Why RemoteVerificationStrategy is not supported:**

`RemoteVerificationStrategy` only checks the `x-ar-io-verified` header from the original gateway response. It doesn't fetch from trusted gateways.

However, `ManifestVerificationStrategy` needs to:
1. Fetch nested resources from trusted gateways
2. Verify each resource independently
3. Recursively verify nested manifests

This architectural incompatibility means RemoteVerificationStrategy cannot be used with manifest verification.

**Error you'll see:**
```
Error: ManifestVerificationStrategy does not support RemoteVerificationStrategy.
RemoteVerificationStrategy only checks x-ar-io-verified headers from the original gateway,
but ManifestVerificationStrategy needs to fetch nested resources from trusted gateways.
Please use HashVerificationStrategy, DataRootVerificationStrategy, or SignatureVerificationStrategy instead.
```

**Recommendation:** Use `HashVerificationStrategy` for manifest verification:
```typescript
const wayfinder = new Wayfinder({
  verificationSettings: {
    enabled: true,
    strict: true,
    strategy: new ManifestVerificationStrategy({
      baseStrategy: new HashVerificationStrategy({
        trustedGateways: [
          new URL('https://permagate.io'),
          new URL('https://arweave.net'),
        ],
      }),
    }),
  },
});
```

## Examples

### Verify a Simple Manifest

```typescript
import { Wayfinder, HashVerificationStrategy } from '@ar.io/wayfinder-core';

const wayfinder = new Wayfinder({
  verificationSettings: {
    enabled: true,
    strict: true,
    strategy: new HashVerificationStrategy({
      trustedGateways: [new URL('https://permagate.io')],
    }),
  },
});

const response = await wayfinder.requestWithManifest('ar://manifest-id');

if (response.allVerified) {
  console.log('✅ All resources verified!');
  const text = await response.text();
  // Safe to use the data
} else {
  console.error('❌ Verification failed');
}
```

### Track Progress with Progress Bar

```typescript
let totalResources = 0;
let verifiedResources = 0;

const response = await wayfinder.requestWithManifest('ar://manifest-id', {
  onProgress: (event) => {
    if (event.type === 'manifest-parsed') {
      totalResources = event.totalResources;
      console.log(`Manifest has ${totalResources} resources`);
    }
    if (event.type === 'resource-verified') {
      verifiedResources = event.currentIndex;
      const percentage = (verifiedResources / totalResources) * 100;
      console.log(`Progress: ${percentage.toFixed(1)}%`);
    }
    if (event.type === 'manifest-complete') {
      console.log(`Complete! ${event.totalVerified}/${totalResources} verified`);
    }
  },
});
```

### Handle Verification Failures

```typescript
const response = await wayfinder.requestWithManifest('ar://manifest-id');

if (!response.allVerified) {
  // Check which resources failed
  for (const [txId, result] of response.verificationResults) {
    if (!result.verified) {
      console.error(`Failed to verify ${txId}:`, result.error);
    }
  }

  throw new Error('Some resources failed verification');
}
```

## Troubleshooting

### "Verification strategy must be configured"

```typescript
// ❌ Wrong - no verification strategy
const wayfinder = new Wayfinder();
await wayfinder.requestWithManifest('ar://id'); // Error!

// ✅ Correct - verification strategy provided
const wayfinder = new Wayfinder({
  verificationSettings: {
    enabled: true,
    strategy: new HashVerificationStrategy({
      trustedGateways: [new URL('https://permagate.io')],
    }),
  },
});
```

### "Maximum manifest nesting depth exceeded"

Increase the `maxDepth` parameter:

```typescript
await wayfinder.requestWithManifest('ar://id', {
  maxDepth: 10, // Increase from default 5
});
```

### Slow Verification

1. **Increase concurrency:**
   ```typescript
   await wayfinder.requestWithManifest('ar://id', {
     concurrency: 20, // Increase from default 10
   });
   ```

2. **Use caching:**
   ```typescript
   const cache = new ManifestVerificationCache({ ttlMs: 3600000 });
   const strategy = new ManifestVerificationStrategy({
     baseStrategy: myStrategy,
     cache, // Reuse verification results
   });
   ```

3. **Check trusted gateway performance:**
   ```typescript
   // Use faster trusted gateways
   const strategy = new HashVerificationStrategy({
     trustedGateways: [
       new URL('https://arweave.net'),     // Try multiple
       new URL('https://permagate.io'),
     ],
     maxConcurrency: 2, // Fetch from multiple gateways in parallel
   });
   ```

## Migration Guide

### Upgrading from Regular Request

Before:
```typescript
const response = await wayfinder.request('ar://manifest-id');
// ❌ Nested resources not verified
```

After:
```typescript
const response = await wayfinder.requestWithManifest('ar://manifest-id');
// ✅ All nested resources verified
```

### Backward Compatibility

The new manifest verification is fully backward compatible:
- Existing `wayfinder.request()` calls continue to work
- `requestWithManifest()` is an opt-in enhancement
- No breaking changes to existing APIs

## Best Practices

1. **Always use strict mode for production apps**
   ```typescript
   verificationSettings: { strict: true }
   ```

2. **Set appropriate concurrency limits**
   ```typescript
   // For mobile/slow connections
   concurrency: 5

   // For desktop/fast connections
   concurrency: 20
   ```

3. **Monitor verification progress**
   ```typescript
   onProgress: (event) => {
     // Log to analytics, update UI, etc.
   }
   ```

4. **Handle verification failures gracefully**
   ```typescript
   if (!response.allVerified) {
     // Show warning to user
     // Optionally allow them to proceed with caution
   }
   ```

5. **Use caching for repeated requests**
   ```typescript
   const cache = new ManifestVerificationCache();
   // Reuse cache across requests
   ```

## Contributing

Found a bug or have a feature request? Please file an issue on [GitHub](https://github.com/ar-io/wayfinder/issues).
