import {
  ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
} from '@nestjs/common';
import {
  ThrottlerGuard,
  type ThrottlerLimitDetail,
  type ThrottlerRequest,
} from '@nestjs/throttler';

type SafeThrottlerMeta = {
  throttlerName: string;
  retryAfterMs: number | null;
};

@Injectable()
export class AppThrottlerGuard extends ThrottlerGuard {
  private readonly policies = new WeakMap<ExecutionContext, string>();

  protected async handleRequest(props: ThrottlerRequest): Promise<boolean> {
    this.policies.set(props.context, props.throttler.name ?? 'default');
    try {
      return await super.handleRequest(props);
    } finally {
      this.policies.delete(props.context);
    }
  }

  protected override throwThrottlingException(
    context: ExecutionContext,
    throttlerLimitDetail: ThrottlerLimitDetail,
  ): Promise<void> {
    const req = context.switchToHttp().getRequest<{ path?: string }>();
    const route = req?.path ?? '';

    const { throttlerName, retryAfterMs } = this.extractSafeThrottlerMeta(
      context,
      throttlerLimitDetail,
    );

    if (retryAfterMs !== null) {
      const { res } = this.getRequestResponse(context);
      this.setResponseHeader(res, 'Retry-After', retryAfterMs / 1000);
    }
    const isDetectAi = route === '/detect/ai';

    let message = 'Demasiadas solicitudes. Intenta de nuevo más tarde.';
    let code = 'RATE_LIMIT_EXCEEDED';

    if (isDetectAi && throttlerName === 'short') {
      message = 'Espera un momento para continuar.';
      code = 'RATE_LIMIT_SHORT';
    } else if (isDetectAi && throttlerName === 'daily') {
      message = 'Alcanzaste el límite de consultas. Intenta más tarde.';
      code = 'RATE_LIMIT_DAILY';
    }

    return Promise.reject(
      new HttpException(
        {
          statusCode: 429,
          error: 'Too Many Requests',
          message,
          code,
          throttler: throttlerName,
          retryAfterMs,
        },
        HttpStatus.TOO_MANY_REQUESTS,
      ),
    );
  }

  private extractSafeThrottlerMeta(
    context: ExecutionContext,
    detail: unknown,
  ): SafeThrottlerMeta {
    const throttlerName = this.policies.get(context) ?? 'default';
    let retryAfterMs: number | null = null;

    if (this.isRecord(detail)) {
      // Throttler v6 reports remaining BLOCK seconds, not window milliseconds.
      const maybeTimeToExpire = detail['timeToBlockExpire'];
      if (
        typeof maybeTimeToExpire === 'number' &&
        Number.isFinite(maybeTimeToExpire) &&
        maybeTimeToExpire > 0
      ) {
        retryAfterMs = Math.ceil(maybeTimeToExpire) * 1000;
      }
    }

    return { throttlerName, retryAfterMs };
  }

  private isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null;
  }
}
