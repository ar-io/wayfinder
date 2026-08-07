---
"@ar.io/wayfinder-core": major
---

**Breaking:** remove the default telemetry API key.

`initTelemetry` previously fell back to an API key bundled in the published
package when `telemetrySettings.apiKey` was not supplied. That key has been
revoked. Telemetry is opt-in and disabled by default, so installs that never
set `telemetrySettings.enabled: true` are unaffected.

- `telemetrySettings.apiKey` no longer has a default value.
- When `enabled` is `true` and `exporterUrl` targets Honeycomb, `apiKey` is now
  required and `initTelemetry` throws if it is missing. Because `initTelemetry`
  runs from the `Wayfinder` constructor, this surfaces at construction time.
- Exporters pointed at a non-Honeycomb host are unaffected and may omit
  `apiKey`; the `x-honeycomb-*` headers are only sent when a key is present.

To keep exporting traces, supply your own key:

```ts
new Wayfinder({
  telemetrySettings: {
    enabled: true,
    apiKey: process.env.HONEYCOMB_API_KEY,
  },
});
```

Or send them to a collector you operate, which needs no key:

```ts
new Wayfinder({
  telemetrySettings: {
    enabled: true,
    exporterUrl: 'https://otel.example.com/v1/traces',
  },
});
```
