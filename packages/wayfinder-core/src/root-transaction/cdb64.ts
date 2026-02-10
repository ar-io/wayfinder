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
 * CDB64 - A 64-bit variant of the Constant Database format.
 *
 * Based on the CDB format by D. J. Bernstein (https://cr.yp.to/cdb.html)
 * with modifications to support 64-bit file offsets for files >4GB.
 *
 * Ported from ar-io-node's CDB64 implementation.
 *
 * This module is fully web-compatible — no Node.js APIs are used.
 * All I/O goes through the ByteRangeSource abstraction (typically
 * HttpByteRangeSource using fetch with Range headers).
 */

import { Unpackr } from 'msgpackr';

import { defaultLogger } from '../logger.js';
import type {
  Logger,
  RootTransactionInfo,
  RootTransactionSource,
} from '../types.js';
import { fromB64Url, toB64Url } from '../utils/base64.js';

// Header size: 256 pointers * 16 bytes each = 4096 bytes
const HEADER_SIZE = 4096;

// Each header pointer: 8 bytes position + 8 bytes length = 16 bytes
const POINTER_SIZE = 16;

// Each hash table slot: 8 bytes hash + 8 bytes position = 16 bytes
const SLOT_SIZE = 16;

// Number of hash tables
const NUM_TABLES = 256;

// Maximum file size supported (limited by safe integer precision for file I/O)
const MAX_SAFE_FILE_SIZE = BigInt(Number.MAX_SAFE_INTEGER);

function toSafeFilePosition(position: bigint): number {
  if (position > MAX_SAFE_FILE_SIZE) {
    throw new Error(
      `File position ${position} exceeds maximum safe integer (${Number.MAX_SAFE_INTEGER}). ` +
        `CDB64 files larger than ~8TB are not supported.`,
    );
  }
  return Number(position);
}

/** Read a little-endian uint64 from a Uint8Array using DataView. */
function readUint64LE(data: Uint8Array, offset: number): bigint {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  return view.getBigUint64(offset, true);
}

/** Write a little-endian uint64 into a Uint8Array using DataView. */
export function writeUint64LE(
  data: Uint8Array,
  offset: number,
  value: bigint,
): void {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  view.setBigUint64(offset, value, true);
}

/** Compare two Uint8Arrays for byte equality. */
function uint8ArrayEquals(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

/**
 * DJB hash function used by CDB, extended to 64-bit.
 *
 * Formula: hash = ((hash << 5) + hash) ^ byte, starting with 5381.
 */
export function cdb64Hash(key: Uint8Array): bigint {
  let h = 5381n;
  for (const byte of key) {
    h = ((h << 5n) + h) ^ BigInt(byte);
    h = h & 0xffffffffffffffffn; // Keep as unsigned 64-bit
  }
  return h;
}

// ---------------------------------------------------------------------------
// ByteRangeSource abstraction
// ---------------------------------------------------------------------------

/**
 * Web-compatible interface for random-access byte range reads.
 * Uses Uint8Array (not Buffer) for web compatibility.
 */
export interface ByteRangeSource {
  read(offset: number, size: number): Promise<Uint8Array>;
  close(): Promise<void>;
  isOpen(): boolean;
}

/**
 * Web-compatible implementation of ByteRangeSource using fetch with
 * HTTP Range requests. Works in both browsers and Node.js.
 */
export class HttpByteRangeSource implements ByteRangeSource {
  private url: string;
  private fetchFn: typeof globalThis.fetch;
  private open_ = true;

  constructor({
    url,
    fetch: fetchFn = globalThis.fetch,
  }: {
    url: string;
    fetch?: typeof globalThis.fetch;
  }) {
    this.url = url;
    this.fetchFn = fetchFn;
  }

  async read(offset: number, size: number): Promise<Uint8Array> {
    if (!this.open_) {
      throw new Error('HttpByteRangeSource is closed.');
    }
    const end = offset + size - 1;
    const response = await this.fetchFn(this.url, {
      headers: { Range: `bytes=${offset}-${end}` },
    });

    if (response.status !== 206) {
      throw new Error(`Expected 206 Partial Content, got ${response.status}`);
    }

    const arrayBuffer = await response.arrayBuffer();
    const result = new Uint8Array(arrayBuffer);
    if (result.length !== size) {
      throw new Error(`Expected ${size} bytes, got ${result.length}`);
    }
    return result;
  }

  async close(): Promise<void> {
    this.open_ = false;
  }

  isOpen(): boolean {
    return this.open_;
  }
}

// ---------------------------------------------------------------------------
// CDB64 Reader
// ---------------------------------------------------------------------------

/**
 * CDB64 Reader - Performs lookups in CDB64 databases via a ByteRangeSource.
 *
 * Usage:
 *   const reader = Cdb64Reader.fromSource({ source: mySource });
 *   await reader.open();
 *   const value = await reader.get(key);
 *   await reader.close();
 */
export class Cdb64Reader {
  private source: ByteRangeSource;
  private ownsSource: boolean;
  private tablePointers: { position: bigint; length: bigint }[] = [];
  private opened = false;

  constructor(source: ByteRangeSource, ownsSource = true) {
    this.source = source;
    this.ownsSource = ownsSource;
  }

  static fromSource({
    source,
    ownsSource = true,
  }: {
    source: ByteRangeSource;
    ownsSource?: boolean;
  }): Cdb64Reader {
    return new Cdb64Reader(source, ownsSource);
  }

  async open(): Promise<void> {
    const header = await this.source.read(0, HEADER_SIZE);

    if (header.length !== HEADER_SIZE) {
      throw new Error('Invalid CDB64 file: header too short');
    }

    this.tablePointers = [];
    for (let i = 0; i < NUM_TABLES; i++) {
      const offset = i * POINTER_SIZE;
      this.tablePointers.push({
        position: readUint64LE(header, offset),
        length: readUint64LE(header, offset + 8),
      });
    }

    this.opened = true;
  }

  async get(key: Uint8Array): Promise<Uint8Array | undefined> {
    if (!this.opened) {
      throw new Error('Reader not opened. Call open() first.');
    }

    const hash = cdb64Hash(key);
    const tableIndex = Number(hash % BigInt(NUM_TABLES));
    const pointer = this.tablePointers[tableIndex];

    if (pointer.length === 0n) {
      return undefined;
    }

    const tableLength = Number(pointer.length);
    let slot = Number((hash / BigInt(NUM_TABLES)) % BigInt(tableLength));

    for (let i = 0; i < tableLength; i++) {
      const slotPosition = pointer.position + BigInt(slot * SLOT_SIZE);

      const slotData = await this.source.read(
        toSafeFilePosition(slotPosition),
        SLOT_SIZE,
      );

      const slotHash = readUint64LE(slotData, 0);
      const recordPosition = readUint64LE(slotData, 8);

      if (recordPosition === 0n) {
        return undefined;
      }

      if (slotHash === hash) {
        const recordHeader = await this.source.read(
          toSafeFilePosition(recordPosition),
          16,
        );

        const keyLength = Number(readUint64LE(recordHeader, 0));
        const valueLength = Number(readUint64LE(recordHeader, 8));

        const recordKey = await this.source.read(
          toSafeFilePosition(recordPosition + 16n),
          keyLength,
        );

        if (uint8ArrayEquals(key, recordKey)) {
          return await this.source.read(
            toSafeFilePosition(recordPosition + 16n + BigInt(keyLength)),
            valueLength,
          );
        }
      }

      slot = (slot + 1) % tableLength;
    }

    return undefined;
  }

  async close(): Promise<void> {
    if (this.ownsSource) {
      await this.source.close();
    }
    this.opened = false;
  }

  isOpen(): boolean {
    return this.opened;
  }
}

// ---------------------------------------------------------------------------
// CDB64 value encoding/decoding
// ---------------------------------------------------------------------------

/**
 * Decoded CDB64 value containing root transaction information.
 */
export interface Cdb64RootTxValue {
  rootTxId: Uint8Array;
  rootDataItemOffset?: number;
  rootDataOffset?: number;
}

const unpackr = new Unpackr({ useRecords: false });

/**
 * Decodes a MessagePack-encoded CDB64 value.
 *
 * Expected format:
 *   { r: Uint8Array(32), i?: number, d?: number }
 */
export function decodeCdb64Value(data: Uint8Array): Cdb64RootTxValue {
  const decoded = unpackr.unpack(data);

  if (!decoded || typeof decoded !== 'object') {
    throw new Error('Invalid CDB64 value: not an object');
  }

  if (!(decoded.r instanceof Uint8Array)) {
    throw new Error('Invalid CDB64 value: missing or invalid rootTxId');
  }

  const rootTxId = new Uint8Array(decoded.r);
  if (rootTxId.length !== 32) {
    throw new Error('Invalid CDB64 value: rootTxId must be 32 bytes');
  }

  if ('i' in decoded && 'd' in decoded) {
    const rootDataItemOffset = decoded.i;
    const rootDataOffset = decoded.d;

    if (
      typeof rootDataItemOffset !== 'number' ||
      !Number.isInteger(rootDataItemOffset) ||
      rootDataItemOffset < 0
    ) {
      throw new Error('Invalid CDB64 value: invalid rootDataItemOffset');
    }

    if (
      typeof rootDataOffset !== 'number' ||
      !Number.isInteger(rootDataOffset) ||
      rootDataOffset < 0
    ) {
      throw new Error('Invalid CDB64 value: invalid rootDataOffset');
    }

    return { rootTxId, rootDataItemOffset, rootDataOffset };
  }

  return { rootTxId };
}

// ---------------------------------------------------------------------------
// CDB64 Manifest types (for partitioned indexes)
// ---------------------------------------------------------------------------

export type PartitionLocation = { type: 'http'; url: string };

export interface PartitionInfo {
  prefix: string; // hex "00"-"ff"
  location: PartitionLocation;
  recordCount: number;
  size: number;
}

export interface Cdb64Manifest {
  version: 1;
  createdAt: string;
  totalRecords: number;
  partitions: PartitionInfo[];
}

// ---------------------------------------------------------------------------
// Partitioned CDB64 Reader
// ---------------------------------------------------------------------------

type PartitionState = {
  reader: Cdb64Reader;
  source: ByteRangeSource;
};

/**
 * Routes lookups to partition-specific CDB64 files based on the first byte
 * of the key. Partitions are opened lazily on first access via HTTP
 * byte-range reads.
 */
export class PartitionedCdb64Reader {
  // null = no partition, undefined = not yet opened, PartitionState = open
  private partitions: (PartitionState | null | undefined)[];
  private openPromises: Map<number, Promise<PartitionState | null>>;
  private manifest: Cdb64Manifest;
  private fetchFn?: typeof globalThis.fetch;
  private logger: Logger;
  private opened = false;

  constructor({
    manifest,
    fetch: fetchFn,
    logger = defaultLogger,
  }: {
    manifest: Cdb64Manifest;
    fetch?: typeof globalThis.fetch;
    logger?: Logger;
  }) {
    this.manifest = manifest;
    this.fetchFn = fetchFn;
    this.logger = logger;

    // Initialize all 256 slots as undefined (not yet opened)
    this.partitions = new Array<PartitionState | null | undefined>(256).fill(
      undefined,
    );
    this.openPromises = new Map();

    // Build a set of prefixes that exist in the manifest
    const existingPrefixes = new Set(
      manifest.partitions.map((p) => parseInt(p.prefix, 16)),
    );

    // Mark slots with no partition as null
    for (let i = 0; i < 256; i++) {
      if (!existingPrefixes.has(i)) {
        this.partitions[i] = null;
      }
    }
  }

  async open(): Promise<void> {
    this.opened = true;
  }

  async get(key: Uint8Array): Promise<Uint8Array | undefined> {
    if (!this.opened) {
      throw new Error('PartitionedCdb64Reader not opened. Call open() first.');
    }

    const partitionIndex = key[0];
    const partition = this.partitions[partitionIndex];

    if (partition === null) {
      return undefined;
    }

    if (partition === undefined) {
      const state = await this.openPartition(partitionIndex);
      if (state === null) {
        return undefined;
      }
      return state.reader.get(key);
    }

    return partition.reader.get(key);
  }

  private async openPartition(index: number): Promise<PartitionState | null> {
    // Deduplicate concurrent opens for the same partition
    const existing = this.openPromises.get(index);
    if (existing) {
      return existing;
    }

    const promise = this.doOpenPartition(index);
    this.openPromises.set(index, promise);

    try {
      const result = await promise;
      this.partitions[index] = result;
      return result;
    } catch (error: any) {
      this.logger.warn('Failed to open partition', {
        index,
        error: error.message,
      });
      this.partitions[index] = null;
      return null;
    } finally {
      this.openPromises.delete(index);
    }
  }

  private async doOpenPartition(index: number): Promise<PartitionState | null> {
    const prefix = index.toString(16).padStart(2, '0');
    const partitionInfo = this.manifest.partitions.find(
      (p) => p.prefix === prefix,
    );

    if (!partitionInfo) {
      return null;
    }

    const source = new HttpByteRangeSource({
      url: partitionInfo.location.url,
      ...(this.fetchFn ? { fetch: this.fetchFn } : {}),
    });

    const reader = Cdb64Reader.fromSource({ source });
    await reader.open();

    return { reader, source };
  }

  async close(): Promise<void> {
    for (const partition of this.partitions) {
      if (partition != null) {
        try {
          await partition.reader.close();
        } catch {
          // ignore close errors
        }
      }
    }
    this.partitions = new Array<PartitionState | null | undefined>(256).fill(
      null,
    );
    this.openPromises.clear();
    this.opened = false;
  }

  isOpen(): boolean {
    return this.opened;
  }
}

// ---------------------------------------------------------------------------
// CDB64 Root Transaction Source
// ---------------------------------------------------------------------------

type CDB64RootTransactionSourceParams = {
  manifest: Cdb64Manifest;
  fetch?: typeof globalThis.fetch;
  logger?: Logger;
};

/**
 * Resolves data item IDs to root transaction IDs using partitioned CDB64
 * files. Partitions are opened lazily on first access via HTTP byte-range
 * reads.
 */
export class CDB64RootTransactionSource implements RootTransactionSource {
  private reader: PartitionedCdb64Reader;

  constructor({
    manifest,
    fetch: fetchFn,
    logger = defaultLogger,
  }: CDB64RootTransactionSourceParams) {
    this.reader = new PartitionedCdb64Reader({
      manifest,
      fetch: fetchFn,
      logger,
    });
  }

  async getRootTransaction({
    txId,
  }: {
    txId: string;
    gateway?: URL;
  }): Promise<RootTransactionInfo> {
    if (!this.reader.isOpen()) {
      await this.reader.open();
    }

    const keyBytes = fromB64Url(txId);
    const value = await this.reader.get(keyBytes);

    if (!value) {
      throw new Error('Transaction not found in any CDB64 partition', {
        cause: { txId },
      });
    }

    const decoded = decodeCdb64Value(value);
    return {
      rootTransactionId: toB64Url(decoded.rootTxId),
      rootDataItemOffset: decoded.rootDataItemOffset,
      rootDataOffset: decoded.rootDataOffset,
      isDataItem: true,
    };
  }

  async close(): Promise<void> {
    await this.reader.close();
  }
}
