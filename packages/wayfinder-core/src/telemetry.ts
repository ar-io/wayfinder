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
import 'zone.js';
import { WayfinderEmitter } from './emitter.js';
import type {
  GatewaysProvider,
  TelemetrySettings,
  WayfinderOptions,
} from './types.js';
import { isBrowser, isChromeExtension } from './utils/browser.js';
import { WAYFINDER_CORE_VERSION } from './version.js';

// avoid re-initializing the tracer provider and tracer
let tracerProvider: WebTracerProvider | NodeTracerProvider | undefined;
let tracer: Tracer | undefined;

export const initTelemetry = ({
  enabled = false,
  sampleRate = 0.1, // 10% sample rate by default
  exporterUrl = 'https://api.honeycomb.io/v1/traces',
  apiKey = 'c8gU8dHlu6V7e5k2Gn9LaG', // intentionally left here - if it gets abused we'll disable it
}: TelemetrySettings):
  | {
      tracerProvider: WebTracerProvider | NodeTracerProvider;
      tracer: Tracer;
    }
  | undefined => {
  if (enabled === false) return undefined;

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
    headers: {
      'x-honeycomb-team': apiKey,
      'x-honeycomb-dataset': 'wayfinder-core',
    },
  });

  const sampler = new TraceIdRatioBasedSampler(sampleRate);
  const resource = resourceFromAttributes({
    [ATTR_SERVICE_NAME]: 'wayfinder-core',
    [ATTR_SERVICE_VERSION]: WAYFINDER_CORE_VERSION,
  });

  const useWebTracer = isBrowser() || isChromeExtension();
  const spanProcessor = useWebTracer
    ? new SimpleSpanProcessor(exporter)
    : new BatchSpanProcessor(exporter, {
        scheduledDelayMillis: 500,
      });
  const provider = useWebTracer
    ? new WebTracerProvider({
        sampler,
        resource,
        spanProcessors: [spanProcessor],
      })
    : new NodeTracerProvider({
        sampler,
        resource,
        spanProcessors: [spanProcessor],
      });

  provider.register({
    // zone.js is only used in the browser (node/extensions/service workers don't need it)
    contextManager: useWebTracer ? new ZoneContextManager() : undefined,
  });

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
  gatewaysProvider,
}: {
  originalUrl?: string;
  emitter?: WayfinderEmitter;
  tracer?: Tracer;
  verificationSettings?: WayfinderOptions['verificationSettings'];
  routingSettings?: WayfinderOptions['routingSettings'];
  gatewaysProvider?: GatewaysProvider;
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
        gatewaysProvider: gatewaysProvider?.constructor.name,
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
