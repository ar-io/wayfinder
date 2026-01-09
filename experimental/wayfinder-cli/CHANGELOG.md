# Changelog

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
