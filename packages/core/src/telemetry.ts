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
  type Tracer,
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
import { ATTR_SERVICE_NAME } from '@opentelemetry/semantic-conventions';

import type { TelemetryConfig } from './types.js';

export const initTelemetry = (
  config: TelemetryConfig = {},
): Tracer | undefined => {
  if (config.enabled === false) return undefined;

  diag.setLogger(new DiagConsoleLogger(), DiagLogLevel.ERROR);

  const exporter = new OTLPTraceExporter({
    url: config.exporterUrl ?? 'https://api.honeycomb.io/v1/traces',
    headers: {
      'x-honeycomb-team': config.apiKey ?? '',
      'x-honeycomb-dataset': config.dataset ?? 'wayfinder',
    },
  });

  const isBrowser = typeof window !== 'undefined';
  const spanProcessor = new BatchSpanProcessor(exporter);
  const sampler = new TraceIdRatioBasedSampler(config.sampleRate ?? 1);
  const resource = resourceFromAttributes({
    [ATTR_SERVICE_NAME]: config.serviceName ?? 'wayfinder',
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

  return trace.getTracer(config.serviceName ?? 'wayfinder');
};
