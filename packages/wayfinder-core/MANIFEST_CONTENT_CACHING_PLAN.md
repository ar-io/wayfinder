# Manifest Content Caching Implementation Plan

## Goal
Enable Wayfinder to cache verified content so that when a web app loads manifest resources, they're served from cache without re-fetching, ensuring users only see fully verified content.

## Current Problem

**Scenario:**
```javascript
// User requests manifest
const response = await wayfinder.requestWithManifest('ar://manifest-id');
const html = await response.text(); // Returns index.html

// Browser parses HTML and sees:
// <script src="ar://script-tx-id"></script>
// <img src="ar://image-tx-id">

// Each resource triggers a NEW request:
await wayfinder.request('ar://script-tx-id'); // Fetches AGAIN, unverified!
await wayfinder.request('ar://image-tx-id'); // Fetches AGAIN, unverified!
```

**Issues:**
1. ❌ Resources fetched twice (once for verification, once for serving)
2. ❌ User sees unverified content (second fetch bypasses verification)
3. ❌ Slow performance (double network requests)
4. ❌ Strict mode doesn't work (unverified content still loads)

## Proposed Solution

### Architecture Changes

#### 1. Enhanced Cache Structure
```typescript
interface VerificationResult {
  txId: string;
  verified: boolean;
  timestamp: number;
  // NEW FIELDS:
  content?: Uint8Array;      // Verified content bytes
  contentType?: string;       // Content-Type header
  headers?: Record<string, string>; // All response headers
}
```

#### 2. Flow with Content Caching

**Step 1: requestWithManifest() called**
```javascript
await wayfinder.requestWithManifest('ar://manifest-id', {
  verifyNested: true,
  strict: true
});
```

**Step 2: Manifest verification phase**
```
1. Fetch /raw/manifest-id → Get manifest JSON
2. Parse manifest → Find 438 resources
3. For each resource:
   a. Fetch from gateway
   b. Verify bytes cryptographically
   c. If verified: Store content + headers in cache
   d. If failed + strict mode: Throw error
   e. If failed + non-strict: Store with verified=false, emit warning event
4. Return index.html to user
```

**Step 3: Browser requests resource**
```javascript
// Browser triggers:
await wayfinder.request('ar://script-tx-id');

// Wayfinder checks cache:
const cached = this.manifestContentCache.get({ txId: 'script-tx-id' });

if (cached && cached.verified && cached.content) {
  // ✅ Serve from cache (no fetch!)
  return new Response(cached.content, {
    headers: cached.headers
  });
} else if (cached && !cached.verified && this.verificationSettings.strict) {
  // ❌ Strict mode: Block unverified content
  throw new Error(`Resource ${txId} failed verification`);
} else if (cached && !cached.verified) {
  // ⚠️ Non-strict: Serve with warning event
  this.emitter.emit('verification-warning', { txId });
  return new Response(cached.content, {
    headers: { ...cached.headers, 'x-wayfinder-verified': 'false' }
  });
} else {
  // Not in cache, fetch normally
  return this.fetch(...);
}
```

### Implementation Steps

#### Step 1: Update ManifestVerificationStrategy ✅ DONE
- [x] Add content, contentType, headers fields to VerificationResult

#### Step 2: Modify ManifestVerificationStrategy.fetchAndVerifyResource()
```typescript
private async fetchAndVerifyResource({ txId, ... }) {
  // ... existing fetch code ...

  // NEW: Capture content bytes during verification
  const chunks: Uint8Array[] = [];
  const [verifyBranch, captureBranch] = response.body.tee();

  // Verify original bytes
  await this.verifySingleTransaction({ data: verifyBranch, ... });

  // Capture verified content
  for await (const chunk of captureBranch) {
    chunks.push(chunk);
  }

  const content = Buffer.concat(chunks);

  // Store in cache with content
  this.cache.set({
    txId,
    verified: true,
    content,
    contentType: headers['content-type'],
    headers,
    timestamp: Date.now()
  });
}
```

#### Step 3: Modify Wayfinder.request()
```typescript
async request(input, options) {
  // Extract TX ID from input
  const { txId } = extractRoutingInfo(createWayfinderUrl(input));

  if (txId) {
    // Check content cache first
    const cached = this.manifestContentCache.get({ txId });

    if (cached && cached.content) {
      if (!cached.verified && this.verificationSettings.strict) {
        throw new Error(`Blocked unverified content: ${txId}`);
      }

      if (!cached.verified) {
        this.emitter.emit('verification-warning', {
          txId,
          message: 'Serving unverified cached content'
        });
      }

      // Serve from cache
      return new Response(cached.content, {
        status: 200,
        headers: cached.headers
      });
    }
  }

  // Not in cache, proceed with normal fetch
  return this.fetch(input, options);
}
```

#### Step 4: Update requestWithManifest()
```typescript
async requestWithManifest(input, options) {
  // ... existing code ...

  // Use the instance cache, not a new one
  const manifestStrategy = new ManifestVerificationStrategy({
    baseStrategy: this.verificationSettings.strategy,
    cache: this.manifestContentCache, // Use instance cache!
    ...
  });

  // ... rest of verification ...
}
```

### Modes of Operation

#### Strict Mode (strict: true)
- ✅ Verification happens before any content is served
- ❌ If verification fails, throws error - nothing loads
- ✅ User only sees verified content
- ✅ App can catch error and show message

#### Non-Strict Mode (strict: false, default)
- ✅ Content served immediately (better UX)
- ⚠️ Verification happens in background
- ⚠️ Unverified content served with warning event
- ✅ App can listen to events and show warnings

### Memory Management

**Concerns:**
- Caching 438 resources × avg 100KB = 43.8 MB
- Could cause memory pressure in browser

**Solutions:**
1. **Size Limits:**
   ```typescript
   class ManifestVerificationCache {
     private maxTotalSize = 50 * 1024 * 1024; // 50 MB limit
     private maxItemSize = 5 * 1024 * 1024;   // 5 MB per item
   }
   ```

2. **LRU Eviction:**
   - When cache full, evict least recently used
   - Keep verification results, discard content

3. **Selective Caching:**
   ```typescript
   // Only cache small resources
   if (content.length < this.maxItemSize) {
     cache.set({ content });
   } else {
     cache.set({ content: undefined }); // Store verification only
   }
   ```

### Events for App Integration

```typescript
// App can listen for these events:
wayfinder.emitter.on('verification-failed', (event) => {
  // Show error banner: "Failed to verify resource"
  console.error(`Verification failed: ${event.txId}`);
});

wayfinder.emitter.on('verification-warning', (event) => {
  // Show warning banner: "Content not yet verified"
  console.warn(`Unverified content: ${event.txId}`);
});

wayfinder.emitter.on('verification-succeeded', (event) => {
  // Update UI: "Content verified ✓"
  console.log(`Verified: ${event.txId}`);
});

wayfinder.emitter.on('manifest-progress', (event) => {
  // Show progress: "Verifying 123/438 resources..."
  console.log(`Progress: ${event.verified}/${event.total}`);
});
```

### API Examples

#### Example 1: Web App with Strict Mode
```typescript
const wayfinder = new Wayfinder({
  verificationSettings: {
    enabled: true,
    strict: true, // Block unverified content
    strategy: new HashVerificationStrategy({
      trustedGateways: [new URL('https://arweave.net')]
    })
  }
});

try {
  // Load manifest with verification
  const response = await wayfinder.requestWithManifest('ar://manifest-id', {
    verifyNested: true,
    onProgress: (event) => {
      setProgress(`${event.verified}/${event.total}`);
    }
  });

  if (!response.allVerified) {
    throw new Error('Some resources failed verification');
  }

  // All verified! Serve content
  const html = await response.text();
  document.body.innerHTML = html;

  // When browser requests resources, they're served from verified cache
  // No additional fetches needed!

} catch (error) {
  showError(`Verification failed: ${error.message}`);
}
```

#### Example 2: Web App with Non-Strict Mode
```typescript
const wayfinder = new Wayfinder({
  verificationSettings: {
    enabled: true,
    strict: false, // Allow unverified content with warnings
    events: {
      'verification-warning': (event) => {
        showWarningBanner(`Unverified: ${event.txId}`);
      },
      'verification-failed': (event) => {
        showError(`Failed to verify: ${event.txId}`);
      }
    }
  }
});

// Load immediately, verify in background
const response = await wayfinder.requestWithManifest('ar://manifest-id', {
  verifyNested: true
});

const html = await response.text();
document.body.innerHTML = html; // Loads immediately

// Resources load from cache (verified or not)
// App shows warnings for unverified content
```

### Testing Plan

1. **Unit Tests:**
   - Cache stores and retrieves content correctly
   - Strict mode blocks unverified content
   - Non-strict mode serves with warnings
   - Memory limits enforced

2. **Integration Tests:**
   - requestWithManifest() caches all resources
   - Subsequent request() calls use cache
   - No duplicate fetches
   - Events emitted correctly

3. **Performance Tests:**
   - Measure time: with vs without cache
   - Measure memory: cache size limits
   - Measure network: verify only one fetch per resource

### Security Considerations

1. **Cache Poisoning:**
   - ✅ Content only cached AFTER verification succeeds
   - ✅ Cryptographic verification ensures integrity
   - ✅ Cache is per-Wayfinder instance (no cross-contamination)

2. **Memory Exhaustion:**
   - ✅ Size limits prevent runaway memory usage
   - ✅ LRU eviction keeps cache bounded
   - ✅ TTL ensures old content is purged

3. **Strict Mode Bypass:**
   - ✅ Cache check happens in request(), respects strict mode
   - ✅ Unverified content blocked when strict=true
   - ✅ No way to bypass verification

### Next Steps

1. Implement Step 2: Modify fetchAndVerifyResource()
2. Implement Step 3: Modify request()
3. Implement Step 4: Update requestWithManifest()
4. Add memory management (size limits, LRU)
5. Add comprehensive tests
6. Update documentation
7. Test with real ArDrive manifest

### Open Questions

1. **Should we cache ALL resources or only small ones?**
   - Proposal: Cache < 5MB, verification-only for large files

2. **What's the default cache TTL?**
   - Proposal: 1 hour (configurable)

3. **Should cache be clearable by the app?**
   - Proposal: Add `wayfinder.clearManifestCache()` method

4. **Should we support cache persistence (localStorage)?**
   - Proposal: Phase 2 feature, not MVP
