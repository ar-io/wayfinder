---
"@ar.io/wayfinder-extension": patch
---

Follow-up fixes after the Solana migration:

- **Stop falling back to a mainnet gateway when the user is on a
  non-mainnet network.** `FALLBACK_GATEWAY` is hardcoded to a mainnet
  gateway (turbo-gateway.com); using it from a devnet or custom-network
  install would silently serve mainnet content under the user's
  chosen network. `routing.ts` now reads the `network` preset from
  storage and only triggers the mainnet fallback when
  `network === 'mainnet'`. On devnet or custom, the original routing
  error is propagated instead.

- **Tolerate invalid stored network config on startup.** The IIFE that
  initializes the read-only `ARIO` instance on service-worker boot
  now wraps `arioFromStorage()` in a try/catch and falls back to the
  bundled devnet defaults if the user previously persisted a bad RPC
  URL or program ID via the custom-network preset. Previously, a
  single bad value could brick `debouncedInitializeWayfinder()` and
  leave routing inoperable until manual settings reset.

- **Drop two orphan message-handler allowlist entries**
  (`resetAdvancedSettings`, `updateVerificationMode`) plus the
  unreachable `resetAdvancedSettings` handler body. Neither was wired
  to a UI control after the AO → Solana migration and the latter's
  responsibilities are covered by the existing
  `updateAdvancedSettings` flow.
