import './common/tracing/tracing'; // must be first: patches http/express/pg before they're imported elsewhere
import { initSentry } from './common/tracing/sentry';
initSentry();

import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { ValidationPipe } from '@nestjs/common';
import { Logger } from 'nestjs-pino';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { BrandingService } from './branding/branding.service';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bufferLogs: true });
  // Behind Caddy every request arrives from the proxy, so the throttler and logs would see one client.
  // TRUST_PROXY_HOPS is the number of proxies in front (1 in the pilot compose file); 0 for local dev.
  app.set('trust proxy', Number(process.env.TRUST_PROXY_HOPS ?? 0));
  app.useLogger(app.get(Logger));
  app.use(helmet());
  // The configured origins (our own portal, local dev), plus the portal served from any organisation's
  // verified custom domain (white label level 2). Domain answers are cached briefly so a busy portal does
  // not query the database for every request.
  const configured = (process.env.CORS_ORIGINS ?? 'http://localhost:3001,http://localhost:19006,http://localhost:8081,http://localhost:8082,http://localhost:8083').split(',');
  const branding = app.get(BrandingService);
  const verdicts = new Map<string, { allowed: boolean; at: number }>();
  app.enableCors({
    origin: (origin, callback) => {
      if (!origin || configured.includes(origin)) return callback(null, true);
      const cached = verdicts.get(origin);
      if (cached && Date.now() - cached.at < 60_000) return callback(null, cached.allowed);
      branding
        .isAllowedOrigin(origin)
        .catch(() => false)
        .then((allowed) => {
          if (verdicts.size > 500) verdicts.clear();
          verdicts.set(origin, { allowed, at: Date.now() });
          callback(null, allowed);
        });
    },
    credentials: true,
  });
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));

  const port = process.env.PORT ?? 3000;
  await app.listen(port);
}

bootstrap();
