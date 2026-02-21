import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  PayloadTooLargeException,
} from '@nestjs/common';
import { Response } from 'express';

@Catch(PayloadTooLargeException)
export class PayloadTooLargeExceptionFilter implements ExceptionFilter {
  catch(exception: PayloadTooLargeException, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();
    const maxMb = Number(process.env.MAX_UPLOAD_MB || 8);
    return res.status(413).json({
      statusCode: 413,
      message: `La imagen excede el tamaño máximo permitido (${maxMb}MB).`,
      error: 'Payload Too Large',
    });
  }
}
