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

import { pLimit } from 'plimit-lit';
import { WayfinderEmitter } from '../emitter.js';
import { defaultLogger } from '../logger.js';
import { ArweaveManifest, ManifestParser } from '../manifest/parser.js';
import {
  ManifestVerificationCache,
  VerificationResult,
} from '../manifest/verification-cache.js';
import type {
  DataStream,
  Logger,
  ManifestVerificationProgress,
  VerificationStrategy,
} from '../types.js';
import { readableStreamToAsyncIterable } from '../utils/hash.js';

/**
 * Verification strategy that handles Arweave manifests
 *
 * Wraps an existing verification strategy and adds manifest-specific logic:
 * - Detects manifest content (by content-type or structure)
 * - Parses manifest JSON
 * - Recursively verifies all referenced resources
 * - Handles nested manifests (manifests that reference other manifests)
 * - Caches verification results for performance
 * - Emits detailed progress events
 *
 * @example
 * ```typescript
 * const strategy = new ManifestVerificationStrategy({
 *   baseStrategy: new HashVerificationStrategy({
 *     trustedGateways: [new URL('https://permagate.io')]
 *   }),
 *   maxDepth: 5,
 *   concurrency: 10,
 * });
 * ```
 */
export class ManifestVerificationStrategy implements VerificationStrategy {
  public readonly trustedGateways: URL[];
  private readonly baseStrategy: VerificationStrategy;
  private readonly maxDepth: number;
  private readonly concurrency: number;
  private readonly cache: ManifestVerificationCache;
  private readonly logger: Logger;
  private readonly emitter?: WayfinderEmitter;

  constructor({
    baseStrategy,
    maxDepth = 5,
    concurrency = 10,
    cache,
    logger = defaultLogger,
    emitter,
  }: {
    baseStrategy: VerificationStrategy;
    maxDepth?: number;
    concurrency?: number;
    cache?: ManifestVerificationCache;
    logger?: Logger;
    emitter?: WayfinderEmitter;
  }) {
    this.baseStrategy = baseStrategy;
    this.trustedGateways = baseStrategy.trustedGateways;

    // Validate that we have at least one trusted gateway
    // ManifestVerificationStrategy needs to fetch nested resources from trusted gateways
    if (!this.trustedGateways || this.trustedGateways.length === 0) {
      // Check if this is RemoteVerificationStrategy
      const strategyName = baseStrategy.constructor.name;
      if (strategyName === 'RemoteVerificationStrategy') {
        throw new Error(
          'ManifestVerificationStrategy does not support RemoteVerificationStrategy. ' +
            'RemoteVerificationStrategy only checks x-ar-io-verified headers from the original gateway, ' +
            'but ManifestVerificationStrategy needs to fetch nested resources from trusted gateways. ' +
            'Please use HashVerificationStrategy, DataRootVerificationStrategy, or SignatureVerificationStrategy instead.',
        );
      }

      throw new Error(
        'ManifestVerificationStrategy requires at least one trusted gateway. ' +
          'The base verification strategy must be configured with trustedGateways. ' +
          'Please use HashVerificationStrategy, DataRootVerificationStrategy, or SignatureVerificationStrategy ' +
          'with a trustedGateways configuration.',
      );
    }

    this.maxDepth = maxDepth;
    this.concurrency = concurrency;
    this.cache = cache ?? new ManifestVerificationCache();
    this.logger = logger;
    this.emitter = emitter;
  }

  /**
   * Get header value case-insensitively
   * HTTP headers are case-insensitive per RFC 2616
   */
  private getHeader(
    headers: Record<string, string>,
    name: string,
  ): string | undefined {
    const key = Object.keys(headers).find(
      (k) => k.toLowerCase() === name.toLowerCase(),
    );
    return key ? headers[key] : undefined;
  }

  /**
   * Check if content is a manifest based on content-type header
   * HTTP headers are case-insensitive, so we normalize to lowercase
   */
  private isManifestContentType(headers: Record<string, string>): boolean {
    const contentType = this.getHeader(headers, 'content-type');
    return (
      contentType?.includes('application/x.arweave-manifest+json') ?? false
    );
  }

  /**
   * Try to parse data as a manifest
   * Returns null if data is not a valid manifest
   */
  private async tryParseManifest(data: DataStream): Promise<{
    manifest: ArweaveManifest;
    rawContent: string;
  } | null> {
    try {
      // Convert stream to string
      const chunks: Uint8Array[] = [];
      const iterable =
        'getReader' in data
          ? readableStreamToAsyncIterable(data as ReadableStream<Uint8Array>)
          : data;

      for await (const chunk of iterable) {
        chunks.push(chunk);
      }

      const rawContent = new TextDecoder().decode(Buffer.concat(chunks as any));

      // Try to parse as JSON manifest
      const manifest = ManifestParser.parse(rawContent);
      return { manifest, rawContent };
    } catch (error) {
      this.logger.debug('Failed to parse as manifest', { error });
      return null;
    }
  }

  /**
   * Three-way tee for streams (verify, parse, capture)
   * Since native tee() only does 2-way, we tee twice
   */
  private teeThreeWay(
    stream: ReadableStream<Uint8Array>,
  ): [
    ReadableStream<Uint8Array>,
    ReadableStream<Uint8Array>,
    ReadableStream<Uint8Array>,
  ] {
    const [branch1, temp] = stream.tee();
    const [branch2, branch3] = temp.tee();
    return [branch1, branch2, branch3];
  }

  /**
   * Capture content bytes from a stream with size limit
   * MAX SECURITY: Enforces 10MB limit to prevent memory exhaustion
   */
  private async captureContent(
    stream: ReadableStream<Uint8Array>,
    maxSize: number,
  ): Promise<Uint8Array | undefined> {
    try {
      const chunks: Uint8Array[] = [];
      let totalSize = 0;

      const reader = stream.getReader();

      while (true) {
        const { done, value } = await reader.read();

        if (done) break;

        totalSize += value.length;

        // MAX SECURITY: Enforce size limit
        if (totalSize > maxSize) {
          this.logger.warn('Content exceeds cache size limit, not caching', {
            totalSize,
            maxSize,
          });
          reader.cancel('Size limit exceeded');
          return undefined;
        }

        chunks.push(value);
      }

      return Buffer.concat(chunks);
    } catch (error) {
      this.logger.error('Failed to capture content', { error });
      return undefined;
    }
  }

  /**
   * Verify a single transaction using the base strategy
   */
  private async verifySingleTransaction({
    txId,
    data,
    headers,
  }: {
    txId: string;
    data: DataStream;
    headers: Record<string, string>;
  }): Promise<void> {
    // Check cache first
    const cached = this.cache.get({ txId });
    if (cached) {
      this.logger.debug('Using cached verification result', { txId, cached });
      if (!cached.verified) {
        throw cached.error || new Error('Verification failed (cached)');
      }
      return;
    }

    // Verify using base strategy
    try {
      await this.baseStrategy.verifyData({ data, txId, headers });
      this.cache.set({ txId, verified: true });
    } catch (error) {
      this.cache.set({ txId, verified: false, error: error as Error });
      throw error;
    }
  }

  /**
   * Fetch from trusted gateways with retry logic
   */
  private async fetchFromTrustedGateway(
    txId: string,
  ): Promise<{ response: Response; gateway: URL }> {
    if (!this.trustedGateways || this.trustedGateways.length === 0) {
      throw new Error('No trusted gateways configured');
    }

    let lastError: Error | undefined;

    // Try each trusted gateway in order
    for (const gateway of this.trustedGateways) {
      try {
        const url = new URL(`/${txId}`, gateway);
        this.logger.debug('Attempting to fetch from trusted gateway', {
          txId,
          gateway: gateway.toString(),
        });

        const response = await fetch(url.toString());

        if (response.ok) {
          this.logger.debug('Successfully fetched from trusted gateway', {
            txId,
            gateway: gateway.toString(),
          });
          return { response, gateway };
        }

        // Response not OK, try next gateway
        lastError = new Error(
          `Gateway returned ${response.status}: ${response.statusText}`,
        );
        this.logger.debug('Trusted gateway returned error, trying next', {
          txId,
          gateway: gateway.toString(),
          status: response.status,
        });
      } catch (error) {
        lastError = error as Error;
        this.logger.debug('Failed to fetch from trusted gateway, trying next', {
          txId,
          gateway: gateway.toString(),
          error: (error as Error).message,
        });
      }
    }

    // All gateways failed
    throw new Error(
      `All ${this.trustedGateways.length} trusted gateway(s) failed for ${txId}`,
      { cause: lastError },
    );
  }

  /**
   * Fetch and verify a nested resource
   */
  private async fetchAndVerifyResource({
    txId,
    depth,
    parentTxId,
  }: {
    txId: string;
    depth: number;
    parentTxId?: string;
  }): Promise<VerificationResult> {
    // Check cache first
    const cached = this.cache.get({ txId });
    if (cached) {
      return cached;
    }

    this.logger.debug('Fetching and verifying resource', {
      txId,
      depth,
      parentTxId,
    });

    try {
      // Fetch the resource from trusted gateways with retry
      const { response } = await this.fetchFromTrustedGateway(txId);

      if (!response.ok) {
        throw new Error(
          `Failed to fetch resource: ${response.status} ${response.statusText}`,
        );
      }

      // Check for response body
      if (!response.body) {
        throw new Error(
          `Response from trusted gateway has no body for ${txId}`,
        );
      }

      const headers: Record<string, string> = {};
      response.headers.forEach((value, key) => {
        headers[key] = value;
      });
      const data = response.body;

      // Get content length for size limit check
      const contentLengthHeader = this.getHeader(headers, 'content-length');
      const contentLength = contentLengthHeader
        ? parseInt(contentLengthHeader, 10)
        : undefined;

      // MAX SECURITY: Only cache resources under 10MB to avoid memory issues
      // and focus on the real attack surface (JavaScript, HTML, CSS, images)
      const MAX_CACHEABLE_SIZE = 10 * 1024 * 1024; // 10 MB
      const shouldCacheContent =
        contentLength === undefined || contentLength <= MAX_CACHEABLE_SIZE;

      // Check if this is a nested manifest
      const isManifest =
        this.isManifestContentType(headers) ||
        this.getHeader(headers, 'content-type')?.includes('json');

      if (isManifest && depth < this.maxDepth && data) {
        // SECURITY: Use tee() to verify original bytes while parsing and capturing
        let verifyBranch: ReadableStream<Uint8Array>;
        let parseBranch: ReadableStream<Uint8Array>;
        let captureBranch: ReadableStream<Uint8Array> | undefined;

        if (shouldCacheContent) {
          // Three-way tee for: verify, parse, capture
          const [v, p, c] = this.teeThreeWay(data);
          verifyBranch = v;
          parseBranch = p;
          captureBranch = c;
        } else {
          // Two-way tee: verify and parse only (no capture for large files)
          [verifyBranch, parseBranch] = data.tee();
        }

        // Start verification in parallel
        const verificationPromise = this.verifySingleTransaction({
          txId,
          data: verifyBranch,
          headers,
        });

        // Capture content in parallel (if small enough)
        let contentPromise: Promise<Uint8Array | undefined> | undefined;
        if (captureBranch) {
          contentPromise = this.captureContent(
            captureBranch,
            MAX_CACHEABLE_SIZE,
          );
        }

        // Parse as manifest in parallel
        const parsed = await this.tryParseManifest(parseBranch);

        // Wait for verification to complete
        await verificationPromise;

        // Wait for content capture to complete (if applicable)
        const content = contentPromise ? await contentPromise : undefined;

        // Store in cache with content
        const result: VerificationResult = {
          txId,
          verified: true,
          timestamp: Date.now(),
          content,
          contentType: this.getHeader(headers, 'content-type'),
          headers,
        };
        this.cache.set(result);

        if (parsed) {
          this.emitter?.emit(
            'manifest-progress' as any,
            {
              type: 'nested-manifest-detected',
              parentTxId: parentTxId || txId,
              nestedTxId: txId,
              depth,
            } as ManifestVerificationProgress,
          );

          // Recursively verify nested manifest resources
          await this.verifyNestedResources({
            txId,
            manifest: parsed.manifest,
            depth: depth + 1,
          });
        }

        return result;
      } else {
        // Not a manifest - verify as regular transaction
        let verifyBranch: ReadableStream<Uint8Array>;
        let captureBranch: ReadableStream<Uint8Array> | undefined;

        if (shouldCacheContent) {
          [verifyBranch, captureBranch] = data.tee();
        } else {
          verifyBranch = data;
        }

        // Verify content
        await this.verifySingleTransaction({
          txId,
          data: verifyBranch,
          headers,
        });

        // Capture content (if small enough)
        const content = captureBranch
          ? await this.captureContent(captureBranch, MAX_CACHEABLE_SIZE)
          : undefined;

        // Store in cache with content
        const result: VerificationResult = {
          txId,
          verified: true,
          timestamp: Date.now(),
          content,
          contentType: this.getHeader(headers, 'content-type'),
          headers,
        };
        this.cache.set(result);

        return result;
      }
    } catch (error) {
      const result: VerificationResult = {
        txId,
        verified: false,
        error: error as Error,
        timestamp: Date.now(),
      };

      // Cache the failure result
      this.cache.set(result);

      // Emit verification-failed event
      this.emitter?.emit('verification-failed', {
        txId,
        error: error as Error,
        timestamp: Date.now(),
      });

      return result;
    }
  }

  /**
   * Verify all resources in a manifest with controlled concurrency
   */
  private async verifyManifestResources({
    manifest,
    parentTxId,
    depth,
  }: {
    manifest: ArweaveManifest;
    parentTxId: string;
    depth: number;
  }): Promise<Map<string, VerificationResult>> {
    const txIds = ManifestParser.getAllTransactionIds(manifest);
    const results = new Map<string, VerificationResult>();

    if (txIds.length === 0) {
      return results;
    }

    this.logger.debug('Verifying manifest resources', {
      totalResources: txIds.length,
      concurrency: this.concurrency,
      depth,
    });

    // Use promise pool for controlled concurrency
    const throttle = pLimit(this.concurrency);

    const verifications = txIds.map((resourceTxId, index) =>
      throttle(async () => {
        this.emitter?.emit(
          'manifest-progress' as any,
          {
            type: 'resource-verifying',
            txId: parentTxId,
            resourceTxId,
            currentIndex: index + 1,
            totalResources: txIds.length,
          } as ManifestVerificationProgress,
        );

        const result = await this.fetchAndVerifyResource({
          txId: resourceTxId,
          depth,
          parentTxId,
        });

        this.emitter?.emit(
          'manifest-progress' as any,
          {
            type: 'resource-verified',
            txId: parentTxId,
            resourceTxId,
            verified: result.verified,
            currentIndex: index + 1,
            totalResources: txIds.length,
          } as ManifestVerificationProgress,
        );

        results.set(resourceTxId, result);
        return result;
      }),
    );

    await Promise.all(verifications);

    return results;
  }

  /**
   * Verify data stream, with manifest detection and recursive verification
   *
   * SECURITY: This method uses stream.tee() to verify the ORIGINAL bytes
   * from the gateway while simultaneously parsing the content. This ensures
   * cryptographic verification is performed on the actual received data,
   * not on re-encoded content.
   *
   * If data is a manifest:
   * 1. Tee stream into verifyBranch and parseBranch
   * 2. Verify original bytes via base strategy (in parallel)
   * 3. Parse manifest from parseBranch (in parallel)
   * 4. After both complete, verify nested resources
   *
   * If data is not a manifest:
   * - Verification still completes via base strategy
   * - No nested resource verification
   */
  async verifyData({
    data,
    headers,
    txId,
  }: {
    data: DataStream;
    headers: Record<string, string>;
    txId: string;
  }): Promise<void> {
    // Check if this looks like a manifest based on content-type
    const mightBeManifest =
      this.isManifestContentType(headers) ||
      this.getHeader(headers, 'content-type')?.includes('json');

    if (!mightBeManifest) {
      this.logger.debug(
        'Not a manifest (based on content-type), using base strategy',
        {
          txId,
          contentType: this.getHeader(headers, 'content-type'),
        },
      );
      return this.baseStrategy.verifyData({ data, headers, txId });
    }

    // SECURITY FIX: Use tee() to verify original stream while parsing
    // This ensures we verify the actual bytes received, not re-encoded content
    const stream = data as ReadableStream<Uint8Array>;

    if (!stream.tee) {
      // If stream doesn't support tee (shouldn't happen), fall back to base strategy
      this.logger.warn('Stream does not support tee(), using base strategy', {
        txId,
      });
      return this.baseStrategy.verifyData({ data, headers, txId });
    }

    const [verifyBranch, parseBranch] = stream.tee();

    // Start verification of ORIGINAL bytes in parallel
    const verificationPromise = this.baseStrategy.verifyData({
      data: verifyBranch,
      headers,
      txId,
    });

    // Parse manifest from second branch in parallel
    let parsed: { manifest: ArweaveManifest; rawContent: string } | null = null;
    try {
      parsed = await this.tryParseManifest(parseBranch);
    } catch (error) {
      this.logger.debug('Failed to parse as manifest', { txId, error });
    }

    // Wait for base verification to complete
    // This verifies the ORIGINAL bytes from the gateway
    await verificationPromise;

    if (!parsed) {
      // Content has JSON content-type but isn't a valid manifest
      // Base verification already completed, so we're done
      this.logger.debug(
        'Not a valid manifest, but base verification completed',
        {
          txId,
        },
      );
      return;
    }

    // It's a manifest! Emit detection event
    const totalResources = ManifestParser.getAllTransactionIds(
      parsed.manifest,
    ).length;
    this.emitter?.emit(
      'manifest-progress' as any,
      {
        type: 'manifest-detected',
        txId,
        totalResources,
      } as ManifestVerificationProgress,
    );

    // Now verify all nested resources
    // Note: The manifest itself was already verified above via base strategy
    await this.verifyNestedResources({
      txId,
      manifest: parsed.manifest,
      depth: 0,
    });
  }

  /**
   * Verify nested resources in a manifest
   * Separated from main verification to avoid re-verifying the manifest itself
   */
  private async verifyNestedResources({
    txId,
    manifest,
    depth = 0,
  }: {
    txId: string;
    manifest: ArweaveManifest;
    depth?: number;
  }): Promise<void> {
    // Check depth limit
    if (depth > this.maxDepth) {
      throw new Error(
        `Maximum manifest nesting depth (${this.maxDepth}) exceeded`,
      );
    }

    const totalResources = ManifestParser.getAllTransactionIds(manifest).length;

    this.emitter?.emit(
      'manifest-progress' as any,
      {
        type: 'manifest-parsed',
        txId,
        manifest,
        totalResources,
      } as ManifestVerificationProgress,
    );

    this.logger.debug('Verifying manifest nested resources', {
      txId,
      totalResources,
      depth,
    });

    // Verify all nested resources
    const results = await this.verifyManifestResources({
      manifest,
      parentTxId: txId,
      depth: depth + 1,
    });

    // Check if all resources verified successfully
    const failed = Array.from(results.values()).filter((r) => !r.verified);
    const allVerified = failed.length === 0;

    this.emitter?.emit(
      'manifest-progress' as any,
      {
        type: 'manifest-complete',
        txId,
        totalVerified: results.size - failed.length,
        totalFailed: failed.length,
        allVerified,
      } as ManifestVerificationProgress,
    );

    if (!allVerified) {
      const errors = failed.map((r) => `${r.txId}: ${r.error?.message}`);
      throw new Error(
        `Manifest verification failed: ${failed.length} resource(s) failed verification: ${errors.join(', ')}`,
      );
    }
  }
}
