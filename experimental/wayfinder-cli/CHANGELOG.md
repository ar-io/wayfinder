# Changelog

## 0.0.5

### Patch Changes

- 954e60e: Replace hardcoded gateway defaults with turbo-gateway.com

  - Replace arweave.net and permagate.io defaults with turbo-gateway.com throughout codebase
  - Update all fallback gateways to use AR.IO-compatible gateway
  - Update documentation examples to use turbo-gateway.com
  - Fix integration tests to use turbo-gateway.com instead of permagate.io
  - Fix flaky test by excluding timestamp header from ArNS header comparison
  - No breaking changes - all user configurations still work as before
  - arweave.net is no longer an AR.IO gateway and doesn't support /ar-io/\* endpoints

- Updated dependencies [954e60e]
  - @ar.io/wayfinder-core@1.9.2

## 0.0.1 (2025-01-09)

### Features

- Initial release of @ar.io/wayfinder-cli
- **fetch** command for downloading files from ar:// URIs
  - Streaming support for large files
  - Progress bar with download speed
  - Multiple routing strategies (random, fastest, balanced, preferred)
  - Verification strategies (hash, data-root, signature, remote)
  - JSON output for scripting
- **config** command for managing settings
  - Local and global configuration files
  - Set/get individual values
  - List all configurations
- **info** command for gateway information
  - Display available gateways
  - Test gateway latencies
  - JSON output support
- Comprehensive error handling with helpful suggestions
- TypeScript for type safety
- Fast startup with minimal dependencies
