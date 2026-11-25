import { test } from 'node:test';
import assert from 'node:assert/strict';
import { reconcile } from './provider-usage-report.mjs';
const from = '2026-11-17T00:00:00Z',
  to = '2026-11-24T00:00:00Z';
const row = { providerRequestId: 'req_1', timestamp: from, operations: 5 };
const event = {
  event: 'provider_attempt_completed',
  attemptId: 'attempt_1',
  providerRequestId: 'req_1',
  environment: 'staging',
  timestamp: '2026-11-24T00:00:03Z',
  operations: 5,
};

test('deduplicates provider and HTTP metadata, matching a late completion by ID', () => {
  const r = reconcile(
    [row, row],
    [event, { ...event, event: 'http_request_completed' }],
    from,
    to,
  );
  assert.equal(r.knownProviderOperations, 5);
  assert.equal(r.exactMatches, 1);
  assert.equal(r.byEnvironment.staging.knownOperations, 5);
  assert.equal(r.duplicateProviderRows, 1);
});
test('does not assign an environment using a nearby timestamp', () => {
  const r = reconcile(
    [row, { ...row, providerRequestId: 'req_out', timestamp: to }],
    [{ ...event, providerRequestId: 'req_other', timestamp: from }],
    from,
    to,
  );
  assert.equal(r.providerRequests, 1);
  assert.equal(r.exactMatches, 0);
  assert.equal(r.unmatched.length, 1);
});
test('flags ambiguous environments and conflicting operation metadata', () => {
  assert.equal(
    reconcile(
      [row],
      [event, { ...event, attemptId: 'attempt_2', environment: 'production' }],
      from,
      to,
    ).ambiguous.length,
    1,
  );
  assert.equal(
    reconcile([row], [{ ...event, operations: 0 }], from, to).ambiguous.length,
    1,
  );
  assert.throws(() =>
    reconcile([row, { ...row, operations: 10 }], [], from, to),
  );
});
test('keeps unknown operations and started-without-completion separate from zero', () => {
  const start = {
    event: 'provider_attempt_started',
    attemptId: 'attempt_1',
    timestamp: from,
    environment: 'development',
  };
  const r = reconcile([{ ...row, operations: null }], [start], from, to);
  assert.equal(r.unknownProviderOperationRequests, 1);
  assert.equal(r.unresolvedAttempts.length, 1);
  const done = reconcile(
    [{ ...row, operations: 0 }],
    [start, { ...event, environment: 'development', operations: null }],
    from,
    to,
  );
  assert.equal(done.unresolvedAttempts.length, 0);
  assert.equal(done.unknownCompletionAttempts.length, 1);
});
test('accepts identical attempt duplicates and rejects conflicting starts or finals', () => {
  const start = {
    event: 'provider_attempt_started',
    attemptId: 'attempt_1',
    timestamp: from,
    environment: 'staging',
  };
  const r = reconcile([row], [start, start, event, event], from, to);
  assert.equal(r.exactMatches, 1);
  assert.equal(r.unresolvedAttempts.length, 0);
  for (const other of [
    { ...start, environment: 'production' },
    { ...start, timestamp: '2026-11-18T00:00:00Z' },
  ]) {
    assert.throws(
      () => reconcile([], [start, other], from, to),
      /Conflicting duplicate attempt ID/,
    );
  }
  for (const other of [
    { ...event, operations: 0 },
    { ...event, providerRequestId: 'req_other' },
  ]) {
    assert.throws(
      () => reconcile([row], [event, other], from, to),
      /Conflicting duplicate attempt ID/,
    );
  }
  assert.throws(
    () =>
      reconcile(
        [row],
        [start, { ...event, environment: 'production' }],
        from,
        to,
      ),
    /Conflicting attempt lifecycle/,
  );
});
test('surfaces contradictory evidence even when provider operations are unknown', () => {
  const r = reconcile(
    [{ ...row, operations: null }],
    [event, { ...event, event: 'http_request_completed', operations: 0 }],
    from,
    to,
  );
  assert.equal(r.exactMatches, 0);
  assert.equal(r.ambiguous.length, 1);
  assert.equal(r.unknownProviderOperationRequests, 1);
});
test('rejects invalid metadata without echoing untrusted values', () => {
  assert.throws(
    () =>
      reconcile(
        [{ ...row, providerRequestId: 'PRIVATE\nINJECTION' }],
        [],
        from,
        to,
      ),
    /Invalid provider metadata/,
  );
  assert.throws(() => reconcile([row], [], to, from));
});

test('rejects malformed audit metadata rather than silently hiding evidence', () => {
  for (const bad of [
    { ...event, providerRequestId: 'PRIVATE\nINJECTION' },
    ...[-1, 1.5, '5', Infinity, Number.MAX_SAFE_INTEGER + 1].map(
      (operations) => ({ ...event, operations }),
    ),
  ]) {
    assert.throws(
      () => reconcile([row], [bad], from, to),
      /Invalid audit provider metadata/,
    );
  }
  assert.equal(
    reconcile(
      [row],
      [{ ...event, providerRequestId: null, operations: null }],
      from,
      to,
    ).unmatched.length,
    1,
  );
});
