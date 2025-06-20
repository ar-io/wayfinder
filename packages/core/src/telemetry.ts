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
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { resourceFromAttributes } from '@opentelemetry/resources';
import {
  BatchSpanProcessor,
  TraceIdRatioBasedSampler,
} from '@opentelemetry/sdk-trace-base';
import { NodeTracerProvider } from '@opentelemetry/sdk-trace-node';
import { WebTracerProvider } from '@opentelemetry/sdk-trace-web';
import {
  ATTR_SERVICE_NAME,
  ATTR_SERVICE_VERSION,
} from '@opentelemetry/semantic-conventions';

import type {
  GatewaysProvider,
  TelemetryConfig,
  WayfinderOptions,
} from './types.js';
import { WayfinderEmitter } from './wayfinder.js';
import packageJson from '../package.json' with { type: 'json' };

export const initTelemetry = (
  config: TelemetryConfig = {
    enabled: false,
    sampleRate: 0,
    serviceName: 'wayfinder-core',
  },
): Tracer | undefined => {
  if (config.enabled === false) return undefined;
  diag.setLogger(new DiagConsoleLogger(), DiagLogLevel.ERROR);

  const exporter = new OTLPTraceExporter({
    url: config.exporterUrl ?? 'https://api.honeycomb.io',
    headers: {
      'x-honeycomb-team': config.apiKey ?? '',
      'x-honeycomb-dataset': 'wayfinder-dev',
    },
  });

  const isBrowser = typeof window !== 'undefined';
  const spanProcessor = new BatchSpanProcessor(exporter);
  const sampler = new TraceIdRatioBasedSampler(config.sampleRate ?? 1);
  const resource = resourceFromAttributes({
    [ATTR_SERVICE_NAME]: 'wayfinder-core',
    [ATTR_SERVICE_VERSION]: packageJson?.version ?? 'unknown',
  });

  const provider = isBrowser
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

  provider.register();

  return trace.getTracer('wayfinder-core');
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
  const activeContext = context.active();
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
    activeContext,
  );
  const parentContext = parentSpan
    ? trace.setSpan(context.active(), parentSpan)
    : context.active();
  let routingSpan: Span | undefined;
  let verificationSpan: Span | undefined;
  // add listeners on the emitter to the span
  emitter?.on('routing-started', () => {
    if (parentSpan && !routingSpan) {
      context.with(parentContext, () => {
        routingSpan = tracer?.startSpan('wayfinder.routing');
      });
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
    if (parentSpan && !verificationSpan) {
      context.with(parentContext, () => {
        verificationSpan = tracer?.startSpan('wayfinder.verification');
      });
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

  return { parentSpan, routingSpan, verificationSpan };
};
