// Must be imported before any other module in main.ts so auto-instrumentation
// can patch http/express/pg before they're required elsewhere.
import { NodeSDK } from '@opentelemetry/sdk-node';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { ConsoleSpanExporter, NoopSpanProcessor } from '@opentelemetry/sdk-trace-node';
import { chooseTraceExporter } from './trace-exporter';

const exporterKind = chooseTraceExporter(process.env);

const sdk = new NodeSDK({
  serviceName: 'childcare-api',
  // 'none' drops spans but keeps the tracer provider registered, so trace
  // context still propagates and request logs keep their trace_id. (An empty
  // spanProcessors list skips that registration and silences pino-http's
  // request logging; omitting both options falls back to OTEL_TRACES_EXPORTER,
  // which defaults to OTLP on localhost.)
  ...(exporterKind === 'otlp'
    ? { traceExporter: new OTLPTraceExporter({ url: process.env.OTEL_EXPORTER_OTLP_ENDPOINT }) }
    : exporterKind === 'console'
      ? { traceExporter: new ConsoleSpanExporter() }
      : { spanProcessors: [new NoopSpanProcessor()] }),
  instrumentations: [getNodeAutoInstrumentations()],
});

sdk.start();

process.on('SIGTERM', () => {
  sdk.shutdown().finally(() => process.exit(0));
});
