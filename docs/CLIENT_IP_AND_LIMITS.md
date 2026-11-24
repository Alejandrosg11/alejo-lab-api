# Client identity and rate limits (SEC-04)

The QA baseline showed eight requests from one source address reaching validation
without the expected fourth-request 429. Remaining counters varied even before
forged headers were sent. `trust proxy = 1` and Express `req.ip` are not sufficient
to identify the security client consistently across the deployed Railway path.

## Security identity

`resolveClientIp` selects one explicit source for both throttling and Turnstile
verification/session binding:

- `CLIENT_IP_SOURCE=railway-edge` explicitly opts in to trusting the public HTTP
  edge's `X-Real-IP` address. Railway metadata never grants that trust.
- `CLIENT_IP_SOURCE=socket` uses the TCP socket address and ignores forwarding
  headers. This is the default outside Railway, suitable for localhost/direct HTTP.
- On Railway, the operator must configure the mode explicitly. Missing/invalid
  configuration fails startup before readiness; it never silently trusts headers
  or groups all public callers into a shared socket bucket.
- Enable edge mode only after verifying the network boundary below. A setting is
  an operational trust decision, **not per-request authentication**. If untrusted
  private/TCP access cannot be excluded, do not enable this mode or release this
  candidate: first restrict ingress or add authenticated origin protection.
- An invalid mode, absent edge address, list/duplicate or malformed address fails
  closed with 503 before provider calls. `/health` remains exempt from throttling
  for platform healthchecks that may not supply edge headers.
- Security decisions never use `req.ip`, `X-Forwarded-For` or `CF-Connecting-IP`
  directly. Express retains its previous proxy metadata setting for protocol and
  host behavior; it does not determine the security tracker.
- IPv4-mapped addresses and IPv6 notation are canonicalized. Sessions use the
  complete address. Throttling preserves Nest's IPv6 /64 grouping, so rotating
  addresses inside a subnet does not automatically create new buckets.

This depends on Railway's **public HTTP ingress boundary**, whose documented
client header is X-Real-IP. A directly submitted X-Real-IP is not independently
authenticated by this app. In edge mode it must have been overwritten by the
trusted ingress. Private network calls and TCP proxies bypass that guarantee;
do not expose this API that way without redesigning the boundary. Current
production and QA each have one API replica and no TCP proxy. Checking alternative
origin exposure remains SEC-06. Local tests simulate trusted ingress; they do not
prove Railway overwrites a header. Repeat the bounded physical QA probes after
deployment and confirm that forged XFF/X-Real-IP/CF headers cannot reset a bucket.

Release gate: inspect all services/callers in each environment and any TCP/private
exposure before setting CLIENT_IP_SOURCE=railway-edge there. Record the result and
configuration together; leave existing deployments untouched if that boundary is
not established. The code does not claim to identify public ingress from the
presence of a header or environment variables. No such variable has been added
to QA or production as part of preparing this PR.

Sources checked during the investigation:

- https://docs.railway.com/networking/public-networking/specs-and-limits
- https://developers.cloudflare.com/fundamentals/reference/http-headers/

## Existing quota contract and limitations

- `/detect/ai`: three requests per 60 seconds and ten per 86,400 seconds, per
  normalized client and handler. Failed validation requests also consume hits.
- The daily policy is not a midnight calendar reset. Retry-After reports the
  active block duration; requests rejected by the short policy do not reach the
  later daily policy. A shared public NAT address can group legitimate people.
- Default storage is in-memory, per process: restarts/deployments lose counters,
  multiple replicas do not share them. This delivery does not claim a durable
  ten-per-day guarantee or a global Sightengine spending cap.
- With one replica, no new shared store is provisioned in this delivery. Add a
  shared atomic store before horizontal scaling or if a restart-proof quota is
  required; define TTL, concurrency, failure behavior and cost before doing so.
- No global Cloudflare rate rule is added: the baseline is too small to choose a
  safe additional threshold. The sensitive-file rule, Turnstile and existing
  limits remain enabled. No bypass or quota increase is introduced.

## Tests and rollout

Integration tests cover stable buckets across varying intermediary chains,
separate clients, IPv6 subnets, local header spoofing, missing edge identity,
Turnstile remoteip and session binding. Existing short/daily policy and retry
tests use a simulated clock and mocked providers, not live quota.

Before closing SEC-04: complete code review, user localhost approval, deploy QA,
repeat physical spoof probes and client-isolation checks, obtain QA approval,
then promote and verify production. No real images are needed for the negative
probes. A rollout can invalidate previously signed sessions whose stored IP was
an intermediary; affected clients must complete a fresh Turnstile challenge.
Do not weaken signature checks or discard session/IP binding to preserve them.

Rollback must keep tracker and Turnstile IP selection consistent. Prefer reverting
the whole change through the release workflow. Record that a process restart
also resets in-memory limits and this cannot be used as a verification shortcut.
