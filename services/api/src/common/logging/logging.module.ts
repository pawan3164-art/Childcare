import { Module } from '@nestjs/common';
import { LoggerModule } from 'nestjs-pino';
import { ClsModule } from 'nestjs-cls';
import { v4 as uuidv4 } from 'uuid';
import { IncomingMessage, ServerResponse } from 'http';

/**
 * Structured logging + correlation IDs, wired in at Stage 0 before any feature
 * code exists (see /CLAUDE.md "Observability & logging standard"). pino-http
 * logs entry/exit/duration for every request automatically — not opt-in per route.
 */
@Module({
  imports: [
    ClsModule.forRoot({
      global: true,
      middleware: {
        mount: true,
        generateId: true,
        idGenerator: (req: IncomingMessage & { headers: Record<string, string | undefined> }) =>
          req.headers['x-correlation-id'] ?? uuidv4(),
        setup: (cls, req: IncomingMessage) => {
          cls.set('correlationId', cls.getId());
        },
      },
    }),
    LoggerModule.forRoot({
      pinoHttp: {
        genReqId: (req: IncomingMessage) =>
          (req.headers['x-correlation-id'] as string | undefined) ?? uuidv4(),
        customProps: (req: IncomingMessage) => ({
          correlationId: (req as { id?: string }).id,
        }),
        // Never log request/response bodies by default — child PII, payment
        // data and media must not end up in logs (see /CLAUDE.md privacy guardrail).
        autoLogging: true,
        redact: {
          paths: [
            'req.headers.authorization',
            'req.headers.cookie',
            'req.body',
            'res.body',
          ],
          remove: true,
        },
        transport:
          process.env.NODE_ENV !== 'production'
            ? { target: 'pino-pretty', options: { singleLine: true } }
            : undefined,
        customSuccessMessage: (req: IncomingMessage, res: ServerResponse, responseTime: number) =>
          `${req.method} ${req.url} ${res.statusCode} - ${responseTime}ms`,
      },
    }),
  ],
  exports: [ClsModule],
})
export class LoggingModule {}
