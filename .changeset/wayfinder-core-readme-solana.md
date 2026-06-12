---
"@ar.io/wayfinder-core": patch
---

Docs: update README examples to SDK v4.0.2 stable syntax.

Remove `backend: 'solana'` parameter (Solana is now the only backend),
switch examples to mainnet (no program-ID overrides needed), and
remove stale devnet program IDs. The `address()` import from
`@solana/kit` is no longer needed in mainnet examples.

No code changes; this is docs-only.
