---
"@ar.io/wayfinder-extension": major
---

BREAKING: Wayfinder extension is now Solana-only. AO support has been
removed.

**Storage schema (breaking for AO-era users):**

- The `processId` and `aoCuUrl` keys in `chrome.storage.local` are no
  longer used. On first run after upgrade, the extension detects them,
  silently deletes them, drops the cached `localGatewayAddressRegistry`
  (the AO gateway snapshot is irrelevant on Solana), and writes Solana
  devnet defaults: `network`, `rpcUrl`, `coreProgramId`, `garProgramId`,
  `arnsProgramId`, `antProgramId`. The next gateway sync repopulates the
  registry from the Solana network.
- A single info-level log line is emitted on migration so the migration
  is visible in devtools.

**Settings UI:**

- "AR.IO Process ID" and "AO Compute Unit URL" fields removed.
- Replaced with: a Network preset selector
  (`mainnet | devnet | custom`), a Solana RPC URL input, and a
  collapsible "Advanced: AR.IO Program IDs" panel exposing the four
  per-program addresses (core / GAR / ArNS / ANT). Preset modes auto-
  fill the RPC + program IDs and disable those inputs; Custom mode
  re-enables them for advanced operators (e.g., localnet developers).
- All three presets are now selectable (`mainnet`, `devnet`, `custom`);
  the default preset on a fresh install is `devnet`.

**Dependencies:**

- Bumped `@ar.io/sdk` from `^3.21.0` to `^4.0.2`.
- Bumped `@solana/kit` to `^6.8.0` (matches SDK v4.0.2 requirement).
- Removed `@permaweb/aoconnect` (no longer needed).

**Code:**

- `src/background.ts`: dropped `AOProcess` / `connect` / AO process
  constants imports; added `arioFromStorage()` helper that constructs
  a Solana-backed `ARIO.init({rpc, ...programIds})`
  from `chrome.storage.local`; rewrote the four `ARIO.init` call sites
  to use the helper; added `migrateStorageFromAOEra()` to handle the
  storage schema bump.
- `src/settings.ts`: replaced `handleProcessIdChange` /
  `handleAoCuUrlChange` with a single `handleNetworkConfigChange`
  routed to all six new field IDs; preset selection auto-fills RPC and
  program IDs; per-field edits validate the input
  (URL parsing for RPC, base58 Solana address parsing for program IDs).
- `src/constants.ts`: removed `ARIO_MAINNET_PROCESS_ID`,
  `DEFAULT_AO_CU_URL`.
- `src/config/defaults.ts`: replaced AO defaults
  (`processId`, `aoCuUrl`) with Solana devnet defaults
  (`network`, `rpcUrl`, four program IDs).
