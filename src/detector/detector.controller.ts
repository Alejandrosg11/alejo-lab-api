import {
  BadRequestException,
  Body,
  Controller,
  Headers,
  Post,
  Req,
  Res,
  UploadedFile,
  UseFilters,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { DetectorService } from './detector.service';
import { MulterExceptionFilter } from '../common/filters/multer-exception.filter';
import * as path from 'path';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { TurnstileService } from '../security/turnstile.service';

const ALLOWED = new Set(['image/jpeg', 'image/png', 'image/webp']);
const ALLOWED_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp']);
const MAX_MB = Number(process.env.MAX_UPLOAD_MB || 8);

type TurnstileSessionApi = {
  getSessionHeaderName: () => string;
  verifySessionToken: (
    token: string | undefined,
    remoteIp?: string,
    userAgent?: string,
  ) => boolean;
  createSessionToken: (
    remoteIp?: string,
    userAgent?: string,
  ) => string | undefined;
  verifyTokenOrThrow: (
    token: string | undefined,
    remoteIp?: string,
  ) => Promise<void>;
};

@Controller('detect')
export class DetectorController {
  constructor(
    private readonly detectorService: DetectorService,
    private readonly turnstileService: TurnstileService,
  ) {}

  @Post('ai')
  @Throttle({
    short: { limit: 3, ttl: 60_000 },
    daily: { limit: 10, ttl: 86_400_000 },
  })
  @UseFilters(MulterExceptionFilter)
  @UseInterceptors(
    FileInterceptor('image', {
      storage: memoryStorage(),
      limits: { fileSize: MAX_MB * 1024 * 1024 },
      fileFilter: (_req, file, callback) => {
        const ext = path.extname(file.originalname || '').toLowerCase();
        const isMimeAllowed = ALLOWED.has(file.mimetype);
        const isExtAllowed = ALLOWED_EXTENSIONS.has(ext);

        if (!isMimeAllowed || !isExtAllowed) {
          return callback(
            new BadRequestException('Formato no soportado. Usa JPG/PNG/WebP.'),
            false,
          );
        }
        callback(null, true);
      },
    }),
  )
  async detectAi(
    @UploadedFile() file?: Express.Multer.File,
    @Body() body?: Record<string, unknown>,
    @Headers('x-turnstile-token') xTurnstileToken?: string,
    @Headers('cf-turnstile-response') cfTurnstileResponse?: string,
    @Headers('user-agent') userAgent?: string,
    @Req() req?: Request,
    @Res({ passthrough: true }) res?: Response,
  ) {
    if (!file) throw new BadRequestException('Falta el archivo "image".');
    if (!ALLOWED.has(file.mimetype)) {
      throw new BadRequestException('Formato no soportado. Usa JPG/PNG/WebP.');
    }

    const tokenField = process.env.BOT_TOKEN_FIELD || 'turnstileToken';
    const bodyToken =
      body && typeof body[tokenField] === 'string'
        ? body[tokenField]
        : undefined;

    const token = bodyToken || xTurnstileToken || cfTurnstileResponse;
    const turnstile = this.turnstileService as unknown as TurnstileSessionApi;

    const sessionHeaderName = turnstile.getSessionHeaderName();
    const rawSessionHeader = req?.headers?.[sessionHeaderName];
    const sessionToken = Array.isArray(rawSessionHeader)
      ? rawSessionHeader[0]
      : rawSessionHeader;

    const hasTrustedSession = turnstile.verifySessionToken(
      sessionToken,
      req?.ip,
      userAgent,
    );

    if (!hasTrustedSession) {
      await turnstile.verifyTokenOrThrow(token, req?.ip);
    }

    const refreshedSessionToken = turnstile.createSessionToken(
      req?.ip,
      userAgent,
    );

    if (refreshedSessionToken && res) {
      res.setHeader(sessionHeaderName, refreshedSessionToken);
    }

    return this.detectorService.checkGenAI(file);
  }
}
