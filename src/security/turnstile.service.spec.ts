/* eslint-disable @typescript-eslint/unbound-method -- Jest mocked functions do not use a receiver. */
import axios from 'axios';
import { TurnstileService } from './turnstile.service';

jest.mock('axios');
const post = jest.mocked(axios.post);

describe('TurnstileService with simulated provider', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    jest.resetAllMocks();
    process.env.TURNSTILE_SECRET_KEY = 'unit-test-provider-secret';
    process.env.TURNSTILE_SESSION_SECRET = 'unit-test-qa-session-secret';
    process.env.TURNSTILE_SESSION_TTL_MS = '60000';
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    jest.restoreAllMocks();
  });

  it('accepts provider success and rejects an expired challenge', async () => {
    const service = new TurnstileService();
    post.mockResolvedValueOnce({ data: { success: true } });
    await expect(
      service.verifyTokenOrThrow('test-token'),
    ).resolves.toBeUndefined();
    post.mockResolvedValueOnce({
      data: { success: false, 'error-codes': ['timeout-or-duplicate'] },
    });
    await expect(
      service.verifyTokenOrThrow('expired-token'),
    ).rejects.toMatchObject({
      response: { code: 'TOKEN_INVALID' },
    });
  });

  it('reports provider unavailability without a real network call', async () => {
    post.mockRejectedValueOnce(new Error('simulated provider outage'));
    await expect(
      new TurnstileService().verifyTokenOrThrow('test-token'),
    ).rejects.toMatchObject({ response: { code: 'BOT_PROVIDER_UNAVAILABLE' } });
  });

  it('rejects a missing token before contacting the provider', async () => {
    await expect(
      new TurnstileService().verifyTokenOrThrow(undefined),
    ).rejects.toMatchObject({ response: { code: 'TOKEN_MISSING' } });
    expect(post).not.toHaveBeenCalled();
  });

  it('rejects sessions signed in another environment in both directions', () => {
    const service = new TurnstileService();
    const qaToken = service.createSessionToken('192.0.2.1', 'test-agent');
    expect(service.verifySessionToken(qaToken, '192.0.2.1', 'test-agent')).toBe(
      true,
    );
    process.env.TURNSTILE_SESSION_SECRET =
      'unit-test-production-session-secret';
    expect(service.verifySessionToken(qaToken, '192.0.2.1', 'test-agent')).toBe(
      false,
    );
    const productionToken = service.createSessionToken(
      '192.0.2.1',
      'test-agent',
    );
    process.env.TURNSTILE_SESSION_SECRET = 'unit-test-qa-session-secret';
    expect(
      service.verifySessionToken(productionToken, '192.0.2.1', 'test-agent'),
    ).toBe(false);
    expect(post).not.toHaveBeenCalled();
  });

  it('rejects expired, tampered, and differently bound sessions', () => {
    const clock = jest.spyOn(Date, 'now').mockReturnValue(100000);
    const service = new TurnstileService();
    const token = service.createSessionToken('192.0.2.1', 'test-agent');
    expect(service.verifySessionToken(token, '192.0.2.2', 'test-agent')).toBe(
      false,
    );
    expect(service.verifySessionToken(token, '192.0.2.1', 'other-agent')).toBe(
      false,
    );
    expect(service.verifySessionToken(`${token}tampered`)).toBe(false);
    clock.mockReturnValue(160001);
    expect(service.verifySessionToken(token, '192.0.2.1', 'test-agent')).toBe(
      false,
    );
  });
});
