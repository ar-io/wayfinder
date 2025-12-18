# Integration Testing Guide for Manifest Verification

## Overview

This guide explains how to run integration tests for Wayfinder's manifest verification feature.

## Test Files Created

### 1. **Full Integration Test Suite**
`src/verification/manifest-verification.integration.test.ts`

Comprehensive Node.js test suite using the built-in test runner. Tests:
- Real manifest fetching and parsing
- Transaction ID validation
- Nested resource verification
- Caching behavior
- Event emission
- Performance benchmarks

**Run with:**
```bash
cd packages/wayfinder-core
SKIP_INTEGRATION_TESTS=0 npx tsx --test src/verification/manifest-verification.integration.test.ts
```

**Note:** Currently blocked by optional dependency issues (`@opentelemetry/context-zone`, `zone.js`). These need to be installed or made truly optional.

### 2. **Standalone Integration Test**
`test-manifest-integration.mjs`

Simple standalone script that tests manifest operations without requiring a build:
- Manifest fetching
- TX ID validation
- Sample resource fetching
- Path resolution
- Cache performance

**Run with:**
```bash
cd packages/wayfinder-core
node test-manifest-integration.mjs
```

## Important: Gateway `/raw/` Endpoint

**Critical Detail:** By default, when you request a manifest transaction ID from a gateway (e.g., `https://arweave.net/dJ9BWH0lLdid0c7ajAqS_8O66HnhL3zVH1C7h9AEv8g`), the gateway serves the **index file** (e.g., `index.html`) defined in the manifest, NOT the manifest JSON itself.

**To fetch the actual manifest JSON**, you must use the `/raw/` endpoint:
- ❌ Wrong: `https://arweave.net/dJ9BWH0lLdid0c7ajAqS_8O66HnhL3zVH1C7h9AEv8g` → Returns index.html
- ✅ Correct: `https://arweave.net/raw/dJ9BWH0lLdid0c7ajAqS_8O66HnhL3zVH1C7h9AEv8g` → Returns manifest JSON

**Wayfinder automatically handles this** in `requestWithManifest()` by using the `/raw/` endpoint internally.

## Test Transaction ID

The provided TX ID `dJ9BWH0lLdid0c7ajAqS_8O66HnhL3zVH1C7h9AEv8g` is a real ArDrive web application manifest with 438 paths.

### Finding a Valid Manifest TX ID

To test with a real Arweave manifest, you need a TX ID that points to a transaction with:
- Content-Type: `application/x.arweave-manifest+json`
- Valid manifest structure: `{ "manifest": "arweave/paths", "version": "...", "paths": {...} }`

**How to find manifest TX IDs:**

1. **From ArDrive:**
   - Open ArDrive
   - Look for folder transactions
   - Folder manifests are stored as separate transactions
   - Check transaction details for content type

2. **From Arweave Explorer:**
   ```bash
   # Query for manifests using GraphQL
   curl -X POST https://arweave.net/graphql \
     -H "Content-Type: application/json" \
     -d '{
       "query": "{ transactions(tags: [{name: \"Content-Type\", values: [\"application/x.arweave-manifest+json\"]}], first: 10) { edges { node { id } } } }"
     }'
   ```

3. **Test with a known manifest:**
   - Use the Arweave permaweb app manifests
   - Check `arweave.net/graphql` for public manifest examples

### Example Valid Manifest Structure

```json
{
  "manifest": "arweave/paths",
  "version": "0.1.0",
  "index": {
    "path": "index.html"
  },
  "paths": {
    "index.html": {
      "id": "TRANSACTION_ID_HERE_43_CHARS_AAAAAAAAAAA"
    },
    "style.css": {
      "id": "ANOTHER_TX_ID_43_CHARS_BBBBBBBBBBBBBB"
    }
  }
}
```

## Running Tests

### Prerequisites

```bash
# Install dependencies (from repo root)
npm install

# Or from wayfinder-core directory
cd packages/wayfinder-core
npm install
```

### Quick Test (Standalone)

```bash
cd packages/wayfinder-core

# Edit test-manifest-integration.mjs and replace ARDRIVE_MANIFEST_TX_ID
# with a valid manifest transaction ID

node test-manifest-integration.mjs
```

### Full Test Suite

Once dependencies are resolved:

```bash
cd packages/wayfinder-core

# Run integration tests
SKIP_INTEGRATION_TESTS=0 TEST_TIMEOUT=120000 \
  npx tsx --test src/verification/manifest-verification.integration.test.ts
```

## What Integration Tests Cover

✅ **Manifest Fetching**
- Fetch from real Arweave gateways
- Parse manifest structure
- Validate manifest schema

✅ **Transaction ID Validation**
- Verify 43-character format
- Base64url alphabet validation
- Deduplication

✅ **Resource Verification**
- Fetch nested resources
- Verify content exists
- Check content types

✅ **Path Resolution**
- Resolve paths to TX IDs
- Handle index paths
- Path normalization

✅ **Caching**
- Verification result caching
- Cache hit performance
- TTL behavior

✅ **Events**
- Progress events
- Success/failure events
- Verification events

✅ **Performance**
- Concurrent verification
- Gateway fallback
- Timeout handling

## Current Issues

### 1. Optional Dependencies Not Resolved

The integration test requires OpenTelemetry dependencies that are listed as optional but not properly handled:
- `@opentelemetry/context-zone`
- `zone.js`

**Workarounds:**
1. Use the standalone test script (`test-manifest-integration.mjs`)
2. Install optional dependencies manually
3. Disable telemetry in test configuration

### 2. TX ID Verification

The provided TX ID needs to be verified as an actual Arweave manifest. Current TX ID returns an HTML application.

## Next Steps

1. **Get Valid Manifest TX ID**
   - Find or create a test manifest
   - Verify it has the correct content type
   - Update both test files with the TX ID

2. **Fix Optional Dependencies**
   - Make telemetry truly optional
   - Or require the dependencies properly
   - Update package.json configuration

3. **Add to CI/CD**
   - Create GitHub Actions workflow
   - Run integration tests on PR
   - Cache test results

4. **Expand Test Coverage**
   - Test with large manifests (100+ resources)
   - Test nested manifests (depth > 1)
   - Test with malformed manifests
   - Test verification failures

## Example: Testing with Wayfinder Client

```javascript
import { Wayfinder } from '@ar.io/wayfinder-core';
import { ManifestVerificationStrategy } from '@ar.io/wayfinder-core';
import { HashVerificationStrategy } from '@ar.io/wayfinder-core';

const wayfinder = new Wayfinder({
  verificationSettings: {
    enabled: true,
    strict: true,
    strategy: new ManifestVerificationStrategy({
      baseStrategy: new HashVerificationStrategy({
        trustedGateways: [
          new URL('https://arweave.net'),
          new URL('https://permagate.io'),
        ],
      }),
      maxDepth: 3,
      concurrency: 10,
    }),
  },
});

// Fetch and verify manifest
const response = await wayfinder.requestWithManifest(
  'ar://YOUR_MANIFEST_TX_ID_HERE',
  {
    verifyNested: true,
    onProgress: (event) => {
      console.log(`Verified ${event.verified}/${event.total}`);
    },
  },
);

console.log('All verified:', response.allVerified);
console.log('Paths:', Object.keys(response.manifest.paths));
```

## Support

If you encounter issues:
1. Check the TX ID is a valid manifest
2. Verify network connectivity to Arweave gateways
3. Check for dependency installation issues
4. Review test output for specific errors

## Contributing

When adding new integration tests:
1. Follow the existing test structure
2. Add descriptive test names
3. Include console output for debugging
4. Document any new dependencies
5. Update this guide with new test coverage
