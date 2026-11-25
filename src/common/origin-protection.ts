import type { INestApplication } from '@nestjs/common';
import { createHash, timingSafeEqual } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { recordRequestCategory } from './request-audit';

export const ORIGIN_AUTH_HEADER = 'x-alejo-origin-auth';
const secretPattern = /^[a-f0-9]{64}$/;

function protectedDeployment(): boolean {
  return (
    ['RAILWAY_PROJECT_ID', 'RAILWAY_ENVIRONMENT_ID', 'RAILWAY_SERVICE_ID'].some(
      (key) => process.env[key] !== undefined,
    ) ||
    process.env.NODE_ENV === 'production' ||
    ['production', 'staging', 'qa'].includes(process.env.APP_ENV ?? '')
  );
}

// No secret values or request headers belong in configuration error messages.
export function loadOriginProtection(): readonly Buffer[] {
  const required = protectedDeployment();
  const mode =
    process.env.ORIGIN_PROTECTION_MODE ??
    (required ? 'shared-secret' : 'disabled');
  if (mode === 'disabled' && !required) return [];
  if (mode !== 'shared-secret') {
    throw new Error('La configuración de protección de origen no es válida.');
  }
  const current = process.env.ORIGIN_SHARED_SECRET;
  const previous = process.env.ORIGIN_SHARED_SECRET_PREVIOUS;
  if (
    !current ||
    !secretPattern.test(current) ||
    (previous !== undefined &&
      (!secretPattern.test(previous) || previous === current))
  ) {
    throw new Error('La configuración de protección de origen no es válida.');
  }
  return [current, ...(previous === undefined ? [] : [previous])].map(
    (secret) => createHash('sha256').update(secret).digest(),
  );
}

// Register after safe audit and before CORS, parsers/interceptors and guards.
// Cloudflare must SET (overwrite) this private header, never append it or expose
// it to the browser. Host/CF/XFF headers alone do not authenticate ingress.
export function configureOriginProtection(app: INestApplication): void {
  const digests = loadOriginProtection(); // Invalid protected config fails boot.
  app.use((req: Request, res: Response, next: NextFunction) => {
    // Keep only the exact minimal readiness endpoint available to Railway.
    // All other paths, preflights, unknown routes and POST /health need auth.
    const health =
      (req.method === 'GET' || req.method === 'HEAD') && req.path === '/health';
    if (digests.length === 0 || health) {
      next();
      return;
    }
    const supplied = req.headers[ORIGIN_AUTH_HEADER];
    if (typeof supplied === 'string' && secretPattern.test(supplied)) {
      const digest = createHash('sha256').update(supplied).digest();
      if (digests.some((expected) => timingSafeEqual(expected, digest))) {
        next();
        return;
      }
    }
    recordRequestCategory('origin_denied');
    res.status(403).json({
      statusCode: 403,
      error: 'Forbidden',
      code: 'ORIGIN_ACCESS_DENIED',
      message: 'Acceso no permitido.',
    });
  });
}
