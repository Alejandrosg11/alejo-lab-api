import { Test } from '@nestjs/testing';
import { Logger, type INestApplication } from '@nestjs/common';
import type { App } from 'supertest/types';
import request from 'supertest';
import axios from 'axios';
import { AppModule } from '../src/app.module';
import { configureRequestAudit } from '../src/common/request-audit';
import { configureCors } from '../src/common/configure-cors';
import { TurnstileService } from '../src/security/turnstile.service';
import {
  configureOriginProtection,
  ORIGIN_AUTH_HEADER,
} from '../src/common/origin-protection';

jest.mock('axios');
// eslint-disable-next-line @typescript-eslint/unbound-method -- Mocked Axios has no receiver.
const post = jest.mocked(axios.post);
const original = { ...process.env };
const current = 'a'.repeat(64);
const previous = 'b'.repeat(64);

describe('authenticated origin ingress', () => {
  let app: INestApplication<App>;
  let audit: jest.SpyInstance;
  beforeEach(async () => {
    jest.resetAllMocks();
    process.env.NODE_ENV = 'test';
    process.env.APP_ENV = 'test';
    process.env.CLIENT_IP_SOURCE = 'socket';
    process.env.ORIGIN_PROTECTION_MODE = 'shared-secret';
    process.env.ORIGIN_SHARED_SECRET = current;
    process.env.ORIGIN_SHARED_SECRET_PREVIOUS = previous;
    process.env.TURNSTILE_SECRET_KEY = 'origin-provider-fixture';
    process.env.TURNSTILE_SESSION_SECRET = 'origin-session-fixture';
    process.env.BOT_SESSION_HEADER = 'x-bot-session-token';
    process.env.SIGHTENGINE_USER = 'origin-test-user';
    process.env.SIGHTENGINE_SECRET = 'origin-test-secret';
    audit = jest
      .spyOn(Logger.prototype, 'log')
      .mockImplementation(() => undefined);
    const module = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = module.createNestApplication();
    configureRequestAudit(app);
    configureOriginProtection(app);
    configureCors(app);
    await app.init();
  });
  afterEach(async () => {
    await app?.close();
    jest.restoreAllMocks();
    process.env = { ...original };
  });

  it.each([
    ['post', '/detect/ai'],
    ['options', '/detect/ai'],
    ['get', '/affiliate/ugee/random'],
    ['get', '/.git/config'],
    ['get', '/unknown'],
    ['get', '/health/'],
    ['get', '/health/private'],
    ['post', '/health'],
  ] as const)(
    'rejects unauthenticated %s %s before routing',
    async (method, path) => {
      const res = await request(app.getHttpServer())
        [method](path)
        .set('Host', 'api.alejodraws.com')
        .set('CF-Ray', 'forged')
        .set('CF-Connecting-IP', '203.0.113.10')
        .set('X-Real-IP', '203.0.113.11')
        .expect(403);
      expect(res.body).toMatchObject({ code: 'ORIGIN_ACCESS_DENIED' });
      expect(res.headers['x-request-id']).toBeDefined();
      expect(post).not.toHaveBeenCalled();
    },
  );
  it.each(['', 'c'.repeat(64), `${current}, ${current}`])(
    'rejects wrong, empty or combined credentials: %j',
    async (value) => {
      await request(app.getHttpServer())
        .post('/detect/ai')
        .set(ORIGIN_AUTH_HEADER, value)
        .expect(403);
      expect(post).not.toHaveBeenCalled();
    },
  );
  it('keeps only exact GET/HEAD health available without authentication', async () => {
    await request(app.getHttpServer()).get('/health').expect(200);
    await request(app.getHttpServer()).head('/health').expect(200);
    await request(app.getHttpServer()).get('/health?probe=ready').expect(200);
    expect(post).not.toHaveBeenCalled();
  });
  it.each([current, previous])(
    'accepts the current or explicit rotation key',
    async (key) => {
      const res = await request(app.getHttpServer())
        .get('/affiliate/ugee/random')
        .set(ORIGIN_AUTH_HEADER, key)
        .expect(200);
      expect(res.headers[ORIGIN_AUTH_HEADER]).toBeUndefined();
      expect(JSON.stringify(res.body)).not.toContain(key);
    },
  );
  it('rejects before CORS and upload validation and audits without secrets', async () => {
    const res = await request(app.getHttpServer())
      .post('/detect/ai')
      .set('Origin', 'https://invalid.example')
      .set(ORIGIN_AUTH_HEADER, 'c'.repeat(64))
      .attach('image', Buffer.from('invalid file'), 'invalid.exe')
      .expect(403);
    expect(res.body).toMatchObject({ code: 'ORIGIN_ACCESS_DENIED' });
    const events = audit.mock.calls.map(([message]: [unknown]) =>
      String(message),
    );
    expect(
      events.some((message) => message.includes('"category":"origin_denied"')),
    ).toBe(true);
    expect(events.join()).not.toContain('c'.repeat(64));
    expect(events.join()).not.toContain(current);
    expect(post).not.toHaveBeenCalled();
  });
  it('retains legitimate browser preflight and denies invalid CORS after auth', async () => {
    const res = await request(app.getHttpServer())
      .options('/detect/ai')
      .set(ORIGIN_AUTH_HEADER, current)
      .set('Origin', 'https://alejodraws.com')
      .set('Access-Control-Request-Method', 'POST')
      .set('Access-Control-Request-Headers', 'content-type,x-turnstile-token')
      .expect('Access-Control-Allow-Origin', 'https://alejodraws.com')
      .expect(204);
    expect(res.headers[ORIGIN_AUTH_HEADER]).toBeUndefined();
    await request(app.getHttpServer())
      .options('/detect/ai')
      .set(ORIGIN_AUTH_HEADER, current)
      .set('Origin', 'https://invalid.example')
      .expect(403);
    expect(post).not.toHaveBeenCalled();
  });
  it('does not charge denied origin requests against authenticated client limits', async () => {
    for (let i = 0; i < 8; i++) {
      await request(app.getHttpServer()).post('/detect/ai').expect(403);
    }
    for (let i = 0; i < 3; i++) {
      await request(app.getHttpServer())
        .post('/detect/ai')
        .set(ORIGIN_AUTH_HEADER, current)
        .expect('X-RateLimit-Remaining-short', String(2 - i))
        .expect(400);
    }
    await request(app.getHttpServer())
      .post('/detect/ai')
      .set(ORIGIN_AUTH_HEADER, current)
      .expect(429);
    expect(post).not.toHaveBeenCalled();
  });
  it('preserves a legitimate signed session and analysis behind authenticated ingress', async () => {
    const userAgent = 'origin-session-regression';
    const session = app
      .get(TurnstileService)
      .createSessionToken('127.0.0.1', userAgent);
    post.mockResolvedValue({
      data: {
        status: 'success',
        type: { ai_generated: 0.91 },
        request: { id: 'origin-fixture', operations: 5 },
      },
    });
    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=',
      'base64',
    );
    const res = await request(app.getHttpServer())
      .post('/detect/ai')
      .set(ORIGIN_AUTH_HEADER, current)
      .set('User-Agent', userAgent)
      .set('x-bot-session-token', session!)
      .attach('image', png, 'fixture.png')
      .expect(201);
    expect(post).toHaveBeenCalledTimes(1);
    expect(res.headers['x-bot-session-token']).toBeDefined();
    expect(res.headers[ORIGIN_AUTH_HEADER]).toBeUndefined();
  });
});
