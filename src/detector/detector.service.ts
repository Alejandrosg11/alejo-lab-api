import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import axios from 'axios';
import FormData from 'form-data';

type SightengineResponse = {
  type?: {
    ai_generated?: number;
  };
};

function isSightengineResponse(data: unknown): data is SightengineResponse {
  if (typeof data !== 'object' || data === null) return false;
  const maybeType = (data as { type?: unknown }).type;
  if (maybeType === undefined) return true;
  if (typeof maybeType !== 'object' || maybeType === null) return false;
  const maybeScore = (maybeType as { ai_generated?: unknown }).ai_generated;
  return maybeScore === undefined || typeof maybeScore === 'number';
}

@Injectable()
export class DetectorService {
  async checkGenAI(file: Express.Multer.File) {
    const apiUser = process.env.SIGHTENGINE_USER;
    const apiSecret = process.env.SIGHTENGINE_SECRET;

    if (!apiUser || !apiSecret) {
      throw new ServiceUnavailableException(
        'Faltan credenciales de Sightengine.',
      );
    }

    const form = new FormData();
    form.append('models', 'genai');
    form.append('api_user', apiUser);
    form.append('api_secret', apiSecret);
    form.append('media', file.buffer, {
      filename: file.originalname || 'image',
      contentType: file.mimetype,
    });

    try {
      const { data } = await axios.post<unknown>(
        'https://api.sightengine.com/1.0/check.json',
        form,
        {
          headers: form.getHeaders(),
          timeout: Number(process.env.SIGHTENGINE_TIMEOUT_MS || 10000),
          maxBodyLength: Infinity,
        },
      );

      if (
        !isSightengineResponse(data) ||
        typeof data.type?.ai_generated !== 'number'
      ) {
        throw new ServiceUnavailableException(
          'Respuesta inesperada de Sightengine.',
        );
      }

      const score = data.type.ai_generated;
      const label = score >= 0.8 ? 'alta' : score >= 0.5 ? 'media' : 'baja';

      return {
        aiGenerated: score,
        label,
      };
    } catch {
      // eslint-disable-next-line prettier/prettier
      throw new ServiceUnavailableException(
        'No se pudo analizar la imagen.',
      );
    }
  }
}
