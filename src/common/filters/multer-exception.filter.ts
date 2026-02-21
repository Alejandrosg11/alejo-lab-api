import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  PayloadTooLargeException,
} from '@nestjs/common';
import { Response } from 'express';
import { MulterError } from 'multer';

@Catch(MulterError)
export class MulterExceptionFilter implements ExceptionFilter {
  catch(exception: MulterError, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();

    if (exception.code === 'LIMIT_FILE_SIZE') {
      const maxMb = Number(process.env.MAX_UPLOAD_MB || 8);

      const nestException = new PayloadTooLargeException(
        `La imagen excede el tamaño máximo permitido (${maxMb}MB).`,
      );

      const response = nestException.getResponse() as
        | string
        | { message?: string; error?: string; statusCode?: number };

      return res.status(nestException.getStatus()).json(
        typeof response === 'string'
          ? {
              statusCode: nestException.getStatus(),
              message: response,
              error: 'Payload Too Large',
            }
          : response,
      );
    }

    return res.status(400).json({
      statusCode: 400,
      message: 'Error al procesar el archivo.',
      error: 'Bad Request',
    });
  }
}
