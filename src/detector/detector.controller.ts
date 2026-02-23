import {
  BadRequestException,
  Controller,
  Post,
  UploadedFile,
  UseInterceptors,
  UseFilters,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { DetectorService } from './detector.service';
import { MulterExceptionFilter } from '../common/filters/multer-exception.filter';
import * as path from 'path';
import { Throttle } from '@nestjs/throttler';

const ALLOWED = new Set(['image/jpeg', 'image/png', 'image/webp']);
const ALLOWED_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp']);
const MAX_MB = Number(process.env.MAX_UPLOAD_MB || 8);

@Controller('detect')
export class DetectorController {
  constructor(private readonly detectorService: DetectorService) {}

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
  async detectAi(@UploadedFile() file?: Express.Multer.File) {
    if (!file) throw new BadRequestException('Falta el archivo "image".');
    if (!ALLOWED.has(file.mimetype)) {
      throw new BadRequestException('Formato no soportado. Usa JPG/PNG/WebP.');
    }

    return this.detectorService.checkGenAI(file);
  }
}
