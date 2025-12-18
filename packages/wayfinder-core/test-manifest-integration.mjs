/**
 * Standalone Integration Test for Manifest Verification
 *
 * Run with: node test-manifest-integration.mjs
 *
 * This is a simple Node.js script that tests manifest verification
 * without requiring a build or test runner.
 */

// Real ArDrive manifest transaction ID
const ARDRIVE_MANIFEST_TX_ID = 'dJ9BWH0lLdid0c7ajAqS_8O66HnhL3zVH1C7h9AEv8g';
const GATEWAY_URL = 'https://arweave.net';
// Use /raw/ endpoint to get manifest JSON instead of the index file
const RAW_ENDPOINT = `${GATEWAY_URL}/raw`;

console.log('🧪 Manifest Verification Integration Test');
console.log('='.repeat(70));
console.log(`\nManifest TX ID: ${ARDRIVE_MANIFEST_TX_ID}`);
console.log(`Gateway: ${GATEWAY_URL}\n`);

async function testManifestFetch() {
  console.log('📦 Test 1: Fetching manifest from gateway...');

  try {
    // Use /raw/ endpoint to fetch manifest JSON
    const url = `${RAW_ENDPOINT}/${ARDRIVE_MANIFEST_TX_ID}`;
    const response = await fetch(url);

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const manifestText = await response.text();
    const manifest = JSON.parse(manifestText);

    console.log(`  ✅ Successfully fetched manifest`);
    console.log(`  📊 Manifest version: ${manifest.version}`);
    console.log(
      `  📁 Number of paths: ${Object.keys(manifest.paths || {}).length}`,
    );
    console.log(`  📄 Index: ${manifest.index?.path || 'none'}`);

    // Validate manifest structure
    if (manifest.manifest !== 'arweave/paths') {
      throw new Error('Invalid manifest type');
    }

    if (!manifest.version) {
      throw new Error('Missing manifest version');
    }

    if (!manifest.paths || typeof manifest.paths !== 'object') {
      throw new Error('Invalid paths structure');
    }

    return manifest;
  } catch (error) {
    console.log(`  ❌ Failed: ${error.message}`);
    throw error;
  }
}

async function testTransactionIdValidation(manifest) {
  console.log('\n🔍 Test 2: Validating transaction IDs...');

  try {
    const txIdRegex = /^[A-Za-z0-9_-]{43}$/;
    const paths = manifest.paths || {};
    const txIds = Object.values(paths).map((entry) => entry.id);
    const uniqueTxIds = [...new Set(txIds)];

    console.log(`  📝 Total transaction IDs: ${txIds.length}`);
    console.log(`  🔢 Unique transaction IDs: ${uniqueTxIds.length}`);

    let validCount = 0;
    const invalidIds = [];

    for (const txId of uniqueTxIds) {
      if (txIdRegex.test(txId)) {
        validCount++;
      } else {
        invalidIds.push(txId);
      }
    }

    if (invalidIds.length > 0) {
      console.log(`  ❌ Found ${invalidIds.length} invalid TX IDs:`);
      invalidIds.slice(0, 5).forEach((id) => console.log(`     - ${id}`));
      throw new Error('Invalid transaction IDs found');
    }

    console.log(
      `  ✅ All ${validCount} transaction IDs are valid (43 chars, base64url)`,
    );
    return uniqueTxIds;
  } catch (error) {
    console.log(`  ❌ Failed: ${error.message}`);
    throw error;
  }
}

async function testResourceFetch(manifest, maxResources = 3) {
  console.log(
    `\n📥 Test 3: Fetching sample resources (first ${maxResources})...`,
  );

  try {
    const paths = Object.keys(manifest.paths || {}).slice(0, maxResources);
    let successCount = 0;

    for (const path of paths) {
      const entry = manifest.paths[path];
      const txId = entry.id;

      try {
        const url = `${GATEWAY_URL}/${txId}`;
        const response = await fetch(url, { method: 'HEAD' }); // HEAD request for speed

        if (response.ok) {
          const contentLength = response.headers.get('content-length');
          const contentType = response.headers.get('content-type');
          console.log(`  ✅ ${path}`);
          console.log(
            `     Size: ${contentLength ? `${contentLength} bytes` : 'unknown'}`,
          );
          console.log(`     Type: ${contentType || 'unknown'}`);
          console.log(`     TX ID: ${txId.substring(0, 15)}...`);
          successCount++;
        } else {
          console.log(`  ⚠️  ${path} - HTTP ${response.status}`);
        }
      } catch (error) {
        console.log(`  ❌ ${path} - ${error.message}`);
      }
    }

    console.log(
      `\n  📊 Successfully fetched ${successCount}/${paths.length} resources`,
    );
    return successCount;
  } catch (error) {
    console.log(`  ❌ Failed: ${error.message}`);
    throw error;
  }
}

async function testPathResolution(manifest) {
  console.log('\n🗺️  Test 4: Testing path resolution...');

  try {
    const paths = Object.keys(manifest.paths || {});
    console.log(`  📁 Total paths in manifest: ${paths.length}`);

    // Show first 10 paths
    console.log('  \nSample paths:');
    paths.slice(0, 10).forEach((path) => {
      const txId = manifest.paths[path].id;
      console.log(`    ${path} → ${txId.substring(0, 20)}...`);
    });

    if (paths.length > 10) {
      console.log(`    ... and ${paths.length - 10} more`);
    }

    // Test index resolution
    if (manifest.index?.path) {
      const indexPath = manifest.index.path;
      const indexEntry = manifest.paths[indexPath];
      if (indexEntry) {
        console.log(`\n  📄 Index path: ${indexPath}`);
        console.log(`     TX ID: ${indexEntry.id}`);
        console.log(`  ✅ Index resolution successful`);
      } else {
        console.log(`  ⚠️  Index path "${indexPath}" not found in paths`);
      }
    } else {
      console.log(`  ℹ️  No index defined in manifest`);
    }

    return true;
  } catch (error) {
    console.log(`  ❌ Failed: ${error.message}`);
    throw error;
  }
}

async function testManifestCaching() {
  console.log('\n⚡ Test 5: Testing cache performance...');

  try {
    // First request
    const start1 = Date.now();
    const response1 = await fetch(`${RAW_ENDPOINT}/${ARDRIVE_MANIFEST_TX_ID}`);
    await response1.text();
    const duration1 = Date.now() - start1;

    console.log(`  📡 First request: ${duration1}ms`);

    // Second request (should be cached by gateway)
    const start2 = Date.now();
    const response2 = await fetch(`${RAW_ENDPOINT}/${ARDRIVE_MANIFEST_TX_ID}`);
    await response2.text();
    const duration2 = Date.now() - start2;

    console.log(`  📡 Second request: ${duration2}ms`);

    if (duration2 < duration1 * 0.9) {
      console.log(
        `  ✅ Second request faster (${((1 - duration2 / duration1) * 100).toFixed(0)}% improvement)`,
      );
    } else {
      console.log(`  ℹ️  Similar performance (gateway caching may vary)`);
    }

    return true;
  } catch (error) {
    console.log(`  ❌ Failed: ${error.message}`);
    throw error;
  }
}

// Run all tests
async function runAllTests() {
  const startTime = Date.now();
  let passed = 0;
  let failed = 0;

  try {
    const manifest = await testManifestFetch();
    passed++;

    const _txIds = await testTransactionIdValidation(manifest);
    passed++;

    await testResourceFetch(manifest, 3);
    passed++;

    await testPathResolution(manifest);
    passed++;

    await testManifestCaching();
    passed++;
  } catch (error) {
    failed++;
    console.error(`\n❌ Test suite failed: ${error.message}`);
  }

  const duration = Date.now() - startTime;

  console.log('\n' + '='.repeat(70));
  console.log('📊 Test Results');
  console.log('='.repeat(70));
  console.log(`✅ Passed: ${passed}`);
  console.log(`❌ Failed: ${failed}`);
  console.log(`⏱️  Total time: ${duration}ms`);
  console.log('='.repeat(70));

  if (failed === 0) {
    console.log('\n🎉 All tests passed!');
    process.exit(0);
  } else {
    console.log('\n💥 Some tests failed');
    process.exit(1);
  }
}

// Run tests
runAllTests().catch((error) => {
  console.error('\n💥 Fatal error:', error);
  process.exit(1);
});
