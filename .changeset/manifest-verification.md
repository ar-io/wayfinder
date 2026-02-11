---
"@ar.io/wayfinder-core": patch
---

Fix verification for manifest and raw data endpoints

- Add automatic manifest detection via x-ar-io-data-id and x-arns-resolved-id headers
- When dataId !== resolvedId, verify against the actual served content (e.g., index.html)
- Add raw parameter support for /raw/{txId} endpoint verification
- Add normalizeHeaders utility to reduce code duplication
