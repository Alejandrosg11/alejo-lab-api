import { ForbiddenException, type INestApplication } from '@nestjs/common';
import { recordRequestCategory } from './request-audit';

const defaultAllowedOrigins = [
  'https://alejodraws.com',
  'https://www.alejodraws.com',
  'https://alejo-tools-web.vercel.app',
  'http://localhost:3000',
];
function normalizeOrigin(origin: string): string {
  return origin.trim().replace(/\/$/, '').toLowerCase();
}

// Shared with HTTP tests to exercise the actual production CORS configuration.
export function configureCors(app: INestApplication): void {
  const allowedOrigins = new Set(
    [
      ...defaultAllowedOrigins,
      ...(process.env.CORS_ALLOWED_ORIGINS || '').split(',').filter(Boolean),
    ].map(normalizeOrigin),
  );
  const sessionHeader = (
    process.env.BOT_SESSION_HEADER || 'x-bot-session-token'
  )
    .trim()
    .toLowerCase();
  app.enableCors({
    origin: (
      origin: string | undefined,
      callback: (error: Error | null, allow?: boolean) => void,
    ) => {
      if (!origin || allowedOrigins.has(normalizeOrigin(origin))) {
        callback(null, true);
        return;
      }
      recordRequestCategory('cors_denied');
      callback(
        new ForbiddenException({
          statusCode: 403,
          error: 'Forbidden',
          code: 'CORS_ORIGIN_DENIED',
          message: 'Origen no permitido por CORS',
        }),
        false,
      );
    },
    exposedHeaders: [
      'X-Request-ID',
      sessionHeader,
      'Retry-After',
      'Retry-After-short',
      'Retry-After-daily',
    ],
  });
}
