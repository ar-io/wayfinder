# Gateway Migration Summary

**Date:** 2026-03-02
**Migration:** arweave.net / permagate.io → turbo-gateway.com

## Overview

Replaced all hardcoded gateway defaults throughout the codebase to use `https://turbo-gateway.com` instead of `arweave.net` or `permagate.io`.

**Rationale:**
- arweave.net is no longer an AR.IO gateway (doesn't support `/ar-io/*` endpoints)
- turbo-gateway.com is a verified AR.IO gateway with full AR.IO API support
- Developers can still configure any gateway they want - these are just fallback defaults

## Files Changed

### Core Library (`packages/wayfinder-core`)

1. **src/client.ts**
   - `DEFAULT_TRUSTED_GATEWAY`: permagate.io → turbo-gateway.com
   - Preferred routing strategy default: arweave.net → turbo-gateway.com
   - `createVerificationStrategy` default trustedGateways: permagate.io → turbo-gateway.com

2. **src/wayfinder.ts**
   - Deprecated `gatewaysProvider` fallback: arweave.net → turbo-gateway.com
   - Default verification strategy trustedGateways (2 locations): permagate.io → turbo-gateway.com
   - JSDoc examples (3 locations): permagate.io → turbo-gateway.com

3. **src/routing/round-robin.ts**
   - Default gateways: [arweave.net, permagate.io] → [turbo-gateway.com, g8way.io]

4. **README.md**
   - All documentation examples: permagate.io → turbo-gateway.com
   - Composite gateway provider example updated
   - Verification strategy examples updated

### Extension (`packages/wayfinder-extension`)

5. **src/adapters/chrome-storage-gateway-provider.ts**
   - Fallback gateway: arweave.net → turbo-gateway.com

6. **src/constants.ts**
   - `FALLBACK_GATEWAY`: arweave.net → turbo-gateway.com
   - Label: "Arweave.net (Fallback)" → "Turbo Gateway (Fallback)"

7. **src/settings.ts**
   - Last resort fallback: arweave.net → turbo-gateway.com

### CLI (`experimental/wayfinder-cli`)

8. **src/commands/info.ts**
   - TrustedPeersGatewaysProvider default: permagate.io → turbo-gateway.com

## Acceptable Remaining References

The following references to arweave.net are intentional and correct:

### URL Parsing (Legacy Support)
- `packages/wayfinder-core/src/wayfinder.ts`: Legacy URL parsing for arweave.net/arweave.dev URLs
  - Used to convert old-style URLs like `https://arweave.net/txid` to `ar://txid`
  - Does NOT assume arweave.net is an AR.IO gateway
  - Just recognizes the URL format for backwards compatibility

### Extension Permission Patterns
- `packages/wayfinder-extension/src/background.ts`: URL patterns like `*://arweave.net/*`
  - These are Chrome extension permission patterns
  - Allows extension to intercept/handle arweave.net URLs if users visit them
  - Does NOT make requests to arweave.net

### Documentation Comments
- `packages/wayfinder-extension/src/routing.ts`: Comments explaining URL formats
  - Just showing examples of different URL formats (subdomain vs path)
  - Not recommending arweave.net as a gateway

### Test Files
- `packages/wayfinder-core/src/wayfinder.test.ts`: Test cases for parsing arweave.net URLs
  - Testing legacy URL parsing functionality
  - Does NOT rely on arweave.net being an AR.IO gateway

## Verification

To verify turbo-gateway.com supports AR.IO APIs:

```bash
# Check AR.IO info endpoint
curl -I https://turbo-gateway.com/ar-io/info

# Should return AR.IO headers like:
# X-AR-IO-Hops, X-AR-IO-Origin, X-AR-IO-Verified, etc.
```

✅ Confirmed: turbo-gateway.com returns all AR.IO-specific headers

## Testing Checklist

After these changes, verify:

- [ ] `createWayfinderClient()` with no config fetches gateway list successfully
- [ ] Preferred routing strategy works
- [ ] Extension loads and syncs gateways
- [ ] Extension fallback works when registry fails
- [ ] CLI info command works
- [ ] All tests pass
- [ ] Documentation examples are correct

## Developer Impact

✅ **No breaking changes** - These are all internal defaults
✅ **Developers can still configure any gateway** - Full flexibility maintained
✅ **Better defaults** - Now defaults to a working AR.IO gateway

### Example: Custom Gateway Configuration Still Works

```typescript
// Developers can use any gateway they want
const wayfinder = createWayfinderClient({
  routingSettings: {
    strategy: new StaticRoutingStrategy({
      gateway: 'https://any-gateway.example.com'
    })
  }
});

// Or use TrustedPeersGatewaysProvider with any AR.IO gateway
const gatewayProvider = new TrustedPeersGatewaysProvider({
  trustedGateway: 'https://custom-gateway.com',
});
```

## Summary

- **9 files modified**
- **All defaults now use turbo-gateway.com**
- **g8way.io added as second default in round-robin**
- **Documentation updated to reflect new defaults**
- **No breaking changes - all user configurations still work**
