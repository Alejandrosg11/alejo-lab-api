import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import axios from 'axios';

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
