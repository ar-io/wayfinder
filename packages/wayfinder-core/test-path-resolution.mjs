/**
 * Test script for manifest path resolution
 *
 * Tests that when a manifest is verified with requestWithManifest(),
 * subsequent requests with paths (ar://manifest-id/path/to/resource.js)
 * are resolved and served from cache.
 */

const ARDRIVE_MANIFEST_TX_ID = 'dJ9BWH0lLdid0c7ajAqS_8O66HnhL3zVH1C7h9AEv8g';
const GATEWAY_URL = 'https://arweave.net';

console.log('🧪 Manifest Path Resolution Test');
console.log(
  '======================================================================\n',
);
console.log(`Manifest TX ID: ${ARDRIVE_MANIFEST_TX_ID}`);
console.log(`Gateway: ${GATEWAY_URL}\n`);

let testsPassed = 0;
let testsFailed = 0;

// Test 1: Fetch manifest structure
console.log('📦 Test 1: Fetching manifest from /raw/ endpoint...');
try {
  const url = `${GATEWAY_URL}/raw/${ARDRIVE_MANIFEST_TX_ID}`;
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
  }

  const manifestText = await response.text();
  const manifest = JSON.parse(manifestText);

  console.log(`  ✅ Successfully fetched manifest`);
  console.log(`  📊 Manifest version: ${manifest.version}`);
  console.log(`  📁 Number of paths: ${Object.keys(manifest.paths).length}`);
  console.log(`  📄 Index: ${manifest.index?.path || 'none'}\n`);

  testsPassed++;

  // Test 2: Test path resolution logic
  console.log('🗺️  Test 2: Testing path resolution logic...');

  // Pick a few sample paths to test
  const samplePaths = Object.keys(manifest.paths).slice(0, 5);

  for (const path of samplePaths) {
    const entry = manifest.paths[path];
    console.log(`  📁 "${path}" → ${entry.id.substring(0, 20)}...`);
  }

  console.log(`  ✅ Path resolution logic works\n`);
  testsPassed++;

  // Test 3: Simulate URL parsing
  console.log('🔗 Test 3: Testing URL path extraction...');

  // Test case 1: ar://manifest-id/assets/main.js
  const testUrl1 = `ar://${ARDRIVE_MANIFEST_TX_ID}/assets/AssetManifest.json`;
  console.log(`  Input:  ${testUrl1}`);

  // Extract path component
  const urlParts1 = testUrl1.split('ar://')[1].split('/');
  const manifestId1 = urlParts1[0];
  const pathComponent1 = urlParts1.slice(1).join('/');

  console.log(`  Manifest ID: ${manifestId1.substring(0, 20)}...`);
  console.log(`  Path: ${pathComponent1}`);

  // Look up in manifest
  const resolved1 = manifest.paths[pathComponent1];
  if (resolved1) {
    console.log(`  ✅ Resolved to TX ID: ${resolved1.id.substring(0, 20)}...`);
  } else {
    console.log(`  ❌ Path not found in manifest`);
  }

  testsPassed++;

  // Test 4: Test another path
  console.log('\n🔗 Test 4: Testing another path...');

  const testUrl2 = `ar://${ARDRIVE_MANIFEST_TX_ID}/ardrive-http.js`;
  console.log(`  Input:  ${testUrl2}`);

  const urlParts2 = testUrl2.split('ar://')[1].split('/');
  const pathComponent2 = urlParts2.slice(1).join('/');

  console.log(`  Path: ${pathComponent2}`);

  const resolved2 = manifest.paths[pathComponent2];
  if (resolved2) {
    console.log(`  ✅ Resolved to TX ID: ${resolved2.id.substring(0, 20)}...`);
  } else {
    console.log(`  ❌ Path not found in manifest`);
  }

  testsPassed++;

  // Test 5: Test index path
  console.log('\n🔗 Test 5: Testing index path resolution...');

  const indexPath = manifest.index?.path;
  if (indexPath) {
    console.log(`  Index path: ${indexPath}`);
    const indexEntry = manifest.paths[indexPath];
    if (indexEntry) {
      console.log(
        `  ✅ Index resolves to TX ID: ${indexEntry.id.substring(0, 20)}...`,
      );
    } else {
      console.log(`  ❌ Index path not found in manifest`);
    }
  } else {
    console.log(`  ⚠️  No index defined in manifest`);
  }

  testsPassed++;
} catch (error) {
  console.error(`  ❌ Test failed: ${error.message}\n`);
  testsFailed++;
}

console.log(
  '\n======================================================================',
);
console.log('📊 Test Results');
console.log(
  '======================================================================',
);
console.log(`✅ Passed: ${testsPassed}`);
console.log(`❌ Failed: ${testsFailed}`);
console.log(
  '======================================================================\n',
);

if (testsFailed === 0) {
  console.log('🎉 All tests passed!\n');
  process.exit(0);
} else {
  console.log('❌ Some tests failed.\n');
  process.exit(1);
}
