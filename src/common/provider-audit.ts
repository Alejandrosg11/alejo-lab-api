import { Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { getRequestAuditIdentity } from './request-audit';

type Outcome =
  'response' | 'http_error' | 'timeout' | 'network_error' | 'unexpected_error';

const logger = new Logger('ProviderAudit');

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object'
    ? (value as Record<string, unknown>)
    : undefined;
}

export function providerUsage(data: unknown) {
  const request = record(record(data)?.request);
  const id = request?.id;
  const operations = request?.operations;
  return {
    providerRequestId:
      typeof id === 'string' && /^[a-zA-Z0-9_-]{1,100}$/.test(id) ? id : null,
    operations:
      typeof operations === 'number' &&
      Number.isSafeInteger(operations) &&
      operations >= 0
        ? operations
        : null,
  };
}

// One attempt per dispatch, with a terminal event independent of HTTP close.
// Started without completed means unknown, never zero billable operations.
export function startSightengineAudit() {
  const identity = getRequestAuditIdentity();
  const attemptId = randomUUID();
  const started = performance.now();
  const base = {
    ...identity,
    attemptId,
    provider: 'sightengine',
    model: 'genai',
  };
  logger.log(
    JSON.stringify({
      event: 'provider_attempt_started',
      timestamp: new Date().toISOString(),
      ...base,
    }),
  );
  let completed = false;
  return (outcome: Outcome, data?: unknown, httpStatus?: number) => {
    if (completed) return;
    completed = true;
    const usage = providerUsage(data);
    logger.log(
      JSON.stringify({
        event: 'provider_attempt_completed',
        timestamp: new Date().toISOString(),
        ...base,
        outcome,
        httpStatus:
          typeof httpStatus === 'number' &&
          Number.isInteger(httpStatus) &&
          httpStatus >= 100 &&
          httpStatus <= 599
            ? httpStatus
            : null,
        durationMs: Math.round(performance.now() - started),
        ...usage,
      }),
    );
  };
}
