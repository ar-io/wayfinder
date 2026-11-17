---
"@ar.io/wayfinder-core": minor
---

A request that gets a 5xx response or a network error now retries on a different gateway when one is available, instead of possibly drawing the same gateway again; with `PreferredWithFallbackRoutingStrategy`, the retry goes to the fallback once the preferred gateway has failed. `RoutingStrategy.selectGateway` takes a new optional `exclude` list of gateways that already failed the request, which the built-in strategies honour and custom strategies can ignore.
