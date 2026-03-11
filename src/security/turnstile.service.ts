import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import axios from 'axios';
import { createHash, createHmac, timingSafeEqual } from 'crypto';

type TurnstileVerifyResponse = {
  success?: boolean;
  challenge_ts?: string;
  hostname?: string;
  'error-codes'?: string[];
  action?: string;
  cdata?: string;
};

@Injectable()
export class TurnstileService {
  private readonly verifyUrl =
    process.env.TURNSTILE_VERIFY_URL ||
    'https://challenges.cloudflare.com/turnstile/v0/siteverify';
  private readonly sessionHeaderName = (
    process.env.BOT_SESSION_HEADER || 'x-bot-session-token'
  )
    .trim()
    .toLowerCase();
  private readonly sessionTtlMs = Number(
    process.env.TURNSTILE_SESSION_TTL_MS || 15 * 60 * 1000,
  );

  getSessionHeaderName(): string {
    return this.sessionHeaderName;
  }

  private getSessionSecret(): string {
    return (
      process.env.TURNSTILE_SESSION_SECRET ||
      process.env.TURNSTILE_SECRET_KEY ||
      ''
    ).trim();
  }

  private toBase64Url(input: string | Buffer): string {
    return Buffer.from(input)
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/g, '');
  }

  private fromBase64Url(input: string): Buffer {
    const withPadding = input
      .replace(/-/g, '+')
      .replace(/_/g, '/')
      .padEnd(Math.ceil(input.length / 4) * 4, '=');

    return Buffer.from(withPadding, 'base64');
  }

  private hashOptionalValue(value: string | undefined): string {
    if (!value) {
      return '';
    }

    return createHash('sha256').update(value).digest('hex').slice(0, 24);
  }

  createSessionToken(
    remoteIp?: string,
    userAgent?: string,
  ): string | undefined {
    const secret = this.getSessionSecret();
    if (!secret) {
      return undefined;
    }

    const payload = {
      exp: Date.now() + this.sessionTtlMs,
      ip: this.hashOptionalValue(remoteIp),
      ua: this.hashOptionalValue(userAgent),
    };

    const encodedPayload = this.toBase64Url(JSON.stringify(payload));
    const signature = createHmac('sha256', secret)
      .update(encodedPayload)
      .digest();
    const encodedSignature = this.toBase64Url(signature);

    return `${encodedPayload}.${encodedSignature}`;
  }

  verifySessionToken(
    token: string | undefined,
    remoteIp?: string,
    userAgent?: string,
  ): boolean {
    const secret = this.getSessionSecret();
    if (!secret || !token || !token.trim()) {
      return false;
    }

    const parts = token.trim().split('.');
    if (parts.length !== 2) {
      return false;
    }

    const [encodedPayload, encodedSignature] = parts;

    const expectedSignature = createHmac('sha256', secret)
      .update(encodedPayload)
      .digest();

    let providedSignature: Buffer;
    try {
      providedSignature = this.fromBase64Url(encodedSignature);
    } catch {
      return false;
    }

    if (providedSignature.length !== expectedSignature.length) {
      return false;
    }

    if (!timingSafeEqual(providedSignature, expectedSignature)) {
      return false;
    }

    let payload: { exp?: number; ip?: string; ua?: string };
    try {
      payload = JSON.parse(
        this.fromBase64Url(encodedPayload).toString('utf8'),
      ) as {
        exp?: number;
        ip?: string;
        ua?: string;
      };
    } catch {
      return false;
    }

    if (!payload.exp || payload.exp <= Date.now()) {
      return false;
    }

    const expectedIpHash = this.hashOptionalValue(remoteIp);
    const expectedUaHash = this.hashOptionalValue(userAgent);

    if (payload.ip && expectedIpHash && payload.ip !== expectedIpHash) {
      return false;
    }

    if (payload.ua && expectedUaHash && payload.ua !== expectedUaHash) {
      return false;
    }

    return true;
  }

  async verifyTokenOrThrow(token: string | undefined, remoteIp?: string) {
    if (!token || !token.trim()) {
      throw new BadRequestException({
        statusCode: 400,
        error: 'Bad Request',
        code: 'TOKEN_MISSING',
        message: 'Falta el token anti-bot.',
      });
    }

    const secret = process.env.TURNSTILE_SECRET_KEY;
    if (!secret) {
      throw new ServiceUnavailableException({
        statusCode: 503,
        error: 'Service Unavailable',
        code: 'BOT_PROTECTION_MISCONFIGURED',
        message: 'La protección anti-bot no está configurada.',
      });
    }

    const payload = new URLSearchParams();
    payload.append('secret', secret);
    payload.append('response', token.trim());
    if (remoteIp) {
      payload.append('remoteip', remoteIp);
    }

    try {
      const response = await axios.post<TurnstileVerifyResponse>(
        this.verifyUrl,
        payload.toString(),
        {
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          timeout: Number(process.env.TURNSTILE_TIMEOUT_MS || 7000),
        },
      );

      const isValid = response.data?.success === true;
      if (!isValid) {
        throw new ForbiddenException({
          statusCode: 403,
          error: 'Forbidden',
          code: 'TOKEN_INVALID',
          message: 'Token anti-bot inválido o expirado.',
          details: response.data?.['error-codes'] ?? [],
        });
      }
    } catch (error: unknown) {
      if (error instanceof BadRequestException) throw error;
      if (error instanceof ForbiddenException) throw error;
      if (error instanceof ServiceUnavailableException) throw error;

      if (axios.isAxiosError(error)) {
        throw new ServiceUnavailableException({
          statusCode: 503,
          error: 'Service Unavailable',
          code: 'BOT_PROVIDER_UNAVAILABLE',
          message: 'No se pudo validar el challenge anti-bot.',
        });
      }

      throw new ServiceUnavailableException({
        statusCode: 503,
        error: 'Service Unavailable',
        code: 'BOT_PROVIDER_UNAVAILABLE',
        message: 'No se pudo validar el challenge anti-bot.',
      });
    }
  }
}
