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
import { describe, it } from 'node:test';
import { Packr } from 'msgpackr';

import { toB64Url } from '../utils/base64.js';
import {
  type ByteRangeSource,
  CDB64RootTransactionSource,
  type Cdb64Manifest,
  Cdb64Reader,
  HttpByteRangeSource,
  PartitionedCdb64Reader,
  cdb64Hash,
  decodeCdb64Value,
  writeUint64LE,
} from './cdb64.js';

const packr = new Packr({ useRecords: false });
const encoder = new TextEncoder();

// ---------------------------------------------------------------------------
// Test helpers — in-memory CDB64 builder (replaces Cdb64Writer for tests)
// ---------------------------------------------------------------------------

const HEADER_SIZE = 4096;
const POINTER_SIZE = 16;
const SLOT_SIZE = 16;
const NUM_TABLES = 256;

/** Build a CDB64 image in memory from key-value pairs. */
function buildCdb64(
  entries: { key: Uint8Array; value: Uint8Array }[],
): Uint8Array {
  // Phase 1: build records section
  const recordChunks: Uint8Array[] = [];
  const recordEntries: {
    hash: bigint;
    position: bigint;
    tableIndex: number;
  }[] = [];
  let position = BigInt(HEADER_SIZE);

  for (const { key, value } of entries) {
    const hash = cdb64Hash(key);
    const tableIndex = Number(hash % BigInt(NUM_TABLES));
    recordEntries.push({ hash, position, tableIndex });

    const header = new Uint8Array(16);
    writeUint64LE(header, 0, BigInt(key.length));
    writeUint64LE(header, 8, BigInt(value.length));

    recordChunks.push(header, key, value);
    position += BigInt(16 + key.length + value.length);
  }

  // Phase 2: build hash tables
  const tableChunks: Uint8Array[] = [];
  const tablePointers: { position: bigint; length: bigint }[] = [];
  const tableRecords: { hash: bigint; position: bigint }[][] = [];
  for (let i = 0; i < NUM_TABLES; i++) {
    tableRecords[i] = [];
  }
  for (const entry of recordEntries) {
    tableRecords[entry.tableIndex].push({
      hash: entry.hash,
      position: entry.position,
    });
  }

  for (let i = 0; i < NUM_TABLES; i++) {
    const records = tableRecords[i];
    const tableLength = records.length === 0 ? 0 : records.length * 2;

    tablePointers.push({ position, length: BigInt(tableLength) });
    if (tableLength === 0) continue;

    const slots: { hash: bigint; position: bigint }[] = new Array(tableLength);
    for (let j = 0; j < tableLength; j++) {
      slots[j] = { hash: 0n, position: 0n };
    }

    for (const record of records) {
      let slot = Number(
        (record.hash / BigInt(NUM_TABLES)) % BigInt(tableLength),
      );
      while (slots[slot].position !== 0n) {
        slot = (slot + 1) % tableLength;
      }
      slots[slot] = { hash: record.hash, position: record.position };
    }

    const tableData = new Uint8Array(tableLength * SLOT_SIZE);
    for (let j = 0; j < tableLength; j++) {
      const offset = j * SLOT_SIZE;
      writeUint64LE(tableData, offset, slots[j].hash);
      writeUint64LE(tableData, offset + 8, slots[j].position);
    }

    tableChunks.push(tableData);
    position += BigInt(tableLength * SLOT_SIZE);
  }

  // Phase 3: build header
  const header = new Uint8Array(HEADER_SIZE);
  for (let i = 0; i < NUM_TABLES; i++) {
    const offset = i * POINTER_SIZE;
    writeUint64LE(header, offset, tablePointers[i].position);
    writeUint64LE(header, offset + 8, tablePointers[i].length);
  }

  // Phase 4: concatenate
  const totalSize = Number(position);
  const result = new Uint8Array(totalSize);
  result.set(header, 0);
  let writeOffset = HEADER_SIZE;
  for (const chunk of recordChunks) {
    result.set(chunk, writeOffset);
    writeOffset += chunk.length;
  }
  for (const chunk of tableChunks) {
    result.set(chunk, writeOffset);
    writeOffset += chunk.length;
  }

  return result;
}

/** Create a ByteRangeSource backed by an in-memory Uint8Array. */
function memorySource(data: Uint8Array): ByteRangeSource {
  let open = true;
  return {
    async read(offset: number, size: number): Promise<Uint8Array> {
      return new Uint8Array(data.buffer, data.byteOffset + offset, size);
    },
    async close(): Promise<void> {
      open = false;
    },
    isOpen(): boolean {
      return open;
    },
  };
}

/** Create a mock fetch that serves byte ranges from an in-memory buffer. */
function createRangeFetch(data: Uint8Array): typeof globalThis.fetch {
  return (async (_url: string, init?: RequestInit) => {
    const rangeHeader = (init?.headers as Record<string, string>)?.['Range'];
    const match = rangeHeader?.match(/bytes=(\d+)-(\d+)/);
    if (!match) throw new Error('Bad range header');
    const start = parseInt(match[1]);
    const end = parseInt(match[2]);
    const slice = data.subarray(start, end + 1);
    return new Response(
      slice.buffer.slice(slice.byteOffset, slice.byteOffset + slice.byteLength),
      { status: 206 },
    );
  }) as unknown as typeof globalThis.fetch;
}

/** Create a mock fetch routing URLs to different buffers. */
function createMultiRangeFetch(
  map: Record<string, Uint8Array>,
): typeof globalThis.fetch {
  return (async (url: string, init?: RequestInit) => {
    const data = map[url];
    if (!data) throw new Error(`Unknown URL: ${url}`);
    const rangeHeader = (init?.headers as Record<string, string>)?.['Range'];
    const match = rangeHeader?.match(/bytes=(\d+)-(\d+)/);
    if (!match) throw new Error('Bad range header');
    const start = parseInt(match[1]);
    const end = parseInt(match[2]);
    const slice = data.subarray(start, end + 1);
    return new Response(
      slice.buffer.slice(slice.byteOffset, slice.byteOffset + slice.byteLength),
      { status: 206 },
    );
  }) as unknown as typeof globalThis.fetch;
}

function encodeCdb64Value(value: {
  rootTxId: Uint8Array;
  rootDataItemOffset?: number;
  rootDataOffset?: number;
}): Uint8Array {
  const obj: Record<string, unknown> = { r: Buffer.from(value.rootTxId) };
  if (
    value.rootDataItemOffset !== undefined &&
    value.rootDataOffset !== undefined
  ) {
    obj.i = value.rootDataItemOffset;
    obj.d = value.rootDataOffset;
  }
  return new Uint8Array(packr.pack(obj));
}

const mockLogger = {
  debug: (..._args: unknown[]) => {
    /* no-op */
  },
  info: (..._args: unknown[]) => {
    /* no-op */
  },
  warn: (..._args: unknown[]) => {
    /* no-op */
  },
  error: (..._args: unknown[]) => {
    /* no-op */
  },
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('cdb64Hash', () => {
  it('should produce consistent hash for the same input', () => {
    const key = encoder.encode('test-key');
    const hash1 = cdb64Hash(key);
    const hash2 = cdb64Hash(key);
    assert.equal(hash1, hash2);
  });

  it('should produce 5381 for empty input', () => {
    const hash = cdb64Hash(new Uint8Array(0));
    assert.equal(hash, 5381n);
  });

  it('should produce different hashes for different inputs', () => {
    const hash1 = cdb64Hash(encoder.encode('key1'));
    const hash2 = cdb64Hash(encoder.encode('key2'));
    assert.notEqual(hash1, hash2);
  });

  it('should work with Uint8Array input', () => {
    const buf = encoder.encode('test');
    const uint8 = new Uint8Array(buf);
    assert.equal(cdb64Hash(buf), cdb64Hash(uint8));
  });
});

describe('Cdb64Reader', () => {
  it('should find a value in a single-entry CDB64', async () => {
    const key = encoder.encode('hello');
    const value = encoder.encode('world');
    const data = buildCdb64([{ key, value }]);

    const reader = Cdb64Reader.fromSource({ source: memorySource(data) });
    await reader.open();
    assert.equal(reader.isOpen(), true);

    const result = await reader.get(key);
    assert.ok(result);
    assert.ok(result instanceof Uint8Array);
    assert.deepEqual(result, encoder.encode('world'));

    await reader.close();
    assert.equal(reader.isOpen(), false);
  });

  it('should find values in a multi-entry CDB64', async () => {
    const entries = [
      { key: encoder.encode('key1'), value: encoder.encode('value1') },
      { key: encoder.encode('key2'), value: encoder.encode('value2') },
      { key: encoder.encode('key3'), value: encoder.encode('value3') },
      {
        key: encoder.encode('another-key'),
        value: encoder.encode('another-value'),
      },
    ];

    const data = buildCdb64(entries);
    const reader = Cdb64Reader.fromSource({ source: memorySource(data) });
    await reader.open();

    for (const entry of entries) {
      const result = await reader.get(entry.key);
      assert.ok(result);
      assert.deepEqual(result, entry.value);
    }

    await reader.close();
  });

  it('should return undefined for a missing key', async () => {
    const data = buildCdb64([
      { key: encoder.encode('exists'), value: encoder.encode('yes') },
    ]);
    const reader = Cdb64Reader.fromSource({ source: memorySource(data) });
    await reader.open();

    const result = await reader.get(encoder.encode('does-not-exist'));
    assert.equal(result, undefined);

    await reader.close();
  });

  it('should throw if not opened', async () => {
    const reader = Cdb64Reader.fromSource({
      source: memorySource(new Uint8Array(0)),
    });
    await assert.rejects(
      async () => reader.get(encoder.encode('key')),
      /Reader not opened/,
    );
  });

  it('should handle 32-byte binary keys (like transaction IDs)', async () => {
    const key1 = new Uint8Array(32).fill(0xaa);
    const key2 = new Uint8Array(32).fill(0xbb);
    const value1 = encoder.encode('tx-data-1');
    const value2 = encoder.encode('tx-data-2');

    const data = buildCdb64([
      { key: key1, value: value1 },
      { key: key2, value: value2 },
    ]);
    const reader = Cdb64Reader.fromSource({ source: memorySource(data) });
    await reader.open();

    const result1 = await reader.get(key1);
    assert.ok(result1);
    assert.deepEqual(result1, value1);

    const result2 = await reader.get(key2);
    assert.ok(result2);
    assert.deepEqual(result2, value2);

    const missing = await reader.get(new Uint8Array(32).fill(0xcc));
    assert.equal(missing, undefined);

    await reader.close();
  });

  it('should work with fromSource() and a mock ByteRangeSource', async () => {
    const key = encoder.encode('source-key');
    const value = encoder.encode('source-value');
    const data = buildCdb64([{ key, value }]);

    const reader = Cdb64Reader.fromSource({ source: memorySource(data) });
    await reader.open();
    assert.equal(reader.isOpen(), true);

    const result = await reader.get(key);
    assert.ok(result);
    assert.deepEqual(result, value);

    const missing = await reader.get(encoder.encode('nope'));
    assert.equal(missing, undefined);

    await reader.close();
  });
});

describe('decodeCdb64Value', () => {
  it('should decode simple format (rootTxId only)', () => {
    const rootTxId = new Uint8Array(32).fill(0x42);
    const encoded = encodeCdb64Value({ rootTxId });

    const decoded = decodeCdb64Value(encoded);
    assert.deepEqual(decoded.rootTxId, rootTxId);
    assert.equal(decoded.rootDataItemOffset, undefined);
    assert.equal(decoded.rootDataOffset, undefined);
  });

  it('should decode complete format (rootTxId + offsets)', () => {
    const rootTxId = new Uint8Array(32).fill(0x42);
    const encoded = encodeCdb64Value({
      rootTxId,
      rootDataItemOffset: 1024,
      rootDataOffset: 2048,
    });

    const decoded = decodeCdb64Value(encoded);
    assert.deepEqual(decoded.rootTxId, rootTxId);
    assert.equal(decoded.rootDataItemOffset, 1024);
    assert.equal(decoded.rootDataOffset, 2048);
  });

  it('should throw on invalid data (not an object)', () => {
    const encoded = new Uint8Array(packr.pack('not-an-object'));
    assert.throws(() => decodeCdb64Value(encoded), /not an object/);
  });

  it('should throw on missing rootTxId', () => {
    const encoded = new Uint8Array(packr.pack({ x: 'wrong' }));
    assert.throws(
      () => decodeCdb64Value(encoded),
      /missing or invalid rootTxId/,
    );
  });

  it('should throw on wrong rootTxId length', () => {
    const encoded = new Uint8Array(packr.pack({ r: Buffer.alloc(16) }));
    assert.throws(() => decodeCdb64Value(encoded), /rootTxId must be 32 bytes/);
  });

  it('should throw on invalid rootDataItemOffset', () => {
    const encoded = new Uint8Array(
      packr.pack({ r: Buffer.alloc(32), i: -1, d: 100 }),
    );
    assert.throws(
      () => decodeCdb64Value(encoded),
      /invalid rootDataItemOffset/,
    );
  });

  it('should throw on invalid rootDataOffset', () => {
    const encoded = new Uint8Array(
      packr.pack({ r: Buffer.alloc(32), i: 100, d: 'not-a-number' }),
    );
    assert.throws(() => decodeCdb64Value(encoded), /invalid rootDataOffset/);
  });
});

describe('HttpByteRangeSource', () => {
  it('should make correct Range requests and return data', async () => {
    const testData = new Uint8Array([10, 20, 30, 40, 50, 60, 70, 80]);
    let capturedHeaders: Record<string, string> = {};

    const mockFetch = (async (_url: string, init?: RequestInit) => {
      capturedHeaders = Object.fromEntries(
        Object.entries((init?.headers as Record<string, string>) ?? {}),
      );
      const rangeHeader = capturedHeaders['Range'];
      const match = rangeHeader.match(/bytes=(\d+)-(\d+)/);
      if (!match) throw new Error('Bad range header');
      const start = parseInt(match[1]);
      const end = parseInt(match[2]);
      const slice = testData.subarray(start, end + 1);
      return new Response(
        slice.buffer.slice(
          slice.byteOffset,
          slice.byteOffset + slice.byteLength,
        ),
        { status: 206 },
      );
    }) as unknown as typeof globalThis.fetch;

    const source = new HttpByteRangeSource({
      url: 'https://example.com/data.cdb',
      fetch: mockFetch,
    });

    assert.equal(source.isOpen(), true);

    const result = await source.read(2, 3);
    assert.deepEqual(result, new Uint8Array([30, 40, 50]));
    assert.equal(capturedHeaders['Range'], 'bytes=2-4');

    await source.close();
    assert.equal(source.isOpen(), false);

    await assert.rejects(
      async () => source.read(0, 1),
      /HttpByteRangeSource is closed/,
    );
  });

  it('should throw on non-206 response', async () => {
    const mockFetch = (async () => {
      return new Response(null, { status: 200 });
    }) as unknown as typeof globalThis.fetch;

    const source = new HttpByteRangeSource({
      url: 'https://example.com/data.cdb',
      fetch: mockFetch,
    });

    await assert.rejects(
      async () => source.read(0, 10),
      /Expected 206 Partial Content, got 200/,
    );
  });

  it('should throw on size mismatch', async () => {
    const mockFetch = (async () => {
      return new Response(new Uint8Array([1, 2, 3]), { status: 206 });
    }) as unknown as typeof globalThis.fetch;

    const source = new HttpByteRangeSource({
      url: 'https://example.com/data.cdb',
      fetch: mockFetch,
    });

    await assert.rejects(
      async () => source.read(0, 10),
      /Expected 10 bytes, got 3/,
    );
  });
});

describe('PartitionedCdb64Reader', () => {
  it('should route lookups to the correct partition by first byte of key', async () => {
    const keyAA = new Uint8Array(32).fill(0xaa);
    const valueAA = encoder.encode('value-aa');
    const keyBB = new Uint8Array(32).fill(0xbb);
    const valueBB = encoder.encode('value-bb');

    const dataAA = buildCdb64([{ key: keyAA, value: valueAA }]);
    const dataBB = buildCdb64([{ key: keyBB, value: valueBB }]);

    const mockFetch = createMultiRangeFetch({
      'https://example.com/partition-aa.cdb': dataAA,
      'https://example.com/partition-bb.cdb': dataBB,
    });

    const manifest: Cdb64Manifest = {
      version: 1,
      createdAt: new Date().toISOString(),
      totalRecords: 2,
      partitions: [
        {
          prefix: 'aa',
          location: {
            type: 'http',
            url: 'https://example.com/partition-aa.cdb',
          },
          recordCount: 1,
          size: 0,
        },
        {
          prefix: 'bb',
          location: {
            type: 'http',
            url: 'https://example.com/partition-bb.cdb',
          },
          recordCount: 1,
          size: 0,
        },
      ],
    };

    const reader = new PartitionedCdb64Reader({
      manifest,
      fetch: mockFetch,
    });
    await reader.open();
    assert.equal(reader.isOpen(), true);

    const resultAA = await reader.get(keyAA);
    assert.ok(resultAA);
    assert.deepEqual(resultAA, valueAA);

    const resultBB = await reader.get(keyBB);
    assert.ok(resultBB);
    assert.deepEqual(resultBB, valueBB);

    // Key with first byte 0xcc has no partition
    const keyCC = new Uint8Array(32).fill(0xcc);
    const resultCC = await reader.get(keyCC);
    assert.equal(resultCC, undefined);

    await reader.close();
    assert.equal(reader.isOpen(), false);
  });

  it('should lazily open partitions only when accessed', async () => {
    const key = new Uint8Array(32).fill(0x01);
    const value = encoder.encode('lazy-value');
    const data = buildCdb64([{ key, value }]);

    let fetchCallCount = 0;
    const countingFetch = (async (_url: string, init?: RequestInit) => {
      fetchCallCount++;
      const rangeHeader = (init?.headers as Record<string, string>)?.['Range'];
      const match = rangeHeader?.match(/bytes=(\d+)-(\d+)/);
      if (!match) throw new Error('Bad range header');
      const start = parseInt(match[1]);
      const end = parseInt(match[2]);
      const slice = data.subarray(start, end + 1);
      return new Response(
        slice.buffer.slice(
          slice.byteOffset,
          slice.byteOffset + slice.byteLength,
        ),
        { status: 206 },
      );
    }) as unknown as typeof globalThis.fetch;

    const manifest: Cdb64Manifest = {
      version: 1,
      createdAt: new Date().toISOString(),
      totalRecords: 1,
      partitions: [
        {
          prefix: '01',
          location: { type: 'http', url: 'https://example.com/lazy.cdb' },
          recordCount: 1,
          size: 0,
        },
      ],
    };

    const reader = new PartitionedCdb64Reader({
      manifest,
      fetch: countingFetch,
    });
    await reader.open();

    // No fetch calls yet — partitions are lazy
    assert.equal(fetchCallCount, 0);

    // Access partition 0x01 — triggers fetch calls (header read + lookup)
    const result = await reader.get(key);
    assert.ok(result);
    assert.deepEqual(result, value);
    const firstAccessCount = fetchCallCount;
    assert.ok(firstAccessCount > 0);

    // Second lookup — no header re-read, only lookup fetches
    const prevCount = fetchCallCount;
    await reader.get(key);
    const secondAccessAdded = fetchCallCount - prevCount;
    const firstAccessLookupOnly = firstAccessCount - 1; // subtract 1 header read
    assert.equal(secondAccessAdded, firstAccessLookupOnly);

    await reader.close();
  });

  it('should throw if not opened', async () => {
    const manifest: Cdb64Manifest = {
      version: 1,
      createdAt: new Date().toISOString(),
      totalRecords: 0,
      partitions: [],
    };

    const reader = new PartitionedCdb64Reader({ manifest });
    await assert.rejects(
      async () => reader.get(new Uint8Array(32)),
      /not opened/,
    );
  });

  it('should handle partition open failures gracefully', async () => {
    const failFetch = (async () => {
      throw new Error('Network error');
    }) as unknown as typeof globalThis.fetch;

    const manifest: Cdb64Manifest = {
      version: 1,
      createdAt: new Date().toISOString(),
      totalRecords: 1,
      partitions: [
        {
          prefix: 'ff',
          location: { type: 'http', url: 'https://example.com/broken.cdb' },
          recordCount: 1,
          size: 0,
        },
      ],
    };

    const reader = new PartitionedCdb64Reader({
      manifest,
      fetch: failFetch,
      logger: mockLogger,
    });
    await reader.open();

    const key = new Uint8Array(32).fill(0xff);
    const result = await reader.get(key);
    assert.equal(result, undefined);

    await reader.close();
  });
});

describe('CDB64RootTransactionSource', () => {
  const dataItemIdBytes = new Uint8Array(32).fill(0xaa);
  const rootTxIdBytes = new Uint8Array(32).fill(0xbb);
  const dataItemId = toB64Url(dataItemIdBytes);
  const rootTxId = toB64Url(rootTxIdBytes);

  const partitionData = buildCdb64([
    {
      key: dataItemIdBytes,
      value: encodeCdb64Value({
        rootTxId: rootTxIdBytes,
        rootDataItemOffset: 512,
        rootDataOffset: 1024,
      }),
    },
  ]);

  function createManifest(): Cdb64Manifest {
    return {
      version: 1,
      createdAt: new Date().toISOString(),
      totalRecords: 1,
      partitions: [
        {
          prefix: 'aa',
          location: {
            type: 'http',
            url: 'https://example.com/partition-aa.cdb',
          },
          recordCount: 1,
          size: 0,
        },
      ],
    };
  }

  it('should return correct rootTransactionId, rootDataItemOffset, rootDataOffset', async () => {
    const source = new CDB64RootTransactionSource({
      manifest: createManifest(),
      fetch: createRangeFetch(partitionData),
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
      manifest: createManifest(),
      fetch: createRangeFetch(partitionData),
      logger: mockLogger,
    });

    const unknownTxId = toB64Url(new Uint8Array(32).fill(0xcc));
    await assert.rejects(
      async () => source.getRootTransaction({ txId: unknownTxId }),
      /Transaction not found in any CDB64 partition/,
    );

    await source.close();
  });

  it('should handle missing partitions gracefully', async () => {
    const manifest: Cdb64Manifest = {
      version: 1,
      createdAt: new Date().toISOString(),
      totalRecords: 0,
      partitions: [],
    };

    const source = new CDB64RootTransactionSource({
      manifest,
      logger: mockLogger,
    });

    await assert.rejects(
      async () => source.getRootTransaction({ txId: dataItemId }),
      /Transaction not found in any CDB64 partition/,
    );

    await source.close();
  });
});
