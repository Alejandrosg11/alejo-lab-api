# Provider usage reconciliation (SEC-05)

HTTP requests, image analyses and provider operations are different units.
Never multiply all HTTP requests by five or treat a failed/aborted HTTP response
as proof of zero provider usage. Use Sightengine's reported `request.operations`
and `request.id`; counts may vary with the model and media. A client timeout
does not establish whether the provider processed its request.

## New accounting events

The existing Nest stdout logger emits two safe event types:

- `provider_attempt_started`: one `attemptId` per dispatch to Sightengine, with
  timestamp UTC, provider/model and captured application `requestId`, environment,
  canonical route and method. Starting an attempt does not prove network delivery.
- `provider_attempt_completed`: the same identity plus duration, bounded outcome
  (`response`, `http_error`, `timeout`, `network_error`, `unexpected_error`),
  upstream HTTP status, validated provider ID and operations. Missing/invalid
  provider metadata is **null**, including unknown usage on timeout/network error.

The final event is emitted even if the browser already closed its HTTP request.
Provider errors can report zero operations; zero is retained only when reported.
A response can consume operations even if its model payload is invalid and the
application returns 503. `response` means a response arrived, not that analysis
succeeded. HTTP audit categories remain the application outcome.

An attempt has at most one terminal event in the process. Process crashes,
termination, stdout loss and retention can still lose either event. Started
without completed is unresolved, not free. No persistent accounting database,
background retries, provider calls from a scheduler, spending cap or exporter
is introduced. This change does not disable analysis after a client disconnect.

Captured identity follows existing `APP_ENV` / `RAILWAY_ENVIRONMENT_NAME` rules.
Production and staging use their Railway labels; local is development and mocked
tests are test. Unknown labels stay unknown. Local calls outside HTTP have a null
application request ID but retain attempt ID and environment. Do not copy hosted
session or origin secrets into local overrides.

Only bounded metadata is logged. No credentials, complete provider/error bodies,
images, filenames, scores, session/challenge tokens, headers, IP or user-agent.
These events do not change the API response contract or frontend.

## Offline report

Normalize/export only safe fields, preserving pagination and the extraction
window as separate evidence. Inputs:

```json
{"requests":[{"providerRequestId":"req_example","timestamp":"2026-11-24T18:00:00Z","operations":5}]}
```

```json
{"events":[{"event":"provider_attempt_completed","attemptId":"attempt-example","timestamp":"2026-11-24T18:00:01Z","environment":"staging","providerRequestId":"req_example","operations":5}]}
```

The audit input also accepts `provider_attempt_started` and legacy
`http_request_completed` events. Extract the JSON object from Nest's ANSI/prefix
wrapper before normalizing; do not dump raw Railway proxy logs into this schema.
Keep start events to detect unresolved attempts and error/timeout completions to
detect unknown usage: an `analysis_success`-only export cannot establish either.

```text
node scripts/provider-usage-report.mjs provider.json audit.json 2026-11-24T00:00:00Z 2026-11-25T00:00:00Z report.json
node --test scripts/provider-usage-report.test.mjs
```

Output must be a new path (existing files are never overwritten). It includes
known provider operations, unknown operation counts, exact matches by provider ID,
environment totals, unmatched provider records, ambiguous/conflicting metadata,
and unresolved/unknown-completion attempts. Inputs with invalid provider metadata
or conflicting duplicate provider IDs fail rather than silently miscounting.

The window is UTC **[from, to)** and uses provider request timestamps. Export audit
events with margins around the window for delayed completions. Exact matches are
by provider ID, never by nearest timestamp. Deduplicate provider exports and
HTTP/provider completion metadata by provider ID: summing both doubles usage.
Multiple environments or conflicting reported operations make a match ambiguous.
An unmatched provider record is not evidence of abuse or of localhost usage.

The report is a reconciliation of supplied records, not a provider invoice.
Check the dashboard aggregate for the same UTC window, all pages/filters, unknown
metadata, unresolved attempts and export/retention coverage before calling it
complete. Counts without old provider IDs can support only temporal candidates.

## Collection, access and retention

Owner: site maintainer. Collect safe prod, QA and local provider events before
the hosting access window expires; compare with provider usage after allowing
for delayed responses. Record the window, export limits/pages, deployment IDs,
dashboard total and any known missing intervals alongside the report. Store
exports locally with restricted access, not in public PRs or screenshots. No
automatic recurring export or email has been configured by this change.

Railway's documented log access/retention windows depend on plan: Free 3 days,
Trial/Hobby 7 days, Pro 30 days, Enterprise up to 90. These are not an application
deletion guarantee, and upgrading may restore older logs. The effective workspace
plan/access policy still needs confirmation before remote rollout; do not promise
monthly completeness from a shorter available log window. Sightengine's full
history/retention guarantee was not established; verify actual available pages.
Adding provider secrets does not establish separate quotas or usage breakdowns.

## Rollout and rollback

Run unit tests, real HTTP tests with simulated providers, report tests, lint and
build. Cover a client disconnect followed by a late provider completion, errors
with zero operations, unknown timeout usage, concurrent identity isolation,
malformed metadata and deduplication. No real calls are needed for automation.
Obtain review and the user's localhost approval, then QA approval before promotion.
For an approved manual real analysis, budget it explicitly and correlate its
provider ID in dashboard and logs; do not spend quota to fabricate error cases.

Rollback through the normal code release workflow. No variable, credential or DNS
changes are required. Retain evidence that accounting coverage was reduced; old
HTTP completion logs cannot reconstruct all late provider completions.

Sources: [Sightengine API reference](https://sightengine.com/docs/reference),
[Railway logs](https://docs.railway.com/observability/logs).
