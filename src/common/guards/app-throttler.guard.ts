import {
  ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
} from '@nestjs/common';
import { ThrottlerGuard, type ThrottlerLimitDetail } from '@nestjs/throttler';

type SafeThrottlerMeta = {
  throttlerName: string;
  retryAfterMs: number;
};

@Injectable()
export class AppThrottlerGuard extends ThrottlerGuard {
  protected override throwThrottlingException(
    context: ExecutionContext,
    throttlerLimitDetail: ThrottlerLimitDetail,
  ): Promise<void> {
    const req = context.switchToHttp().getRequest<{ path?: string }>();
    const route = req?.path ?? '';

    const { throttlerName, retryAfterMs } =
      this.extractSafeThrottlerMeta(throttlerLimitDetail);

    const retryIn = this.formatRetryTime(retryAfterMs);
    const isDetectAi = route === '/detect/ai';

    let message = 'Demasiadas solicitudes. Intenta de nuevo más tarde.';
    let code = 'RATE_LIMIT_EXCEEDED';

    if (isDetectAi && throttlerName === 'short') {
      message = `Demasiadas solicitudes en poco tiempo. Máximo 3 análisis por minuto. Intenta de nuevo en ${retryIn}.`;
      code = 'RATE_LIMIT_SHORT';
    } else if (isDetectAi && throttlerName === 'daily') {
      message = `Límite diario alcanzado. Máximo 10 análisis por día. Intenta de nuevo en ${retryIn}.`;
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

  private extractSafeThrottlerMeta(detail: unknown): SafeThrottlerMeta {
    let throttlerName = 'default';
    let retryAfterMs = 0;

    if (this.isRecord(detail)) {
      const maybeTimeToExpire = detail['timeToExpire'];
      if (
        typeof maybeTimeToExpire === 'number' &&
        Number.isFinite(maybeTimeToExpire)
      ) {
        retryAfterMs = Math.max(0, maybeTimeToExpire);
      }

      const maybeThrottler = detail['throttler'];
      if (this.isRecord(maybeThrottler)) {
        const maybeName = maybeThrottler['name'];
        if (typeof maybeName === 'string' && maybeName.trim()) {
          throttlerName = maybeName;
        }
      }
    }

    return { throttlerName, retryAfterMs };
  }

  private isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null;
  }

  private formatRetryTime(ms: number): string {
    const s = Math.max(1, Math.ceil(ms / 1000));
    if (s < 60) return `${s}s`;

    const m = Math.ceil(s / 60);
    if (m < 60) return `${m} min`;

    const h = Math.ceil(m / 60);
    return `${h} h`;
  }
}
