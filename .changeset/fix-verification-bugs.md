---
"@ar.io/wayfinder-extension": patch
---

fix(verification): resolve multiple bugs in hash verification feature

- Fix race condition in Wayfinder initialization promise handling
- Fix chrome.runtime.lastError timing issues in verified.ts
- Fix handleBackgroundMessage return type for async message handling
- Improve error handling in broadcastEvent with proper error differentiation
- Improve catch handler logging in manifest-verifier
- Remove dead code: unused exports, no-op functions, and incomplete SVG interception
- Add immediate cleanup on service worker startup for stale verification states
