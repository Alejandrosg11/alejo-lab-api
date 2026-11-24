/* eslint-disable @typescript-eslint/unbound-method -- Jest mocked Axios methods do not use a receiver. */
import { Test } from '@nestjs/testing';
import { Logger, type INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types';
import axios from 'axios';
import { AppModule } from '../src/app.module';
import { TurnstileService } from '../src/security/turnstile.service';
import { MulterExceptionFilter } from '../src/common/filters/multer-exception.filter';
import { PayloadTooLargeExceptionFilter } from '../src/common/filters/payload-too-large-exception.filter';
import { configureCors } from '../src/common/configure-cors';
import { configureRequestAudit } from '../src/common/request-audit';
import { configureOriginProtection } from '../src/common/origin-protection';

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
  let auditLog: jest.SpyInstance;

  function auditEvents(): Record<string, unknown>[] {
    return auditLog.mock.calls.flatMap(([message]: [unknown]) =>
      typeof message === 'string' && message.startsWith('{"event":')
        ? [JSON.parse(message) as Record<string, unknown>]
        : [],
    );
  }

  beforeEach(async () => {
    jest.resetAllMocks();
    auditLog = jest
      .spyOn(Logger.prototype, 'log')
      .mockImplementation(() => undefined);
    process.env.APP_ENV = 'test';
    process.env.ORIGIN_PROTECTION_MODE = 'disabled';
    // This fixture deliberately represents local ingress, even on Railway CI.
    delete process.env.RAILWAY_PROJECT_ID;
    delete process.env.RAILWAY_ENVIRONMENT_ID;
    delete process.env.RAILWAY_SERVICE_ID;
    process.env.CLIENT_IP_SOURCE = 'socket';
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
    configureRequestAudit(app);
    configureOriginProtection(app);
    app.useGlobalFilters(
      new MulterExceptionFilter(),
      new PayloadTooLargeExceptionFilter(),
    );
    configureCors(app);
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
    expect(response.headers['x-request-id']).toMatch(/^[a-f0-9-]{36}$/);
    expect(auditEvents()).toEqual([
      expect.objectContaining({
        route: '/health',
        status: 200,
        environment: 'test',
        requestId: response.headers['x-request-id'],
        category: 'http_success',
      }),
    ]);
  });

  it('keeps one edge client bucket despite changing forwarded chains and isolates another client', async () => {
    process.env.CLIENT_IP_SOURCE = 'railway-edge';
    for (let i = 0; i < 3; i++) {
      const response = await request(app.getHttpServer())
        .post('/detect/ai')
        .set('X-Real-IP', '198.51.100.10')
        .set('X-Forwarded-For', `203.0.113.${i + 1}, 192.0.2.${i + 1}`)
        .set('CF-Connecting-IP', `203.0.113.${i + 10}`)
        .expect(400);
      expect(response.headers['x-ratelimit-remaining-short']).toBe(
        String(2 - i),
      );
    }
    const blocked = await request(app.getHttpServer())
      .post('/detect/ai')
      .set('X-Real-IP', '198.51.100.10')
      .set('X-Forwarded-For', '203.0.113.99')
      .set('CF-Connecting-IP', '203.0.113.100')
      .expect(429);
    expect(blocked.body).toMatchObject({ code: 'RATE_LIMIT_SHORT' });
    expect(Number(blocked.headers['retry-after'])).toBeGreaterThan(0);
    await request(app.getHttpServer())
      .post('/detect/ai')
      .set('X-Real-IP', '198.51.100.11')
      .expect(400);
    expect(post).not.toHaveBeenCalled();
  });

  it('does not trust IP headers on local/direct socket mode', async () => {
    for (let i = 0; i < 3; i++) {
      await request(app.getHttpServer())
        .post('/detect/ai')
        .set('X-Real-IP', `203.0.113.${i + 1}`)
        .set('X-Forwarded-For', `192.0.2.${i + 1}`)
        .set('CF-Connecting-IP', `198.51.100.${i + 1}`)
        .expect(400);
    }
    await request(app.getHttpServer())
      .post('/detect/ai')
      .set('X-Real-IP', '203.0.113.99')
      .expect(429);
    expect(post).not.toHaveBeenCalled();
  });

  it('groups IPv6 clients by /64 for throttling while isolating another subnet', async () => {
    process.env.CLIENT_IP_SOURCE = 'railway-edge';
    for (let i = 1; i <= 3; i++) {
      await request(app.getHttpServer())
        .post('/detect/ai')
        .set('X-Real-IP', `2001:db8:1:1::${i}`)
        .expect(400);
    }
    await request(app.getHttpServer())
      .post('/detect/ai')
      .set('X-Real-IP', '2001:db8:1:1::99')
      .expect(429);
    await request(app.getHttpServer())
      .post('/detect/ai')
      .set('X-Real-IP', '2001:db8:1:2::1')
      .expect(400);
    expect(post).not.toHaveBeenCalled();
  });

  it('uses the same authoritative address for session verification and renewal', async () => {
    process.env.CLIENT_IP_SOURCE = 'railway-edge';
    const ip = '198.51.100.10';
    const saved = sessions.createSessionToken(ip, agent);
    post.mockResolvedValueOnce({ data: sightengine });
    const response = await upload(saved)
      .set('X-Real-IP', ip)
      .set('CF-Connecting-IP', '203.0.113.77')
      .set('X-Forwarded-For', '203.0.113.88')
      .attach('image', png, 'fixture.png')
      .expect(201);
    expect(
      sessions.verifySessionToken(response.headers[sessionHeader], ip, agent),
    ).toBe(true);
    expect(
      sessions.verifySessionToken(
        response.headers[sessionHeader],
        '198.51.100.11',
        agent,
      ),
    ).toBe(false);
    expect(post).toHaveBeenCalledTimes(1);
    const denied = await upload(saved)
      .set('X-Real-IP', '198.51.100.11')
      .attach('image', png, 'fixture.png')
      .expect(400);
    expect(denied.body).toMatchObject({ code: 'TOKEN_MISSING' });
    expect(post).toHaveBeenCalledTimes(1);
  });

  it('passes the authoritative address to Turnstile remoteip', async () => {
    process.env.CLIENT_IP_SOURCE = 'railway-edge';
    post
      .mockResolvedValueOnce({ data: { success: true } })
      .mockResolvedValueOnce({ data: sightengine });
    await request(app.getHttpServer())
      .post('/detect/ai')
      .set('X-Real-IP', '198.51.100.10')
      .set('CF-Connecting-IP', '203.0.113.77')
      .field('turnstileToken', 'test-token')
      .attach('image', png, 'fixture.png')
      .expect(201);
    expect(
      new URLSearchParams(String(post.mock.calls[0][1])).get('remoteip'),
    ).toBe('198.51.100.10');
  });

  it('fails closed for missing edge identity while keeping health available', async () => {
    process.env.CLIENT_IP_SOURCE = 'railway-edge';
    await request(app.getHttpServer())
      .post('/detect/ai')
      .set('X-Forwarded-For', '203.0.113.1')
      .expect(503);
    expect(auditEvents()[0]).toMatchObject({
      category: 'client_ip_unavailable',
    });
    expect(post).not.toHaveBeenCalled();
    await request(app.getHttpServer()).get('/health').expect(200);
  });

  it.each([
    ['staging', 'staging'],
    ['production', 'production'],
    ['unexpected-private-label', 'unknown'],
    [undefined, 'unknown'],
  ])(
    'identifies production-mode environments without assuming production: %s',
    async (railwayEnvironment, expected) => {
      delete process.env.APP_ENV;
      process.env.NODE_ENV = 'production';
      if (railwayEnvironment)
        process.env.RAILWAY_ENVIRONMENT_NAME = railwayEnvironment;
      else delete process.env.RAILWAY_ENVIRONMENT_NAME;
      await request(app.getHttpServer()).get('/health').expect(200);
      expect(auditEvents()[0]).toMatchObject({ environment: expected });
      expect(JSON.stringify(auditEvents())).not.toContain(
        'unexpected-private-label',
      );
    },
  );

  it.each(['POST', 'OPTIONS'])(
    'rejects a disallowed origin on %s with 403 before providers',
    async (method) => {
      const client = request(app.getHttpServer());
      const call =
        method === 'POST'
          ? client.post('/detect/ai')
          : client.options('/detect/ai');
      const response = await call
        .set('Origin', 'https://untrusted.example')
        .set('Access-Control-Request-Method', 'POST')
        .expect(403);
      expect(response.body).toMatchObject({
        code: 'CORS_ORIGIN_DENIED',
        statusCode: 403,
      });
      expect(response.headers['access-control-allow-origin']).toBeUndefined();
      expect(post).not.toHaveBeenCalled();
      expect(auditEvents()).toEqual([
        expect.objectContaining({ category: 'cors_denied', status: 403 }),
      ]);
    },
  );

  it('preserves the configured QA origin and exposed request/session headers', async () => {
    await app.close();
    process.env.CORS_ALLOWED_ORIGINS = 'https://qa.example';
    const fixture = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = fixture.createNestApplication();
    configureRequestAudit(app);
    configureCors(app);
    await app.init();
    const response = await request(app.getHttpServer())
      .options('/detect/ai')
      .set('Origin', 'https://qa.example')
      .set('Access-Control-Request-Method', 'POST')
      .set('Access-Control-Request-Headers', sessionHeader)
      .expect(204);
    expect(response.headers['access-control-allow-origin']).toBe(
      'https://qa.example',
    );
    for (const header of [
      'x-request-id',
      sessionHeader,
      'retry-after',
      'retry-after-short',
      'retry-after-daily',
    ]) {
      expect(
        response.headers['access-control-expose-headers'].toLowerCase(),
      ).toContain(header);
    }
    expect(post).not.toHaveBeenCalled();
  });

  it('logs canonical routes and server-generated IDs without request secrets', async () => {
    const sentinel = 'PRIVATE_SENTINEL_DO_NOT_LOG';
    const response = await request(app.getHttpServer())
      .post(`/detect/ai?key=${sentinel}`)
      .set('X-Request-ID', sentinel)
      .set('User-Agent', sentinel)
      .set('x-turnstile-token', sentinel)
      .expect(400);
    await request(app.getHttpServer()).get(`/unknown/${sentinel}`).expect(404);
    expect(response.headers['x-request-id']).not.toBe(sentinel);
    expect(auditEvents()).toHaveLength(2);
    expect(auditEvents()[0]).toMatchObject({
      category: 'validation',
      route: '/detect/ai',
    });
    expect(auditEvents()[1]).toMatchObject({ route: 'other' });
    expect(JSON.stringify(auditEvents())).not.toContain(sentinel);
    expect(post).not.toHaveBeenCalled();
  });

  it('keeps provider metadata isolated between concurrent requests', async () => {
    post.mockImplementation(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
      return { data: sightengine };
    });
    const [success, missing] = await Promise.all([
      upload().attach('image', png, {
        filename: 'secret-filename.png',
        contentType: 'image/png',
      }),
      request(app.getHttpServer()).post('/detect/ai'),
    ]);
    expect(success.status).toBe(201);
    expect(missing.status).toBe(400);
    expect(auditEvents()).toHaveLength(2);
    expect(
      auditEvents().find(
        (event) => event.requestId === success.headers['x-request-id'],
      ),
    ).toMatchObject({
      category: 'analysis_success',
      providerRequestId: 'simulated-analysis',
      operations: 5,
    });
    const rejected = auditEvents().find(
      (event) => event.requestId === missing.headers['x-request-id'],
    );
    expect(rejected).toMatchObject({ category: 'validation' });
    expect(rejected).not.toHaveProperty('providerRequestId');
    expect(rejected).not.toHaveProperty('operations');
    expect(JSON.stringify(auditEvents())).not.toContain('secret-filename');
  });

  it.each([
    [{ code: 'ECONNABORTED' }, 503, 'sightengine_timeout'],
    [{ code: 'ECONNRESET' }, 503, 'sightengine_network'],
    [{ response: { status: 429 } }, 400, 'sightengine_quota'],
    [{ response: { status: 401 } }, 503, 'sightengine_auth'],
    [{ response: { status: 502 } }, 503, 'sightengine_http_error'],
  ])(
    'classifies a provider failure without logging its error body: %j',
    async (error, status, category) => {
      jest.mocked(axios.isAxiosError).mockReturnValue(true);
      post.mockRejectedValueOnce({
        ...error,
        config: { api_secret: 'PRIVATE_PROVIDER_SECRET' },
      });
      await upload().attach('image', png, 'fixture.png').expect(status);
      expect(auditEvents()).toEqual([
        expect.objectContaining({ category, status }),
      ]);
      expect(JSON.stringify(auditEvents())).not.toContain(
        'PRIVATE_PROVIDER_SECRET',
      );
    },
  );

  it('distinguishes a malformed provider response and drops unsafe metadata', async () => {
    post.mockResolvedValueOnce({
      data: { request: { id: 'SECRET\nINJECTION', operations: -5 } },
    });
    await upload().attach('image', png, 'fixture.png').expect(503);
    expect(auditEvents()[0]).toMatchObject({
      category: 'sightengine_invalid_response',
    });
    expect(auditEvents()[0]).not.toHaveProperty('providerRequestId');
    expect(auditEvents()[0]).not.toHaveProperty('operations');
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
    expect(auditEvents()[0]).toMatchObject({ category: 'turnstile_invalid' });
    expect(post).toHaveBeenCalledTimes(1);
  });

  it('distinguishes a Turnstile timeout before any analysis call', async () => {
    jest.mocked(axios.isAxiosError).mockReturnValue(true);
    post.mockRejectedValueOnce({ code: 'ECONNABORTED' });
    await request(app.getHttpServer())
      .post('/detect/ai')
      .field('turnstileToken', 'private-token')
      .attach('image', png, 'fixture.png')
      .expect(503);
    expect(post).toHaveBeenCalledTimes(1);
    expect(auditEvents()[0]).toMatchObject({ category: 'turnstile_timeout' });
    expect(JSON.stringify(auditEvents())).not.toContain('private-token');
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
    const now = Date.now();
    const clock = jest.spyOn(Date, 'now').mockReturnValue(now);
    post.mockResolvedValue({ data: sightengine });
    for (let i = 0; i < 3; i++) {
      await upload()
        .attach('image', png, {
          filename: 'fixture.png',
          contentType: 'image/png',
        })
        .expect(201);
    }
    // The window has one second left, but a new block lasts a full minute.
    clock.mockReturnValue(now + 59000);
    const firstBlock = await upload()
      .attach('image', png, 'fixture.png')
      .expect(429);
    expect(firstBlock.body).toMatchObject({
      code: 'RATE_LIMIT_SHORT',
      retryAfterMs: 60000,
    });
    expect(auditEvents().at(-1)).toMatchObject({
      category: 'rate_limit_short',
      status: 429,
    });
    expect(post).toHaveBeenCalledTimes(3);
    clock.mockReturnValue(now + 89000);
    const blocked = await upload()
      .set('Origin', 'http://localhost:3000')
      .attach('image', png, 'fixture.png')
      .expect(429);
    expect(blocked.body).toMatchObject({
      code: 'RATE_LIMIT_SHORT',
      throttler: 'short',
      retryAfterMs: 30000,
    });
    expect(blocked.headers['retry-after']).toBe('30');
    expect(blocked.headers['retry-after-short']).toBe('30');
    expect(blocked.headers['access-control-allow-origin']).toBe(
      'http://localhost:3000',
    );
    expect(
      blocked.headers['access-control-expose-headers'].toLowerCase(),
    ).toContain('retry-after');
    expect(JSON.stringify(blocked.body)).not.toContain('3 análisis');
    expect(post).toHaveBeenCalledTimes(3);
    clock.mockReturnValue(now + 119001);
    await upload().attach('image', png, 'fixture.png').expect(201);
    expect(post).toHaveBeenCalledTimes(4);
  });

  it('reports the daily policy and remaining block rather than the original window', async () => {
    let now = Date.now();
    jest.spyOn(Date, 'now').mockImplementation(() => now);
    post.mockResolvedValue({ data: sightengine });
    for (let i = 0; i < 10; i++) {
      now += 61000;
      await upload().attach('image', png, 'fixture.png').expect(201);
    }
    now += 61000;
    const response = await upload()
      .set('Origin', 'http://localhost:3000')
      .attach('image', png, 'fixture.png')
      .expect(429);
    expect(response.body).toMatchObject({
      code: 'RATE_LIMIT_DAILY',
      throttler: 'daily',
      retryAfterMs: 86400000,
    });
    expect(auditEvents().at(-1)).toMatchObject({
      category: 'rate_limit_daily',
      status: 429,
    });
    expect(response.headers['retry-after']).toBe('86400');
    expect(response.headers['retry-after-daily']).toBe('86400');
    expect(
      response.headers['access-control-expose-headers'].toLowerCase(),
    ).toContain('retry-after-daily');
    now += 30000;
    const retry = await upload()
      .attach('image', png, 'fixture.png')
      .expect(429);
    expect(retry.body).toMatchObject({
      code: 'RATE_LIMIT_DAILY',
      retryAfterMs: 86370000,
    });
    expect(post).toHaveBeenCalledTimes(10);
  });

  it('allows the browser preflight with the configured session header', async () => {
    await request(app.getHttpServer())
      .options('/detect/ai')
      .set('Origin', 'http://localhost:3000')
      .set('Access-Control-Request-Method', 'POST')
      .set('Access-Control-Request-Headers', sessionHeader)
      .expect('Access-Control-Allow-Origin', 'http://localhost:3000')
      .expect(204);
    expect(post).not.toHaveBeenCalled();
  });
});
