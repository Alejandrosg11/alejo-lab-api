import { test } from 'node:test';
import assert from 'node:assert/strict';
import { reconcile } from './provider-usage-report.mjs';
const from = '2026-11-17T00:00:00Z', to = '2026-11-24T00:00:00Z';
const row = { providerRequestId: 'req_1', timestamp: from, operations: 5 };
const event = { event: 'provider_attempt_completed', providerRequestId: 'req_1', environment: 'staging', timestamp: '2026-11-24T00:00:03Z', operations: 5 };

test('deduplicates provider and HTTP metadata, matching a late completion by ID', () => {
  const r = reconcile([row, row], [event, { ...event, event: 'http_request_completed' }], from, to);
  assert.equal(r.knownProviderOperations, 5);
  assert.equal(r.exactMatches, 1);
  assert.equal(r.byEnvironment.staging.knownOperations, 5);
  assert.equal(r.duplicateProviderRows, 1);
});
test('does not assign an environment using a nearby timestamp', () => {
  const r = reconcile([row, { ...row, providerRequestId: 'req_out', timestamp: to }], [{ ...event, providerRequestId: 'req_other', timestamp: from }], from, to);
  assert.equal(r.providerRequests, 1);
  assert.equal(r.exactMatches, 0);
  assert.equal(r.unmatched.length, 1);
});
test('flags ambiguous environments and conflicting operation metadata', () => {
  assert.equal(reconcile([row], [event, { ...event, environment: 'production' }], from, to).ambiguous.length, 1);
  assert.equal(reconcile([row], [{ ...event, operations: 0 }], from, to).ambiguous.length, 1);
  assert.throws(() => reconcile([row, { ...row, operations: 10 }], [], from, to));
});
test('keeps unknown operations and started-without-completion separate from zero', () => {
  const start = { event: 'provider_attempt_started', attemptId: 'attempt_1', timestamp: from, environment: 'development' };
  const r = reconcile([{ ...row, operations: null }], [start], from, to);
  assert.equal(r.unknownProviderOperationRequests, 1);
  assert.equal(r.unresolvedAttempts.length, 1);
  const done = reconcile([{ ...row, operations: 0 }], [start, { ...event, attemptId: 'attempt_1', operations: null }], from, to);
  assert.equal(done.unresolvedAttempts.length, 0);
  assert.equal(done.unknownCompletionAttempts.length, 1);
});
test('rejects invalid metadata without echoing untrusted values', () => {
  assert.throws(() => reconcile([{ ...row, providerRequestId: 'PRIVATE\nINJECTION' }], [], from, to), /Invalid provider metadata/);
  assert.throws(() => reconcile([row], [], to, from));
});
