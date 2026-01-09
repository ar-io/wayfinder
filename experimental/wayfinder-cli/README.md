# Wayfinder CLI

Fast and user-friendly command-line interface for fetching files via AR.IO Wayfinder.

## Installation

```bash
npm install -g @ar.io/wayfinder-cli
# or
yarn global add @ar.io/wayfinder-cli
```

## Quick Start

```bash
# Fetch and display content (quiet by default)
wayfinder fetch ar://ardrive

# Save to file with progress bar
wayfinder fetch ar://example.pdf -o example.pdf --progress

# Enable verbose logging to see detailed information
wayfinder fetch ar://data --verbose

# Completely silent (only errors)
wayfinder fetch ar://data -o file.txt --quiet
```

## Commands

### `fetch`

Fetch data from ar:// URLs with support for streaming, progress tracking, and verification.

```bash
wayfinder fetch <url> [options]
```

**Options:**
- `-o, --output <path>` - Save to file instead of stdout
- `-r, --routing <strategy>` - Routing strategy (random, fastest, balanced, preferred)
- `-v, --verify <strategy>` - Verification strategy (hash, data-root, signature, remote, disabled)
- `-g, --gateway <url>` - Preferred gateway URL
- `--progress` - Show download progress bar
- `--json` - Output metadata as JSON
- `--verbose` - Enable verbose logging
- `--quiet` - Suppress all output except errors
- `--timeout <ms>` - Request timeout in milliseconds (default: 60000)

**Examples:**

```bash
# Basic fetch (quiet by default)
wayfinder fetch ar://example-name

# Save with progress and verbose output
wayfinder fetch ar://large-file.zip -o file.zip --progress --verbose

# Use fastest gateway with hash verification (verbose)
wayfinder fetch ar://important-data -r fastest -v hash --verbose

# Use specific gateway silently
wayfinder fetch ar://data -g https://my-gateway.com --quiet

# Output only JSON metadata
wayfinder fetch ar://example --json --quiet
```

### `config`

Manage wayfinder configuration settings.

```bash
wayfinder config <command> [options]
```

**Subcommands:**
- `set <key> <value>` - Set a configuration value
- `get <key>` - Get a configuration value
- `list` - List all configuration values
- `path` - Show configuration file path

**Options:**
- `-g, --global` - Use global config instead of local

**Configuration Keys:**
- `routing` - Default routing strategy (random, fastest, balanced, preferred)
- `verification` - Default verification strategy (hash, data-root, signature, remote, disabled)
- `gateway` - Preferred gateway URL
- `outputFormat` - Output format (human, json)
- `verbose` - Enable verbose logging (true, false)
- `quiet` - Suppress output (true, false)
- `progress` - Show progress by default (true, false)

**Examples:**

```bash
# Set default routing strategy
wayfinder config set routing fastest

# Set global verification strategy
wayfinder config set verification hash --global

# List all configurations
wayfinder config list

# Get specific value
wayfinder config get gateway
```

### `info`

Display information about available gateways with latency testing.

```bash
wayfinder info [options]
```

**Options:**
- `--json` - Output as JSON
- `-l, --limit <number>` - Limit number of gateways to display (default: 10)

**Examples:**

```bash
# Show gateway information
wayfinder info

# Get JSON output
wayfinder info --json

# Show top 20 gateways
wayfinder info --limit 20
```

## Configuration

Wayfinder CLI supports configuration files for setting default options. Configuration is loaded from:

1. Local `.wayfinderrc` file in the current directory
2. Global `~/.wayfinderrc` file in your home directory
3. Command-line arguments (highest priority)

### Configuration File Format

```json
{
  "routing": "fastest",
  "verification": "hash",
  "gateway": "https://preferred-gateway.com",
  "progress": true,
  "verbose": false
}
```

## Advanced Usage

### Streaming Large Files

Wayfinder CLI efficiently streams large files to disk:

```bash
wayfinder fetch ar://large-dataset.csv -o data.csv --progress
```

### Verification

Enable cryptographic verification to ensure data integrity:

```bash
# Hash verification (recommended)
wayfinder fetch ar://important-doc -v hash

# Signature verification
wayfinder fetch ar://signed-data -v signature

# Data root verification
wayfinder fetch ar://transaction -v data-root
```

### Using with Scripts

Output JSON metadata for script processing:

```bash
# Get metadata as JSON
METADATA=$(wayfinder fetch ar://example --json)

# Extract gateway used
GATEWAY=$(echo $METADATA | jq -r '.gateway')
```

### Quiet Mode for Pipelines

Use quiet mode when piping output:

```bash
# Pipe content to another command
wayfinder fetch ar://data.json --quiet | jq '.results'

# Save to file silently
wayfinder fetch ar://file.txt -o output.txt --quiet
```

## Logging Levels

Wayfinder CLI follows a quiet-by-default philosophy with three logging levels:

### Default (Quiet)
Shows only essential output like success messages and progress:
```bash
wayfinder fetch ar://data -o file.txt
# ✓ Saved to file.txt
```

### Verbose (`--verbose`)
Shows detailed information about the fetch process:
```bash
wayfinder fetch ar://data -o file.txt --verbose
# ⚙ Using routing strategy: default
# ⚙ Using verification: disabled
# ⚙ Response from gateway: arweave.net
# ⚙ Content-Type: application/json
# ⚙ Content-Length: 1234 bytes
# ⚙ Verification status: skipped
# ⚙ Received 1234 bytes
# ✓ Saved to file.txt
```

### Quiet (`--quiet`)
Shows only errors (perfect for scripts):
```bash
wayfinder fetch ar://data -o file.txt --quiet
# (no output unless there's an error)
```

## Environment Variables

- `DEBUG` - Enable debug output and stack traces
- `NO_COLOR` - Disable colored output

## Error Handling

Wayfinder CLI provides helpful error messages with recovery suggestions:

```bash
# Invalid URL
$ wayfinder fetch invalid-url
✖ Invalid URL format
  URLs must start with ar:// (e.g., ar://example-name)

# Network timeout
$ wayfinder fetch ar://example --timeout 1000
✖ Request timeout after 1000ms
  Try increasing the timeout or using a different gateway
```

## Performance Tips

1. **Use fastest routing** for optimal gateway selection:
   ```bash
   wayfinder config set routing fastest
   ```

2. **Enable progress** for large downloads:
   ```bash
   wayfinder config set progress true
   ```

3. **Configure preferred gateway** if you have a reliable one:
   ```bash
   wayfinder config set gateway https://fast-gateway.com
   ```

## License

Licensed under the Apache License, Version 2.0. See [LICENSE](LICENSE) for details.