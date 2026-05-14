---
"@ar.io/wayfinder-core": patch
---

Verify compatibility with `@ar.io/sdk` `4.x-solana.X` (Solana-backed AR.IO Network).

- Bump devDependency from `^3.13.0` → `^4.0.0-solana.8` so tests exercise the Solana-capable SDK.
- The `peerDependency` range `>=3.12.0` is unchanged — wayfinder-core is chain-agnostic at runtime (only consumes the `AoARIORead` type, which has the same shape in both AO and Solana SDK lines). AO-era consumers continue to work unchanged.
- No code changes. No breaking changes for consumers.
