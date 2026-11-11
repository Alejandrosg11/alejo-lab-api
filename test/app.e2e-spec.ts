/* eslint-disable @typescript-eslint/unbound-method -- Jest mocked Axios methods do not use a receiver. */
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types';
import axios from 'axios';
import { AppModule } from '../src/app.module';
import { TurnstileService } from '../src/security/turnstile.service';
import { MulterExceptionFilter } from '../src/common/filters/multer-exception.filter';
import { PayloadTooLargeExceptionFilter } from '../src/common/filters/payload-too-large-exception.filter';

// Use real Nest, Express, Multer, file signatures, sessions and throttling.
// Only external providers are mocked; tests never consume analysis quota.
jest.mock('axios');
const post = jest.mocked(axios.post);
const originalEnv = { ...process.env };
const agent = 'dependency-regression-test';
const sessionHeader = 'x-bot-session-token';
const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=',
  'base64',
);
const sightengine = {
  status: 'success',
  type: { ai_generated: 0.91 },
  request: { id: 'simulated-analysis', operations: 5 },
};

describe('API dependency integration', () => {
  let app: INestApplication<App>;
  let sessions: TurnstileService;

  beforeEach(async () => {
    jest.resetAllMocks();
    process.env.TURNSTILE_SECRET_KEY = 'e2e-provider-secret';
    process.env.TURNSTILE_SESSION_SECRET = 'e2e-local-session-secret';
    process.env.TURNSTILE_SESSION_TTL_MS = '60000';
    process.env.BOT_TOKEN_FIELD = 'turnstileToken';
    process.env.BOT_SESSION_HEADER = sessionHeader;
    process.env.SIGHTENGINE_USER = 'e2e-user';
    process.env.SIGHTENGINE_SECRET = 'e2e-secret';
    const moduleFixture = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication();
    app.useGlobalFilters(
      new MulterExceptionFilter(),
      new PayloadTooLargeExceptionFilter(),
    );
    app.enableCors({
      origin: 'http://localhost:3000',
      exposedHeaders: [sessionHeader],
    });
    await app.init();
    sessions = app.get(TurnstileService);
  });

  afterEach(async () => {
    await app?.close();
    jest.restoreAllMocks();
    process.env = { ...originalEnv };
  });

  function upload(session = sessions.createSessionToken(undefined, agent)) {
    return request(app.getHttpServer())
      .post('/detect/ai')
      .set('User-Agent', agent)
      .set(sessionHeader, session!);
  }

  it('serves /health without contacting providers', async () => {
    const response = await request(app.getHttpServer())
      .get('/health')
      .expect(200);
    expect(response.body).toMatchObject({
      status: 'ok',
      service: 'alejo-lab-api',
    });
    expect(post).not.toHaveBeenCalled();
  });

  it('analyzes a real PNG signature with a saved session and refreshes it', async () => {
    post.mockResolvedValueOnce({ data: sightengine });
    const response = await upload()
      .set('Origin', 'http://localhost:3000')
      .attach('image', png, {
        filename: 'fixture.png',
        contentType: 'image/png',
      })
      .expect(201);
    const body = response.body as {
      result: { percentage: number; label: string };
      analysis: { operations: number };
    };
    expect(body.result).toMatchObject({
      percentage: 91,
      label: 'alta',
    });
    expect(body.analysis.operations).toBe(5);
    expect(
      sessions.verifySessionToken(
        response.headers[sessionHeader],
        undefined,
        agent,
      ),
    ).toBe(true);
    expect(response.headers['access-control-expose-headers']).toContain(
      sessionHeader,
    );
    expect(post).toHaveBeenCalledTimes(1);
    expect(post.mock.calls[0][0]).toBe(
      'https://api.sightengine.com/1.0/check.json',
    );
  });

  it('verifies a challenge before analyzing when no session exists', async () => {
    post
      .mockResolvedValueOnce({ data: { success: true } })
      .mockResolvedValueOnce({ data: sightengine });
    await request(app.getHttpServer())
      .post('/detect/ai')
      .field('turnstileToken', 'simulated-challenge')
      .attach('image', png, {
        filename: 'fixture.png',
        contentType: 'image/png',
      })
      .expect(201);
    expect(post).toHaveBeenCalledTimes(2);
    expect(post.mock.calls[0][0]).toContain('/siteverify');
    expect(post.mock.calls[1][0]).toBe(
      'https://api.sightengine.com/1.0/check.json',
    );
  });

  it('rejects an unsupported extension before contacting providers', async () => {
    await upload()
      .attach('image', png, {
        filename: 'fixture.txt',
        contentType: 'image/png',
      })
      .expect(400);
    expect(post).not.toHaveBeenCalled();
  });

  it('rejects a forged MIME type using the real signature detector', async () => {
    await upload()
      .attach('image', Buffer.from('not an image'), {
        filename: 'fixture.png',
        contentType: 'image/png',
      })
      .expect(400);
    expect(post).not.toHaveBeenCalled();
  });

  it('rejects a missing file', async () => {
    await upload().expect(400);
    expect(post).not.toHaveBeenCalled();
  });

  it('enforces the existing file size limit through Multer', async () => {
    const maxBytes = Number(process.env.MAX_UPLOAD_MB || 8) * 1024 * 1024;
    await upload()
      .attach('image', Buffer.alloc(maxBytes + 1), {
        filename: 'large.png',
        contentType: 'image/png',
      })
      .expect(413);
    expect(post).not.toHaveBeenCalled();
  });

  it('requests a new challenge for an expired session', async () => {
    const now = Date.now();
    const clock = jest.spyOn(Date, 'now').mockReturnValue(now - 120000);
    const expired = sessions.createSessionToken(undefined, agent);
    clock.mockRestore();
    const response = await upload(expired)
      .attach('image', png, {
        filename: 'fixture.png',
        contentType: 'image/png',
      })
      .expect(400);
    expect((response.body as { code: string }).code).toBe('TOKEN_MISSING');
    expect(post).not.toHaveBeenCalled();
  });

  it('rejects a challenge denied by the simulated provider', async () => {
    post.mockResolvedValueOnce({ data: { success: false } });
    const response = await request(app.getHttpServer())
      .post('/detect/ai')
      .field('turnstileToken', 'rejected-challenge')
      .attach('image', png, {
        filename: 'fixture.png',
        contentType: 'image/png',
      })
      .expect(403);
    expect((response.body as { code: string }).code).toBe('TOKEN_INVALID');
    expect(post).toHaveBeenCalledTimes(1);
  });

  it('reports a simulated verification provider outage without analyzing', async () => {
    post.mockRejectedValueOnce(new Error('simulated outage'));
    const response = await request(app.getHttpServer())
      .post('/detect/ai')
      .field('turnstileToken', 'simulated-challenge')
      .attach('image', png, {
        filename: 'fixture.png',
        contentType: 'image/png',
      })
      .expect(503);
    expect((response.body as { code: string }).code).toBe(
      'BOT_PROVIDER_UNAVAILABLE',
    );
    expect(post).toHaveBeenCalledTimes(1);
  });

  it('reports a simulated Sightengine timeout', async () => {
    jest.mocked(axios.isAxiosError).mockReturnValue(true);
    post.mockRejectedValueOnce({ code: 'ECONNABORTED' });
    await upload()
      .attach('image', png, {
        filename: 'fixture.png',
        contentType: 'image/png',
      })
      .expect(503);
    expect(post).toHaveBeenCalledTimes(1);
  });

  it('preserves the three requests per minute limit without further provider calls', async () => {
    post.mockResolvedValue({ data: sightengine });
    for (let i = 0; i < 3; i++) {
      await upload()
        .attach('image', png, {
          filename: 'fixture.png',
          contentType: 'image/png',
        })
        .expect(201);
    }
    await upload()
      .attach('image', png, {
        filename: 'fixture.png',
        contentType: 'image/png',
      })
      .expect(429);
    expect(post).toHaveBeenCalledTimes(3);
    // Header names/units and the short/daily error contract remain P1-02.
  });
});
