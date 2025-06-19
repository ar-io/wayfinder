# Wayfinder Core Integration Issues and Fixes

## Issues Identified

### 1. **Verification Event Name Mismatch** ⚠️ CRITICAL
- **Issue**: The background verification code listens for `verification-passed` but Wayfinder Core emits `verification-succeeded`
- **Location**: 
  - `background-verification-cached.ts:111-112`
  - `background.ts:684,686`
- **Impact**: Verification events are never captured, making verification appear to fail
- **Fix**: Update event names to match Wayfinder Core's actual events

### 2. **Response Body Not Consumed in Background Verification** ⚠️ CRITICAL
- **Issue**: The verification request in `background.ts` doesn't consume the response body
- **Location**: `background.ts:689-709` 
- **Impact**: Wayfinder Core's streaming verification never completes because the data isn't read
- **Fix**: Consume response body to trigger verification completion

### 3. **Missing Signature Verification in UI**
- **Issue**: Settings page only shows hash and dataRoot strategies, but not signature
- **Location**: `settings.html:210` - missing signature verification option
- **Impact**: Users can't select signature verification even though it's supported
- **Fix**: Add signature verification option to settings UI

### 4. **Overwhelming UX Configuration**
- **Issue**: Too many technical options exposed at once
- **Current problems**:
  - Gateway selection shows raw URLs with stake amounts
  - Verification modes (off/background/strict) are confusing
  - Advanced settings are always visible
  - Too many sliders and dropdowns
- **Fix**: Implement progressive disclosure with basic/advanced modes

### 5. **Duplicate Verification Logic** ⚠️ TECHNICAL DEBT
- **Issue**: Both `background.ts` and `background-verification-cached.ts` have verification logic
- **Location**: 
  - `background.ts:976-1336` (deprecated verifyInBackground function)
  - `background-verification-cached.ts` (new implementation)
- **Impact**: Confusing which one is used, potential for bugs
- **Fix**: Remove old implementation, use only cached version

### 6. **Incorrect Verification Strategy Parameter Names** ⚠️ CRITICAL
- **Issue**: Using incorrect parameter structure when creating verification strategies
- **Location**: `routing.ts:311-340` - using `{ trustedGateways, logger }` but type assertions needed
- **Impact**: Verification strategies may not initialize correctly
- **Fix**: Check Wayfinder Core API and use correct parameter structure

### 7. **Missing Error Handling in Routing** ⚠️ USER EXPERIENCE
- **Issue**: When gateway selection fails, error messages are generic
- **Location**: `routing.ts:502-523` - fallback handling
- **Impact**: Users don't understand why routing failed
- **Fix**: Add specific error messages for common failure scenarios

### 8. **Cache Management Issues** ⚠️ DATA INTEGRITY
- **Issue**: Verification cache doesn't properly handle ArNS name changes
- **Location**: `background.ts:1141-1215` - ArNS change detection logic
- **Impact**: Cached verifications may be stale for ArNS names that point to new content
- **Fix**: Enhance cache to track ArNS → txId mappings separately

### 9. **Create Simplified Settings UI** (Future Work)
- **Issue**: Current settings are too complex for average users
- **Fix**: Create new simplified interface with:
  - Quick Setup: One-click optimal configuration
  - Basic Mode: Just routing (auto/manual) and verification (on/off)
  - Expert Mode: Current detailed options

## Implementation Order

### Phase 1: Core Functionality (Current Focus)
1. Fix verification event names
2. Consume response body for verification
5. Consolidate verification logic
6. Fix verification strategy creation
7. Improve error messages
8. Enhance cache management

### Phase 2: UI/UX Improvements (Future)
3. Add signature verification to UI
4. Simplify UX with progressive disclosure
9. Create simplified settings UI

## Detailed Fix Implementations

### Fix 1: Verification Event Names
```typescript
// In background-verification-cached.ts and background.ts
// Change all instances of:
wayfinder.emitter.on('verification-passed', handleVerificationPassed);
// To:
wayfinder.emitter.on('verification-succeeded', handleVerificationPassed);
```

### Fix 2: Consume Response Body
```typescript
// In background.ts makeVerifiedRequest handler
const response = await wayfinder.request(request.url, requestOptions);

// Consume the response body to trigger verification
const responseText = await response.text();

// Wait for verification to complete
await new Promise(resolve => setTimeout(resolve, 2000));

// Then create the serializable response
const responseData = {
  ok: response.ok,
  status: response.status,
  statusText: response.statusText,
  headers: Object.fromEntries(response.headers.entries()),
  url: response.url,
  body: responseText, // Include the body
  verification: verificationResult,
};
```

### Fix 5: Consolidate Verification Logic
- Remove the deprecated `verifyInBackground` function from `background.ts`
- Update all calls to use `verifyInBackgroundWithCache` from `background-verification-cached.ts`
- Ensure consistent event handling across the codebase

### Fix 6: Verification Strategy Parameters
```typescript
// Update routing.ts verification strategy creation
// Remove type assertions and use proper API
verificationStrategyInstance = new HashVerificationStrategy({
  trustedGateways,
  logger,
  maxConcurrency: 2,
});
```

### Fix 7: Improve Error Messages
```typescript
// Add specific error handling in getRoutableGatewayUrl
catch (error) {
  if (error.message.includes('No gateways available')) {
    logger.error('[ROUTING] No gateways available. Please sync gateway registry.');
  } else if (error.message.includes('Network error')) {
    logger.error('[ROUTING] Network connectivity issue. Please check your connection.');
  } else if (error.message.includes('Invalid ar://')) {
    logger.error('[ROUTING] Invalid ar:// URL format.');
  }
  // ... etc
}
```

### Fix 8: Enhanced Cache Management
```typescript
// New cache structure
interface VerificationCacheEntry {
  txId: string;
  hash: string;
  algorithm: string;
  timestamp: number;
  verified: boolean;
  // ArNS specific fields
  arnsName?: string;
  arnsResolvedAt?: number;
  arnsProcessId?: string;
}

// Check ArNS resolution freshness before using cache
if (isArNSName && cachedEntry.arnsResolvedAt) {
  const cacheAge = Date.now() - cachedEntry.arnsResolvedAt;
  if (cacheAge > ARNS_CACHE_TTL) {
    // Re-resolve ArNS name
  }
}
```