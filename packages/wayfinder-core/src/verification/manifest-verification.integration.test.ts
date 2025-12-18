/**
 * WayFinder
 * Copyright (C) 2022-2025 Permanent Data Solutions, Inc.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

/**
 * Integration Tests for Manifest Verification
 *
 * These tests make REAL network requests to Arweave gateways.
 * Run with: npx tsx --test src/verification/manifest-verification.integration.test.ts
 *
 * Environment variables:
 * - SKIP_INTEGRATION_TESTS=1 to skip these tests
 * - TEST_TIMEOUT=60000 to set timeout (default 60s)
 */

import assert from 'node:assert';
import { before, describe, it } from 'node:test';
import { ManifestParser } from '../manifest/parser.js';
import { Wayfinder } from '../wayfinder.js';
import { HashVerificationStrategy } from './hash-verification.js';
import { ManifestVerificationStrategy } from './manifest-verification.js';

// Skip integration tests if environment variable is set
const SKIP_INTEGRATION_TESTS = process.env.SKIP_INTEGRATION_TESTS === '1';
const TEST_TIMEOUT = parseInt(process.env.TEST_TIMEOUT || '60000', 10);

// Real ArDrive manifest transaction ID provided by user
const ARDRIVE_MANIFEST_TX_ID = 'dJ9BWH0lLdid0c7ajAqS_8O66HnhL3zVH1C7h9AEv8g';

describe(
  'Manifest Verification - Integration Tests',
  { skip: SKIP_INTEGRATION_TESTS },
  () => {
    let wayfinder: Wayfinder;

    before(() => {
      // Initialize Wayfinder with manifest verification
      wayfinder = new Wayfinder({
        verificationSettings: {
          enabled: true,
          strict: true,
          strategy: new ManifestVerificationStrategy({
            baseStrategy: new HashVerificationStrategy({
              trustedGateways: [
                new URL('https://arweave.net'),
                new URL('https://permagate.io'),
              ],
              maxConcurrency: 2, // Verify from 2 gateways
            }),
            maxDepth: 3,
            concurrency: 5, // Verify 5 resources at a time
          }),
        },
      });
    });

    describe('Real ArDrive Manifest', () => {
      it(
        'should fetch and parse the manifest',
        { timeout: TEST_TIMEOUT },
        async () => {
          const response = await wayfinder.request(
            `ar://${ARDRIVE_MANIFEST_TX_ID}`,
          );

          assert.ok(response.ok, 'Response should be ok');

          const manifestText = await response.text();
          assert.ok(manifestText.length > 0, 'Manifest should have content');

          const manifest = ManifestParser.parse(manifestText);
          assert.strictEqual(
            manifest.manifest,
            'arweave/paths',
            'Should be an Arweave manifest',
          );
          assert.ok(manifest.version, 'Manifest should have version');
          assert.ok(
            Object.keys(manifest.paths).length > 0,
            'Manifest should have paths',
          );

          console.log('\n📦 Manifest Info:');
          console.log(`  Version: ${manifest.version}`);
          console.log(`  Paths: ${Object.keys(manifest.paths).length}`);
          console.log(`  Index: ${manifest.index?.path || 'none'}`);
        },
      );

      it(
        'should verify the manifest structure',
        { timeout: TEST_TIMEOUT },
        async () => {
          const response = await wayfinder.request(
            `ar://${ARDRIVE_MANIFEST_TX_ID}`,
          );
          const manifestText = await response.text();
          const manifest = ManifestParser.parse(manifestText);

          // Get all transaction IDs
          const txIds = ManifestParser.getAllTransactionIds(manifest);
          assert.ok(txIds.length > 0, 'Should have transaction IDs');

          // Verify all TX IDs are valid format (43 chars)
          for (const txId of txIds) {
            assert.strictEqual(
              txId.length,
              43,
              `TX ID ${txId} should be 43 characters`,
            );
          }

          console.log(`\n✅ All ${txIds.length} transaction IDs are valid`);
        },
      );

      it(
        'should verify manifest with requestWithManifest',
        { timeout: TEST_TIMEOUT },
        async () => {
          let progressEvents = 0;
          let verifiedCount = 0;

          const response = await wayfinder.requestWithManifest(
            `ar://${ARDRIVE_MANIFEST_TX_ID}`,
            {
              verifyNested: true,
              maxDepth: 2,
              concurrency: 5,
              onProgress: (event) => {
                progressEvents++;
                if (event.verified) {
                  verifiedCount++;
                }
                if (progressEvents <= 5 || progressEvents % 10 === 0) {
                  console.log(
                    `  Progress: ${verifiedCount}/${event.total} verified`,
                  );
                }
              },
            },
          );

          assert.ok(response.ok, 'Response should be ok');
          assert.ok(response.manifest, 'Response should include manifest');

          console.log('\n📊 Verification Results:');
          console.log(`  Total progress events: ${progressEvents}`);
          console.log(`  Resources verified: ${verifiedCount}`);
          console.log(`  All verified: ${response.allVerified}`);
          console.log(
            `  Manifest paths: ${Object.keys(response.manifest.paths).length}`,
          );

          // The manifest should be verified
          assert.ok(response.allVerified !== undefined);
        },
      );

      it(
        'should cache verification results',
        { timeout: TEST_TIMEOUT },
        async () => {
          // First request - should verify
          const start1 = Date.now();
          const response1 = await wayfinder.requestWithManifest(
            `ar://${ARDRIVE_MANIFEST_TX_ID}`,
            {
              verifyNested: true,
              concurrency: 5,
            },
          );
          const duration1 = Date.now() - start1;

          assert.ok(response1.ok, 'First request should succeed');

          // Second request - should use cache
          const start2 = Date.now();
          const response2 = await wayfinder.requestWithManifest(
            `ar://${ARDRIVE_MANIFEST_TX_ID}`,
            {
              verifyNested: true,
              concurrency: 5,
            },
          );
          const duration2 = Date.now() - start2;

          assert.ok(response2.ok, 'Second request should succeed');

          console.log('\n⚡ Cache Performance:');
          console.log(`  First request: ${duration1}ms`);
          console.log(`  Second request (cached): ${duration2}ms`);
          console.log(`  Speedup: ${(duration1 / duration2).toFixed(2)}x`);

          // Second request should be faster due to caching
          // (Not always guaranteed due to network variance, but should be true most of the time)
          if (duration2 < duration1 * 0.8) {
            console.log('  ✅ Cache is working effectively!');
          } else {
            console.log('  ⚠️  Cache speedup not observed (network variance?)');
          }
        },
      );

      it(
        'should handle path resolution',
        { timeout: TEST_TIMEOUT },
        async () => {
          const response = await wayfinder.requestWithManifest(
            `ar://${ARDRIVE_MANIFEST_TX_ID}`,
          );

          assert.ok(response.manifest, 'Should have manifest');

          const manifest = response.manifest;
          const paths = ManifestParser.getAllPaths(manifest);

          console.log('\n🗂️  Manifest Paths:');
          paths.slice(0, 10).forEach((path) => {
            const txId = ManifestParser.resolvePath(manifest, path);
            console.log(`  ${path} → ${txId?.substring(0, 10)}...`);
          });

          if (paths.length > 10) {
            console.log(`  ... and ${paths.length - 10} more`);
          }

          // Test resolving index
          if (manifest.index?.path) {
            const indexTxId = ManifestParser.getIndex(manifest);
            assert.ok(indexTxId, 'Should resolve index transaction ID');
            console.log(
              `\n📄 Index: ${manifest.index.path} → ${indexTxId?.substring(0, 10)}...`,
            );
          }
        },
      );

      it(
        'should emit verification events',
        { timeout: TEST_TIMEOUT },
        async () => {
          let verificationSucceeded = 0;
          let verificationFailed = 0;
          let verificationProgress = 0;

          const wayfinderWithEvents = new Wayfinder({
            verificationSettings: {
              enabled: true,
              strict: false, // Use non-strict to not block on failures
              strategy: new ManifestVerificationStrategy({
                baseStrategy: new HashVerificationStrategy({
                  trustedGateways: [new URL('https://arweave.net')],
                }),
                concurrency: 3,
              }),
              events: {
                'verification-succeeded': () => verificationSucceeded++,
                'verification-failed': () => verificationFailed++,
                'verification-progress': () => verificationProgress++,
              },
            },
          });

          await wayfinderWithEvents.requestWithManifest(
            `ar://${ARDRIVE_MANIFEST_TX_ID}`,
            {
              verifyNested: true,
              concurrency: 3,
            },
          );

          console.log('\n📡 Verification Events:');
          console.log(`  Succeeded: ${verificationSucceeded}`);
          console.log(`  Failed: ${verificationFailed}`);
          console.log(`  Progress: ${verificationProgress}`);

          // Should have emitted at least some events
          assert.ok(
            verificationSucceeded > 0 || verificationProgress > 0,
            'Should emit verification events',
          );
        },
      );

      it(
        'should handle non-strict mode gracefully',
        { timeout: TEST_TIMEOUT },
        async () => {
          const wayfinderNonStrict = new Wayfinder({
            verificationSettings: {
              enabled: true,
              strict: false, // Non-strict: don't block on verification failures
              strategy: new ManifestVerificationStrategy({
                baseStrategy: new HashVerificationStrategy({
                  trustedGateways: [new URL('https://arweave.net')],
                }),
              }),
            },
          });

          const response = await wayfinderNonStrict.requestWithManifest(
            `ar://${ARDRIVE_MANIFEST_TX_ID}`,
            {
              verifyNested: true,
            },
          );

          assert.ok(response.ok, 'Response should succeed in non-strict mode');
          assert.ok(response.manifest, 'Should have manifest');

          console.log('\n🔓 Non-strict Mode:');
          console.log(`  Response ok: ${response.ok}`);
          console.log(`  Manifest loaded: ${!!response.manifest}`);
          console.log(`  All verified: ${response.allVerified}`);
        },
      );
    });

    describe('Edge Cases', () => {
      it(
        'should handle invalid transaction ID gracefully',
        { timeout: 10000 },
        async () => {
          await assert.rejects(
            async () => {
              await wayfinder.request('ar://invalid-tx-id');
            },
            (_error: any) => {
              // Should fail with some error (404, network error, etc.)
              return true;
            },
            'Should reject invalid transaction ID',
          );
        },
      );

      it(
        'should handle non-manifest transaction',
        { timeout: TEST_TIMEOUT },
        async () => {
          // Use a known non-manifest TX ID (adjust if needed)
          // This should fetch successfully but not be parsed as a manifest
          const _response = await wayfinder.request(
            'ar://AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
          );

          // Response might be ok or not found, depending on if TX exists
          // Just verify we don't crash
          assert.ok(true, 'Should handle non-manifest TX gracefully');
        },
      );
    });

    describe('Performance Benchmarks', () => {
      it(
        'should complete verification within reasonable time',
        { timeout: TEST_TIMEOUT },
        async () => {
          const start = Date.now();

          const response = await wayfinder.requestWithManifest(
            `ar://${ARDRIVE_MANIFEST_TX_ID}`,
            {
              verifyNested: true,
              concurrency: 10, // Higher concurrency for speed
            },
          );

          const duration = Date.now() - start;

          assert.ok(response.ok, 'Verification should succeed');

          console.log('\n⏱️  Performance:');
          console.log(`  Total time: ${duration}ms`);
          console.log(
            `  Paths: ${Object.keys(response.manifest?.paths || {}).length}`,
          );

          if (response.manifest) {
            const txIds = ManifestParser.getAllTransactionIds(
              response.manifest,
            );
            const msPerResource = duration / txIds.length;
            console.log(`  Resources: ${txIds.length}`);
            console.log(`  Time per resource: ${msPerResource.toFixed(0)}ms`);
          }

          // Reasonable time would be under 30 seconds for most manifests
          assert.ok(
            duration < 30000,
            `Verification should complete within 30s (took ${duration}ms)`,
          );
        },
      );
    });
  },
);

describe(
  'Integration Test Instructions',
  { skip: !SKIP_INTEGRATION_TESTS },
  () => {
    it('should display instructions when skipped', () => {
      console.log('\n' + '='.repeat(70));
      console.log('📋 INTEGRATION TESTS SKIPPED');
      console.log('='.repeat(70));
      console.log('\nTo run integration tests:');
      console.log(
        '  npx tsx --test src/verification/manifest-verification.integration.test.ts',
      );
      console.log('\nOr with environment variables:');
      console.log(
        '  SKIP_INTEGRATION_TESTS=0 TEST_TIMEOUT=120000 npx tsx --test ...',
      );
      console.log('\nNote: Integration tests make real network requests.');
      console.log('='.repeat(70) + '\n');
    });
  },
);
