import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { MulterExceptionFilter } from './common/filters/multer-exception.filter';
import { PayloadTooLargeExceptionFilter } from './common/filters/payload-too-large-exception.filter';
import { NestExpressApplication } from '@nestjs/platform-express';

const defaultAllowedOrigins = [
  'https://alejodraws.com',
  'https://www.alejodraws.com',
  'https://alejo-tools-web.vercel.app',
  'http://localhost:3000',
];

function normalizeOrigin(origin: string): string {
  return origin.trim().replace(/\/$/, '').toLowerCase();
}

function getAllowedOrigins(): string[] {
  const envOrigins = (process.env.CORS_ALLOWED_ORIGINS || '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);

  return Array.from(
    new Set(
      [...defaultAllowedOrigins, ...envOrigins].map((origin) =>
        normalizeOrigin(origin),
      ),
    ),
  );
}

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);

  // Railway / reverse proxy
  app.set('trust proxy', 1);

  const allowedOrigins = getAllowedOrigins();

  app.enableCors({
    origin: (origin, callback) => {
      if (!origin || allowedOrigins.includes(normalizeOrigin(origin))) {
        callback(null, true);
        return;
      }

      callback(new Error('Origen no permitido por CORS'), false);
    },
  });

  app.useGlobalFilters(
    new MulterExceptionFilter(),
    new PayloadTooLargeExceptionFilter(),
  );

  await app.listen(process.env.PORT ?? 3001);
}
void bootstrap();
