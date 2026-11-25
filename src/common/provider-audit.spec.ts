import { Logger } from '@nestjs/common';
import { providerUsage, startSightengineAudit } from './provider-audit';

describe('Safe provider accounting', () => {
  afterEach(() => jest.restoreAllMocks());

  it('preserves zero operations but never invents usage for absent metadata', () => {
    expect(
      providerUsage({ request: { id: 'req_safe', operations: 0 } }),
    ).toEqual({
      providerRequestId: 'req_safe',
      operations: 0,
    });
    expect(providerUsage(undefined)).toEqual({
      providerRequestId: null,
      operations: null,
    });
    for (const operations of [
      -1,
      1.5,
      Infinity,
      Number.MAX_SAFE_INTEGER + 1,
      '5',
    ]) {
      expect(
        providerUsage({ request: { id: 'private\ninjection', operations } }),
      ).toEqual({
        providerRequestId: null,
        operations: null,
      });
    }
  });

  it('emits a single safe terminal event without an HTTP context', () => {
    const log = jest
      .spyOn(Logger.prototype, 'log')
      .mockImplementation(() => undefined);
    const complete = startSightengineAudit();
    complete('timeout', { api_secret: 'PRIVATE', request: { id: 'req_safe' } });
    complete('response', { request: { operations: 5 } }, 200);
    const events = log.mock.calls.map(
      ([message]: [string]) => JSON.parse(message) as Record<string, unknown>,
    );
    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({
      event: 'provider_attempt_started',
      provider: 'sightengine',
      model: 'genai',
      requestId: null,
    });
    expect(events[1]).toMatchObject({
      event: 'provider_attempt_completed',
      attemptId: events[0].attemptId,
      outcome: 'timeout',
      operations: null,
      httpStatus: null,
    });
    expect(JSON.stringify(events)).not.toContain('PRIVATE');
  });
});
