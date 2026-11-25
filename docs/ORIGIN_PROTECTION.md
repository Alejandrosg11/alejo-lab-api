# Origin protection (SEC-06)

## Confirmed problem

The public DNS proxy alone does not close the origin. A controlled TLS request to
`api.alejodraws.com`, connected directly to Railway's DNS target while preserving
Host/SNI, reached Express. `/.git/config` returned application 404 directly while
Cloudflare returned 403. No sensitive file was exposed, but WAF bypass was real.
The Railway target hostname alone returning 404 does not prove origin isolation.

## Contract

Cloudflare must **set/overwrite** `x-alejo-origin-auth` for the exact API hostname.
The backend compares a SHA-256 digest of its fixed-format credential using
`timingSafeEqual`. A missing, wrong or combined header returns generic 403
`ORIGIN_ACCESS_DENIED` before CORS, upload validation, client throttling and
provider calls. Safe audit records `origin_denied`, without header values, IPs,
user agents or query strings. The credential is never returned in a response,
passed to a provider or published in browser code/environment variables.

- `ORIGIN_PROTECTION_MODE=shared-secret` enables the check.
- `ORIGIN_SHARED_SECRET`: independently generated random 32 bytes, encoded as
  exactly 64 lowercase hex characters. Set only in backend and trusted ingress.
- `ORIGIN_SHARED_SECRET_PREVIOUS`: optional, different valid key for an explicit,
  short rotation overlap. Remove it promptly after migration; there is no automatic
  expiry. Never reuse production keys in QA or Turnstile session signing.
- Only local/non-production execution can use `disabled` (also its local default).
  Any Railway identity metadata, including partial/empty values, `NODE_ENV=production`
  or `APP_ENV=production|staging|qa` requires protection. Missing/invalid config or
  a disabled protected deployment fails boot before readiness. Errors omit secrets.

The exact GET/HEAD `/health` remains public for Railway healthchecks. A query on
that path remains a healthcheck; trailing slashes, descendants and other methods
are not exempt. This endpoint returns only status/service/time. This is a narrow,
intentional residual exposure, not a claim that all network access is closed.
Requests still reach Railway and the application middleware. This is not a
network firewall or a complete DDoS/spending control; credential compromise would
allow bypass of this check. Turnstile, session binding, upload validation, CORS and
SEC-04 limits still apply independently to accepted API requests.

## Release gates — not yet configured remotely

1. Review/test this candidate and obtain the user's localhost approval. Local
   browser testing normally keeps local mode disabled; integration tests exercise
   the authenticated mode with mocked external providers.
2. Prepare a QA API custom hostname proxied by Cloudflare. Keep the frontend QA
   protected by its existing Vercel login. Update only QA's API base URL and rebuild
   its frontend; never put the ingress secret in `NEXT_PUBLIC_*`.
3. Add a scoped Request Header Transform Rule that SETS the private header for
   that exact QA hostname, with a new QA-only secret. Leave unrelated hosts/rules
   intact. Add the matching secret/mode to the QA API without prematurely
   redeploying. Confirm sender, receiver, TLS/domain and healthcheck configuration
   together before merging/deploying the protected candidate.
4. In QA, test legitimate frontend preflight, analysis/Turnstile/session flow,
   affiliate route and limits. Direct origin requests must return 403, including
   forged Host/CF/XFF/auth headers and unsupported upload payloads. Test that
   Cloudflare overwrites a bogus incoming origin-auth header. Public exact health
   remains 200. Correlate application IDs with sanitized Railway logs. Negative
   probes use no images/providers; limit repeated valid requests to preserve quota.
5. Obtain QA approval. Prepare independent production credential and scoped rule,
   then promote the same reviewed code and verify the Cloudflare and direct paths.
   A DNS target or a configured environment variable alone is not evidence of
   working enforcement. SEC-04's explicit client IP mode remains unchanged.

Protecting QA's former public Railway hostname is part of step 4: only health
should remain accessible without trusted ingress authentication. Do not preserve
an unauthenticated QA bypass just to avoid adding a Cloudflare test hostname.

## Rotation and recovery

For rotation: deploy the backend accepting the new current credential and the old
one as previous; update Cloudflare's SET rule to the new credential; verify the
normal path; remove the previous credential and deploy again. Record an explicit
overlap deadline. Keep credentials out of screenshots, stdout, source control,
PRs, logs, analytics, request query strings and this document.

For rollout failure, inspect which side is mismatched. Keep the exact health
exception and previous working deployment available. Prefer restoring the matching
trusted rule/credential or reverting the whole release via the workflow. Removing
the Cloudflare credential while enforcement remains enabled makes public API
requests fail. Do not expose the credential in frontend code or globally disable
security to fix routing. An application rollback to pre-SEC-06 code reopens the
confirmed direct-origin bypass; record that consequence and repair promptly.

## Alerting is a separate operational gate

The requested delivery destination is email. Inspect actual account capabilities,
agree recipients, thresholds/windows and response owner before activating alerts.
Separate sustained detector 5xx from expected 403/404/429 and deployment events.
No monitor or email sender is created by this middleware. Do not claim provider
quota monitoring or a recurring email is active merely because logging exists.

Sources: [Cloudflare request-header transforms](https://developers.cloudflare.com/rules/transform/request-header-modification/),
[plan availability](https://developers.cloudflare.com/rules/transform/),
[Railway monitors](https://docs.railway.com/observability).
