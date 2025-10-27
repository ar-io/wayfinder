---
"@ar.io/wayfinder-core": minor
---

feat: deprecate gatewaysProvider parameter on Wayfinder class

This change deprecates the `gatewaysProvider` parameter on the Wayfinder class while maintaining full backwards compatibility. Routing strategies now manage their own gateways internally, providing better separation of concerns.

**Breaking Changes**: None - this change is fully backwards compatible

**Changes**:
- Mark `gatewaysProvider` as `@deprecated` in Wayfinder class and WayfinderOptions interface
- Update `wayfinderFetch` to get gateways from routing strategies instead of requiring separate gatewaysProvider
- Maintain backwards compatibility by automatically injecting gatewaysProvider into routing strategies when provided
- Update telemetry to remove gatewaysProvider parameter dependency
- Reorganize `createWayfinderClient` to properly handle gateways provider creation and caching

**Migration Guide**:
No immediate action required. The deprecated `gatewaysProvider` parameter will continue to work as before. For new code, prefer creating routing strategies with their own `gatewaysProvider` parameter:

```typescript
// Old (still works, but deprecated)
const wayfinder = new Wayfinder({
  gatewaysProvider: myGatewaysProvider,
  routingSettings: {
    strategy: new RandomRoutingStrategy(),
  },
});

// New (recommended)
const wayfinder = new Wayfinder({
  routingSettings: {
    strategy: new RandomRoutingStrategy({
      gatewaysProvider: myGatewaysProvider,
    }),
  },
});
```