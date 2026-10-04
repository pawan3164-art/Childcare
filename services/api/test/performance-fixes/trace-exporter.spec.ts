import { chooseTraceExporter } from '../../src/common/tracing/trace-exporter';

/**
 * Stage 5 load test (2026-10-04): with no OTEL_EXPORTER_OTLP_ENDPOINT set,
 * the API fell back to ConsoleSpanExporter and pretty-printed every span to
 * stdout — ~700 MB / 20M lines in a 15-minute run, synchronous I/O on every
 * request, and unusable alongside the structured JSON request logs. The
 * console exporter must be an explicit opt-in for local debugging only.
 */
describe('chooseTraceExporter', () => {
  it('uses OTLP whenever an endpoint is configured', () => {
    expect(chooseTraceExporter({ OTEL_EXPORTER_OTLP_ENDPOINT: 'http://collector:4318/v1/traces', NODE_ENV: 'production' })).toBe('otlp');
    expect(chooseTraceExporter({ OTEL_EXPORTER_OTLP_ENDPOINT: 'http://collector:4318/v1/traces' })).toBe('otlp');
  });

  it('exports nothing by default when no endpoint is configured', () => {
    expect(chooseTraceExporter({ NODE_ENV: 'production' })).toBe('none');
    expect(chooseTraceExporter({ NODE_ENV: 'development' })).toBe('none');
    expect(chooseTraceExporter({})).toBe('none');
  });

  it('dumps spans to the console only on explicit opt-in, and never in production', () => {
    expect(chooseTraceExporter({ OTEL_TRACES_CONSOLE: '1', NODE_ENV: 'development' })).toBe('console');
    expect(chooseTraceExporter({ OTEL_TRACES_CONSOLE: '1', NODE_ENV: 'production' })).toBe('none');
  });
});
