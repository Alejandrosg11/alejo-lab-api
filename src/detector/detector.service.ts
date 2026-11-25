import { fileTypeFromBuffer } from 'file-type';
import {
  BadRequestException,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import axios from 'axios';
import FormData from 'form-data';
import { providerUsage, startSightengineAudit } from '../common/provider-audit';
import { SightengineGenAiResponse } from '../types';
import {
  recordProviderUsage,
  recordRequestCategory,
} from '../common/request-audit';

type ConfidenceLabel = 'baja' | 'media' | 'alta';

@Injectable()
export class DetectorService {
  async checkGenAI(file: Express.Multer.File) {
    // Validación MIME real
    const allowedMime = ['image/jpeg', 'image/png', 'image/webp'];
    const detected = await fileTypeFromBuffer(file.buffer);
    if (!detected || !allowedMime.includes(detected.mime)) {
      recordRequestCategory('validation');
      throw new BadRequestException(
        'El archivo no es una imagen válida (JPG, PNG, WebP).',
      );
    }
    const apiUser = process.env.SIGHTENGINE_USER;
    const apiSecret = process.env.SIGHTENGINE_SECRET;

    if (!apiUser || !apiSecret) {
      recordRequestCategory('sightengine_configuration');
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

    const completeProviderAudit = startSightengineAudit();
    try {
      const response = await axios.post<SightengineGenAiResponse>(
        'https://api.sightengine.com/1.0/check.json',
        form,
        {
          headers: form.getHeaders(),
          timeout: Number(process.env.SIGHTENGINE_TIMEOUT_MS || 10000),
          maxBodyLength: Infinity,
        },
      );

      const data: SightengineGenAiResponse = response.data;
      completeProviderAudit('response', data, response.status);
      const usage = providerUsage(data);
      recordProviderUsage(usage.providerRequestId, usage.operations);
      const score = data?.type?.ai_generated;
      if (typeof score !== 'number') {
        recordRequestCategory('sightengine_invalid_response');
        throw new ServiceUnavailableException(
          'Respuesta inesperada del servicio.',
        );
      }

      const { label, message } = this.buildHumanResult(score);
      recordRequestCategory('analysis_success');

      return {
        result: {
          aiGenerated: score,
          percentage: Math.round(score * 100),
          label,
          message,
        },
        analysis: {
          requestId: data.request?.id ?? null,
          timestamp: data.request?.timestamp ?? null,
          status: data.status ?? null,
          operations: data.request?.operations ?? null, // útil para ti; opcional mostrarlo en UI
        },
        media: {
          filename: file.originalname,
          mimetype: file.mimetype,
          sizeBytes: file.size,
        },
        disclaimer:
          'Resultado probabilístico. Úsalo como señal, no como sentencia.',
      };
    } catch (error: unknown) {
      if (error instanceof ServiceUnavailableException) {
        completeProviderAudit('unexpected_error'); // No-op after a response event.
        throw error;
      }
      if (axios.isAxiosError(error)) {
        const usage = providerUsage(error.response?.data);
        recordProviderUsage(usage.providerRequestId, usage.operations);
        // Timeout
        if (error.code === 'ECONNABORTED' || error.code === 'ETIMEDOUT') {
          completeProviderAudit(
            'timeout',
            error.response?.data,
            error.response?.status,
          );
          recordRequestCategory('sightengine_timeout');
          throw new ServiceUnavailableException(
            'El servicio de análisis tardó demasiado en responder. Intenta de nuevo.',
          );
        }

        const status = error.response?.status;
        completeProviderAudit(
          error.response ? 'http_error' : 'network_error',
          error.response?.data,
          status,
        );

        // Errores del proveedor (4xx/5xx)
        if (typeof status === 'number') {
          // Cuota / límite / demasiadas solicitudes (dependiendo de cómo responda el proveedor)
          if (status === 402 || status === 429) {
            recordRequestCategory('sightengine_quota');
            throw new BadRequestException(
              'El detector alcanzó temporalmente su límite de uso. Intenta más tarde.',
            );
          }

          // Credenciales inválidas / auth del proveedor
          if (status === 401 || status === 403) {
            recordRequestCategory('sightengine_auth');
            throw new ServiceUnavailableException(
              'El servicio no está disponible en este momento.',
            );
          }

          // Archivo inválido/corrupto o request malformada al proveedor
          if (status >= 400 && status < 500) {
            recordRequestCategory('sightengine_http_error');
            throw new BadRequestException(
              'No se pudo procesar la imagen. Verifica que el archivo no esté dañado.',
            );
          }

          // Error del proveedor
          if (status >= 500) {
            recordRequestCategory('sightengine_http_error');
            throw new ServiceUnavailableException(
              'El servicio de análisis no está disponible en este momento. Intenta más tarde.',
            );
          }
        }

        // Error de red / sin respuesta del proveedor
        if (!error.response) {
          recordRequestCategory('sightengine_network');
          throw new ServiceUnavailableException(
            'No se pudo conectar con el servicio de análisis. Intenta de nuevo.',
          );
        }

        // Fallback axios
        recordRequestCategory('sightengine_unavailable');
        throw new ServiceUnavailableException('No se pudo analizar la imagen.');
      }

      // Fallback general
      completeProviderAudit('unexpected_error');
      recordRequestCategory('sightengine_unavailable');
      throw new ServiceUnavailableException('No se pudo analizar la imagen.');
    }
  }

  private buildHumanResult(score: number): {
    label: ConfidenceLabel;
    message: string;
  } {
    if (score >= 0.8) {
      return {
        label: 'alta',
        message:
          'Alta probabilidad de que la imagen haya sido generada por IA.',
      };
    }

    if (score >= 0.5) {
      return {
        label: 'media',
        message:
          'Probabilidad media. Se recomienda revisar contexto, fuente y proceso antes de concluir.',
      };
    }

    return {
      label: 'baja',
      message:
        'Baja probabilidad de que la imagen haya sido generada por IA, aunque no es una prueba definitiva.',
    };
  }
}
