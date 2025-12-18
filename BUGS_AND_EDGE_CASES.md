# Bugs and Edge Cases - Comprehensive Code Review

## 🔴 CRITICAL BUGS

### 1. **Incorrect `allVerified` Logic in requestWithManifest**

**Location:** `packages/wayfinder-core/src/wayfinder.ts:841`

**The Bug:**
```typescript
manifestResponse.allVerified = verificationResults.size === 0 ? true : allVerified;
```

**Problem:**
If no verification results are found in the cache (`verificationResults.size === 0`), we set `allVerified = true`. This is incorrect!

**Scenario:**
1. User requests a manifest with 100 resources
2. Verification completes successfully
3. Cache is cleared or TTL expires
4. User calls `requestWithManifest` again
5. No results found in cache → `verificationResults.size === 0`
6. `allVerified = true` even though nothing was verified! ❌

**Impact:** HIGH - Users might trust unverified content

**Fix:**
```typescript
// If no results in cache, it means we couldn't verify
// Only set to true if we actually have results AND they're all verified
manifestResponse.allVerified =
  verificationResults.size > 0 && allVerified;
```

---

### 2. **Potential Null Pointer in fetchAndVerifyResource**

**Location:** `packages/wayfinder-core/src/verification/manifest-verification.ts:206`

**The Bug:**
```typescript
const data = response.body!; // Non-null assertion
```

**Problem:**
Using `!` assumes `response.body` is never null, but according to the Fetch API, `body` can be null for responses without a body (204 No Content, HEAD requests, etc.).

**Scenario:**
1. Trusted gateway returns 204 or has no body
2. `response.body` is null
3. Code crashes when trying to call `data.tee()` on null

**Impact:** HIGH - Crashes verification

**Fix:**
```typescript
if (!response.body) {
  throw new Error('Response has no body');
}
const data = response.body;
```

---

### 3. **No Retry Logic for Failed Trusted Gateways**

**Location:** `packages/wayfinder-core/src/verification/manifest-verification.ts:188`

**The Bug:**
```typescript
const gateway = this.trustedGateways[0]; // Always uses first gateway
```

**Problem:**
Always uses the first trusted gateway. If it's down, verification fails entirely, even if other trusted gateways are available.

**Scenario:**
1. User configures 3 trusted gateways
2. First gateway is down (network issue, rate limited, etc.)
3. Verification fails completely
4. Other 2 gateways could have worked ❌

**Impact:** MEDIUM - Reduces reliability

**Fix:**
```typescript
async fetchFromTrustedGateway(txId: string): Promise<Response> {
  let lastError: Error | undefined;

  for (const gateway of this.trustedGateways) {
    try {
      const url = new URL(`/${txId}`, gateway);
      const response = await fetch(url.toString());
      if (response.ok) {
        return response;
      }
    } catch (error) {
      lastError = error as Error;
      this.logger.debug(`Failed to fetch from ${gateway}`, { error });
    }
  }

  throw new Error(
    `All trusted gateways failed for ${txId}`,
    { cause: lastError }
  );
}
```

---

## 🟡 MEDIUM SEVERITY BUGS

### 4. **React Hook: Infinite Loop from onProgress Callback**

**Location:** `packages/wayfinder-react/src/hooks/index.ts:137`

**The Bug:**
```typescript
const memoizedOptions = useMemo(() => options, [JSON.stringify(options)]);
```

**Problem:**
Using `JSON.stringify(options)` for memoization causes issues:
- If `onProgress` is defined inline, it creates a new function reference every render
- `JSON.stringify` can't serialize functions, so it's ignored
- But the `options` object reference changes
- This triggers a new request on every render → infinite loop

**Scenario:**
```tsx
function MyComponent() {
  const { data } = useManifestRequest('ar://id', {
    onProgress: (e) => console.log(e), // New function every render!
  });
  // Infinite loop! New request every render
}
```

**Impact:** MEDIUM - Developer footgun, can cause infinite loops

**Fix:**
```typescript
// Option 1: Use deep equality or stable references
const memoizedOptions = useMemo(() => options, [
  options?.verifyNested,
  options?.maxDepth,
  options?.concurrency,
  // Don't include onProgress in deps
]);

// Option 2: Separate onProgress from options
const onProgressRef = useRef(options?.onProgress);
useEffect(() => {
  onProgressRef.current = options?.onProgress;
}, [options?.onProgress]);
```

---

### 5. **React Hook: No Cleanup for Async Operations**

**Location:** `packages/wayfinder-react/src/hooks/index.ts:162-195`

**The Bug:**
```typescript
useEffect(() => {
  // ...
  (async () => {
    const response = await wayfinder.requestWithManifest(...);
    setData(arrayBuffer); // Can run after unmount!
  })();
}, [...]);
```

**Problem:**
No cleanup function to cancel in-flight requests when:
- Component unmounts
- URL/options change before request completes

**Scenario:**
1. Component mounts, starts request
2. User navigates away → component unmounts
3. Request completes, tries to call setState
4. React warning: "Can't perform a React state update on an unmounted component"
5. Memory leak

**Impact:** MEDIUM - Memory leaks, React warnings

**Fix:**
```typescript
useEffect(() => {
  let cancelled = false;

  (async () => {
    try {
      const response = await wayfinder.requestWithManifest(...);
      if (cancelled) return; // Don't update state if cancelled

      const arrayBuffer = await response.arrayBuffer();
      if (cancelled) return;

      setData(arrayBuffer);
      // ... other setStates
    } catch (err) {
      if (cancelled) return;
      setError(err);
    } finally {
      if (!cancelled) {
        setIsLoading(false);
      }
    }
  })();

  return () => {
    cancelled = true; // Cleanup
  };
}, [...]);
```

---

### 6. **Missing Validation for Empty trustedGateways**

**Location:** `packages/wayfinder-core/src/verification/manifest-verification.ts:81`

**The Bug:**
```typescript
this.trustedGateways = baseStrategy.trustedGateways;
```

**Problem:**
No validation that `trustedGateways` is non-empty. If base strategy has empty array, verification will fail cryptically.

**Scenario:**
```typescript
const strategy = new ManifestVerificationStrategy({
  baseStrategy: new HashVerificationStrategy({
    trustedGateways: [], // Empty!
  }),
});
// No error until runtime when trying to verify
```

**Impact:** MEDIUM - Poor error messages

**Fix:**
```typescript
constructor({ baseStrategy, ... }) {
  this.baseStrategy = baseStrategy;
  this.trustedGateways = baseStrategy.trustedGateways;

  if (!this.trustedGateways || this.trustedGateways.length === 0) {
    throw new Error(
      'ManifestVerificationStrategy requires at least one trusted gateway'
    );
  }

  // ... rest of constructor
}
```

---

## 🟢 LOW SEVERITY / EDGE CASES

### 7. **Case-Insensitive Header Handling**

**Location:** `packages/wayfinder-core/src/verification/manifest-verification.ts:93-94`

**The Issue:**
```typescript
const contentType = headers['content-type'] || headers['Content-Type'];
```

**Problem:**
Only checks two cases. HTTP headers are case-insensitive, so we could have `Content-Type`, `content-type`, `CONTENT-TYPE`, etc.

**Impact:** LOW - Most environments normalize headers

**Fix:**
```typescript
private isManifestContentType(headers: Record<string, string>): boolean {
  // Headers should be case-insensitive
  const contentType = Object.entries(headers)
    .find(([key]) => key.toLowerCase() === 'content-type')?.[1];

  return contentType?.includes('application/x.arweave-manifest+json') ?? false;
}
```

---

### 8. **Depth Check Off-by-One Potential**

**Location:** `packages/wayfinder-core/src/verification/manifest-verification.ts:213,242,507`

**The Issue:**
```typescript
// Line 213: Check if depth < maxDepth
if (isManifest && depth < this.maxDepth && data) {
  // ...
  // Line 242: Recurse with depth + 1
  await this.verifyNestedResources({
    txId,
    manifest: parsed.manifest,
    depth: depth + 1, // Could this exceed maxDepth?
  });
}

// Line 507: Check if depth > maxDepth
if (depth > this.maxDepth) {
  throw new Error(...);
}
```

**Problem:**
Confusing depth tracking. If `maxDepth = 5`:
- At depth 4, we check `4 < 5` (true), proceed
- Call with `depth: 5`
- In verifyNestedResources, check `5 > 5` (false), proceed
- Call verifyManifestResources with `depth: 6`
- Then fetchAndVerifyResource checks `6 < 5` (false)

The logic works but is confusing. It's not clear if maxDepth is inclusive or exclusive.

**Impact:** LOW - Confusing but functional

**Improvement:**
```typescript
// Be explicit about inclusive vs exclusive
if (depth >= this.maxDepth) {
  throw new Error(
    `Maximum manifest nesting depth (${this.maxDepth}) reached`
  );
}
```

---

### 9. **No Timeout for Fetch Requests**

**Location:** `packages/wayfinder-core/src/verification/manifest-verification.ts:194`

**The Issue:**
```typescript
const response = await fetch(url.toString());
```

**Problem:**
No timeout configured. If a trusted gateway is slow or hangs, verification hangs indefinitely.

**Impact:** LOW - But can cause poor UX

**Improvement:**
```typescript
const controller = new AbortController();
const timeoutId = setTimeout(() => controller.abort(), 30000); // 30s timeout

try {
  const response = await fetch(url.toString(), {
    signal: controller.signal,
  });
  return response;
} finally {
  clearTimeout(timeoutId);
}
```

---

### 10. **Potential Memory Issue with Large Manifests**

**Location:** `packages/wayfinder-core/src/verification/manifest-verification.ts:814-827`

**The Issue:**
```typescript
// In requestWithManifest, we clone the response
const clonedResponse = response.clone();
const text = await clonedResponse.text();
```

**Problem:**
For large manifests (MB of data), we:
1. Load entire response into memory (original)
2. Clone it (2x memory)
3. Convert to text (potentially 2x more for UTF-16)

**Impact:** LOW - Manifests are typically small JSON files

**Improvement:**
Consider streaming parsers for very large manifests

---

### 11. **No Validation of Transaction ID Format**

**Location:** `packages/wayfinder-core/src/manifest/parser.ts:102`

**The Issue:**
```typescript
static getAllTransactionIds(manifest: ArweaveManifest): string[] {
  const ids = Object.values(manifest.paths).map((entry) => entry.id);
  return [...new Set(ids)]; // Remove duplicates
}
```

**Problem:**
No validation that transaction IDs are valid Arweave format (43 characters, base64url).

**Impact:** LOW - Invalid TX IDs will fail during verification anyway

**Improvement:**
```typescript
const txIdRegex = /^[A-Za-z0-9_-]{43}$/;

static getAllTransactionIds(manifest: ArweaveManifest): string[] {
  const ids = Object.values(manifest.paths).map((entry) => entry.id);

  // Validate TX ID format
  for (const id of ids) {
    if (!txIdRegex.test(id)) {
      throw new Error(`Invalid transaction ID format: ${id}`);
    }
  }

  return [...new Set(ids)];
}
```

---

### 12. **Race Condition in Cache During Concurrent Verification**

**Location:** `packages/wayfinder-core/src/verification/manifest-verification.ts:174-177`

**The Issue:**
```typescript
// Check cache first
const cached = this.cache.get({ txId });
if (cached) {
  return cached;
}

// ... verify ...
```

**Problem:**
If two concurrent requests verify the same resource:
1. Request A checks cache → miss
2. Request B checks cache → miss
3. Both start verification
4. Wasted work (duplicate verification)

**Impact:** LOW - Just inefficient, not a bug

**Improvement:**
Use a Promise cache to deduplicate in-flight requests:
```typescript
private inFlightVerifications = new Map<string, Promise<VerificationResult>>();

async fetchAndVerifyResource({ txId, ... }) {
  // Check cache
  const cached = this.cache.get({ txId });
  if (cached) return cached;

  // Check if already verifying
  if (this.inFlightVerifications.has(txId)) {
    return this.inFlightVerifications.get(txId)!;
  }

  // Start verification
  const promise = this._doVerification(txId, ...);
  this.inFlightVerifications.set(txId, promise);

  try {
    return await promise;
  } finally {
    this.inFlightVerifications.delete(txId);
  }
}
```

---

## Security Edge Cases

### 13. **No Size Limit on Manifest**

**The Issue:**
No maximum size check for manifest JSON. A malicious gateway could serve a multi-GB manifest to cause DoS.

**Impact:** LOW - Manifests are typically small, but could be exploited

**Improvement:**
```typescript
async tryParseManifest(data: DataStream) {
  const chunks: Uint8Array[] = [];
  let totalSize = 0;
  const MAX_MANIFEST_SIZE = 10 * 1024 * 1024; // 10 MB limit

  for await (const chunk of iterable) {
    totalSize += chunk.length;
    if (totalSize > MAX_MANIFEST_SIZE) {
      throw new Error('Manifest exceeds maximum size');
    }
    chunks.push(chunk);
  }
  // ... rest
}
```

---

### 14. **No Limit on Number of Resources**

**The Issue:**
No limit on number of resources in a manifest. Could have 1 million resources → DoS.

**Impact:** LOW - Would be caught by concurrency limit, but still wasteful

**Improvement:**
```typescript
const MAX_RESOURCES = 10000; // Reasonable limit

if (txIds.length > MAX_RESOURCES) {
  throw new Error(
    `Manifest has too many resources (${txIds.length} > ${MAX_RESOURCES})`
  );
}
```

---

## Summary

### Priority: CRITICAL (Must Fix)
1. ✅ Stream re-encoding (ALREADY FIXED)
2. ✅ Stream consumption fallback (ALREADY FIXED)
3. ❌ **Incorrect allVerified logic** - Returns true when nothing verified
4. ❌ **Null pointer on response.body** - Can crash

### Priority: HIGH (Should Fix)
5. ❌ **No trusted gateway retry** - Single point of failure
6. ❌ **React hook infinite loop** - Developer footgun
7. ❌ **React hook no cleanup** - Memory leaks

### Priority: MEDIUM (Nice to Have)
- Empty trustedGateways validation
- Request timeouts
- Better error messages

### Priority: LOW (Optional)
- Case-insensitive headers
- Depth check clarity
- TX ID validation
- Concurrent request deduplication
- Size limits for DoS protection

**Recommendation:** Fix Critical and High priority issues before production use.
