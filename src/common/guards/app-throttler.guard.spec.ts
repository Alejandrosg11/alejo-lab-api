import { ExecutionContext, HttpException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import {
  type ThrottlerRequest,
  type ThrottlerStorage,
} from '@nestjs/throttler';
import { AppThrottlerGuard } from './app-throttler.guard';

class TestGuard extends AppThrottlerGuard {
  check(props: ThrottlerRequest) {
    return this.handleRequest(props);
  }
}

function context() {
  const headers: Record<string, string | number> = {};
  const ctx = {
    switchToHttp: () => ({
      getRequest: () => ({ path: '/detect/ai', headers: {} }),
      getResponse: () => ({
        header: (key: string, value: string | number) => {
          headers[key] = value;
        },
      }),
    }),
  } as ExecutionContext;
  return { ctx, headers };
}

function props(ctx: ExecutionContext, name: string): ThrottlerRequest {
  return {
    context: ctx,
    throttler: { name, ttl: 60000, limit: 3 },
    ttl: 60000,
    limit: 3,
    blockDuration: 60000,
    getTracker: () => 'test',
    generateKey: () => name,
  };
}

async function rejection(
  check: Promise<boolean>,
): Promise<Record<string, unknown>> {
  try {
    await check;
    throw new Error('Expected throttling');
  } catch (error) {
    if (!(error instanceof HttpException)) throw error;
    return error.getResponse() as Record<string, unknown>;
  }
}

describe('AppThrottlerGuard request isolation', () => {
  it('keeps short/daily identities separate when storage operations overlap', async () => {
    const storage: ThrottlerStorage = {
      increment: async (key) => {
        await new Promise((resolve) =>
          setTimeout(resolve, key === 'short' ? 10 : 0),
        );
        return {
          totalHits: 4,
          isBlocked: true,
          timeToExpire: 1,
          timeToBlockExpire: key === 'short' ? 60 : 86400,
        };
      },
    };
    const guard = new TestGuard(
      [{ name: 'short', ttl: 60000, limit: 3 }],
      storage,
      new Reflector(),
    );
    await guard.onModuleInit();
    const short = context(),
      daily = context();
    const results = await Promise.all([
      rejection(guard.check(props(short.ctx, 'short'))),
      rejection(guard.check(props(daily.ctx, 'daily'))),
    ]);
    expect(results[0]).toMatchObject({
      code: 'RATE_LIMIT_SHORT',
      retryAfterMs: 60000,
    });
    expect(results[1]).toMatchObject({
      code: 'RATE_LIMIT_DAILY',
      retryAfterMs: 86400000,
    });
    expect(short.headers['Retry-After']).toBe(60);
    expect(daily.headers['Retry-After']).toBe(86400);
  });
  it('does not invent a block duration from a window when remaining block time is invalid', async () => {
    const storage: ThrottlerStorage = {
      increment: () =>
        Promise.resolve({
          totalHits: 4,
          isBlocked: true,
          timeToExpire: 60,
          timeToBlockExpire: NaN,
        }),
    };
    const guard = new TestGuard(
      [{ name: 'short', ttl: 60000, limit: 3 }],
      storage,
      new Reflector(),
    );
    await guard.onModuleInit();
    const { ctx, headers } = context();
    expect(await rejection(guard.check(props(ctx, 'short')))).toMatchObject({
      code: 'RATE_LIMIT_SHORT',
      retryAfterMs: null,
    });
    expect(headers['Retry-After']).toBeUndefined();
  });
});
