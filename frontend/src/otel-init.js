import { WebTracerProvider } from '@opentelemetry/sdk-trace-web';
import { BatchSpanProcessor, ParentBasedSampler, TraceIdRatioBasedSampler } from '@opentelemetry/sdk-trace-base';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { Resource } from '@opentelemetry/resources';
import { SemanticResourceAttributes } from '@opentelemetry/semantic-conventions';
import { ZoneContextManager } from '@opentelemetry/context-zone';
import { registerInstrumentations } from '@opentelemetry/instrumentation';
import { DocumentLoadInstrumentation } from '@opentelemetry/instrumentation-document-load';
import { UserInteractionInstrumentation } from '@opentelemetry/instrumentation-user-interaction';
import { FetchInstrumentation } from '@opentelemetry/instrumentation-fetch';
import { XMLHttpRequestInstrumentation } from '@opentelemetry/instrumentation-xml-http-request';
import * as api from '@opentelemetry/api';

const OTLP_BASE = import.meta.env.VITE_OTLP_BASE;
const BACKEND_ORIGIN = window.location.origin;

const sampler = new ParentBasedSampler({ root: new TraceIdRatioBasedSampler(0.2) });

const provider = new WebTracerProvider({
  sampler,
  resource: new Resource({
    [SemanticResourceAttributes.SERVICE_NAME]: 'react-paypal-microfrontend',
    [SemanticResourceAttributes.DEPLOYMENT_ENVIRONMENT]: 'dev',
  }),
});

provider.addSpanProcessor(new BatchSpanProcessor(new OTLPTraceExporter({ url: `${OTLP_BASE}/v1/traces` })));
provider.register({ contextManager: new ZoneContextManager() });

registerInstrumentations({
  instrumentations: [
    new DocumentLoadInstrumentation(),
    new UserInteractionInstrumentation(),
    new FetchInstrumentation({
      propagateTraceHeaderCorsUrls: [BACKEND_ORIGIN],
      ignoreUrls: [/\/assets\//, /\/favicon\.ico$/, new RegExp(`${OTLP_BASE.replace(/\//g, '\\/')}`)],
      clearTimingResources: true,
    }),
    new XMLHttpRequestInstrumentation({
      propagateTraceHeaderCorsUrls: [BACKEND_ORIGIN],
      ignoreUrls: [/\/assets\//, /\/favicon\.ico$/],
    }),
  ],
});

window.addEventListener('error', (e) => {
  const tracer = api.trace.getTracer('ui');
  const span = tracer.startSpan('window.error');
  span.recordException(e.error || e.message);
  span.setAttribute('error', true);
  span.end();
});

globalThis.__otelTracer = () => api.trace.getTracer('ui');
