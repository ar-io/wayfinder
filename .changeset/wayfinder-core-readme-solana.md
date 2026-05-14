---
"@ar.io/wayfinder-core": patch
---

Docs: update README examples from AO-era `ARIO.mainnet()` syntax to
SDK 4.x Solana syntax (`ARIO.init({ backend: 'solana', rpc, ...programIds })`).

The package itself is chain-agnostic and works against any SDK
backend, but the published README only showed AO-mainnet examples,
which is misleading in the post-Solana-migration ecosystem. The four
example blocks (Getting Started, NetworkGatewaysProvider reference,
CompositeGatewaysProvider, CompositeRoutingStrategy) now show AR.IO
Solana devnet syntax with a note explaining how to drop the
program-ID overrides for the eventual mainnet deployment.

No code changes; this is docs-only.
