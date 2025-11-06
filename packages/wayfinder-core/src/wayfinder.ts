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

import { type Tracer } from '@opentelemetry/api';
import {
  BasicTracerProvider,
  NodeTracerProvider,
} from '@opentelemetry/sdk-trace-node';
import { WebTracerProvider } from '@opentelemetry/sdk-trace-web';
import { arnsRegex, txIdRegex } from './constants.js';
import { WayfinderEmitter } from './emitter.js';
import { createBaseFetch } from './fetch/base-fetch.js';
import { WayfinderFetch } from './fetch/wayfinder-fetch.js';
import { TrustedPeersGatewaysProvider } from './gateways/trusted-peers.js';
import { PingRoutingStrategy } from './routing/ping.js';
import { RandomRoutingStrategy } from './routing/random.js';
import { initTelemetry } from './telemetry.js';
import type {
  DataRetrievalStrategy,
  GatewaysProvider,
  Logger,
  RoutingStrategy,
  TelemetrySettings,
  VerificationStrategy,
  WayfinderEvents,
  WayfinderOptions,
  WayfinderRequestInit,
  WayfinderURL,
  WayfinderURLParams,
} from './types.js';
import { sandboxFromId } from './utils/base64.js';
import { tapAndVerifyReadableStream } from './utils/verify-stream.js';
import { HashVerificationStrategy } from './verification/hash-verification.js';

// headers
export const createWayfinderRequestHeaders = ({
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
): {
  subdomain: string;
  path: string;
  txId?: string;
  arnsName?: string;
} => {
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

  // Check transaction IDs first (case-sensitive) before ArNS names
  if (txIdRegex.test(firstPart)) {
    // For transaction IDs, use sandbox subdomain
    const sandbox = sandboxFromId(firstPart);
    return {
      subdomain: sandbox,
      path: `/${firstPart}${remainingPath}`,
      txId: firstPart,
    };
  }

  const firstPartLowerCase = firstPart.toLowerCase();

  // Check ArNS names (case-insensitive)
  if (arnsRegex.test(firstPartLowerCase)) {
    // For ArNS names, use the name as subdomain
    return {
      subdomain: firstPartLowerCase,
      path: remainingPath || '/',
      arnsName: firstPartLowerCase,
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
export const createWayfinderFetch = ({
  logger = defaultLogger,
  verificationStrategy,
  strict = false,
  routingStrategy,
  dataRetrievalStrategy,
  emitter,
  tracer,
  fetch = createBaseFetch(),
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
}): WayfinderFetch => {
  // create our wayfinder data fetcher with state from the wayfinder instance
  return new WayfinderFetch({
    logger,
    dataRetrievalStrategy,
    routingStrategy,
    verificationStrategy,
    strict,
    emitter,
    tracer,
    fetch,
    events,
  });
};

/**
 * The main class for the wayfinder
 */
export class Wayfinder {
  /**
   * The gateways provider is responsible for providing the list of gateways to use for routing requests.
   *
   * Useful if you want to get the list of gateways from a dynamic source.
   *
   * @deprecated Use routing strategies with their own gateways providers instead.
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
  protected tracerProvider?:
    | WebTracerProvider
    | NodeTracerProvider
    | BasicTracerProvider;

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
   * Stateful fetch class that exposes the wayfinder fetch method
   */
  protected wayfinderFetch: WayfinderFetch;

  /**
   * The constructor for the wayfinder
   * @param options - Wayfinder configuration options
   */
  /**
   * Custom fetch implementation for making HTTP requests
   */
  protected fetch: typeof globalThis.fetch;

  constructor({
    logger,
    fetch,
    gatewaysProvider,
    verificationSettings,
    routingSettings,
    telemetrySettings,
  }: WayfinderOptions = {}) {
    // default logger to use if no logger is provided
    this.logger = logger ?? defaultLogger;

    // deprecated - kept for backwards compatibility
    this.gatewaysProvider =
      gatewaysProvider ??
      new TrustedPeersGatewaysProvider({
        trustedGateway: 'https://arweave.net',
        logger: this.logger,
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

    // default routing settings with backwards compatibility for gatewaysProvider
    this.routingSettings = {
      events: {},
      strategy: new PingRoutingStrategy({
        logger,
        routingStrategy: new RandomRoutingStrategy({
          logger,
          // use the gateways provider given, or fallback to the default if non provided
          gatewaysProvider: this.gatewaysProvider,
        }),
      }),
      // overwrite the default settings with the provided ones
      ...routingSettings,
    };

    // If a custom routing strategy is provided, inject the gatewaysProvider into it
    if (routingSettings?.strategy) {
      this.injectGatewaysProviderIntoStrategy(
        routingSettings.strategy,
        this.gatewaysProvider,
      );
    }

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

    this.wayfinderFetch = createWayfinderFetch({
      logger: this.logger,
      fetch: fetch,
      verificationStrategy: this.verificationSettings.strategy,
      strict: this.verificationSettings.strict,
      routingStrategy: this.routingSettings.strategy,
      tracer: this.tracer,
      emitter: this.emitter,
      events: {
        ...this.verificationSettings.events,
        ...this.routingSettings.events,
      },
    });

    this.fetch = this.wayfinderFetch.wayfinderFetch.bind(this.wayfinderFetch);
  }

  /**
   * Helper method to inject gatewaysProvider into routing strategies that support it
   * @param strategy - The routing strategy to inject into
   * @param gatewaysProvider - The gateways provider to inject
   */
  private injectGatewaysProviderIntoStrategy(
    strategy: RoutingStrategy,
    gatewaysProvider: GatewaysProvider,
  ): void {
    // Check if the strategy has a gatewaysProvider property that can be set
    if (
      'gatewaysProvider' in strategy &&
      strategy.gatewaysProvider === undefined
    ) {
      (strategy as any).gatewaysProvider = gatewaysProvider;
    }

    // Handle composite strategies that might have nested strategies
    if ('routingStrategy' in strategy && strategy.routingStrategy) {
      this.injectGatewaysProviderIntoStrategy(
        strategy.routingStrategy as RoutingStrategy,
        gatewaysProvider,
      );
    }
    if ('fallbackStrategy' in strategy && strategy.fallbackStrategy) {
      this.injectGatewaysProviderIntoStrategy(
        strategy.fallbackStrategy as RoutingStrategy,
        gatewaysProvider,
      );
    }
  }

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

    // If a deprecated gatewaysProvider is set, inject it into the new strategy
    if (this.gatewaysProvider) {
      this.injectGatewaysProviderIntoStrategy(strategy, this.gatewaysProvider);
    }
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
    init?: WayfinderRequestInit,
  ): Promise<Response> {
    return this.fetch(input, init);
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
