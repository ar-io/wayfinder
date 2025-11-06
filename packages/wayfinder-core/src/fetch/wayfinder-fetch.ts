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

import { type Tracer, context, trace } from '@opentelemetry/api';
import { arioHeaderNames } from '../constants.js';
import { WayfinderEmitter } from '../emitter.js';
import { defaultLogger } from '../logger.js';
import { ContiguousDataRetrievalStrategy } from '../retrieval/contiguous.js';
import { RandomRoutingStrategy } from '../routing/random.js';
import type {
  DataRetrievalStrategy,
  Logger,
  RoutingStrategy,
  VerificationStrategy,
  WayfinderEvents,
  WayfinderRequestInit,
} from '../types.js';
import { tapAndVerifyReadableStream } from '../utils/verify-stream.js';
import {
  constructGatewayUrl,
  createWayfinderRequestHeaders,
  extractRoutingInfo,
} from '../wayfinder.js';

/**
 * Core data fetcher that orchestrates routing, data retrieval, and verification.
 */
export class WayfinderFetch {
  public logger: Logger;
  public dataRetrievalStrategy: DataRetrievalStrategy;
  public routingStrategy: RoutingStrategy;
  public verificationStrategy?: VerificationStrategy;
  public strict: boolean;
  public emitter?: WayfinderEmitter;
  public tracer?: Tracer;
  public fetch: typeof globalThis.fetch;
  public events?: WayfinderEvents;

  constructor({
    logger = defaultLogger,
    dataRetrievalStrategy = new ContiguousDataRetrievalStrategy(),
    routingStrategy = new RandomRoutingStrategy(),
    verificationStrategy,
    strict = false,
    emitter,
    tracer,
    fetch = globalThis.fetch,
    events,
  }: {
    logger?: Logger;
    dataRetrievalStrategy?: DataRetrievalStrategy;
    routingStrategy?: RoutingStrategy;
    verificationStrategy?: VerificationStrategy;
    strict?: boolean;
    emitter?: WayfinderEmitter;
    tracer?: Tracer;
    fetch?: typeof globalThis.fetch;
    events?: WayfinderEvents;
  }) {
    this.logger = logger;
    this.dataRetrievalStrategy = dataRetrievalStrategy;
    this.routingStrategy = routingStrategy;
    this.verificationStrategy = verificationStrategy;
    this.strict = strict;
    this.emitter = emitter;
    this.tracer = tracer;
    this.fetch = fetch;
    this.events = events;
  }

  async wayfinderFetch(
    input: URL | RequestInfo,
    init?: WayfinderRequestInit,
  ): Promise<Response> {
    // enforce ar:// scheme
    const uri = input instanceof URL ? input.toString() : input.toString();
    if (!uri.startsWith('ar://')) {
      this.logger?.debug('URL is not a wayfinder url, skipping routing', {
        input,
      });
      this.emitter?.emit('routing-skipped', {
        originalUrl: JSON.stringify(input),
      });
      return this.fetch(input, init);
    }

    const { subdomain, path, txId, arnsName } = extractRoutingInfo(uri);

    // Create request-specific emitter
    const requestEmitter = new WayfinderEmitter({
      verification: {
        ...this.events,
        ...init?.verificationSettings?.events,
      },
      routing: {
        ...this.events,
        ...init?.routingSettings?.events,
      },
      parentEmitter: this.emitter,
    });

    // Create parent span for the entire fetch operation
    const parentSpan = this.tracer?.startSpan('wayfinder.fetch');

    // Create request span
    const requestSpan = parentSpan
      ? this.tracer?.startSpan(
          'wayfinder.fetch.wayfinderDataFetcher',
          undefined,
          trace.setSpan(context.active(), parentSpan),
        )
      : undefined;

    // Add request attributes to span
    requestSpan?.setAttribute('request.url', uri);
    requestSpan?.setAttribute('request.method', 'GET');

    // Emit routing started event
    requestEmitter.emit('routing-started', {
      originalUrl: uri,
    });

    try {
      this.logger.debug('Fetching data', {
        uri,
        subdomain,
        path,
      });

      // Select gateway using routing strategy
      const selectedGateway = await this.routingStrategy.selectGateway({
        path,
        subdomain,
      });

      // it's just a non data specific request, construct the gateway URL and fetch directly
      const redirectUrl = constructGatewayUrl({
        selectedGateway,
        subdomain,
        path,
      });

      // Emit routing succeeded event
      requestEmitter.emit('routing-succeeded', {
        originalUrl: uri,
        selectedGateway: selectedGateway.toString(),
        redirectUrl: redirectUrl.toString(),
      });

      // if its a txId or arnsName use the dataRetrievalStrategy to fetch the data; otherwise just call internal fetch
      if (!txId && !arnsName) {
        this.logger.debug(
          'No transaction ID or ARNS name found, performing direct fetch',
          {
            uri,
          },
        );
        return this.fetch(redirectUrl.toString(), init);
      }

      const requestHeaders = createWayfinderRequestHeaders({
        traceId: requestSpan?.spanContext().traceId,
      });

      // Use data retrieval strategy to fetch the actual data
      const dataResponse = await this.dataRetrievalStrategy.getData({
        gateway: selectedGateway.toString(),
        subdomain,
        path,
        headers: requestHeaders,
      });

      // If the response is not successful (e.g., 404, 500), return it directly
      if (!dataResponse.ok) {
        this.logger.debug('Gateway returned error response', {
          uri,
          status: dataResponse.status,
          statusText: dataResponse.statusText,
        });
        return dataResponse;
      }

      this.logger.debug('Successfully fetched data', {
        uri,
      });

      // Extract data ID from headers for verification
      const resolvedDataId =
        dataResponse.headers.get(arioHeaderNames.dataId.toLowerCase()) || txId;

      const contentLength = dataResponse.headers.has('content-length')
        ? parseInt(dataResponse.headers.get('content-length')!, 10)
        : 0;

      const headers: Record<string, string> = {};
      dataResponse.headers.forEach((value, key) => {
        headers[key] = value;
      });

      const verificationStrategy = init?.verificationSettings?.enabled
        ? init.verificationSettings.strategy
        : this.verificationStrategy;

      // Determine strict mode - check init first, then fall back to instance settings
      const isStrictMode = init?.verificationSettings?.strict ?? this.strict;

      let finalStream = dataResponse.body;

      // Apply verification if strategy is provided
      if (resolvedDataId && dataResponse.body && verificationStrategy) {
        this.logger.debug('Applying verification to data stream', {
          dataId: resolvedDataId,
        });

        finalStream = tapAndVerifyReadableStream({
          originalStream: dataResponse.body,
          contentLength: contentLength,
          verifyData:
            verificationStrategy.verifyData.bind(verificationStrategy),
          txId: resolvedDataId,
          headers: headers,
          emitter: requestEmitter,
          strict: isStrictMode,
        });
      }

      return new Response(finalStream, {
        headers: headers,
      });
    } catch (error: any) {
      requestEmitter.emit('routing-failed', error as Error);
      this.logger.error('Failed to fetch data', {
        error: error.message,
        stack: error.stack,
        uri,
      });
      throw error;
    } finally {
      requestSpan?.end();
      parentSpan?.end();
    }
  }
}
