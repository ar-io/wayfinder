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
import { EventEmitter } from 'eventemitter3';

import { defaultLogger } from './logger.js';

import { FastestPingRoutingStrategy } from './routing/ping.js';
import type {
  GatewaysProvider,
  Logger,
  TelemetryConfig,
  VerificationStrategy,
  WayfinderEvent,
  WayfinderEventArgs,
  WayfinderFetch,
  WayfinderOptions,
} from './types.js';
import { initTelemetry } from './telemetry.js';
import type { Tracer } from '@opentelemetry/api';
import { SpanStatusCode } from '@opentelemetry/api';
import { sandboxFromId } from './utils/base64.js';
import { HashVerificationStrategy } from './verification/hash-verifier.js';

// known regexes for wayfinder urls
export const arnsRegex = /^[a-z0-9_-]{1,51}$/;
export const txIdRegex = /^[A-Za-z0-9_-]{43}$/;

/**
 * Core function that converts a wayfinder url to the proper ar-io gateway URL
 * @param originalUrl - the wayfinder url to resolve
 * @param selectedGateway - the target gateway to resolve the url against
 * @returns the resolved url that can be used to make a request
 */
export const resolveWayfinderUrl = ({
  originalUrl,
  selectedGateway,
  logger,
}: {
  originalUrl: string;
  selectedGateway: URL;
  logger?: Logger;
}): URL => {
  if (originalUrl.toString().startsWith('ar://')) {
    logger?.debug(`Applying wayfinder routing protocol to ${originalUrl}`, {
      originalUrl,
    });
    const [, path] = originalUrl.toString().split('ar://');

    // e.g. ar:///info should route to the info endpoint of the target gateway
    if (path.startsWith('/')) {
      logger?.debug(`Routing to ${path.slice(1)} on ${selectedGateway}`, {
        originalUrl,
        selectedGateway,
      });
      return new URL(path.slice(1), selectedGateway);
    }

    // Split path to get the first part (name/txId) and remaining path components
    const [firstPart, ...rest] = path.split('/');

    // TODO: this breaks 43 character named arns names - we should check a a local name cache list before resolving raw transaction ids
    if (txIdRegex.test(firstPart)) {
      const sandbox = sandboxFromId(firstPart);
      return new URL(
        `${firstPart}${rest.length > 0 ? '/' + rest.join('/') : ''}`,
        `${selectedGateway.protocol}//${sandbox}.${selectedGateway.hostname}`,
      );
    }

    if (arnsRegex.test(firstPart)) {
      // TODO: tests to ensure arns names support query params and paths
      const arnsUrl = `${selectedGateway.protocol}//${firstPart}.${selectedGateway.hostname}${selectedGateway.port ? `:${selectedGateway.port}` : ''}`;
      logger?.debug(`Routing to ${path} on ${arnsUrl}`, {
        originalUrl,
        selectedGateway,
      });
      return new URL(rest.length > 0 ? rest.join('/') : '', arnsUrl);
    }

    // TODO: support .eth addresses
    // TODO: "gasless" routing via DNS TXT records
  }

  logger?.debug('No wayfinder routing protocol applied', {
    originalUrl,
  });

  // return the original url if it's not a wayfinder url
  return new URL(originalUrl);
};

export class WayfinderEmitter extends EventEmitter<WayfinderEvent> {
  constructor({ verification, routing }: WayfinderEventArgs = {}) {
    super();
    if (verification) {
      if (verification.onVerificationSucceeded) {
        this.on('verification-succeeded', verification.onVerificationSucceeded);
      }
      if (verification.onVerificationFailed) {
        this.on('verification-failed', verification.onVerificationFailed);
      }
      if (verification.onVerificationProgress) {
        this.on('verification-progress', verification.onVerificationProgress);
      }
    }
    if (routing) {
      if (routing.onRoutingStarted) {
        this.on('routing-started', routing.onRoutingStarted);
      }
      if (routing.onRoutingSkipped) {
        this.on('routing-skipped', routing.onRoutingSkipped);
      }
      if (routing.onRoutingSucceeded) {
        this.on('routing-succeeded', routing.onRoutingSucceeded);
      }
    }
  }
}

export function tapAndVerifyReadableStream({
  originalStream,
  contentLength,
  verifyData,
  txId,
  emitter,
  strict = false,
}: {
  originalStream: ReadableStream;
  contentLength: number;
  verifyData: VerificationStrategy['verifyData'];
  txId: string;
  emitter?: WayfinderEmitter;
  strict?: boolean;
}): ReadableStream {
  if (
    originalStream instanceof ReadableStream &&
    typeof originalStream.tee === 'function'
  ) {
    /**
     * NOTE: tee requires the streams both streams to be consumed, so we need to make sure we consume the client branch
     * by the caller. This means when `request` is called, the client stream must be consumed by the caller via await request.text()
     * for verification to complete.
     *
     * It is feasible to make the verification stream not to depend on the client branch being consumed, should the DX not be obvious.
     */
    const [verifyBranch, clientBranch] = originalStream.tee();

    // setup our promise to verify the data
    const verificationPromise = verifyData({
      data: verifyBranch,
      txId,
    });

    let bytesProcessed = 0;
    const reader = clientBranch.getReader();
    const clientStreamWithVerification = new ReadableStream({
      async pull(controller) {
        const { done, value } = await reader.read();
        if (done) {
          if (strict) {
            // in strict mode, we wait for verification to complete before closing the controller
            try {
              await verificationPromise;
              emitter?.emit('verification-succeeded', { txId });
              controller.close();
            } catch (err) {
              // emit the verification failed event
              emitter?.emit('verification-failed', err);

              // In strict mode, we report the error to the client stream
              controller.error(
                new Error('Verification failed', { cause: err }),
              );
            }
          } else {
            // trigger the verification promise and emit events for the result
            verificationPromise
              .then(() => {
                emitter?.emit('verification-succeeded', { txId });
              })
              .catch((error: unknown) => {
                emitter?.emit('verification-failed', error);
              });
            // in non-strict mode, we close the controller immediately and handle verification asynchronously
            controller.close();
          }
        } else {
          bytesProcessed += value.length;
          emitter?.emit('verification-progress', {
            txId,
            totalBytes: contentLength,
            processedBytes: bytesProcessed,
          });
          controller.enqueue(value);
        }
      },
      cancel(reason) {
        // cancel the reader regardless of verification status
        reader.cancel(reason);

        // emit the verification cancellation event
        emitter?.emit('verification-failed', {
          txId,
          error: new Error('Verification cancelled', {
            cause: {
              reason,
            },
          }),
        });
      },
    });
    return clientStreamWithVerification;
  }
  throw new Error('Unsupported body type for cloning');
}

/**
 * Creates a wrapped fetch function that supports ar:// protocol
 *
 * This function leverages a Proxy to intercept calls to fetch
 * and redirects them to the target gateway using the resolveUrl function.
 *
 * Any URLs provided that are not wayfinder urls will be passed directly to fetch.
 *
 * @param resolveUrl - the function to construct the redirect url for ar:// requests
 * @returns a wrapped fetch function that supports ar:// protocol and always returns Response
 */
export const wayfinderFetch = ({
  logger = defaultLogger,
  gatewaysProvider,
  verificationSettings,
  routingSettings,
  emitter,
  tracer,
}: {
  logger?: Logger;
  gatewaysProvider: GatewaysProvider;
  verificationSettings: NonNullable<WayfinderOptions['verificationSettings']>;
  routingSettings: NonNullable<WayfinderOptions['routingSettings']>;
  emitter?: WayfinderEmitter;
  tracer?: Tracer;
}) => {
  return async (
    input: URL | RequestInfo,
    init?: RequestInit & {
      verificationSettings?: NonNullable<
        WayfinderOptions['verificationSettings']
      >;
      routingSettings?: NonNullable<WayfinderOptions['routingSettings']>;
    },
  ): Promise<Response> => {
    const {
      // allows for overriding the verification and routing settings for a single request
      verificationSettings: requestVerificationSettings,
      routingSettings: requestRoutingSettings,
      ...restInit
    } = init ?? {};

    const span = tracer?.startSpan('wayfinder.request', {
      attributes: {
        'wayfinder.original_url':
          input instanceof URL ? input.toString() : input.toString(),
      },
    });

    const requestEmitter = new WayfinderEmitter({
      verification: requestVerificationSettings?.events,
      routing: requestRoutingSettings?.events,
    });

    if (span) {
      requestEmitter.on('routing-started', (event) =>
        span.addEvent('routing-started', event),
      );
      requestEmitter.on('routing-skipped', (event) =>
        span.addEvent('routing-skipped', event),
      );
      requestEmitter.on('routing-succeeded', (event) =>
        span.addEvent('routing-succeeded', event),
      );
      requestEmitter.on('verification-succeeded', (event) =>
        span.addEvent('verification-succeeded', event),
      );
      requestEmitter.on('verification-failed', (event) =>
        span.addEvent('verification-failed', event),
      );
      requestEmitter.on('verification-progress', (event) =>
        span.addEvent('verification-progress', event),
      );
    }

    if (emitter) {
      requestEmitter.on('routing-started', (event) => {
        emitter.emit('routing-started', event);
      });
      requestEmitter.on('routing-skipped', (event) =>
        emitter.emit('routing-skipped', event),
      );
      requestEmitter.on('routing-succeeded', (event) =>
        emitter.emit('routing-succeeded', event),
      );
      requestEmitter.on('verification-succeeded', (event) =>
        emitter.emit('verification-succeeded', event),
      );
      requestEmitter.on('verification-failed', (event) =>
        emitter.emit('verification-failed', event),
      );
      requestEmitter.on('verification-progress', (event) =>
        emitter.emit('verification-progress', event),
      );
    }

    const url = input instanceof URL ? input.toString() : input.toString();

    if (!url.toString().startsWith('ar://')) {
      logger?.debug('URL is not a wayfinder url, skipping routing', {
        input,
      });
      requestEmitter.emit('routing-skipped', {
        originalUrl: JSON.stringify(input),
      });
      span?.setAttribute('wayfinder.redirect_url', url);
      span?.setStatus({ code: SpanStatusCode.OK });
      span?.end();
      return fetch(input, init);
    }

    requestEmitter.emit('routing-started', {
      originalUrl: input.toString(),
    });

    const maxRetries = 3;
    const retryDelay = 1000;

    try {
      for (let i = 0; i < maxRetries; i++) {
        try {
          // select the target gateway
          const selectedGateway = await routingSettings.strategy?.selectGateway(
            {
              gateways: await gatewaysProvider.getGateways(),
              path: url.split('/').slice(1).join('/'), // everything after the first /
              subdomain: '',
            },
          );

          if (!selectedGateway) {
            throw new Error('Failed to select a gateway');
          }

          logger?.debug('Selected gateway', {
            originalUrl: url,
            selectedGateway: selectedGateway?.toString(),
          });

          // route the request to the target gateway
          const redirectUrl = await resolveWayfinderUrl({
            originalUrl: url.toString(),
            selectedGateway,
            logger,
          });

          requestEmitter.emit('routing-succeeded', {
            originalUrl: url,
            selectedGateway: selectedGateway.toString(),
            redirectUrl: redirectUrl.toString(),
          });

          logger?.debug(`Redirecting request`, {
            originalUrl: url,
            redirectUrl: redirectUrl.toString(),
          });

          // make the request to the target gateway using the redirect url
          const response = await fetch(redirectUrl.toString(), {
            // enforce CORS given we're likely going to a different origin, but always allow the client to override
            redirect: 'follow',
            mode: 'cors',
            ...restInit,
          });

          logger?.debug(`Successfully routed request to gateway`, {
            redirectUrl: redirectUrl.toString(),
            originalUrl: url,
          });

          // only verify data if the redirect url is different from the original url
          if (redirectUrl.toString() !== url) {
            if (
              verificationSettings.enabled &&
              verificationSettings.strategy?.verifyData
            ) {
              const headers = response.headers;

              // transaction id is either in the response headers or the path of the request as the first parameter
              const txId =
                headers.get('x-arns-resolved-id') ??
                redirectUrl.pathname.split('/')[1];

              const contentLength = +(headers.get('content-length') ?? 0);

              if (!txIdRegex.test(txId)) {
                // no transaction id found, skip verification
                logger?.debug(
                  'No transaction id found, skipping verification',
                  {
                    redirectUrl: redirectUrl.toString(),
                    originalUrl: url,
                  },
                );
                requestEmitter.emit('verification-skipped', {
                  originalUrl: url,
                });
                return response;
              }

              // Check if the response has a body
              if (response.body) {
                const newClientStream = tapAndVerifyReadableStream({
                  originalStream: response.body,
                  contentLength,
                  verifyData: verificationSettings.strategy?.verifyData.bind(
                    verificationSettings.strategy,
                  ),
                  txId,
                  emitter: requestEmitter,
                  strict: verificationSettings.strict,
                });

                return new Response(newClientStream, {
                  status: response.status,
                  statusText: response.statusText,
                  headers: response.headers,
                });
              } else {
                // No response body to verify, skip verification
                logger?.debug('No response body to verify', {
                  redirectUrl: redirectUrl.toString(),
                  originalUrl: url,
                  txId,
                });
                return response;
              }
            }
          }
          span?.setAttribute('wayfinder.redirect_url', redirectUrl.toString());
          span?.setStatus({ code: SpanStatusCode.OK });
          return response;
        } catch (error: any) {
          logger?.debug('Failed to route request', {
            error: error.message,
            stack: error.stack,
            originalUrl: url,
            attempt: i + 1,
            maxRetries,
          });
          span?.addEvent('request-error', {
            attempt: i + 1,
            error: error.message,
          });
          if (i < maxRetries - 1) {
            await new Promise((resolve) => setTimeout(resolve, retryDelay));
          }
        }
      }

      throw new Error('Failed to route request after max retries', {
        cause: {
          originalUrl: url,
          maxRetries,
        },
      });
    } catch (err: any) {
      span?.recordException(err);
      span?.setStatus({ code: SpanStatusCode.ERROR, message: err?.message });
      throw err;
    } finally {
      span?.end();
    }
  };
};

/**
 * The main class for the wayfinder
 */
export class Wayfinder {
  /**
   * The gateways provider is responsible for providing the list of gateways to use for routing requests.
   *
   * @example
   * const wayfinder = new Wayfinder({
   *   gatewaysProvider: new SimpleCacheGatewaysProvider({
   *     gatewaysProvider: new NetworkGatewaysProvider({ ario: ARIO.mainnet() }),
   *     ttlSeconds: 60 * 60 * 24, // 1 day
   *   }),
   * });
   */
  public readonly gatewaysProvider: GatewaysProvider;

  /**
   * The routing settings to use when routing requests.
   * This includes the routing strategy and event handlers for routing events.
   * If not provided, the default FastestPingRoutingStrategy will be used.
   */
  public readonly routingSettings: Required<
    NonNullable<WayfinderOptions['routingSettings']>
  >;
  /**
   * The verification settings to use when verifying data.
   */
  public readonly verificationSettings: WayfinderOptions['verificationSettings'];

  /**
   * Telemetry configuration used for OpenTelemetry tracing
   */
  public readonly telemetryConfig: TelemetryConfig;

  /**
   * OpenTelemetry tracer instance
   */
  protected tracer?: Tracer;

  /**
   * A helper function that resolves the redirect url for ar:// requests to a target gateway.
   *
   * Note: no verification is done when resolving an ar://<path> url to a wayfinder route.
   * In order to verify the data, you must use the `request` function or request the data and
   * verify it yourself via the `verifyData` function.
   *
   * @example
   * const { resolveUrl } = new Wayfinder();
   *
   * // returns the redirected URL based on the routing strategy and the original url
   * const redirectUrl = await resolveUrl({ originalUrl: 'ar://example' });
   *
   * window.open(redirectUrl.toString(), '_blank');
   */
  public readonly resolveUrl: (params: {
    originalUrl: string;
    logger?: Logger;
  }) => Promise<URL>;

  /**
   * A wrapped fetch function that supports ar:// protocol. If a verification strategy is provided,
   * the request will be verified and events will be emitted as the request is processed.
   *
   * @example
   * const wayfinder = new Wayfinder({
   *   verificationStrategy: new HashVerificationStrategy({
   *     trustedGateways: [new URL('https://permagate.io')],
   *   }),
   * })
   *
   * // request an arns name
   * const response = await wayfinder.request('ar://ardrive')
   *
   * // request a transaction id
   * const response = await wayfinder.request('ar://1234567890')
   *
   * // Set strict mode to true to make verification blocking
   * const wayfinder = new Wayfinder({
   *   strict: true,
   * });
   *
   * // This will throw an error if verification fails
   * try {
   *   const response = await wayfinder.request('ar://1234567890');
   * } catch (error) {
   *   console.error('Verification failed', error);
   * }
   */
  public request: WayfinderFetch;

  /**
   * The logger used by this Wayfinder instance
   */
  protected logger: Logger;

  /**
   * The event emitter for wayfinder that emits routing and verification events for all requests.
   *
   * This is useful for tracking all requests and their statuses, and is updated for each request.
   *
   * If you prefer request-specific events, you can pass in the events to the `request` function.
   *
   * @example
   *
   * const wayfinder = new Wayfinder()
   *
   * wayfinder.emitter.on('verification-succeeded', (event) => {
   *   console.log('Verification passed!', event);
   * })
   *
   * wayfinder.emitter.on('verification-failed', (event) => {
   *   console.log('Verification failed!', event);
   * })
   *
   * or implement the events interface and pass it in, using callback functions
   *
   * const wayfinder = new Wayfinder({
   *   verificationSettings: {
   *     strategy: new HashVerificationStrategy({
   *       trustedGateways: [new URL('https://permagate.io')],
   *     }),
   *     events: {
   *       onVerificationProgress: (event) => {
   *         console.log('Verification progress!', event);
   *       },
   *       onVerificationSucceeded: (event) => {
   *         console.log('Verification passed!', event);
   *       },
   *       onVerificationFailed: (event) => {
   *         console.log('Verification failed!', event);
   *       },
   *     },
   *   }
   *   routingSettings: {
   *     strategy: new FastestPingRoutingStrategy({
   *       timeoutMs: 1000,
   *     }),
   *     events: {
   *       onRoutingStarted: (event) => {
   *         console.log('Routing started!', event);
   *       },
   *       onRoutingSkipped: (event) => {
   *         console.log('Routing skipped!', event);
   *       },
   *       onRoutingSucceeded: (event) => {
   *         console.log('Routing succeeded!', event);
   *       },
   *     },
   *   }
   * })
   *
   * const response = await wayfinder.request('ar://example');
   */
  public readonly emitter: WayfinderEmitter;

  /**
   * The constructor for the wayfinder
   * @param options - Wayfinder configuration options
   */
  constructor({
    logger = defaultLogger,
    gatewaysProvider, // forcing it to be required to avoid making ar-io-sdk a dependency
    verificationSettings,
    routingSettings,
    telemetry,
  }: WayfinderOptions) {
    this.logger = logger;
    this.gatewaysProvider = gatewaysProvider;

    // default verification settings
    this.verificationSettings = {
      enabled:
        verificationSettings?.enabled ??
        verificationSettings?.strategy !== undefined,
      strategy: new HashVerificationStrategy({
        trustedGateways: [new URL('https://permagate.io')],
      }),
      // overwrite the default settings with the provided ones
      ...verificationSettings,
    };

    // default routing settings
    this.routingSettings = {
      events: {},
      strategy: new FastestPingRoutingStrategy({
        timeoutMs: 1000,
        maxConcurrency: 5, // 5 concurrent HEAD requests on the requested path
        logger: defaultLogger,
      }),
      // overwrite the default settings with the provided ones
      ...routingSettings,
    };

    this.emitter = new WayfinderEmitter({
      verification: this.verificationSettings?.events,
      routing: this.routingSettings?.events,
    });

    this.telemetryConfig = {
      enabled: telemetry?.enabled ?? true,
      sampleRate: telemetry?.sampleRate ?? 1,
      apiKey: telemetry?.apiKey,
      dataset: telemetry?.dataset ?? 'wayfinder',
      serviceName: telemetry?.serviceName ?? 'wayfinder',
      exporterUrl: telemetry?.exporterUrl,
    };

    this.tracer = initTelemetry(this.telemetryConfig);

    this.request = wayfinderFetch({
      logger: this.logger,
      emitter: this.emitter,
      gatewaysProvider: this.gatewaysProvider,
      routingSettings: this.routingSettings,
      verificationSettings: this.verificationSettings,
      tracer: this.tracer,
    });

    this.resolveUrl = async ({ originalUrl, logger = this.logger }) => {
      const selectedGateway = await this.routingSettings.strategy.selectGateway(
        {
          gateways: await this.gatewaysProvider.getGateways(),
        },
      );

      return resolveWayfinderUrl({
        originalUrl,
        selectedGateway,
        logger,
      });
    };

    this.logger.debug(
      `Wayfinder initialized with ${this.routingSettings.strategy?.constructor.name} routing strategy`,
    );
  }
}
