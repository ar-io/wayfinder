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
 * Utility functions (cdb64Hash, decodeCdb64Value) use Uint8Array and DataView
 * for web compatibility. The Cdb64Reader/Writer classes require Node.js fs.
 */

import { createWriteStream } from 'node:fs';
import * as fs from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
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
function writeUint64LE(data: Uint8Array, offset: number, value: bigint): void {
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

/**
 * CDB64 Reader - Performs lookups in CDB64 files.
 * Requires Node.js (uses fs.FileHandle for disk-based I/O).
 *
 * Usage:
 *   const reader = new Cdb64Reader('/path/to/data.cdb');
 *   await reader.open();
 *   const value = await reader.get(key);
 *   await reader.close();
 */
export class Cdb64Reader {
  private filePath: string;
  private fileHandle: fs.FileHandle | null = null;
  private tablePointers: { position: bigint; length: bigint }[] = [];

  constructor(filePath: string) {
    this.filePath = filePath;
  }

  async open(): Promise<void> {
    this.fileHandle = await fs.open(this.filePath, 'r');

    const header = new Uint8Array(HEADER_SIZE);
    const { bytesRead } = await this.fileHandle.read(header, 0, HEADER_SIZE, 0);

    if (bytesRead !== HEADER_SIZE) {
      await this.close();
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
  }

  async get(key: Uint8Array): Promise<Uint8Array | undefined> {
    if (!this.fileHandle) {
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

      const slotData = new Uint8Array(SLOT_SIZE);
      const { bytesRead: slotBytesRead } = await this.fileHandle.read(
        slotData,
        0,
        SLOT_SIZE,
        toSafeFilePosition(slotPosition),
      );
      if (slotBytesRead !== SLOT_SIZE) {
        throw new Error(
          `Incomplete slot read: expected ${SLOT_SIZE} bytes, got ${slotBytesRead}`,
        );
      }

      const slotHash = readUint64LE(slotData, 0);
      const recordPosition = readUint64LE(slotData, 8);

      if (recordPosition === 0n) {
        return undefined;
      }

      if (slotHash === hash) {
        const recordHeader = new Uint8Array(16);
        const { bytesRead: headerBytesRead } = await this.fileHandle.read(
          recordHeader,
          0,
          16,
          toSafeFilePosition(recordPosition),
        );
        if (headerBytesRead !== 16) {
          throw new Error(
            `Incomplete record header read: expected 16 bytes, got ${headerBytesRead}`,
          );
        }

        const keyLength = Number(readUint64LE(recordHeader, 0));
        const valueLength = Number(readUint64LE(recordHeader, 8));

        const recordKey = new Uint8Array(keyLength);
        const { bytesRead: keyBytesRead } = await this.fileHandle.read(
          recordKey,
          0,
          keyLength,
          toSafeFilePosition(recordPosition + 16n),
        );
        if (keyBytesRead !== keyLength) {
          throw new Error(
            `Incomplete key read: expected ${keyLength} bytes, got ${keyBytesRead}`,
          );
        }

        if (uint8ArrayEquals(key, recordKey)) {
          const value = new Uint8Array(valueLength);
          const { bytesRead: valueBytesRead } = await this.fileHandle.read(
            value,
            0,
            valueLength,
            toSafeFilePosition(recordPosition + 16n + BigInt(keyLength)),
          );
          if (valueBytesRead !== valueLength) {
            throw new Error(
              `Incomplete value read: expected ${valueLength} bytes, got ${valueBytesRead}`,
            );
          }
          return value;
        }
      }

      slot = (slot + 1) % tableLength;
    }

    return undefined;
  }

  async close(): Promise<void> {
    if (this.fileHandle) {
      await this.fileHandle.close();
      this.fileHandle = null;
    }
  }

  isOpen(): boolean {
    return this.fileHandle !== null;
  }
}

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

/**
 * CDB64 Writer - Creates CDB64 files from key-value pairs.
 * Requires Node.js (uses fs and streams).
 * Used primarily for testing; ported from ar-io-node.
 */
export class Cdb64Writer {
  private outputPath: string;
  private tempPath: string;
  private stream: ReturnType<typeof createWriteStream> | null = null;
  private position: bigint = BigInt(HEADER_SIZE);
  private records: { hash: bigint; position: bigint }[][] = [];
  private finalized = false;

  constructor(outputPath: string) {
    this.outputPath = outputPath;
    this.tempPath = `${outputPath}.tmp.${process.pid}`;
    for (let i = 0; i < NUM_TABLES; i++) {
      this.records[i] = [];
    }
  }

  async open(): Promise<void> {
    const dir = path.dirname(this.outputPath);
    await fs.mkdir(dir, { recursive: true });
    const placeholderHeader = new Uint8Array(HEADER_SIZE);
    await fs.writeFile(this.tempPath, placeholderHeader);
    this.stream = createWriteStream(this.tempPath, { flags: 'a' });
    await new Promise<void>((resolve, reject) => {
      this.stream!.on('open', () => resolve());
      this.stream!.on('error', reject);
    });
  }

  async add(key: Uint8Array, value: Uint8Array): Promise<void> {
    if (this.finalized) {
      throw new Error('Cannot add records after finalization');
    }
    if (!this.stream) {
      throw new Error('Writer not opened. Call open() first.');
    }

    const hash = cdb64Hash(key);
    const tableIndex = Number(hash % BigInt(NUM_TABLES));
    this.records[tableIndex].push({ hash, position: this.position });

    const header = new Uint8Array(16);
    writeUint64LE(header, 0, BigInt(key.length));
    writeUint64LE(header, 8, BigInt(value.length));

    await this.writeToStream(header);
    await this.writeToStream(key);
    await this.writeToStream(value);

    this.position += BigInt(16 + key.length + value.length);
  }

  async finalize(): Promise<void> {
    if (this.finalized) {
      throw new Error('Already finalized');
    }
    if (!this.stream) {
      throw new Error('Writer not opened. Call open() first.');
    }

    this.finalized = true;

    const tablePointers: { position: bigint; length: bigint }[] = [];

    for (let i = 0; i < NUM_TABLES; i++) {
      const records = this.records[i];
      const tableLength = records.length === 0 ? 0 : records.length * 2;

      tablePointers.push({
        position: this.position,
        length: BigInt(tableLength),
      });

      if (tableLength === 0) continue;

      const slots: { hash: bigint; position: bigint }[] = new Array(
        tableLength,
      );
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

      await this.writeToStream(tableData);
      this.position += BigInt(tableLength * SLOT_SIZE);
    }

    await new Promise<void>((resolve, reject) => {
      this.stream!.end(() => resolve());
      this.stream!.on('error', reject);
    });

    const header = new Uint8Array(HEADER_SIZE);
    for (let i = 0; i < NUM_TABLES; i++) {
      const offset = i * POINTER_SIZE;
      writeUint64LE(header, offset, tablePointers[i].position);
      writeUint64LE(header, offset + 8, tablePointers[i].length);
    }

    const fileHandle = await fs.open(this.tempPath, 'r+');
    try {
      await fileHandle.write(header, 0, HEADER_SIZE, 0);
      await fileHandle.sync();
    } finally {
      await fileHandle.close();
    }

    await fs.rename(this.tempPath, this.outputPath);
  }

  private async writeToStream(data: Uint8Array): Promise<void> {
    return new Promise((resolve, reject) => {
      this.stream!.write(data, (err) => {
        if (err) return reject(err);
        resolve();
      });
    });
  }
}

type CDB64RootTransactionSourceParams = {
  cdb64Urls: string[];
  logger?: Logger;
  fetch?: typeof globalThis.fetch;
  cacheDir?: string;
  cacheTtlMs?: number;
};

/**
 * Resolves data item IDs to root transaction IDs using local CDB64 files.
 *
 * Downloads CDB64 files from URLs to a local cache directory and uses
 * Cdb64Reader for O(1) lookups.
 */
export class CDB64RootTransactionSource implements RootTransactionSource {
  private cdb64Urls: string[];
  private logger: Logger;
  private fetch: typeof globalThis.fetch;
  private cacheDir: string;
  private cacheTtlMs: number;
  private readers: Cdb64Reader[] = [];
  private lastDownloadTime = 0;
  private initialized = false;

  constructor({
    cdb64Urls,
    logger = defaultLogger,
    fetch: fetchFn = globalThis.fetch,
    cacheDir = path.join(tmpdir(), 'wayfinder-cdb64'),
    cacheTtlMs = 60 * 60 * 1000, // 1 hour
  }: CDB64RootTransactionSourceParams) {
    this.cdb64Urls = cdb64Urls;
    this.logger = logger;
    this.fetch = fetchFn;
    this.cacheDir = cacheDir;
    this.cacheTtlMs = cacheTtlMs;
  }

  private async ensureInitialized(): Promise<void> {
    const now = Date.now();
    if (this.initialized && now - this.lastDownloadTime < this.cacheTtlMs) {
      return;
    }

    await this.closeReaders();

    await fs.mkdir(this.cacheDir, { recursive: true });

    const readers: Cdb64Reader[] = [];
    for (let i = 0; i < this.cdb64Urls.length; i++) {
      const url = this.cdb64Urls[i];
      const localPath = path.join(this.cacheDir, `cdb64-${i}.cdb`);

      try {
        const response = await this.fetch(url);
        if (!response.ok || !response.body) {
          this.logger.warn('Failed to download CDB64 file', {
            url,
            status: response.status,
          });
          continue;
        }

        const arrayBuffer = await response.arrayBuffer();
        await fs.writeFile(localPath, new Uint8Array(arrayBuffer));

        const reader = new Cdb64Reader(localPath);
        await reader.open();
        readers.push(reader);

        this.logger.debug('Downloaded and opened CDB64 file', {
          url,
          localPath,
        });
      } catch (error: any) {
        this.logger.warn('Error downloading CDB64 file', {
          url,
          error: error.message,
        });
      }
    }

    this.readers = readers;
    this.lastDownloadTime = now;
    this.initialized = true;
  }

  async getRootTransaction({
    txId,
  }: {
    txId: string;
    gateway?: URL;
  }): Promise<RootTransactionInfo> {
    await this.ensureInitialized();

    const keyBytes = fromB64Url(txId);

    for (const reader of this.readers) {
      try {
        const value = await reader.get(keyBytes);
        if (value) {
          const decoded = decodeCdb64Value(value);
          return {
            rootTransactionId: toB64Url(decoded.rootTxId),
            rootDataItemOffset: decoded.rootDataItemOffset,
            rootDataOffset: decoded.rootDataOffset,
            isDataItem: true,
          };
        }
      } catch (error: any) {
        this.logger.debug('Error looking up txId in CDB64 reader', {
          txId,
          error: error.message,
        });
      }
    }

    throw new Error('Transaction not found in any CDB64 file', {
      cause: { txId },
    });
  }

  private async closeReaders(): Promise<void> {
    for (const reader of this.readers) {
      try {
        await reader.close();
      } catch {
        // ignore close errors
      }
    }
    this.readers = [];
  }

  async close(): Promise<void> {
    await this.closeReaders();
    this.initialized = false;
  }
}
