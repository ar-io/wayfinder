---
"@ar.io/wayfinder-core": major
---

BREAKING: Upgrade to `@ar.io/sdk` v4.0.2 stable (Solana-only).

- Bump `peerDependency` from `>=3.12.0` → `>=4.0.0`. SDK v3.x (AO-backed) is no longer supported.
- Bump `devDependency` from `^4.0.0-solana.8` → `^4.0.2`.
- Rename `AoARIORead` → `ARIORead` in `NetworkGatewaysProvider` to match the SDK's v4 type names.
- No runtime behavior changes — the `getGateways()` API shape is unchanged.
