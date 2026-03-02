# Analysis: arweave.net AR.IO Gateway Dependencies

**Date:** 2026-03-02
**Issue:** arweave.net is no longer an AR.IO gateway and should not be relied upon for AR.IO-specific APIs

## Executive Summary

The codebase has multiple critical dependencies on arweave.net providing AR.IO gateway functionality. Since arweave.net is no longer an AR.IO gateway, these dependencies will fail. The issue spans across:

1. **Gateway Discovery** - Using `/ar-io/peers` endpoint
2. **Verification** - Expecting `x-ar-io-verified` headers
3. **Metadata** - Expecting AR.IO-specific headers like `x-ar-io-data-id`
4. **Default/Fallback Configurations** - Using arweave.net as a trusted gateway

## Critical Issues

### 1. TrustedPeersGatewaysProvider Using arweave.net

**Location:** `packages/wayfinder-core/src/gateways/trusted-peers.ts:39`

**Problem:**
```typescript
async getGateways(): Promise<URL[]> {
  const endpoint = new URL('/ar-io/peers', this.trustedGateway).toString();
  // ... fetches from /ar-io/peers endpoint
}
```

**Used in:**
- `packages/wayfinder-core/src/wayfinder.ts:356` - **DEFAULT** fallback gateway provider
  ```typescript
  this.gatewaysProvider = gatewaysProvider ??
    new TrustedPeersGatewaysProvider({
      trustedGateway: 'https://arweave.net',  // ⚠️ BROKEN
      logger: this.logger,
    });
  ```

**Impact:** HIGH
**Severity:** CRITICAL - This is the default gateway provider for the entire Wayfinder class. When no gateway provider is specified, it will try to fetch `/ar-io/peers` from arweave.net and fail.

---

### 2. Preferred Routing Strategy Default

**Location:** `packages/wayfinder-core/src/client.ts:74`

**Problem:**
```typescript
case 'preferred':
  return new PreferredWithFallbackRoutingStrategy({
    preferredGateway: 'https://arweave.net',  // ⚠️ Used as preferred gateway
    fallbackStrategy: createRoutingStrategy({
      strategy: 'fastest',
      gatewaysProvider,
      logger,
    }),
  });
```

**Impact:** MEDIUM
**Severity:** HIGH - When users select "preferred" routing, arweave.net is used as the primary gateway. This doesn't fail immediately but means:
1. Users get routed to arweave.net which isn't part of AR.IO network
2. Verification features expecting AR.IO headers will fail
3. ArNS resolution may not work properly

---

### 3. Default Trusted Gateway Constant

**Location:** `packages/wayfinder-core/src/client.ts:46`

**Problem:**
```typescript
const DEFAULT_TRUSTED_GATEWAY = 'https://permagate.io';
```

**Good News:** The client.ts file correctly uses `permagate.io` as the default, but the Wayfinder class constructor still defaults to `arweave.net`.

---

### 4. Extension Fallbacks

**Location:** Multiple files in `packages/wayfinder-extension/`

**Problems:**

#### Background Script (src/background.ts:168, 176, 178)
```typescript
if (!registry) return ['*://arweave.net/*']; // fallback
return patterns.length > 0 ? patterns : ['*://arweave.net/*'];
return ['*://arweave.net/*'];
```
**Impact:** LOW - These are URL patterns for extension permissions, not API calls

#### Chrome Storage Gateway Provider (src/adapters/chrome-storage-gateway-provider.ts:126)
```typescript
console.warn('[ChromeStorageGatewayProvider] No gateways in local registry, using arweave.net as fallback');
return [new URL('https://arweave.net')];
```
**Impact:** MEDIUM - Falls back to arweave.net when no gateways found

#### Settings (src/settings.ts:636)
```typescript
// Absolute last resort - return arweave.net
return [{
  fqdn: 'arweave.net',
  protocol: 'https',
  operatorStake: 1,
  // ...
}];
```
**Impact:** MEDIUM - Last resort fallback in settings

#### Constants (src/constants.ts:27)
```typescript
fqdn: 'arweave.net',
label: 'Arweave.net (Fallback)',
```
**Impact:** MEDIUM - Defined as a fallback gateway option

---

### 5. Round Robin Default Gateways

**Location:** `packages/wayfinder-core/src/routing/round-robin.ts:41`

**Problem:**
```typescript
if (!gateways && !gatewaysProvider) {
  gateways = [
    new URL('https://arweave.net'),  // ⚠️ Default gateway
    new URL('https://permagate.io'),
  ];
}
```

**Impact:** MEDIUM
**Severity:** MEDIUM - Used as a hardcoded default when no gateways specified

---

## AR.IO-Specific API Dependencies

### API Endpoints Expected

1. **`/ar-io/peers`** - Gateway peer discovery
   - Used by: TrustedPeersGatewaysProvider
   - **Will fail on arweave.net**

2. **`/ar-io/info`** - Gateway information
   - Used by: Extension gateway testing, CLI info command
   - Used in:
     - `packages/wayfinder-extension/src/gateways.ts:812`
     - `packages/wayfinder-extension/src/settings.ts:484`
     - `experimental/wayfinder-cli/src/commands/info.ts:127`
   - **Will fail on arweave.net**

3. **`/ar-io/resolver/{name}`** - ArNS resolution
   - Used by: `scripts/arns-resolutions.mjs:42`
   - **Will fail on arweave.net**

### AR.IO-Specific Headers Expected

The following headers are AR.IO-specific and will NOT be present on arweave.net responses:

**Verification Headers:**
- `X-AR-IO-Verified` - Used by RemoteVerificationStrategy
- `X-AR-IO-Trusted` - Trust indicator
- `X-AR-IO-Digest` - Content digest

**Metadata Headers:**
- `X-AR-IO-Data-Id` - Actual data ID served (critical for verification)
- `X-ArNS-Resolved-Id` - ArNS resolution result
- `X-AR-IO-Hops` - Gateway hop count
- `X-AR-IO-Origin` - Original gateway
- `X-AR-IO-Stable` - Stability indicator

**Chunk/Data Item Headers:**
- `X-AR-IO-Chunk-Source-Type`
- `X-AR-IO-Root-Transaction-Id`
- `X-AR-IO-Data-Item-*` (multiple headers)

**Impact:**
- **RemoteVerificationStrategy** will ALWAYS fail with arweave.net
- **Verification after ArNS resolution** may fail (no `X-AR-IO-Data-Id` header)
- **CLI verification display** will not show verification status correctly

---

## Documentation Issues

### README Examples Using arweave.net

**Locations:**
- `packages/wayfinder-core/README.md:148` - Example shows using arweave.net legacy URLs
- `packages/wayfinder-core/README.md:202` - Example shows using arweave.net as trusted gateway
- `packages/wayfinder-core/README.md:237-241` - Example shows using arweave.net in fallback chain

**Problem:** Documentation examples encourage using arweave.net as a trusted AR.IO gateway

---

## Test Files Using arweave.net

**Locations:**
- `packages/wayfinder-core/src/wayfinder.test.ts:937, 958, 969, 980` - Tests parse arweave.net URLs

**Impact:** LOW - Tests are for URL parsing legacy URLs, not assuming API availability

---

## Recommendations

### Immediate Actions (Priority 1 - CRITICAL)

1. **Change Default Gateway in Wayfinder Constructor**
   ```typescript
   // packages/wayfinder-core/src/wayfinder.ts:356
   this.gatewaysProvider = gatewaysProvider ??
     new TrustedPeersGatewaysProvider({
       trustedGateway: 'https://permagate.io',  // ✅ AR.IO gateway
       logger: this.logger,
     });
   ```

2. **Change Preferred Routing Default**
   ```typescript
   // packages/wayfinder-core/src/client.ts:74
   case 'preferred':
     return new PreferredWithFallbackRoutingStrategy({
       preferredGateway: 'https://permagate.io',  // ✅ AR.IO gateway
       fallbackStrategy: createRoutingStrategy({
         strategy: 'fastest',
         gatewaysProvider,
         logger,
       }),
     });
   ```

3. **Update Round Robin Defaults**
   ```typescript
   // packages/wayfinder-core/src/routing/round-robin.ts:41
   if (!gateways && !gatewaysProvider) {
     gateways = [
       new URL('https://permagate.io'),  // ✅ AR.IO gateway
       new URL('https://ar-io.dev'),      // ✅ AR.IO gateway
     ];
   }
   ```

### High Priority Actions (Priority 2)

4. **Update Extension Fallbacks**
   - Change all arweave.net fallbacks in extension to permagate.io
   - Files: background.ts, chrome-storage-gateway-provider.ts, settings.ts, constants.ts

5. **Update Documentation Examples**
   - Replace arweave.net examples with permagate.io in README files
   - Add note explaining arweave.net is not an AR.IO gateway

### Medium Priority Actions (Priority 3)

6. **Add Validation/Warning**
   - Add runtime warning when TrustedPeersGatewaysProvider is used with non-AR.IO gateway
   - Detect failed `/ar-io/peers` requests and provide helpful error message

7. **Consider NetworkGatewaysProvider as Default**
   - Since @ar.io/sdk is already a dependency, consider using NetworkGatewaysProvider (fetches from on-chain registry) as the default instead of TrustedPeersGatewaysProvider
   - More decentralized and reliable

### Low Priority Actions (Priority 4)

8. **Legacy URL Parsing**
   - Current parsing of arweave.net URLs is fine - it converts them to ar:// format
   - No changes needed, but could add note that arweave.net is legacy

9. **URL Pattern Permissions**
   - Extension URL patterns for arweave.net are fine for backwards compatibility
   - Users may still have bookmarks/links to arweave.net

---

## Testing Plan

After making changes, verify:

1. ✅ Default Wayfinder instance can fetch gateway list
2. ✅ Preferred routing strategy works with correct gateway
3. ✅ Extension loads without errors
4. ✅ Extension can fetch gateway registry
5. ✅ Verification strategies work correctly
6. ✅ CLI info command works
7. ✅ All tests pass

## Risk Assessment

**Current State:**
- 🔴 **CRITICAL** - Default Wayfinder configuration will fail
- 🔴 **HIGH** - Preferred routing uses non-AR.IO gateway
- 🟡 **MEDIUM** - Extension fallbacks to non-AR.IO gateway
- 🟢 **LOW** - Tests and URL parsing unaffected

**After Fix:**
- 🟢 **LOW** - All core functionality will work correctly
- 🟢 **LOW** - Users won't be routed to non-AR.IO gateways
- 🟢 **LOW** - Verification will work as expected

---

## Alternative Considerations

### Option 1: Keep arweave.net for Data Retrieval Only

**Pros:**
- arweave.net is still reliable for fetching transaction data
- Could be used in StaticGatewaysProvider

**Cons:**
- Confusing to users
- No AR.IO-specific features
- Not part of AR.IO network incentives

**Recommendation:** Only keep in URL parsing for legacy support

### Option 2: Remove All References

**Pros:**
- Clean break from non-AR.IO gateways
- Forces users to AR.IO network

**Cons:**
- Breaks backwards compatibility for legacy URLs
- Users may have existing arweave.net links

**Recommendation:** Keep URL parsing support for legacy, remove from defaults

### Option 3: Make TrustedPeersGatewaysProvider Robust

**Idea:** Detect when `/ar-io/peers` fails and fall back to on-chain registry

**Pros:**
- More resilient
- Automatic fallback

**Cons:**
- Adds complexity
- May hide configuration errors

**Recommendation:** Add warning but don't auto-fallback

---

## Files Requiring Changes

### Critical Priority
1. `packages/wayfinder-core/src/wayfinder.ts:356`
2. `packages/wayfinder-core/src/client.ts:74`
3. `packages/wayfinder-core/src/routing/round-robin.ts:41`

### High Priority
4. `packages/wayfinder-extension/src/constants.ts:27`
5. `packages/wayfinder-extension/src/settings.ts:636`
6. `packages/wayfinder-extension/src/adapters/chrome-storage-gateway-provider.ts:126`
7. `packages/wayfinder-core/README.md` (documentation examples)

### Medium Priority
8. Add validation/warnings to TrustedPeersGatewaysProvider

### Total Files to Modify: 8 files
