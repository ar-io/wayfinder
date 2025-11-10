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

// known regexes for wayfinder urls
export const arnsRegex = /^[a-z0-9_-]{1,42}$|^[a-z0-9_-]{44,51}$/;
export const txIdRegex = /^[A-Za-z0-9_-]{43}$/;

// ar.io gateway header names
export const arioHeaderNames = {
  hops: 'X-AR-IO-Hops',
  origin: 'X-AR-IO-Origin',
  originNodeRelease: 'X-AR-IO-Origin-Node-Release',
  digest: 'X-AR-IO-Digest',
  contentDigest: 'Content-Digest',
  expectedDigest: 'X-AR-IO-Expected-Digest',
  stable: 'X-AR-IO-Stable',
  verified: 'X-AR-IO-Verified',
  trusted: 'X-AR-IO-Trusted',
  cache: 'X-Cache',
  chunkSourceType: 'X-AR-IO-Chunk-Source-Type',
  chunkHost: 'X-AR-IO-Chunk-Host',
  chunkDataPath: 'X-Arweave-Chunk-Data-Path',
  chunkDataRoot: 'X-Arweave-Chunk-Data-Root',
  chunkStartOffset: 'X-Arweave-Chunk-Start-Offset',
  chunkRelativeStartOffset: 'X-Arweave-Chunk-Relative-Start-Offset',
  chunkReadOffset: 'X-Arweave-Chunk-Read-Offset',
  chunkTxDataSize: 'X-Arweave-Chunk-Tx-Data-Size',
  chunkTxPath: 'X-Arweave-Chunk-Tx-Path',
  chunkTxId: 'X-Arweave-Chunk-Tx-Id',
  chunkTxStartOffset: 'X-Arweave-Chunk-Tx-Start-Offset',
  rootTransactionId: 'X-AR-IO-Root-Transaction-Id',
  dataItemDataOffset: 'X-AR-IO-Data-Item-Data-Offset',
  dataItemRootParentOffset: 'X-AR-IO-Data-Item-Root-Parent-Offset',
  dataItemOffset: 'X-AR-IO-Data-Item-Offset',
  dataItemSize: 'X-AR-IO-Data-Item-Size',
  rootDataItemOffset: 'X-AR-IO-Root-Data-Item-Offset',
  rootDataOffset: 'X-AR-IO-Root-Data-Offset',
  arnsTtlSeconds: 'X-ArNS-TTL-Seconds',
  arnsName: 'X-ArNS-Name',
  arnsBasename: 'X-ArNS-Basename',
  arnsRecord: 'X-ArNS-Record',
  arnsResolvedId: 'X-ArNS-Resolved-Id',
  dataId: 'X-AR-IO-Data-Id',
  arnsProcessId: 'X-ArNS-Process-Id',
  arnsResolvedAt: 'X-ArNS-Resolved-At',
  arnsLimit: 'X-ArNS-Undername-Limit',
  arnsIndex: 'X-ArNS-Record-Index',
};
