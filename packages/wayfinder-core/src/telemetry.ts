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
import {
  DiagConsoleLogger,
  DiagLogLevel,
  Span,
  type Tracer,
  context,
  diag,
  trace,
} from '@opentelemetry/api';
import { ZoneContextManager } from '@opentelemetry/context-zone';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { resourceFromAttributes } from '@opentelemetry/resources';
import {
  BasicTracerProvider,
  BatchSpanProcessor,
  SimpleSpanProcessor,
  TraceIdRatioBasedSampler,
} from '@opentelemetry/sdk-trace-base';
import { NodeTracerProvider } from '@opentelemetry/sdk-trace-node';
import { WebTracerProvider } from '@opentelemetry/sdk-trace-web';
import {
  ATTR_SERVICE_NAME,
  ATTR_SERVICE_VERSION,
} from '@opentelemetry/semantic-conventions';
import { WayfinderEmitter } from './emitter.js';
import type { TelemetrySettings, WayfinderOptions } from './types.js';
import { isBrowser, isChromeExtension } from './utils/browser.js';
import { assertZoneLoaded, loadZonePolyfill } from './utils/zone.js';
import { WAYFINDER_CORE_VERSION } from './version.js';

// avoid re-initializing the tracer provider and tracer
let tracerProvider:
  | WebTracerProvider
  | NodeTracerProvider
  | BasicTracerProvider
  | undefined;
let tracer: Tracer | undefined;

// load zone.js polyfill if it's not already loaded
if (isBrowser()) {
  loadZonePolyfill();
}

const HONEYCOMB_EXPORTER_URL = 'https://api.honeycomb.io/v1/traces';

// Honeycomb requires an API key on every OTLP request, but a self-hosted
// collector may not, so the key is only mandatory when traces are actually
// bound for Honeycomb (api.honeycomb.io, api.eu1.honeycomb.io, ...).
// Honeycomb only serves https, so a plaintext URL is never really Honeycomb --
// treating it as such would demand a key we then could not transmit safely.
const isHoneycombExporterUrl = (url: string): boolean => {
  try {
    const { protocol, hostname } = new URL(url);
    if (protocol !== 'https:') return false;
    return hostname === 'honeycomb.io' || hostname.endsWith('.honeycomb.io');
  } catch {
    return false;
  }
};

// An API key is a credential and must never travel in plaintext. Loopback is
// exempt so a collector running locally during development still works.
const isSecureExporterUrl = (url: string): boolean => {
  try {
    const { protocol, hostname } = new URL(url);
    if (protocol === 'https:') return true;
    return (
      hostname === 'localhost' ||
      hostname === '127.0.0.1' ||
      hostname === '[::1]'
    );
  } catch {
    return false;
  }
};

export const initTelemetry = ({
  enabled = false,
  sampleRate = 0.1, // 10% sample rate by default
  exporterUrl = HONEYCOMB_EXPORTER_URL,
  apiKey,
  clientName,
  clientVersion,
}: TelemetrySettings):
  | {
      tracerProvider:
        | WebTracerProvider
        | NodeTracerProvider
        | BasicTracerProvider;
      tracer: Tracer;
    }
  | undefined => {
  if (enabled === false) return undefined;

  // validated before the cached-provider check so the failure is deterministic
  // regardless of whether this is the first call
  if (apiKey && !isSecureExporterUrl(exporterUrl)) {
    throw new Error(
      'telemetrySettings.exporterUrl must use https when telemetrySettings.apiKey is set. ' +
        'Sending an API key over plaintext would expose it. Use an https endpoint, or a ' +
        'loopback address (localhost, 127.0.0.1) for a local collector.',
    );
  }

  if (!apiKey && isHoneycombExporterUrl(exporterUrl)) {
    throw new Error(
      'telemetrySettings.apiKey is required when telemetry is enabled and traces are exported to Honeycomb. ' +
        'wayfinder-core no longer provides a default API key. Either set telemetrySettings.apiKey to a ' +
        'Honeycomb ingest key you control, or point telemetrySettings.exporterUrl at your own OTLP collector.',
    );
  }

  // if the tracer provider and tracer are already initialized, return the tracer
  if (tracerProvider) {
    return {
      tracerProvider,
      tracer: tracerProvider.getTracer('wayfinder-core'),
    };
  }

  diag.setLogger(new DiagConsoleLogger(), DiagLogLevel.ERROR);

  const exporter = new OTLPTraceExporter({
    url: exporterUrl,
    // collectors other than Honeycomb may not need (or accept) an API key
    headers: apiKey
      ? {
          'x-honeycomb-team': apiKey,
          'x-honeycomb-dataset': 'wayfinder-core',
        }
      : {},
  });

  const sampler = new TraceIdRatioBasedSampler(sampleRate);
  const resource = resourceFromAttributes({
    [ATTR_SERVICE_NAME]: 'wayfinder-core',
    [ATTR_SERVICE_VERSION]: WAYFINDER_CORE_VERSION,
    'client.name': clientName,
    'client.version': clientVersion,
  });

  // use web tracer if in browser, basic tracer if in chrome extension, node tracer otherwise
  const provider = isBrowser()
    ? new WebTracerProvider({
        sampler,
        resource,
        spanProcessors: [new SimpleSpanProcessor(exporter)],
      })
    : isChromeExtension()
      ? new BasicTracerProvider({
          sampler,
          resource,
          spanProcessors: [new SimpleSpanProcessor(exporter)],
        })
      : new NodeTracerProvider({
          sampler,
          resource,
          spanProcessors: [
            new BatchSpanProcessor(exporter, {
              scheduledDelayMillis: 500,
            }),
          ],
        });

  // ensure zone.js is loaded before registering the tracer provider if we're using the browser
  if (isBrowser()) {
    assertZoneLoaded();
  }

  if ('register' in provider && typeof provider.register === 'function') {
    provider.register({
      // zone.js is only used in the browser (node/extensions/service workers don't need it)
      contextManager: isBrowser() ? new ZoneContextManager() : undefined,
    });
  }

  tracerProvider = provider;
  tracer = provider.getTracer('wayfinder-core');

  return {
    tracerProvider,
    tracer,
  };
};

export const startRequestSpans = ({
  originalUrl,
  emitter,
  tracer,
  verificationSettings,
  routingSettings,
}: {
  originalUrl?: string;
  emitter?: WayfinderEmitter;
  tracer?: Tracer;
  verificationSettings?: WayfinderOptions['verificationSettings'];
  routingSettings?: WayfinderOptions['routingSettings'];
} = {}) => {
  const parentSpan = tracer?.startSpan(
    'wayfinder.request',
    {
      attributes: {
        originalUrl: originalUrl ?? 'undefined',
        'verification.enabled': verificationSettings?.enabled ?? false,
        'verification.strategy':
          verificationSettings?.strategy?.constructor.name ?? 'undefined',
        'verification.strict': verificationSettings?.strict ?? false,
        'verification.trustedGateways':
          verificationSettings?.strategy?.trustedGateways
            ?.map((gateway) => gateway.toString())
            .join(','),
        'routing.strategy':
          routingSettings?.strategy?.constructor.name ?? 'undefined',
      },
    },
    context.active(),
  );

  let routingSpan: Span | undefined;
  let verificationSpan: Span | undefined;
  if (parentSpan) {
    const parentContext = trace.setSpan(context.active(), parentSpan);
    // add listeners on the emitter to the span
    context.with(parentContext, () => {
      emitter?.on('routing-started', () => {
        if (!routingSpan) {
          routingSpan = tracer?.startSpan(
            'wayfinder.routing',
            undefined,
            parentContext,
          );
        }
      });

      emitter?.on('routing-skipped', () => {
        parentSpan?.setAttribute('routing.skipped', true);
        routingSpan?.end();
        parentSpan?.end();
      });

      emitter?.on('routing-succeeded', () => {
        parentSpan?.setAttribute('routing.succeeded', true);
        routingSpan?.end();
      });

      emitter?.on('verification-progress', () => {
        if (!verificationSpan) {
          verificationSpan = tracer?.startSpan(
            'wayfinder.verification',
            undefined,
            parentContext,
          );
        }
      });

      emitter?.on('verification-succeeded', () => {
        parentSpan?.setAttribute('verification.succeeded', true);
        verificationSpan?.end();
        parentSpan?.end();
      });

      emitter?.on('verification-failed', () => {
        parentSpan?.setAttribute('verification.failed', true);
        verificationSpan?.end();
        parentSpan?.end();
      });

      emitter?.on('verification-skipped', () => {
        parentSpan?.setAttribute('verification.skipped', true);
        verificationSpan?.end();
        parentSpan?.end();
      });
    });
  }
  return { parentSpan, routingSpan, verificationSpan };
};
