export type TraceExporterKind = 'otlp' | 'console' | 'none';

/**
 * Which span exporter the API uses. OTLP whenever a collector endpoint is
 * configured. Without one, spans are not exported at all: the console
 * exporter pretty-prints every span synchronously (~700 MB per 15 min under
 * load in the Stage 5 run) and drowns the structured JSON logs, so it is an
 * explicit local-debugging opt-in (OTEL_TRACES_CONSOLE=1) and never used in
 * production.
 */
export function chooseTraceExporter(env: NodeJS.ProcessEnv | Record<string, string | undefined>): TraceExporterKind {
  if (env.OTEL_EXPORTER_OTLP_ENDPOINT) return 'otlp';
  if (env.OTEL_TRACES_CONSOLE === '1' && env.NODE_ENV !== 'production') return 'console';
  return 'none';
}
