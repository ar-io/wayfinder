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

import assert from 'node:assert';
import { describe, it } from 'node:test';
import { ManifestVerificationCache } from './verification-cache.js';

describe('ManifestVerificationCache', () => {
  describe('set and get', () => {
    it('should store and retrieve verification results', () => {
      const cache = new ManifestVerificationCache();

      cache.set({
        txId: 'tx-123',
        hash: 'hash-abc',
        verified: true,
      });

      const result = cache.get({ txId: 'tx-123', hash: 'hash-abc' });
      assert.ok(result);
      assert.strictEqual(result.txId, 'tx-123');
      assert.strictEqual(result.hash, 'hash-abc');
      assert.strictEqual(result.verified, true);
      assert.strictEqual(result.error, undefined);
    });

    it('should store verification with error', () => {
      const cache = new ManifestVerificationCache();
      const error = new Error('Verification failed');

      cache.set({
        txId: 'tx-456',
        verified: false,
        error,
      });

      const result = cache.get({ txId: 'tx-456' });
      assert.ok(result);
      assert.strictEqual(result.verified, false);
      assert.strictEqual(result.error, error);
    });

    it('should return null for non-existent entry', () => {
      const cache = new ManifestVerificationCache();
      const result = cache.get({ txId: 'nonexistent' });
      assert.strictEqual(result, null);
    });

    it('should support lookup without hash', () => {
      const cache = new ManifestVerificationCache();

      cache.set({
        txId: 'tx-789',
        verified: true,
      });

      const result = cache.get({ txId: 'tx-789' });
      assert.ok(result);
      assert.strictEqual(result.txId, 'tx-789');
      assert.strictEqual(result.verified, true);
    });

    it('should differentiate between same txId with different hashes', () => {
      const cache = new ManifestVerificationCache();

      cache.set({
        txId: 'tx-same',
        hash: 'hash-1',
        verified: true,
      });

      cache.set({
        txId: 'tx-same',
        hash: 'hash-2',
        verified: false,
      });

      const result1 = cache.get({ txId: 'tx-same', hash: 'hash-1' });
      const result2 = cache.get({ txId: 'tx-same', hash: 'hash-2' });

      assert.ok(result1);
      assert.ok(result2);
      assert.strictEqual(result1.verified, true);
      assert.strictEqual(result2.verified, false);
    });
  });

  describe('TTL (time-to-live)', () => {
    it('should expire entries after TTL', async () => {
      const cache = new ManifestVerificationCache({ ttlMs: 50 }); // 50ms TTL

      cache.set({
        txId: 'tx-expire',
        verified: true,
      });

      // Should exist initially
      assert.ok(cache.get({ txId: 'tx-expire' }));

      // Wait for expiration
      await new Promise((resolve) => setTimeout(resolve, 60));

      // Should be expired now
      assert.strictEqual(cache.get({ txId: 'tx-expire' }), null);
    });

    it('should not expire entries before TTL', async () => {
      const cache = new ManifestVerificationCache({ ttlMs: 1000 }); // 1 second TTL

      cache.set({
        txId: 'tx-valid',
        verified: true,
      });

      // Wait a bit but not until expiration
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Should still exist
      assert.ok(cache.get({ txId: 'tx-valid' }));
    });
  });

  describe('has', () => {
    it('should return true for existing entries', () => {
      const cache = new ManifestVerificationCache();

      cache.set({
        txId: 'tx-exists',
        verified: true,
      });

      assert.strictEqual(cache.has({ txId: 'tx-exists' }), true);
    });

    it('should return false for non-existent entries', () => {
      const cache = new ManifestVerificationCache();
      assert.strictEqual(cache.has({ txId: 'nonexistent' }), false);
    });

    it('should return false for expired entries', async () => {
      const cache = new ManifestVerificationCache({ ttlMs: 50 });

      cache.set({
        txId: 'tx-expire',
        verified: true,
      });

      await new Promise((resolve) => setTimeout(resolve, 60));

      assert.strictEqual(cache.has({ txId: 'tx-expire' }), false);
    });
  });

  describe('delete', () => {
    it('should remove entry from cache', () => {
      const cache = new ManifestVerificationCache();

      cache.set({
        txId: 'tx-delete',
        verified: true,
      });

      assert.ok(cache.has({ txId: 'tx-delete' }));

      cache.delete({ txId: 'tx-delete' });

      assert.strictEqual(cache.has({ txId: 'tx-delete' }), false);
    });

    it('should handle deleting non-existent entry', () => {
      const cache = new ManifestVerificationCache();
      // Should not throw
      cache.delete({ txId: 'nonexistent' });
    });
  });

  describe('clear', () => {
    it('should remove all entries', () => {
      const cache = new ManifestVerificationCache();

      cache.set({ txId: 'tx-1', verified: true });
      cache.set({ txId: 'tx-2', verified: true });
      cache.set({ txId: 'tx-3', verified: true });

      assert.strictEqual(cache.size, 3);

      cache.clear();

      assert.strictEqual(cache.size, 0);
      assert.strictEqual(cache.has({ txId: 'tx-1' }), false);
      assert.strictEqual(cache.has({ txId: 'tx-2' }), false);
      assert.strictEqual(cache.has({ txId: 'tx-3' }), false);
    });
  });

  describe('prune', () => {
    it('should remove expired entries', async () => {
      const cache = new ManifestVerificationCache({ ttlMs: 100 });

      // Add first entry
      cache.set({ txId: 'tx-expire', verified: true });

      // Wait a bit before adding second entry
      await new Promise((resolve) => setTimeout(resolve, 60));

      // Add second and third entries (these should not expire)
      cache.set({ txId: 'tx-valid', verified: true });
      cache.set({ txId: 'tx-valid-2', verified: true });

      // Wait for first entry to expire (60ms elapsed + 50ms = 110ms, which > 100ms)
      await new Promise((resolve) => setTimeout(resolve, 50));

      // Cache should have 3 entries (1 expired, 2 valid)
      assert.strictEqual(cache.size, 3);

      // Prune expired entries
      const removed = cache.prune();

      assert.strictEqual(removed, 1);
      assert.strictEqual(cache.size, 2);
      assert.strictEqual(cache.has({ txId: 'tx-expire' }), false);
      assert.strictEqual(cache.has({ txId: 'tx-valid' }), true);
      assert.strictEqual(cache.has({ txId: 'tx-valid-2' }), true);
    });

    it('should return 0 when no entries are expired', () => {
      const cache = new ManifestVerificationCache({ ttlMs: 10000 });

      cache.set({ txId: 'tx-1', verified: true });
      cache.set({ txId: 'tx-2', verified: true });

      const removed = cache.prune();
      assert.strictEqual(removed, 0);
      assert.strictEqual(cache.size, 2);
    });
  });

  describe('getStats', () => {
    it('should return accurate statistics', async () => {
      const cache = new ManifestVerificationCache({ ttlMs: 50 });

      cache.set({ txId: 'tx-1', verified: true });
      cache.set({ txId: 'tx-2', verified: true });

      // Wait for first two to expire
      await new Promise((resolve) => setTimeout(resolve, 60));

      // Add more entries
      cache.set({ txId: 'tx-3', verified: true });
      cache.set({ txId: 'tx-4', verified: true });

      const stats = cache.getStats();

      assert.strictEqual(stats.size, 4);
      assert.strictEqual(stats.expired, 2);
      assert.strictEqual(stats.valid, 2);
    });

    it('should return zeros for empty cache', () => {
      const cache = new ManifestVerificationCache();
      const stats = cache.getStats();

      assert.strictEqual(stats.size, 0);
      assert.strictEqual(stats.expired, 0);
      assert.strictEqual(stats.valid, 0);
    });
  });
});
