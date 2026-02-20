import {
  BadRequestException,
  Controller,
  Post,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { DetectorService } from './detector.service';

const ALLOWED = new Set(['image/jpeg', 'image/png', 'image/webp']);
const MAX_MB = Number(process.env.MAX_UPLOAD_MB || 8);

@Controller('detect')
export class DetectorController {
  constructor(private readonly detectorService: DetectorService) {}

  @Post('ai')
  @UseInterceptors(
    FileInterceptor('image', {
      storage: memoryStorage(),
      limits: { fileSize: MAX_MB * 1024 * 1024 },
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
