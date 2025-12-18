# Bugs Found in Content Caching Implementation

## BUG #1: CRITICAL - Path Resolution Fallback Issue

**Location:** `wayfinder.ts:666-714`

**Issue:**
When we have a path-based request like `ar://manifest-id/nonexistent.js`:
1. Line 666: `resourceTxId` is initialized to `manifest-id` (the manifest's tx-id)
2. Line 689-692: Path resolution attempts to find "nonexistent.js" in the manifest
3. Path resolution returns `null` because the path doesn't exist
4. Line 694: The condition `if (resolvedTxId)` fails, so `resourceTxId` is NOT updated
5. Line 713: We check the cache using `manifest-id` instead of falling through to normal fetch

**Problem:**
- We're checking the cache with the MANIFEST's transaction ID instead of the resource ID
- If the manifest itself is cached (< 10MB), we'd serve the manifest JSON instead of the resource
- Even if not cached, we miss the opportunity to fall through to normal fetch

**Fix:**
Only check cache if:
- It's a direct tx-id request (no path component), OR
- Path resolution succeeded (resolvedTxId is not null)

## BUG #2: Type Inconsistency for verification-failed Event

**Location:** `types.ts:56`, `wayfinder.ts:727-731`

**Issue:**
Type definition says:
```typescript
'verification-failed': Error;
```

But new code emits:
```typescript
this.emitter.emit('verification-failed', {
  txId: resourceTxId,
  error,
  timestamp: Date.now(),
});
```

And existing code in `verify-stream.ts:118` also emits an object:
```typescript
emitter?.emit('verification-failed', {
  txId,
  error: new Error('Verification cancelled', { ... }),
});
```

**Problem:**
TypeScript may not catch this because of how EventEmitter3 is typed, but there's inconsistency between the type definition and actual usage.

**Fix Options:**
1. Update type definition to match actual usage
2. Change all emit calls to match the type definition

## BUG #3: Dead Path Resolution Code

**Location:** `wayfinder.ts:671-674`

**Issue:**
```typescript
if (txId && path.startsWith(`/${txId}`)) {
  manifestPath = path.substring(txId.length + 1);
}
```

According to `extractRoutingInfo()` (line 141-148), for tx-id URLs:
- Input: `ar://tx-id/assets/main.js`
- Output: `path = /tx-id/assets/main.js`

So the path extraction logic is correct. But we need to verify this works for ArNS names too.

For ArNS URLs (line 154-160):
- Input: `ar://arns-name/assets/main.js`
- Output: `path = /assets/main.js` (no arns-name prefix)

This is INCONSISTENT! TX-id URLs include the identifier in the path, but ArNS URLs don't.

**Problem:**
The path extraction logic assumes tx-id URLs include the identifier prefix, but we should verify this is always true.

## BUG #4: Manifest Structure Cache Never Expires

**Location:** `wayfinder.ts:440`, `wayfinder.ts:680`

**Issue:**
The `manifestStructureCache` Map is checked for expiration on line 680:
```typescript
if (cachedManifest && Date.now() <= cachedManifest.expiresAt)
```

But there's NO cleanup mechanism. Expired entries remain in memory forever.

**Problem:**
- Memory leak: expired manifests never removed
- Cache grows unbounded over time
- Unlike `ManifestVerificationCache` which has a `prune()` method

**Fix:**
Add a cleanup mechanism, either:
1. Periodic pruning like `ManifestVerificationCache`
2. Lazy cleanup during get operations
3. Use `ManifestVerificationCache` class for consistency

## MINOR ISSUE #1: Redundant Object Creation

**Location:** `manifest-verification.ts:478-484`

**Code:**
```typescript
const result = {
  txId,
  verified: false,
  error: error as Error,
  timestamp: Date.now(),
};
this.cache.set({ txId, verified: false, error: error as Error });
return result;
```

**Issue:**
- Creates `result` object with timestamp
- Then creates a NEW object for `cache.set()` without timestamp
- The cache.set() adds its own timestamp, so the result's timestamp is ignored

**Fix:**
Either reuse `result` or remove it entirely:
```typescript
const result = { txId, verified: false, error: error as Error, timestamp: Date.now() };
this.cache.set(result);
return result;
```

## MINOR ISSUE #2: Missing Verification-Failed Event

**Location:** `manifest-verification.ts:478-486`

**Issue:**
When verification fails, we don't emit a verification-failed event. Other parts of the code emit this event when verification fails.

**Fix:**
Add event emission in the catch block.
