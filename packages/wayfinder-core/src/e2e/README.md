# End-to-end suite

Live-network tests for wayfinder-core. These talk to the real AR.IO Solana
registry and real gateways, so they answer a question the mocked suites can't:
**does the deployed network still satisfy the assumptions the library makes?**

They are deliberately excluded from `test:unit` and from CI.

```bash
npm run test:e2e -w @ar.io/wayfinder-core
```

## Configuration

| Variable | Default | Purpose |
| --- | --- | --- |
| `SOLANA_RPC_URL` | `https://api.mainnet-beta.solana.com` | Solana RPC backing the gateway registry |
| `TRUSTED_GATEWAY` | `https://turbo-gateway.com` | Verification source and peer-discovery seed; matches the `createWayfinderClient()` default |
| `E2E_GATEWAYS` | `https://permagate.io,https://vevivo.art` | Known-good gateways used when the trusted one doesn't serve an endpoint |
| `E2E_TIMEOUT_MS` | `90000` | Per-test timeout |

**Use a dedicated Solana RPC.** The public mainnet endpoint rate-limits bursts,
which shows up as sporadic `NetworkGatewaysProvider` failures that have nothing
to do with wayfinder:

```bash
SOLANA_RPC_URL=https://your-rpc npm run test:e2e -w @ar.io/wayfinder-core
```

## What's covered

Each of the four extension points, exercised against the live network:

- **`gateways.e2e.test.ts`** — the Solana registry path (`NetworkGatewaysProvider`),
  peer discovery, and the caching/fallback wrappers. This closes the largest gap:
  every other suite stubs the gateways provider, so nothing previously exercised
  the on-chain registry at all.
- **`routing.e2e.test.ts`** — all eight routing strategies, plus ArNS resolution.
- **`verification.e2e.test.ts`** — hash, data-root, signature, and remote.
- **`retrieval.e2e.test.ts`** — contiguous and chunk, including each chunk
  prerequisite as its own assertion so a failure names the layer that broke.

## Coverage against developer stories

What a consumer of `@ar.io/wayfinder-core` can actually do, and whether the live
suite proves it. This is the scope statement — treat anything marked ✗ as
unverified against a real network, not as known-broken.

| Developer story | Covered | Where |
| --- | :-: | --- |
| `npm i` the package and import it | ✓ | `npm run test:package` |
| Zero-config `createWayfinderClient()` / `new Wayfinder()` fetches data | ✓ | `routing.e2e` |
| Keep working when peer discovery returns nothing | ✓ | `gateways.e2e` |
| Fetch by transaction ID | ✓ | all four files |
| Fetch by ArNS name, and resolve one to a URL | ✓ | `routing.e2e` |
| Source gateways from the on-chain (Solana) registry | ✓ | `gateways.e2e` |
| Rank gateways by stake / weights and take the top N | ✓ | `gateways.e2e` |
| Pick any of the 8 routing strategies | ✓ | `routing.e2e` |
| Verify data (hash, data-root, signature, remote) | ✓ | `verification.e2e` |
| Have verification fail closed in strict mode | ✓ | `verification.e2e` |
| Retrieve via chunks | ✓ | `retrieval.e2e` (fails; see above) |
| Subscribe to routing/verification events | ✗ | mocked only, in `wayfinder.test.ts` |
| Call gateway endpoints (`ar:///info`, GraphQL POST) | ✗ | live but in `wayfinder.test.ts`, not here |
| ArNS undernames and deep paths | ✗ | URL-shape assertions only, in `wayfinder.test.ts` |
| Enable telemetry and see spans exported | ✗ | — |
| Run in a browser (`LocalStorageGatewaysProvider`) | ✗ | suite is Node-only |
| Pay for data via x402 | ✗ | — |

`wayfinder-react` now covers its provider (memoisation and the
server-side-rendering path), but not the three hooks. `wayfinder-extension` and
`wayfinder-cli` still have **no test suite at all**, so no user-facing extension
story — ar:// navigation, link rewriting, ENS, settings — is verified anywhere.
Those remain the largest gaps in the repo; this suite scopes to
`wayfinder-core`.

## Fixtures matter

Transaction shape determines which strategies can apply, and picking the wrong
one produces failures that look like library bugs:

| Fixture | Shape | Why |
| --- | --- | --- |
| `bundledDataItem` | ANS-104 item in a bundle | Only shape with the `x-ar-io-root-*` headers chunk retrieval needs; has no L1 `/tx/<id>` record |
| `l1FormatTwo` | Format-2 L1 transaction | Only shape with a real `data_root` — required for data-root and signature verification |
| `l1FormatOne` | Format-1 L1 transaction | `data_root` is empty by definition; used to prove verification fails closed |

## Tests that are expected to fail today

These encode correct behaviour and currently fail for reasons outside the
library. They are health checks, not regressions to silence.

- **Chunk retrieval** — no gateway tested serves `/chunk/<offset>/data` usefully.
  Most return 404/502; `turbo-gateway.com` returns the correct chunk bytes but
  omits the `X-Arweave-Chunk-*` headers the strategy verifies against, and
  intermittently returns `200` with the body `Not Found`.

The `TrustedPeersGatewaysProvider` consistency test guards a real incident seen
during development, where `turbo-gateway.com/ar-io/peers` returned an empty
`gateways` map for a sustained period. It passes against a healthy endpoint. If
it starts failing, peer discovery is degraded on whichever gateway
`TRUSTED_GATEWAY` points at — note that some operators (e.g.
`ariospeedwagon.com`) serve an empty map persistently, so pointing the suite at
an arbitrary gateway is expected to fail this check.
