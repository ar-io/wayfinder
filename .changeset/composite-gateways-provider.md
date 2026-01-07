---
"@ar.io/wayfinder-core": minor
---

Add CompositeGatewaysProvider for fallback gateway resolution

- Tries multiple GatewaysProvider instances in order until one succeeds
- Skips providers that fail or return empty gateway lists
- Includes addProvider() and getProviders() helper methods
