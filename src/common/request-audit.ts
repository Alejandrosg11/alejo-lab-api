import { Logger, type INestApplication } from '@nestjs/common';
import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import type { NextFunction, Request, Response } from 'express';

type Category =
  | 'origin_denied'
  | 'client_ip_unavailable'
  | 'cors_denied'
  | 'validation'
  | 'rate_limit_short'
  | 'rate_limit_daily'
  | 'rate_limit'
  | 'turnstile_missing'
  | 'turnstile_invalid'
  | 'turnstile_configuration'
  | 'turnstile_timeout'
  | 'turnstile_network'
  | 'turnstile_http_error'
  | 'turnstile_unavailable'
  | 'sightengine_configuration'
  | 'sightengine_timeout'
  | 'sightengine_network'
  | 'sightengine_quota'
  | 'sightengine_auth'
  | 'sightengine_http_error'
  | 'sightengine_invalid_response'
  | 'sightengine_unavailable'
  | 'analysis_success';

type AuditContext = {
  requestId: string;
  environment: string;
  method: string;
  route: string;
  category?: Category;
  providerRequestId?: string;
  operations?: number;
};

const context = new AsyncLocalStorage<AuditContext>();
const logger = new Logger('RequestAudit');

// Capture identity before awaiting a provider. Its eventual completion must not
// depend on the HTTP response still being open or on later environment changes.
export function getRequestAuditIdentity() {
  const current = context.getStore();
  return {
    requestId: current?.requestId ?? null,
    environment: current?.environment ?? environment(),
    method: current?.method ?? null,
    route: current?.route ?? null,
  };
}

export function recordRequestCategory(category: Category): void {
  const current = context.getStore();
  if (current) current.category = category;
}

export function recordProviderUsage(id: unknown, operations: unknown): void {
  const current = context.getStore();
  if (!current) return;
  // Never spread provider responses or log arbitrary error/config objects.
  if (typeof id === 'string' && /^[a-zA-Z0-9_-]{1,100}$/.test(id)) {
    current.providerRequestId = id;
  }
  if (
    typeof operations === 'number' &&
    Number.isSafeInteger(operations) &&
    operations >= 0
  ) {
    current.operations = operations;
  }
}

function environment(): string {
  const value = process.env.APP_ENV || process.env.RAILWAY_ENVIRONMENT_NAME;
  if (
    value &&
    ['production', 'staging', 'qa', 'development', 'test'].includes(value)
  ) {
    return value;
  }
  if (process.env.NODE_ENV === 'test') return 'test';
  // Do not label a QA build as production just because NODE_ENV=production.
  return process.env.NODE_ENV === 'production' ? 'unknown' : 'development';
}

function safeRoute(path: string): string {
  // Unknown paths may contain secrets. Record only canonical, known routes.
  const route = path.toLowerCase().replace(/\/$/, '');
  return ['/detect/ai', '/affiliate/ugee/random', '/health'].includes(route)
    ? route
    : 'other';
}

// Register before CORS so that preflights and origin rejections are visible too.
export function configureRequestAudit(app: INestApplication): void {
  app.use((req: Request, res: Response, next: NextFunction) => {
    const requestId = randomUUID();
    const started = performance.now();
    const route = safeRoute(req.path);
    const method = [
      'GET',
      'POST',
      'OPTIONS',
      'HEAD',
      'PUT',
      'PATCH',
      'DELETE',
    ].includes(req.method)
      ? req.method
      : 'other';
    const appEnvironment = environment();
    const current: AuditContext = {
      requestId,
      environment: appEnvironment,
      method,
      route,
    };
    res.setHeader('X-Request-ID', requestId);
    let recorded = false;
    const complete = (aborted: boolean) => {
      if (recorded) return;
      recorded = true;
      const status = aborted ? 499 : res.statusCode;
      const category = aborted
        ? 'client_aborted'
        : status >= 500 && current.category === 'validation'
          ? 'internal_error'
          : current.category ||
            (status >= 500
              ? 'internal_error'
              : route === '/detect/ai' && [400, 413, 415].includes(status)
                ? 'validation'
                : status >= 400
                  ? 'request_rejected'
                  : 'http_success');
      logger.log(
        JSON.stringify({
          event: 'http_request_completed',
          timestamp: new Date().toISOString(),
          environment: appEnvironment,
          requestId,
          method,
          route,
          status,
          durationMs: Math.round(performance.now() - started),
          category,
          providerRequestId: current.providerRequestId,
          operations: current.operations,
        }),
      );
    };
    res.once('finish', () => complete(false));
    res.once('close', () => complete(!res.writableFinished));
    context.run(current, next);
  });
}
