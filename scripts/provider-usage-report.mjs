import { readFile, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

const safeId = (value) =>
  typeof value === 'string' && /^[a-zA-Z0-9_-]{1,100}$/.test(value);
const operationCount = (value) => Number.isSafeInteger(value) && value >= 0;
const environments = new Set([
  'production',
  'staging',
  'qa',
  'development',
  'test',
]);
const utc = (value) =>
  typeof value === 'string' &&
  /Z$/.test(value) &&
  Number.isFinite(Date.parse(value));

// Inputs are sanitized JSON exports, never credentials or raw provider responses.
export function reconcile(providerRows, events, from, to) {
  if (!utc(from) || !utc(to) || Date.parse(from) >= Date.parse(to))
    throw Error('Use a valid half-open UTC window.');
  const inWindow = (t) =>
    utc(t) &&
    Date.parse(t) >= Date.parse(from) &&
    Date.parse(t) < Date.parse(to);
  const provider = new Map();
  let duplicateRows = 0;
  for (const row of providerRows) {
    if (
      !safeId(row.providerRequestId) ||
      !utc(row.timestamp) ||
      (row.operations != null && !operationCount(row.operations))
    ) {
      throw Error(
        'Invalid provider metadata; normalize the export before reconciling.',
      );
    }
    const prior = provider.get(row.providerRequestId);
    if (prior) {
      duplicateRows++;
      if (
        prior.timestamp !== row.timestamp ||
        prior.operations !== (row.operations ?? null)
      )
        throw Error('Conflicting duplicate provider ID.');
    } else {
      provider.set(row.providerRequestId, {
        providerRequestId: row.providerRequestId,
        timestamp: row.timestamp,
        operations: row.operations ?? null,
      });
    }
  }
  const selected = [...provider.values()].filter((row) =>
    inWindow(row.timestamp),
  );
  const byId = new Map();
  const started = new Map();
  const completed = new Map();
  const rememberAttempt = (map, event, environment) => {
    if (!safeId(event.attemptId)) throw Error('Invalid attempt ID.');
    const identity = {
      timestamp: event.timestamp,
      environment,
      requestId: event.requestId ?? null,
      providerRequestId: event.providerRequestId ?? null,
      operations: event.operations ?? null,
      outcome: event.outcome ?? null,
      httpStatus: event.httpStatus ?? null,
    };
    const previous = map.get(event.attemptId);
    if (previous && JSON.stringify(previous) !== JSON.stringify(identity))
      throw Error('Conflicting duplicate attempt ID.');
    map.set(event.attemptId, identity);
  };
  for (const event of events) {
    if (
      !utc(event.timestamp) ||
      ![
        'http_request_completed',
        'provider_attempt_started',
        'provider_attempt_completed',
      ].includes(event.event)
    )
      throw Error('Invalid audit event or timestamp.');
    const env = environments.has(event.environment)
      ? event.environment
      : 'unknown';
    if (event.event === 'provider_attempt_started')
      rememberAttempt(started, event, env);
    if (event.event === 'provider_attempt_completed')
      rememberAttempt(completed, event, env);
    // Use terminal provider events and legacy HTTP metadata as the SAME evidence
    // for a provider ID. Never add the two operation counts together.
    if (
      event.event !== 'provider_attempt_started' &&
      safeId(event.providerRequestId)
    ) {
      const entries = byId.get(event.providerRequestId) ?? [];
      entries.push({ environment: env, operations: event.operations });
      byId.set(event.providerRequestId, entries);
    }
  }
  const byEnvironment = {};
  const unmatched = [];
  const ambiguous = [];
  let exactMatches = 0;
  for (const row of selected) {
    const evidence = byId.get(row.providerRequestId) ?? [];
    const envs = [...new Set(evidence.map((e) => e.environment))];
    const reportedCounts = new Set(
      evidence
        .filter((e) => operationCount(e.operations))
        .map((e) => e.operations),
    );
    if (!evidence.length) {
      unmatched.push(row);
      continue;
    }
    if (
      envs.length !== 1 ||
      envs[0] === 'unknown' ||
      reportedCounts.size > 1 ||
      evidence.some(
        (e) =>
          operationCount(e.operations) &&
          row.operations !== null &&
          e.operations !== row.operations,
      )
    ) {
      ambiguous.push({
        ...row,
        reason: 'Environment or operation metadata conflict/unknown',
      });
      continue;
    }
    exactMatches++;
    const totals = (byEnvironment[envs[0]] ??= {
      requests: 0,
      knownOperations: 0,
      unknownOperationRequests: 0,
    });
    totals.requests++;
    if (row.operations === null) totals.unknownOperationRequests++;
    else totals.knownOperations += row.operations;
  }
  for (const [id, start] of started) {
    const end = completed.get(id);
    if (
      end &&
      (start.environment !== end.environment ||
        start.requestId !== end.requestId)
    )
      throw Error('Conflicting attempt lifecycle identity.');
  }
  const unresolvedAttempts = [...started]
    .filter(([id, event]) => inWindow(event.timestamp) && !completed.has(id))
    .map(([attemptId, event]) => ({
      attemptId,
      environment: event.environment,
    }));
  const unknownCompletionAttempts = [...completed]
    .filter(
      ([id, event]) =>
        started.has(id) &&
        inWindow(started.get(id).timestamp) &&
        !operationCount(event.operations),
    )
    .map(([attemptId]) => ({
      attemptId,
      environment: started.get(attemptId).environment,
    }));
  return {
    window: { from, toExclusive: to },
    providerRequests: selected.length,
    knownProviderOperations: selected.reduce(
      (n, r) => n + (r.operations ?? 0),
      0,
    ),
    unknownProviderOperationRequests: selected.filter(
      (r) => r.operations === null,
    ).length,
    duplicateProviderRows: duplicateRows,
    exactMatches,
    byEnvironment,
    unmatched,
    ambiguous,
    unresolvedAttempts,
    unknownCompletionAttempts,
    limitations: [
      'Provider IDs establish matches; timestamps alone never assign an environment.',
      'Totals cover supplied exports only. Verify provider pagination, dashboard total and Railway retention/coverage separately.',
      'Unknown operations are not zero. A timeout/disconnect/crash can consume operations without a usable response.',
      'Provider request timestamps select the UTC window. Supply audit exports with margins for late completions.',
      'HTTP completion and provider completion metadata are deduplicated by provider ID, not added.',
    ],
  };
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length !== 5)
    throw Error(
      'Usage: node scripts/provider-usage-report.mjs provider.json audit.json fromUTC toUTC output.json',
    );
  const [providerPath, auditPath, from, to, output] = args;
  const provider = JSON.parse(await readFile(providerPath, 'utf8'));
  const audit = JSON.parse(await readFile(auditPath, 'utf8'));
  if (!Array.isArray(provider.requests) || !Array.isArray(audit.events))
    throw Error('Expected {requests:[...]} and {events:[...]}.');
  const report = reconcile(provider.requests, audit.events, from, to);
  await writeFile(output, JSON.stringify(report, null, 2) + '\n', {
    flag: 'wx',
  });
  console.log(
    JSON.stringify({
      providerRequests: report.providerRequests,
      knownProviderOperations: report.knownProviderOperations,
      exactMatches: report.exactMatches,
      unmatched: report.unmatched.length,
      ambiguous: report.ambiguous.length,
    }),
  );
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main().catch(() => {
    console.error(
      'Usage reconciliation failed. Check arguments, safe input schemas, duplicate metadata and output path (must be new).',
    );
    process.exitCode = 1;
  });
}
