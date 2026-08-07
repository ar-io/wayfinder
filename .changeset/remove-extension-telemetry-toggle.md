---
"@ar.io/wayfinder-extension": minor
---

Remove the Anonymous Telemetry setting.

`wayfinder-core` no longer provides a default telemetry API key, and a
client-side extension has nowhere to keep one — any key it shipped would be
readable by anyone who unpacked the bundle. Rather than ship a credential, the
toggle is removed and the extension no longer initializes telemetry at all.

- Dropped the telemetry toggle from the settings page, along with its change
  handler, load path, and stored `telemetryEnabled` default.
- `routing.ts` no longer passes `telemetrySettings` when constructing
  `Wayfinder`. This also avoids the constructor throw that core now raises when
  telemetry is enabled without an API key — which, because the constructor sits
  on the `ar://` routing path, would have broken URL resolution outright for
  anyone who had the toggle switched on.
- Existing installs have their orphaned `telemetryEnabled` key removed on
  startup by `migrateStorageFromTelemetryEra()`.

No user action is required. Routing, verification, and gateway selection are
unaffected.
