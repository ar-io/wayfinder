---
"@ar.io/wayfinder-extension": patch
---

Internal: add Solana-network type definitions, constants, and defaults
in preparation for the AO → Solana migration.

- New `NetworkPreset` type (`'mainnet' | 'devnet' | 'custom'`) and
  `SolanaNetworkConfig` shape in `src/types.ts`.
- `AR_IO_SOLANA_DEVNET` preset constant in `src/constants.ts` carrying
  the public devnet RPC URL and the four AR.IO program addresses (core,
  GAR, ArNS, ANT). `AR_IO_SOLANA_MAINNET` placeholder is `null` until
  AR.IO Solana mainnet deploys (now populated with live values).
- `SOLANA_NETWORK_DEFAULTS` export in `src/config/defaults.ts` for use
  by the upcoming migration commit.

This commit is purely additive — no existing code consumes the new
exports yet, so there is no runtime behavior change. The subsequent
PR will switch the extension's initialization and settings paths from
AO to Solana, removing the AO-era constants, dropping
`@permaweb/aoconnect`, and bumping `@ar.io/sdk` to `^4.0.0-solana.8`.
