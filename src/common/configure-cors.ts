import type { INestApplication } from '@nestjs/common';

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
      callback(new Error('Origen no permitido por CORS'), false);
    },
    exposedHeaders: [
      sessionHeader,
      'Retry-After',
      'Retry-After-short',
      'Retry-After-daily',
    ],
  });
}
