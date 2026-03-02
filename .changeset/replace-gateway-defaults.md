---
"@ar.io/wayfinder-core": patch
"@ar.io/wayfinder-extension": patch
"@ar.io/wayfinder-cli": patch
---

Replace hardcoded gateway defaults with turbo-gateway.com

- Replace arweave.net and permagate.io defaults with turbo-gateway.com throughout codebase
- Update all fallback gateways to use AR.IO-compatible gateway
- Update documentation examples to use turbo-gateway.com
- No breaking changes - all user configurations still work as before
- arweave.net is no longer an AR.IO gateway and doesn't support /ar-io/* endpoints
