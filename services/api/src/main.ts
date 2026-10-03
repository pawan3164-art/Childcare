import './common/tracing/tracing'; // must be first: patches http/express/pg before they're imported elsewhere
import { initSentry } from './common/tracing/sentry';
initSentry();

import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { Logger } from 'nestjs-pino';
import helmet from 'helmet';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  app.useLogger(app.get(Logger));
  app.use(helmet());
  // Local dev only: the portal (Next.js) and educator app (Expo web) run on
  // different ports than the API. Tighten this to real deployed origins
  // before production.
  app.enableCors({
    origin: (process.env.CORS_ORIGINS ?? 'http://localhost:3001,http://localhost:19006,http://localhost:8081').split(','),
    credentials: true,
  });
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));

  const port = process.env.PORT ?? 3000;
  await app.listen(port);
}

bootstrap();
