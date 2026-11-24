import type { Request } from 'express';
import { resolveClientIp } from './client-ip';

describe('client security identity', () => {
  const env = { ...process.env };
  const req = (
    headers: Record<string, unknown> = {},
    remoteAddress = '192.0.2.1',
  ) =>
    ({
      headers,
      socket: { remoteAddress },
      ip: '198.51.100.10',
    }) as unknown as Request;
  beforeEach(() => {
    process.env.CLIENT_IP_SOURCE = 'socket';
  });
  afterEach(() => {
    process.env = { ...env };
  });

  it('ignores every forwarded header outside the trusted edge', () => {
    expect(
      resolveClientIp(
        req({
          'x-real-ip': '203.0.113.1',
          'x-forwarded-for': '203.0.113.2',
          'cf-connecting-ip': '203.0.113.3',
        }),
      ),
    ).toBe('192.0.2.1');
  });
  it('uses the edge address instead of req.ip or visitor-supplied CF/XFF', () => {
    process.env.CLIENT_IP_SOURCE = 'railway-edge';
    expect(
      resolveClientIp(
        req({
          'x-real-ip': '203.0.113.1',
          'x-forwarded-for': '203.0.113.2',
          'cf-connecting-ip': '203.0.113.3',
        }),
      ),
    ).toBe('203.0.113.1');
  });
  it.each([
    undefined,
    '',
    'unknown',
    '203.0.113.1, 203.0.113.2',
    ['203.0.113.1'],
    '203.0.113.1:1234',
  ])('fails closed for an invalid edge address: %j', (value) => {
    process.env.CLIENT_IP_SOURCE = 'railway-edge';
    expect(() => resolveClientIp(req({ 'x-real-ip': value }))).toThrow(
      'La identificación del cliente',
    );
  });
  it('canonicalizes mapped IPv4 and IPv6 without a CIDR in session identities', () => {
    expect(resolveClientIp(req({}, '::ffff:192.0.2.1'))).toBe('192.0.2.1');
    expect(
      resolveClientIp(req({}, '2001:0db8:0000:0000:0000:0000:0000:0001')),
    ).toBe('2001:db8::1');
  });
  it('selects Railway edge mode only with the full deployment identity', () => {
    delete process.env.CLIENT_IP_SOURCE;
    process.env.RAILWAY_PROJECT_ID = 'fixture';
    process.env.RAILWAY_ENVIRONMENT_ID = 'fixture';
    process.env.RAILWAY_SERVICE_ID = 'fixture';
    expect(resolveClientIp(req({ 'x-real-ip': '203.0.113.1' }))).toBe(
      '203.0.113.1',
    );
  });
});
