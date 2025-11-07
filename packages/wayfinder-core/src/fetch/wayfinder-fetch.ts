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
import { createBaseFetch } from './base-fetch.js';

/**
 * Creates a wrapped fetch function that supports ar:// protocol
 
 * @param logger - Optional logger for logging fetch operations
 * @param strict - Whether to enforce strict verification
 * @param fetch - Base fetch function to use for HTTP requests
 * @param routingStrategy - Strategy for selecting gateways
 * @param dataRetrievalStrategy - Strategy for retrieving data
 * @param verificationStrategy - Strategy for verifying data integrity
 * @param emitter - Optional event emitter for wayfinder events
 * @param tracer - Optional OpenTelemetry tracer for tracing fetch operations
 * @param events - Optional event handlers for wayfinder events
 * @returns a wrapped fetch function that supports ar:// protocol and always returns Response
 */
export const createWayfinderFetch = ({
  logger = defaultLogger,
  strict = false,
  fetch = createBaseFetch(),
  routingStrategy = new RandomRoutingStrategy(),
  dataRetrievalStrategy = new ContiguousDataRetrievalStrategy({
    fetch,
  }),
  verificationStrategy,
  emitter,
  tracer,
  events,
}: {
  logger?: Logger;
  verificationStrategy?: VerificationStrategy;
  strict?: boolean;
  routingStrategy?: RoutingStrategy;
  dataRetrievalStrategy?: DataRetrievalStrategy;
  emitter?: WayfinderEmitter;
  tracer?: Tracer;
  fetch?: typeof globalThis.fetch;
  events?: WayfinderEvents;
}): ((
  input: URL | RequestInfo,
  init?: WayfinderRequestInit,
) => Promise<Response>) => {
  return async (
    input: URL | RequestInfo,
    init?: WayfinderRequestInit,
  ): Promise<Response> => {
    /**
     * Summary:
     *
     * 1. Check if URL is ar:// - if not, call fetch directly
     * 2. Extract routing info (subdomain, path, txId, arnsName)
     * 3. Use routing strategy to select gateway
     * 4. Construct gateway URL given the requested resource
     * 5. If no txId or arnsName, perform direct fetch to gateway URL
     * 6. If txId or arnsName present, use data retrieval strategy to fetch data
     * 7. If verification strategy present, verify data stream
     * 8. Return a Response object with the (optionally verified) data stream
     */

    const requestUri =
      input instanceof URL ? input.toString() : input.toString();
    if (!requestUri.startsWith('ar://')) {
      logger?.debug('URL is not a wayfinder url, skipping routing', {
        input,
      });
      emitter?.emit('routing-skipped', {
        originalUrl: JSON.stringify(input),
      });
      return fetch(input, init);
    }

    const { subdomain, path, txId, arnsName } = extractRoutingInfo(requestUri);

    // Create request-specific emitter
    const requestEmitter = new WayfinderEmitter({
      verification: {
        ...events,
        ...init?.verificationSettings?.events,
      },
      routing: {
        ...events,
        ...init?.routingSettings?.events,
      },
      parentEmitter: emitter,
    });

    // Create parent span for the entire fetch operation
    const parentSpan = tracer?.startSpan('wayfinder.fetch');

    // Create request span
    const requestSpan = parentSpan
      ? tracer?.startSpan(
          'wayfinder.fetch.wayfinderDataFetcher',
          undefined,
          trace.setSpan(context.active(), parentSpan),
        )
      : undefined;

    // Add request attributes to span
    requestSpan?.setAttribute('request.url', requestUri);
    requestSpan?.setAttribute('request.method', 'GET');

    // Emit routing started event
    requestEmitter.emit('routing-started', {
      originalUrl: requestUri,
    });

    try {
      logger.debug('Fetching data', {
        uri: requestUri,
        subdomain,
        path,
      });

      // Select gateway using routing strategy
      const selectedGateway = await routingStrategy.selectGateway({
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
        originalUrl: requestUri,
        selectedGateway: selectedGateway.toString(),
        redirectUrl: redirectUrl.toString(),
      });

      // if its a txId or arnsName use the dataRetrievalStrategy to fetch the data; otherwise just call internal fetch
      if (!txId && !arnsName) {
        logger.debug(
          'No transaction ID or ARNS name found, performing direct fetch',
          {
            uri: requestUri,
          },
        );
        return fetch(redirectUrl.toString(), init);
      }

      const requestHeaders = createWayfinderRequestHeaders({
        traceId: requestSpan?.spanContext().traceId,
      });

      // Use data retrieval strategy to fetch the actual data
      const dataResponse = await dataRetrievalStrategy.getData({
        gateway: selectedGateway,
        requestUrl: redirectUrl,
        headers: requestHeaders,
      });

      // If the response is not successful (e.g., 404, 500), return it directly
      if (!dataResponse.ok) {
        logger.debug('Gateway returned error response', {
          uri: requestUri,
          status: dataResponse.status,
          statusText: dataResponse.statusText,
        });
        return dataResponse;
      }

      logger.debug('Successfully fetched data', {
        uri: requestUri,
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

      const finalVerificationStrategy = init?.verificationSettings?.enabled
        ? init.verificationSettings.strategy
        : verificationStrategy;

      // Determine strict mode - check init first, then fall back to instance settings
      const isStrictMode = init?.verificationSettings?.strict ?? strict;

      let finalStream = dataResponse.body;

      // Apply verification if strategy is provided
      if (resolvedDataId && dataResponse.body && finalVerificationStrategy) {
        logger.debug('Applying verification to data stream', {
          dataId: resolvedDataId,
        });

        finalStream = tapAndVerifyReadableStream({
          originalStream: dataResponse.body,
          contentLength: contentLength,
          verifyData: finalVerificationStrategy.verifyData.bind(
            finalVerificationStrategy,
          ),
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
      logger.error('Failed to fetch data', {
        error: error.message,
        stack: error.stack,
        uri: requestUri,
      });
      throw error;
    } finally {
      requestSpan?.end();
      parentSpan?.end();
    }
  };
};
