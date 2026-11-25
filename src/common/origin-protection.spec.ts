import { loadOriginProtection } from './origin-protection';

describe('origin protection configuration', () => {
  const original = { ...process.env };
  beforeEach(() => {
    for (const key of [
      'RAILWAY_PROJECT_ID',
      'RAILWAY_ENVIRONMENT_ID',
      'RAILWAY_SERVICE_ID',
      'ORIGIN_PROTECTION_MODE',
      'ORIGIN_SHARED_SECRET',
      'ORIGIN_SHARED_SECRET_PREVIOUS',
    ])
      delete process.env[key];
    process.env.NODE_ENV = 'test';
    process.env.APP_ENV = 'development';
  });
  afterEach(() => {
    process.env = { ...original };
  });

  it('allows direct local development without an ingress secret', () => {
    expect(loadOriginProtection()).toEqual([]);
  });
  it.each([
    ['RAILWAY_PROJECT_ID', ''],
    ['RAILWAY_ENVIRONMENT_ID', 'partial'],
    ['RAILWAY_SERVICE_ID', 'fixture'],
    ['NODE_ENV', 'production'],
    ['APP_ENV', 'qa'],
    ['APP_ENV', 'staging'],
    ['APP_ENV', 'production'],
  ])('cannot disable protection in %s=%j', (key, value) => {
    process.env[key] = value;
    expect(() => loadOriginProtection()).toThrow('protección de origen');
    process.env.ORIGIN_PROTECTION_MODE = 'disabled';
    expect(() => loadOriginProtection()).toThrow('protección de origen');
    process.env.ORIGIN_PROTECTION_MODE = 'shared-secret';
    process.env.ORIGIN_SHARED_SECRET = 'a'.repeat(64);
    expect(loadOriginProtection()).toHaveLength(1);
  });
  it.each(['', 'unknown', 'SHARED-SECRET'])(
    'rejects invalid mode %j',
    (mode) => {
      process.env.ORIGIN_PROTECTION_MODE = mode;
      expect(() => loadOriginProtection()).toThrow('protección de origen');
    },
  );
  it.each([undefined, '', 'secret', 'a'.repeat(63), 'g'.repeat(64)])(
    'rejects weak or malformed secrets without printing them: %j',
    (secret) => {
      process.env.ORIGIN_PROTECTION_MODE = 'shared-secret';
      if (secret !== undefined) process.env.ORIGIN_SHARED_SECRET = secret;
      expect(() => loadOriginProtection()).toThrow(
        /^La configuración de protección de origen no es válida\.$/,
      );
    },
  );
  it('requires a valid, distinct previous key for an explicit rotation overlap', () => {
    process.env.ORIGIN_PROTECTION_MODE = 'shared-secret';
    process.env.ORIGIN_SHARED_SECRET = 'a'.repeat(64);
    process.env.ORIGIN_SHARED_SECRET_PREVIOUS = 'short';
    expect(() => loadOriginProtection()).toThrow('protección de origen');
    process.env.ORIGIN_SHARED_SECRET_PREVIOUS = 'a'.repeat(64);
    expect(() => loadOriginProtection()).toThrow('protección de origen');
    process.env.ORIGIN_SHARED_SECRET_PREVIOUS = 'b'.repeat(64);
    expect(loadOriginProtection()).toHaveLength(2);
  });
});
