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
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { after, before, describe, it } from 'node:test';
import { Packr } from 'msgpackr';

import { fromB64Url, toB64Url } from '../utils/base64.js';
import {
  CDB64RootTransactionSource,
  Cdb64Reader,
  Cdb64Writer,
  cdb64Hash,
  decodeCdb64Value,
} from './cdb64.js';

const packr = new Packr({ useRecords: false });

function encodeCdb64Value(value: {
  rootTxId: Buffer;
  rootDataItemOffset?: number;
  rootDataOffset?: number;
}): Buffer {
  const obj: Record<string, unknown> = { r: value.rootTxId };
  if (
    value.rootDataItemOffset !== undefined &&
    value.rootDataOffset !== undefined
  ) {
    obj.i = value.rootDataItemOffset;
    obj.d = value.rootDataOffset;
  }
  return Buffer.from(packr.pack(obj));
}

describe('cdb64Hash', () => {
  it('should produce consistent hash for the same input', () => {
    const key = Buffer.from('test-key');
    const hash1 = cdb64Hash(key);
    const hash2 = cdb64Hash(key);
    assert.equal(hash1, hash2);
  });

  it('should produce 5381 for empty input', () => {
    const hash = cdb64Hash(Buffer.alloc(0));
    assert.equal(hash, 5381n);
  });

  it('should produce different hashes for different inputs', () => {
    const hash1 = cdb64Hash(Buffer.from('key1'));
    const hash2 = cdb64Hash(Buffer.from('key2'));
    assert.notEqual(hash1, hash2);
  });

  it('should work with Uint8Array input', () => {
    const buf = Buffer.from('test');
    const uint8 = new Uint8Array(buf);
    assert.equal(cdb64Hash(buf), cdb64Hash(uint8));
  });
});

describe('Cdb64Reader', () => {
  const testDir = path.join(tmpdir(), `cdb64-test-${Date.now()}`);

  before(async () => {
    await fs.mkdir(testDir, { recursive: true });
  });

  after(async () => {
    await fs.rm(testDir, { recursive: true, force: true });
  });

  it('should find a value in a single-entry CDB64 file', async () => {
    const filePath = path.join(testDir, 'single.cdb');
    const key = Buffer.from('hello');
    const value = Buffer.from('world');

    const writer = new Cdb64Writer(filePath);
    await writer.open();
    await writer.add(key, value);
    await writer.finalize();

    const reader = new Cdb64Reader(filePath);
    await reader.open();
    assert.equal(reader.isOpen(), true);

    const result = await reader.get(key);
    assert.ok(result);
    assert.equal(result.toString(), 'world');

    await reader.close();
    assert.equal(reader.isOpen(), false);
  });

  it('should find values in a multi-entry CDB64 file', async () => {
    const filePath = path.join(testDir, 'multi.cdb');
    const entries = [
      { key: Buffer.from('key1'), value: Buffer.from('value1') },
      { key: Buffer.from('key2'), value: Buffer.from('value2') },
      { key: Buffer.from('key3'), value: Buffer.from('value3') },
      { key: Buffer.from('another-key'), value: Buffer.from('another-value') },
    ];

    const writer = new Cdb64Writer(filePath);
    await writer.open();
    for (const entry of entries) {
      await writer.add(entry.key, entry.value);
    }
    await writer.finalize();

    const reader = new Cdb64Reader(filePath);
    await reader.open();

    for (const entry of entries) {
      const result = await reader.get(entry.key);
      assert.ok(result, `Expected to find key: ${entry.key.toString()}`);
      assert.equal(result.toString(), entry.value.toString());
    }

    await reader.close();
  });

  it('should return undefined for a missing key', async () => {
    const filePath = path.join(testDir, 'missing.cdb');

    const writer = new Cdb64Writer(filePath);
    await writer.open();
    await writer.add(Buffer.from('exists'), Buffer.from('yes'));
    await writer.finalize();

    const reader = new Cdb64Reader(filePath);
    await reader.open();

    const result = await reader.get(Buffer.from('does-not-exist'));
    assert.equal(result, undefined);

    await reader.close();
  });

  it('should throw if not opened', async () => {
    const reader = new Cdb64Reader('/nonexistent');
    await assert.rejects(
      async () => reader.get(Buffer.from('key')),
      /Reader not opened/,
    );
  });

  it('should handle 32-byte binary keys (like transaction IDs)', async () => {
    const filePath = path.join(testDir, 'binary-keys.cdb');
    const key1 = Buffer.alloc(32, 0xaa);
    const key2 = Buffer.alloc(32, 0xbb);
    const value1 = Buffer.from('tx-data-1');
    const value2 = Buffer.from('tx-data-2');

    const writer = new Cdb64Writer(filePath);
    await writer.open();
    await writer.add(key1, value1);
    await writer.add(key2, value2);
    await writer.finalize();

    const reader = new Cdb64Reader(filePath);
    await reader.open();

    const result1 = await reader.get(key1);
    assert.ok(result1);
    assert.equal(result1.toString(), 'tx-data-1');

    const result2 = await reader.get(key2);
    assert.ok(result2);
    assert.equal(result2.toString(), 'tx-data-2');

    const missing = await reader.get(Buffer.alloc(32, 0xcc));
    assert.equal(missing, undefined);

    await reader.close();
  });
});

describe('decodeCdb64Value', () => {
  it('should decode simple format (rootTxId only)', () => {
    const rootTxId = Buffer.alloc(32, 0x42);
    const encoded = encodeCdb64Value({ rootTxId });

    const decoded = decodeCdb64Value(encoded);
    assert.ok(Buffer.from(decoded.rootTxId).equals(rootTxId));
    assert.equal(decoded.rootDataItemOffset, undefined);
    assert.equal(decoded.rootDataOffset, undefined);
  });

  it('should decode complete format (rootTxId + offsets)', () => {
    const rootTxId = Buffer.alloc(32, 0x42);
    const encoded = encodeCdb64Value({
      rootTxId,
      rootDataItemOffset: 1024,
      rootDataOffset: 2048,
    });

    const decoded = decodeCdb64Value(encoded);
    assert.ok(Buffer.from(decoded.rootTxId).equals(rootTxId));
    assert.equal(decoded.rootDataItemOffset, 1024);
    assert.equal(decoded.rootDataOffset, 2048);
  });

  it('should throw on invalid data (not an object)', () => {
    const encoded = Buffer.from(packr.pack('not-an-object'));
    assert.throws(() => decodeCdb64Value(encoded), /not an object/);
  });

  it('should throw on missing rootTxId', () => {
    const encoded = Buffer.from(packr.pack({ x: 'wrong' }));
    assert.throws(
      () => decodeCdb64Value(encoded),
      /missing or invalid rootTxId/,
    );
  });

  it('should throw on wrong rootTxId length', () => {
    const encoded = Buffer.from(packr.pack({ r: Buffer.alloc(16) }));
    assert.throws(() => decodeCdb64Value(encoded), /rootTxId must be 32 bytes/);
  });

  it('should throw on invalid rootDataItemOffset', () => {
    const encoded = Buffer.from(
      packr.pack({ r: Buffer.alloc(32), i: -1, d: 100 }),
    );
    assert.throws(
      () => decodeCdb64Value(encoded),
      /invalid rootDataItemOffset/,
    );
  });

  it('should throw on invalid rootDataOffset', () => {
    const encoded = Buffer.from(
      packr.pack({ r: Buffer.alloc(32), i: 100, d: 'not-a-number' }),
    );
    assert.throws(() => decodeCdb64Value(encoded), /invalid rootDataOffset/);
  });
});

describe('CDB64RootTransactionSource', () => {
  const testDir = path.join(tmpdir(), `cdb64-source-test-${Date.now()}`);
  const cacheDir = path.join(testDir, 'cache');

  // Use raw bytes to avoid base64url round-trip issues with trailing bits
  const dataItemIdBytes = Buffer.alloc(32, 0xaa);
  const rootTxIdBytes = Buffer.alloc(32, 0xbb);
  const dataItemId = toB64Url(dataItemIdBytes);
  const rootTxId = toB64Url(rootTxIdBytes);

  let cdb64FilePath: string;
  let cdb64FileData: Buffer;

  before(async () => {
    await fs.mkdir(testDir, { recursive: true });

    // Build a CDB64 file with a known entry
    cdb64FilePath = path.join(testDir, 'test.cdb');
    const value = encodeCdb64Value({
      rootTxId: rootTxIdBytes,
      rootDataItemOffset: 512,
      rootDataOffset: 1024,
    });

    const writer = new Cdb64Writer(cdb64FilePath);
    await writer.open();
    await writer.add(dataItemIdBytes, value);
    await writer.finalize();

    cdb64FileData = await fs.readFile(cdb64FilePath);
  });

  after(async () => {
    await fs.rm(testDir, { recursive: true, force: true });
  });

  function createMockFetch(data: Buffer): typeof globalThis.fetch {
    return (async () => {
      return new Response(data, { status: 200 });
    }) as unknown as typeof globalThis.fetch;
  }

  const mockLogger = {
    debug: () => {
      /* no-op for testing */
    },
    info: () => {
      /* no-op for testing */
    },
    warn: () => {
      /* no-op for testing */
    },
    error: () => {
      /* no-op for testing */
    },
  };

  it('should return correct rootTransactionId, rootDataItemOffset, rootDataOffset', async () => {
    const source = new CDB64RootTransactionSource({
      cdb64Urls: ['https://example.com/test.cdb'],
      fetch: createMockFetch(cdb64FileData),
      cacheDir,
      logger: mockLogger,
    });

    const result = await source.getRootTransaction({ txId: dataItemId });
    assert.equal(result.rootTransactionId, rootTxId);
    assert.equal(result.rootDataItemOffset, 512);
    assert.equal(result.rootDataOffset, 1024);
    assert.equal(result.isDataItem, true);

    await source.close();
  });

  it('should throw when txId not found', async () => {
    const source = new CDB64RootTransactionSource({
      cdb64Urls: ['https://example.com/test.cdb'],
      fetch: createMockFetch(cdb64FileData),
      cacheDir: path.join(testDir, 'cache-miss'),
      logger: mockLogger,
    });

    const unknownTxId = toB64Url(Buffer.alloc(32, 0xcc));
    await assert.rejects(
      async () => source.getRootTransaction({ txId: unknownTxId }),
      /Transaction not found in any CDB64 file/,
    );

    await source.close();
  });

  it('should handle download failures gracefully', async () => {
    const failFetch = (async () => {
      return new Response(null, { status: 500 });
    }) as unknown as typeof globalThis.fetch;

    const source = new CDB64RootTransactionSource({
      cdb64Urls: ['https://example.com/broken.cdb'],
      fetch: failFetch,
      cacheDir: path.join(testDir, 'cache-fail'),
      logger: mockLogger,
    });

    await assert.rejects(
      async () => source.getRootTransaction({ txId: dataItemId }),
      /Transaction not found in any CDB64 file/,
    );

    await source.close();
  });

  it('should use cached files on subsequent lookups', async () => {
    let fetchCount = 0;
    const countingFetch = (async () => {
      fetchCount++;
      return new Response(cdb64FileData, { status: 200 });
    }) as unknown as typeof globalThis.fetch;

    const source = new CDB64RootTransactionSource({
      cdb64Urls: ['https://example.com/test.cdb'],
      fetch: countingFetch,
      cacheDir: path.join(testDir, 'cache-reuse'),
      cacheTtlMs: 60_000,
      logger: mockLogger,
    });

    await source.getRootTransaction({ txId: dataItemId });
    assert.equal(fetchCount, 1);

    await source.getRootTransaction({ txId: dataItemId });
    assert.equal(fetchCount, 1); // Should use cache, not re-download

    await source.close();
  });
});
