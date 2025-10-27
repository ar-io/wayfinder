---
"@ar.io/wayfinder-extension": patch
---

Update extension to use latest Wayfinder class API

- Fix static routing strategy assignment bug
- Remove deprecated gatewaysProvider parameter from Wayfinder constructor
- Pass gatewaysProvider directly to routing strategies
- Remove invalid onRoutingFailed event handler
- Update constructor to use latest API patterns