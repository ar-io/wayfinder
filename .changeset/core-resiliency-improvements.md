---
"@ar.io/wayfinder-core": patch
---

Resiliency improvements for gateway routing and data retrieval.

- Gateway retry: automatically re-selects a different gateway and retries
  (up to 3 attempts) on 5xx errors or network failures. 4xx client errors
  are returned immediately without retry.
- Smart pagination: NetworkGatewaysProvider stops fetching from the on-chain
  registry once enough gateways pass the filter, avoiding unnecessary RPC calls.
