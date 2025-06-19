import {
  trace,
  DiagConsoleLogger,
  diag,
  DiagLogLevel,
  type Tracer,
} from '@opentelemetry/api';
import { NodeTracerProvider } from '@opentelemetry/sdk-trace-node';
import {
  BatchSpanProcessor,
  ParentBasedSampler,
  TraceIdRatioBasedSampler,
} from '@opentelemetry/sdk-trace-base';
import { Resource } from '@opentelemetry/resources';
import { SemanticResourceAttributes } from '@opentelemetry/semantic-conventions';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';

import type { TelemetryConfig } from './types.js';

export const initTelemetry = (
  config: TelemetryConfig = {},
): Tracer | undefined => {
  if (config.enabled === false) return undefined;

  diag.setLogger(new DiagConsoleLogger(), DiagLogLevel.ERROR);

  const provider = new NodeTracerProvider({
    sampler: new ParentBasedSampler({
      root: new TraceIdRatioBasedSampler(config.sampleRate ?? 1),
    }),
    resource: new Resource({
      [SemanticResourceAttributes.SERVICE_NAME]:
        config.serviceName ?? 'wayfinder',
    }),
  });

  const exporter = new OTLPTraceExporter({
    url: config.exporterUrl ?? 'https://api.honeycomb.io/v1/traces',
    headers: {
      'x-honeycomb-team': config.apiKey ?? '',
      'x-honeycomb-dataset': config.dataset ?? 'wayfinder',
    },
  });

  provider.addSpanProcessor(new BatchSpanProcessor(exporter));
  provider.register();

  return trace.getTracer('wayfinder');
};
