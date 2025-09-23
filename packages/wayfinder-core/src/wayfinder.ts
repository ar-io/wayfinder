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

import { defaultLogger } from './logger.js';

import { Span, type Tracer, context, trace } from '@opentelemetry/api';
import { NodeTracerProvider } from '@opentelemetry/sdk-trace-node';
import { WebTracerProvider } from '@opentelemetry/sdk-trace-web';
import { WayfinderEmitter } from './emitter.js';
import { StaticGatewaysProvider } from './gateways/static.js';
import { PingRoutingStrategy } from './routing/ping.js';
import { RandomRoutingStrategy } from './routing/random.js';
import { initTelemetry, startRequestSpans } from './telemetry.js';
import type {
  GatewaysProvider,
  Logger,
  RoutingStrategy,
  TelemetrySettings,
  VerificationStrategy,
  WayfinderOptions,
  WayfinderURL,
  WayfinderURLParams,
} from './types.js';
import { sandboxFromId } from './utils/base64.js';
import { HashVerificationStrategy } from './verification/hash-verification.js';

// headers
export const wayfinderRequestHeaders = ({
  traceId,
}: {
  traceId?: string;
}) => {
  return {
    'x-ar-io-component': 'wayfinder',
    // TODO: add the version to the header
    ...(traceId ? { 'x-ar-io-trace-id': traceId } : {}),
  };
};

// known regexes for wayfinder urls
export const arnsRegex = /^[a-z0-9_-]{1,51}$/;
export const txIdRegex = /^[A-Za-z0-9_-]{43}$/;

/**
 * Parses the original URL from the params and returns a WayfinderURL (e.g. ar://<txId>)
 * @param params - The params to parse
 * @returns The WayfinderURL
 */
export const createWayfinderUrl = (
  params: WayfinderURLParams,
): WayfinderURL => {
  // only allow one of the params to be provided
  if (Object.keys(params).length !== 1) {
    throw new Error(
      'Invalid URL params, only one of the following is allowed: originalUrl, wayfinderUrl, txId, arnsName',
    );
  }

  let wayfinderUrl: WayfinderURL;
  if ('originalUrl' in params) {
    // for backwards compatibility, if the original url is already a wayfinder url, return it as-is
    if (params.originalUrl.startsWith('ar://')) {
      return params.originalUrl as WayfinderURL;
    }
    // parse out old urls to arweave.net and arweave.dev, e.g. put it into a URL and get the path
    const url = new URL(params.originalUrl);
    // hard coded for now, but can extend to other hosts
    if (
      url.hostname.toLowerCase().includes('arweave.net') ||
      url.hostname.toLowerCase().includes('arweave.dev')
    ) {
      wayfinderUrl = `ar://${url.pathname.startsWith('/') ? url.pathname.slice(1) : url.pathname}`;
    } else {
      throw new Error('Invalid URL');
    }
  } else if ('wayfinderUrl' in params) {
    wayfinderUrl = params.wayfinderUrl;
  } else if ('txId' in params) {
    wayfinderUrl = `ar://${params.txId}`;
  } else if ('arnsName' in params) {
    wayfinderUrl = `ar://${params.arnsName}`;
  } else {
    throw new Error('Invalid URL params');
  }

  return wayfinderUrl;
};

/**
 * Extracts subdomain and path information from an ar:// URL for routing purposes
 * @param arUrl - the ar:// URL to parse
 * @returns object containing subdomain and path for gateway routing
 */
export const extractRoutingInfo = (
  arUrl: string,
): { subdomain: string; path: string } => {
  if (!arUrl.startsWith('ar://')) {
    return { subdomain: '', path: '' };
  }

  const [, pathPart] = arUrl.split('ar://');

  // Handle ar:///info style URLs (direct gateway endpoints)
  if (pathPart.startsWith('/')) {
    return { subdomain: '', path: pathPart };
  }

  // Split path to get the first part (name/txId) and remaining path components
  const [firstPart, ...rest] = pathPart.split('/');
  const remainingPath = rest.length > 0 ? `/${rest.join('/')}` : '';

  if (txIdRegex.test(firstPart)) {
    // For transaction IDs, use sandbox subdomain
    const sandbox = sandboxFromId(firstPart);
    return {
      subdomain: sandbox,
      path: `/${firstPart}${remainingPath}`,
    };
  }

  const firstPartLowerCase = firstPart.toLowerCase();

  if (arnsRegex.test(firstPartLowerCase)) {
    // For ArNS names, use the name as subdomain
    return {
      subdomain: firstPartLowerCase,
      path: remainingPath || '/',
    };
  }

  // Default case - no special routing
  return { subdomain: '', path: `/${pathPart}` };
};

/**
 * Constructs the final gateway URL using the selected gateway and routing information
 * @param selectedGateway - the selected gateway
 * @param subdomain - the subdomain to prepend to the gateway
 * @param path - the path to append to the gateway
 * @param logger - optional logger for debugging
 * @returns the constructed URL
 */
export const constructGatewayUrl = ({
  selectedGateway,
  subdomain,
  path,
}: {
  selectedGateway: URL;
  subdomain: string;
  path: string;
}): URL => {
  const gatewayUrl = new URL(selectedGateway);

  if (subdomain) {
    gatewayUrl.hostname = `${subdomain}.${gatewayUrl.hostname}`;
  }

  const [pathname, rawQuery] = path.split('?');
  gatewayUrl.pathname = pathname;

  if (rawQuery) {
    gatewayUrl.search = rawQuery;
  }
  return gatewayUrl;
};

export function tapAndVerifyReadableStream({
  originalStream,
  contentLength,
  verifyData,
  txId,
  emitter,
  headers = {},
  strict = false,
}: {
  originalStream: ReadableStream;
  contentLength: number;
  headers?: Record<string, string>;
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
      headers,
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

    const url = input instanceof URL ? input.toString() : input.toString();
    const requestEmitter = new WayfinderEmitter({
      verification: requestVerificationSettings?.events,
      routing: requestRoutingSettings?.events,
      parentEmitter: emitter,
    });

    const { parentSpan } = startRequestSpans({
      originalUrl: url,
      verificationSettings: requestVerificationSettings ?? verificationSettings,
      routingSettings: requestRoutingSettings ?? routingSettings,
      gatewaysProvider,
      emitter: requestEmitter,
      tracer,
    });

    if (!url.toString().startsWith('ar://')) {
      logger?.debug('URL is not a wayfinder url, skipping routing', {
        input,
      });
      requestEmitter.emit('routing-skipped', {
        originalUrl: JSON.stringify(input),
      });
      return fetch(input, init);
    }

    requestEmitter.emit('routing-started', {
      originalUrl: input.toString(),
    });

    const maxRetries = 3;
    const retryDelay = 1000;
    let requestSpan: Span | undefined;

    for (let i = 0; i < maxRetries; i++) {
      try {
        // extract routing information from the ar:// URL
        const { subdomain, path } = extractRoutingInfo(url);

        // select the target gateway
        const selectedGateway = await routingSettings.strategy?.selectGateway({
          gateways: await gatewaysProvider.getGateways(),
          path,
          subdomain,
        });

        if (!selectedGateway) {
          throw new Error('Failed to select a gateway');
        }

        logger?.debug('Selected gateway', {
          originalUrl: url,
          selectedGateway: selectedGateway?.toString(),
        });

        // construct the final gateway URL
        const redirectUrl = constructGatewayUrl({
          selectedGateway,
          subdomain,
          path,
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

        requestSpan = parentSpan
          ? tracer?.startSpan(
              'wayfinder.fetch',
              undefined,
              trace.setSpan(context.active(), parentSpan),
            )
          : undefined;

        // make the request to the target gateway using the redirect url
        const response = await fetch(redirectUrl.toString(), {
          // enforce CORS given we're likely going to a different origin, but always allow the client to override
          redirect: 'follow',
          mode: 'cors',
          headers: {
            // add wayfinder headers, but allow the client to override
            ...wayfinderRequestHeaders({
              traceId: requestSpan?.spanContext().traceId,
            }),
            ...restInit.headers,
          },
          ...restInit,
        });

        // add response attributes to the span
        requestSpan?.setAttribute('response.url', redirectUrl.toString());
        requestSpan?.setAttribute('response.status', response.status);
        requestSpan?.setAttribute('response.statusText', response.statusText);
        response.headers.forEach((value, key) => {
          requestSpan?.setAttribute(`response.headers.${key}`, value);
        });

        logger?.debug(`Successfully routed request to gateway`, {
          redirectUrl: redirectUrl.toString(),
          originalUrl: url,
        });

        // only verify data if the redirect url is different from the original url
        if (redirectUrl.toString() === url) {
          logger?.debug(
            'Redirect URL is the same as the original URL, skipping verification',
            {
              redirectUrl: redirectUrl.toString(),
              originalUrl: url,
            },
          );
          requestEmitter.emit('verification-skipped', {
            originalUrl: url,
          });
          requestSpan?.end();
          return response;
        }

        // if verification is disabled, return the response
        if (
          !(
            verificationSettings.enabled &&
            verificationSettings.strategy?.verifyData
          )
        ) {
          logger?.debug(
            'Verification is disabled or no verification strategy is provided, skipping verification',
            {
              redirectUrl: redirectUrl.toString(),
              originalUrl: url,
            },
          );
          requestEmitter.emit('verification-skipped', {
            originalUrl: url,
          });
          requestSpan?.end();
          return response;
        }

        // Verify the response
        const headers = response.headers;

        // transaction id is either in the response headers or the path of the request as the first parameter
        const txId =
          headers.get('x-arns-resolved-id') ??
          redirectUrl.pathname.split('/')[1];

        const contentLength = +(headers.get('content-length') ?? 0);

        requestSpan?.setAttribute('txId', txId);
        requestSpan?.setAttribute('contentLength', contentLength);
        requestSpan?.end();

        if (!txIdRegex.test(txId)) {
          // no transaction id found, skip verification
          logger?.debug('No transaction id found, skipping verification', {
            redirectUrl: redirectUrl.toString(),
            originalUrl: url,
          });
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
            headers: Object.keys(headers).reduce(
              (acc, key) => {
                acc[key] = headers.get(key) ?? '';
                return acc;
              },
              {} as Record<string, string>,
            ),
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
      } catch (error: any) {
        logger?.debug('Failed to route request', {
          error: error.message,
          stack: error.stack,
          originalUrl: url,
          attempt: i + 1,
          maxRetries,
        });
        if (i < maxRetries - 1) {
          await new Promise((resolve) => setTimeout(resolve, retryDelay));
        }
      } finally {
        requestSpan?.end();
      }
    }

    throw new Error('Failed to route request after max retries', {
      cause: {
        originalUrl: url,
        maxRetries,
      },
    });
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
  public readonly verificationSettings: Required<
    Omit<NonNullable<WayfinderOptions['verificationSettings']>, 'strategy'>
  > & {
    strategy: VerificationStrategy | undefined;
  };

  /**
   * Telemetry configuration used for OpenTelemetry tracing
   */
  public readonly telemetrySettings: TelemetrySettings;

  /**
   * OpenTelemetry tracer provider instance
   */
  protected tracerProvider?: WebTracerProvider | NodeTracerProvider;

  /**
   * OpenTelemetry tracer instance
   */
  protected tracer?: Tracer;

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
    logger,
    gatewaysProvider,
    verificationSettings,
    routingSettings,
    telemetrySettings,
  }: WayfinderOptions = {}) {
    // default logger to use if no logger is provided
    this.logger = logger ?? defaultLogger;

    // default gateways provider to use if no provider is provided
    this.gatewaysProvider =
      gatewaysProvider ??
      new StaticGatewaysProvider({
        gateways: [
          'https://permagate.io',
          'https://arweave.net',
          'https://ardrive.net',
        ],
      });

    // default verification settings
    this.verificationSettings = {
      enabled:
        verificationSettings?.enabled ??
        verificationSettings?.strategy !== undefined,
      events: {},
      strict: false,
      strategy:
        (verificationSettings?.strategy ?? verificationSettings?.enabled)
          ? new HashVerificationStrategy({
              logger,
              trustedGateways: [new URL('https://permagate.io')],
            })
          : undefined,
      // overwrite the default settings with the provided ones
      ...verificationSettings,
    };

    // default routing settings
    this.routingSettings = {
      events: {},
      strategy: new PingRoutingStrategy({
        logger,
        routingStrategy: new RandomRoutingStrategy({ logger }),
      }),
      // overwrite the default settings with the provided ones
      ...routingSettings,
    };

    this.emitter = new WayfinderEmitter({
      verification: this.verificationSettings?.events,
      routing: this.routingSettings?.events,
    });

    this.telemetrySettings = {
      enabled: telemetrySettings?.enabled ?? false,
      sampleRate: telemetrySettings?.sampleRate,
      apiKey: telemetrySettings?.apiKey,
      exporterUrl: telemetrySettings?.exporterUrl,
      clientName: telemetrySettings?.clientName,
      clientVersion: telemetrySettings?.clientVersion,
    };

    const { tracerProvider, tracer } =
      initTelemetry(this.telemetrySettings) ?? {};
    this.tracerProvider = tracerProvider;
    this.tracer = tracer;

    // send an event that the wayfinder is initialized
    this.tracer
      ?.startSpan('wayfinder.initialized', {
        attributes: {
          'verification.strategy':
            this.verificationSettings.strategy?.constructor.name,
          'verification.enabled': this.verificationSettings.enabled,
          'verification.trustedGateways':
            this.verificationSettings.strategy?.trustedGateways.map((gateway) =>
              gateway.toString(),
            ),
          'routing.strategy': this.routingSettings.strategy?.constructor.name,
          'telemetry.enabled': this.telemetrySettings.enabled,
          'telemetry.sampleRate': this.telemetrySettings.sampleRate,
        },
      })
      .end();

    this.logger.debug('Initialized Wayfinder', {
      logger: this.logger,
      verificationSettings: this.verificationSettings,
      routingSettings: this.routingSettings,
      telemetrySettings: this.telemetrySettings,
    });
  }

  // TODO: consider property getters and setters for strategies and settings

  /**
   * Sets the routing strategy to use for routing requests.
   *
   * @example
   * const wayfinder = new Wayfinder();
   * wayfinder.setRoutingStrategy(new RandomRoutingStrategy());
   *
   * @param strategy - The routing strategy to use
   */
  setRoutingStrategy(strategy: RoutingStrategy) {
    this.routingSettings.strategy = strategy;
  }

  /**
   * Sets the verification strategy to use for verifying requests.
   *
   * @example
   * const wayfinder = new Wayfinder();
   * wayfinder.setVerificationStrategy(new HashVerificationStrategy({
   *   trustedGateways: [new URL('https://permagate.io')],
   * }));
   *
   * @param strategy - The verification strategy to use
   */
  setVerificationStrategy(strategy: VerificationStrategy) {
    this.verificationSettings.strategy = strategy;
  }

  /**
   * Disables verification for requests.
   *
   * @example
   * const wayfinder = new Wayfinder({
   *   verificationSettings: {
   *     enabled: true,
   *   },
   * });
   *
   * // disable verification
   * wayfinder.disableVerification();
   *
   * // enable verification with strict mode
   * wayfinder.enableVerification({ strict: true });
   */
  disableVerification() {
    this.verificationSettings.enabled = false;
  }

  /**
   * Enables verification for requests.
   *
   * @example
   * const wayfinder = new Wayfinder({
   *   verificationSettings: {
   *     enabled: false,
   *   },
   * });
   *
   * // enable verification with strict mode
   * wayfinder.enableVerification({ strict: true });
   *
   * // enable verification without strict mode
   * wayfinder.enableVerification();
   * @param strict - Whether to make verification strict
   */
  enableVerification({
    strict = false,
    strategy,
  }: {
    strict?: boolean;
    strategy?: VerificationStrategy;
  } = {}) {
    this.verificationSettings.enabled = true;
    this.verificationSettings.strict = strict;
    this.verificationSettings.strategy =
      strategy ??
      this.verificationSettings.strategy ??
      new HashVerificationStrategy({
        logger: this.logger,
        trustedGateways: [new URL('https://permagate.io')],
      });
  }

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
  request(
    input: URL | RequestInfo,
    init?: RequestInit & {
      verificationSettings?: NonNullable<
        WayfinderOptions['verificationSettings']
      >;
      routingSettings?: NonNullable<WayfinderOptions['routingSettings']>;
    },
  ): Promise<Response> {
    return wayfinderFetch({
      logger: this.logger,
      gatewaysProvider: this.gatewaysProvider,
      emitter: this.emitter,
      routingSettings: this.routingSettings,
      verificationSettings: this.verificationSettings,
      tracer: this.tracer,
    })(input, init);
  }

  /**
   * A helper function that resolves a provided url to a target gateway using the current routing strategy.
   *
   * Note: no verification is done when calling this function.
   * It just generates the redirect url based on the routing strategy.
   * In order to verify the data, you must use the `request` function or request the data and
   * verify it yourself via the `verifyData` function.
   *
   * @example
   * const { resolveUrl } = new Wayfinder();
   *
   * // returns the redirected URL based on the routing strategy and the original url
   * const redirectUrl = await resolveUrl({
   *   originalUrl: 'https://arweave.net/<txId>',
   * });
   *
   * // returns the redirected URL based on the routing strategy and the provided arns name
   * const redirectUrl = await resolveUrl({
   *   arnsName: 'ardrive',
   * });
   *
   * // returns the redirected URL based on the routing strategy and the provided wayfinder url
   * const redirectUrl = await resolveUrl({
   *   wayfinderUrl: 'ar://1234567890',
   * });
   *
   * // returns the redirected URL based on the routing strategy and the provided txId
   * const redirectUrl = await resolveUrl({
   *   txId: '1234567890',
   * });
   *
   * window.open(redirectUrl.toString(), '_blank');
   */
  async resolveUrl(params: WayfinderURLParams): Promise<URL> {
    // create a span for the resolveUrl function
    const resolveUrlSpan = this.tracer?.startSpan('wayfinder.resolveUrl', {
      attributes: {
        ...Object.entries(params).reduce(
          (acc, [key, value]) => ({
            ...acc,
            [`params.${key}`]: value,
            'routing.strategy': this.routingSettings.strategy?.constructor.name,
          }),
          {},
        ),
      },
    });

    // parse url span that uses the resolveUrl as the parent span
    const wayfinderUrl = createWayfinderUrl(params);

    resolveUrlSpan?.setAttribute('wayfinderUrl', wayfinderUrl);

    // extract routing information from the original URL
    const { subdomain, path } = extractRoutingInfo(wayfinderUrl);

    resolveUrlSpan?.setAttribute('subdomain', subdomain);
    resolveUrlSpan?.setAttribute('path', path);

    const selectedGateway = await this.routingSettings.strategy.selectGateway({
      gateways: await this.gatewaysProvider.getGateways(),
      path,
      subdomain,
    });

    resolveUrlSpan?.setAttribute('selectedGateway', selectedGateway.toString());

    const constructedGatewayUrl = constructGatewayUrl({
      selectedGateway,
      subdomain,
      path,
    });

    resolveUrlSpan?.setAttribute(
      'constructedGatewayUrl',
      constructedGatewayUrl.toString(),
    );
    resolveUrlSpan?.end();

    // return the constructed gateway url
    return constructedGatewayUrl;
  }
}
