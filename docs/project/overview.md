# Project overview

Idhn is an authorization layer that sits in front of a protected HTTP service. A
**Guard** intercepts each incoming request and uses a service-authored
**manifest** to work out which `Action` the request is attempting and which
`Context` facts to extract from it. It then asks a **Judge** for a `Decision`.
The Judge evaluates OPA/Rego policies, compiled to a WASM bundle, against the
action and context. It combines the results with a deny-overrides strategy. The
Guard then forwards the request upstream or answers with a rejection.

The domain logic lives in `source/core/` (`access`, `policy`, `guard`, `judge`,
`opa`). The apps in `source/apps/` are thin wiring layers: each one reads
configuration from the environment, builds the core objects, and starts a
process or exposes a builder. See `source/core/PLAN.md` for the design
rationale.

## Apps at a glance

| App                  | Package                    | Kind         | What it does                                                                |
| -------------------- | -------------------------- | ------------ | --------------------------------------------------------------------------- |
| `guard/standalone`   | `@idhn/guard-standalone`   | HTTP server  | Reverse proxy that asks a remote judge-server for each decision             |
| `guard/embedded`     | `@idhn/guard-embedded`     | HTTP server  | Reverse proxy that runs its Judge in-process, with no separate judge        |
| `guard/fake-service` | `@idhn/guard-fake-service` | HTTP server  | Stand-in protected service that echoes what it received (demo only)         |
| `guard/demo`         | —                          | Demo assets  | Manifest, Rego policy, WASM bundle and 403 page for a manual end-to-end run |
| `judge/server`       | `@idhn/judge-server`       | HTTP server  | Serves a `Judge.Behavior` over HTTP; internal only, never exposed publicly  |
| `web`                | —                          | Web frontend | React + React Router UI scaffold (early stage)                              |

## Deployment topologies

The Guard can reach a Judge in two ways. `Guard` depends only on the
`Judge.Behavior` interface, so switching between them changes no domain code.

1. **Split (standalone):** `guard/standalone` → HTTP → `judge/server`. The Guard
   is the only public process. The judge-server stays on the internal network,
   holds the policy bundle and owns the policy registry.
2. **Single process (embedded):** `guard/embedded` composes its own Judge inside
   its own process. There is one process and one port, with no
   `JUDGE_SERVER_URL`. The `guard/base` Docker image ships this build: it starts
   the Guard in the background, and the consuming image then runs its own
   service in the foreground.

```
standalone:  client ─▶ guard/standalone ─▶ upstream service
                              │
                              └─HTTP─▶ judge/server (OPA bundle + KV registry)

embedded:    client ─▶ guard/embedded [Judge in-process] ─▶ upstream service
```

In both topologies, the **policy registry** maps each action to the policies
that govern it. It is persisted in Deno KV by `Policy.Registries.Kv`, which owns
the row layout, and nothing in these apps writes to it. Some other
integration-level actor, such as a seed script, a migration or an admin API, has
to populate it by calling `associate` on a `Policy.Registry` (never by writing
KV rows directly). Until it does, every request is denied.

## Recognizing actions: manifests and protocols

A manifest declares how one service's requests map to actions, and which facts
to extract from them. It is tagged with the protocol it describes:

```yaml
id: billing_service
protocol: http # the default when omitted
actions:
  - name: invoice.approve
    match: { method: POST, path: /invoices/:id/approve }
    extract: [{ from: { property: path, using: id }, as: invoiceId }]
```

Everything under `match` and `from` is the vocabulary of that protocol. The
manifest code (`source/core/guard/manifest/`) keeps the protocol-neutral part
(`id`, action names, the parser registry) apart from the HTTP part
(`manifest/http/`). Supporting another protocol means adding its manifest shape,
its parser and its own `ActionResolver`, and giving it its own guard entry point
that pairs that resolver with a matching `ServiceProvider`.
`loadManifestFile(path, protocol)` rejects a manifest declared for a different
protocol than the entry point serves. Only `http` exists today.

## Who is asking: authentication

Authentication only **reports** who is behind a request; it never rejects one.
Whether an action needs an authenticated caller is up to its policies. For each
request whose action resolves, the Guard asks an `Authenticator` (a per-request
port, like `ActionResolver`) for an `Access.Identity` and adds it to the context
as the reserved fact `auth`, which policies read as `input.auth`:

```json
{
  "status": "authenticated",
  "subject": "u-1",
  "issuer": "http://auth.internal",
  "claims": { "username": "alice", "emailVerified": true }
}
```

`status` is `authenticated`, `anonymous` (no credential presented), `invalid` (a
credential that failed verification) or `unavailable` (a credential that could
not be checked because the identity provider is down); all but the first carry
only `status` and empty `claims`. A policy that needs a caller checks
`input.auth.status == "authenticated"`, so an outage denies it, while a policy
that ignores `auth` (a public page) keeps working.

When the judge denies a request, the scheme's `Authenticator` says how to answer
(`Rejection`), and the HTTP guard maps that to a status:

| Caller's identity        | `session-cookie`              | `none`          |
| ------------------------ | ----------------------------- | --------------- |
| `authenticated`          | `403` forbidden               | —               |
| `anonymous` or `invalid` | `401` unauthenticated         | `403` forbidden |
| `unavailable`            | `503` unavailable (try again) | —               |

A request that matches no action is always `403`. Every status serves the same
reject page (`REJECT_RESPONSE_URL`), or an empty body. Nothing else may write
`auth`: the manifest parser and the enrichment definition reject `as: auth`, and
`Context.with()` throws on any conflict.

A manifest declares exactly one scheme in an `authentication` block, inside its
protocol-tagged section. The parser dispatches on `scheme` the way it does on
`protocol`; with no block, the scheme is `none` and every request is anonymous.

```yaml
id: dashboard
protocol: http
authentication:
  scheme: session-cookie
  session_url: http://auth.internal/api/auth/get-session # required
  cookie: better-auth.session_token # optional; this is the default
  issuer: portal # optional; defaults to session_url's origin
  claims: [
    username,
    email,
    name,
    emailVerified,
  ] # optional; these are the default
  ttl_seconds: 5 # optional; default 5, 0 disables caching
  timeout_ms: 2000 # optional; default 2000, then the identity is unavailable
actions: [...]
```

Settings in the manifest are non-secret by design. Each guard's `main.ts` wires
the schemes that deployment supports (`Authenticators.Schemes`, also where a
future scheme would get its secrets from the environment), and startup fails
with `UnsupportedSchemeError` if the manifest names another one.

| Scheme           | What it does                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `none`           | Everyone is anonymous (`Authenticators.Anonymous`).                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `session-cookie` | A server-side session in a cookie (the portal's BetterAuth). Without the cookie the request is anonymous and costs no lookup. Otherwise only that cookie is forwarded to `session_url`: a session makes `user.id` the subject and the listed user fields the claims, `null` makes it invalid, and an error, an unreachable auth server, no answer within `timeout_ms`, or an answer that is not a session makes it unavailable (never cached). Answers are cached per cookie hash for `ttl_seconds`, the revocation lag. |

Identity providers rarely know roles or relationships, so policies should not
hardcode usernames: use `data` (for example `data.roles[input.auth.subject]`) or
an enrichment lookup keyed by `{auth.subject}` for what the provider cannot say.
The fixture policies `profile.read`, `report.view` and `place.manage` in
`source/core/opa/tests/fixtures/` show each pattern.

## Where a policy's facts come from

`Policy.Engine.evaluate` is a pure function of `(policy, context)`. It makes no
network calls, so a policy can only use what is already in its input. Besides
the `auth` fact above, there are three sources, from most to least static:

1. **The request.** The manifest's `extract` entries put path, query, header,
   body or constant values into the `Context`. This happens in the Guard.
2. **Reference data (`data`).** For slow-changing lists such as an allow-list,
   `POLICY_DATA_PATH` points to a JSON file that `OPA.PolicyEngine.load` hands
   to OPA as Rego's `data` document. Policies read `data.<key>`. It is fixed for
   the engine's lifetime, so changing it means restarting the judge, the same as
   a new bundle.
3. **Enrichment.** For live lookups, `ENRICHMENT_PATH` points to a YAML file of
   HTTP lookups that `Judge.Local` runs before evaluating, but only once at
   least one policy governs the action.

   ```yaml
   lookups:
     - as: agent_directory # the fact name: policies read input.agent_directory
       actions: [
         billing_service.invoice_approve,
       ] # optional; all actions if omitted
       http:
         url: http://directory.internal/agents/{subject} # {name} is filled from a fact; {auth.subject} from a nested one
       ttl_seconds: 60 # optional; default 0 (no caching)
       timeout_ms: 2000 # optional; default 2000, then the lookup is unavailable
       optional: false # optional; default false
   ```

   The response body is added to the context as one fact. It never overwrites a
   request fact (`ConflictingFactError`). A failed lookup or a missing
   placeholder fact throws `Judge.Enrichers.LookupError`, so the decision fails
   closed. With `optional: true` the fact is omitted instead and the policy sees
   it as undefined. Failures are never cached. A lookup keyed by
   `{auth.subject}` should usually be optional, since an anonymous or invalid
   identity has no subject.

Enrichment runs inside the judge, which is on the internal network, so the
public-facing Guard never needs credentials for those data sources.

## Observability: decision and request logs

Both processes write structured logs as JSON Lines (one JSON object per line) to
stdout, tagged with an `event` field. They never send logs anywhere themselves:
collecting, shipping and storing them is the job of a log shipper (Vector,
Fluent Bit, the container runtime's log driver). That keeps logging off the
network and out of the request's latency.

- **`judge.decision`**: one per judgement, written by the judge (`judge/server`,
  or `guard/embedded` in-process). It has the `decisionId`, the `action`, the
  full `context` the policies were evaluated against (including enriched facts
  and `auth`), the `outcome` (`allowed`, `denied` or `failed`), each policy's
  verdict under `results`, and an `error` when the judgement failed.
- **`guard.request`**: one per request, written by the guard. It has the HTTP
  `method` and `path`, the resolved `action`, the caller's `identity` (status
  and subject), the `decisionId` of the judgement it got, the `outcome`
  (`forwarded`, `rejected` or `failed`), the `rejection` reason, and an `error`
  when handling failed. Fields the guard never got to are left out, so a request
  no action matched has only its method, path and rejection.

Both carry a `timestamp` (when handling started) and `durationMs`.

Faults nothing handled (a policy missing from the bundle, a bug) are written as
one `guard.error` or `judge.error` line with the message, the error class name
and the stack, never as free-form text.

## When something fails: 503 or 500

A request that can't be judged is always denied. The status says whether trying
again may help:

- **`503` with `Retry-After: 5`** when something the judgement depends on is
  temporarily out of reach: the judge-server (unreachable, no answer within
  `JUDGE_TIMEOUT_MS`, or answering `429`/`502`/`503`/`504`) or an enrichment
  lookup's service (the same). The judge records the outcome as `unavailable`,
  and the guard records a `rejected` request with `rejection: unavailable` and
  the failed judgement's `decisionId`. The same `503` is used when the identity
  provider can't be reached.
- **`502`** when the request was allowed but the protected service itself can't
  be reached. The guard records a `rejected` request with
  `rejection: unreachable` and the `decisionId` that allowed it. An error
  response from the service is not this case: it is relayed as the service's own
  answer. A denied request is answered `401`/`403` without ever reaching the
  service, so it never reveals whether the service is up.
- **`500`** for everything else, which is a fault to fix rather than wait out: a
  policy missing from the bundle, a lookup answering `404` or `500` or with a
  malformed body, a missing placeholder fact, a bug.

**Correlating across processes.** The judge gives every judgement its own id and
returns it with the `Decision` (over HTTP as `decisionId` in the `/decide`
response). The guard records that id, so a `guard.request` line and the
`judge.decision` line that explains it share the same `decisionId`, even when
they are in different processes' logs.

In code, `Judge.Local` announces each `Judge.DecisionRecord` on its `OnDecision`
emitter and `Guard` each `RequestRecord` on `OnHandled` (`@duesabati/evento`).
The HTTP guard apps' `Server` re-announces the latter as an `HttpRequestRecord`
on `OnRequestHandled`. Each `main.ts` subscribes a `Log.JsonLines` writer
(`@idhn/log`) to them. Writing is synchronous: the line is on stdout before
`decide` or `execute` settles.

### Timeouts and the decision deadline

Every call a request waits on gives up after a time limit, and giving up counts
as unavailable (`503`):

| Who waits         | For                   | Limit                                               |
| ----------------- | --------------------- | --------------------------------------------------- |
| guard             | the judge's answer    | `JUDGE_TIMEOUT_MS`, default `5000`                  |
| guard             | auth server (session) | `timeout_ms` in the manifest, default `2000`        |
| judge, per lookup | one lookup's service  | `timeout_ms` in the enrichment file, default `2000` |

The guard's `JUDGE_TIMEOUT_MS` is the only limit on a judgement, and it travels
with it: the guard turns it into a deadline, and `Judge.Http.Client` sends the
time still left in an `x-deadline-ms` header. The judge-server makes that its
own deadline, minus 100ms for the answer to travel back. When the deadline
passes, the judge abandons any lookup still in flight, starts no new one, and
answers `503` with the `decisionId`. So the guard always gets the judge's answer
while it is still waiting, and its log points at the judge's `unavailable` line,
however many slow lookups there were. There is nothing to keep in sync: change
the guard's timeout and the judge follows.

The judge-server's `MAX_DECISION_MS` (default `5000`) only limits callers that
send no deadline. A lookup's own `timeout_ms` still bounds that one lookup, and
never outlives the judgement's deadline.

## Apps in detail

### `guard/standalone`

A reverse proxy that runs in front of the protected service. At startup
([main.ts](../../source/apps/guard/standalone/main.ts)) it loads the manifest,
creates a `Judge.Http.Client` pointed at the judge-server, builds the manifest's
authentication scheme, and optionally loads a custom reject response. For each
request it builds an `HttpManifestActionResolver`, the scheme's `Authenticator`
and an `HttpServiceProvider` around the request, then runs `Guard.execute()`.
Authentication happens here, in the public process; the judge-server trusts the
`auth` fact it is sent, which is one more reason it must stay internal. The
request is forwarded to `UPSTREAM_URL` or rejected.

| Env var                 | Required | Default | Meaning                                                      |
| ----------------------- | -------- | ------- | ------------------------------------------------------------ |
| `SERVICE_MANIFEST_PATH` | yes      | —       | `protocol: http` manifest used to resolve action and context |
| `JUDGE_SERVER_URL`      | yes      | —       | Internal URL of `judge/server`                               |
| `JUDGE_TIMEOUT_MS`      | no       | `5000`  | How long to wait for a judgement before answering `503`      |
| `UPSTREAM_URL`          | yes      | —       | The protected service's address                              |
| `REJECT_RESPONSE_URL`   | no       | —       | URL (`file://`, `https://`, …) of a custom rejection body    |
| `PROXY_PORT`            | no       | `8080`  | Public listening port                                        |

Run it with `deno task start`. It is shipped as
`source/ship/guard/standalone/Dockerfile`.

### `guard/embedded`

Does the same job as `guard/standalone`, but composes its own Judge in-process
([main.ts](../../source/apps/guard/embedded/main.ts): OPA engine, KV registry,
enrichers, `Judge.Local`) instead of calling a judge-server over HTTP. It
authenticates the same way, with the same supported schemes. That wiring is
deliberately its own: it is not shared with `judge/server`, so each app decides
for itself which engine, registry and enrichers to use. Because the policy
registry's Deno KV store lives in this process, it needs `--unstable-kv` and
write permission.

| Env var                 | Required | Default         | Meaning                                     |
| ----------------------- | -------- | --------------- | ------------------------------------------- |
| `SERVICE_MANIFEST_PATH` | yes      | —               | Manifest used to resolve action and context |
| `POLICY_BUNDLE_PATH`    | yes      | —               | OPA WASM policy bundle                      |
| `KV_PATH`               | no       | Deno KV default | Location of the policy registry's KV store  |
| `POLICY_DATA_PATH`      | no       | —               | JSON file loaded as Rego's `data`           |
| `ENRICHMENT_PATH`       | no       | —               | YAML file of enrichment lookups             |
| `JUDGE_TIMEOUT_MS`      | no       | `5000`          | How long the guard waits for a judgement    |
| `UPSTREAM_URL`          | yes      | —               | The protected service's address             |
| `REJECT_RESPONSE_URL`   | no       | —               | Custom rejection body                       |
| `PROXY_PORT`            | no       | `8080`          | Public listening port                       |

Its build is shipped in the `guard/base` image (`source/ship/guard/base/`).
Services extend that image (`FROM guard/base`) and call
`/opt/guard/start-guard.sh` from their own `CMD`.

### `judge/server`

The Judge as its own non-public process. At startup
([main.ts](../../source/apps/judge/server/main.ts)) it loads the OPA WASM bundle
into an `OPA.PolicyEngine` and opens a `Policy.Registries.Kv` on Deno KV. It
combines them in a `Judge.Local` that uses a `DenyOverridesStrategy`, which
defaults to deny. It then exposes that Judge over HTTP with `Judge.Http.Server`.
It only reads the registry and never writes to it.

| Env var              | Required | Default         | Meaning                                                          |
| -------------------- | -------- | --------------- | ---------------------------------------------------------------- |
| `POLICY_BUNDLE_PATH` | yes      | —               | OPA WASM policy bundle                                           |
| `KV_PATH`            | no       | Deno KV default | Location of the policy registry's KV store                       |
| `POLICY_DATA_PATH`   | no       | —               | JSON file loaded as Rego's `data`                                |
| `ENRICHMENT_PATH`    | no       | —               | YAML file of enrichment lookups                                  |
| `MAX_DECISION_MS`    | no       | `5000`          | Longest a judgement may take for a caller that sends no deadline |
| `JUDGE_PORT`         | no       | `8081`          | Listening port                                                   |

Run it with `deno task start`. It is shipped as
`source/ship/judge/server/Dockerfile`.

### `guard/fake-service`

A small stand-in for a protected service, used only for manual testing. It
replies with an HTML page that shows the method, path, query, headers and body
it received, so you can tell that a request made it through the Guard. It
listens on `PORT` (default `9100`), and is shipped as
`source/ship/guard/fake-service/Dockerfile`.

### `guard/demo`

Assets for a manual end-to-end run, with no code of its own:

- `manifest.yaml`: service `demo` with a single action, `home.visit` (`GET /`),
  which extracts the optional `vip` query parameter into the context.
- `policy.rego`: `demo.home.visit` allows the request only when `vip == "true"`.
- `policy.wasm`: the compiled bundle. Regenerate it with `./build.sh`, which
  requires the `opa` CLI.
- `forbidden.html`: the custom 403 page, used through `REJECT_RESPONSE_URL`.

Its [README](../../source/apps/guard/demo/README.md) explains how to run the
fake-service, judge-server and standalone guard by hand, and how to seed the
`demo.home.visit` association in KV. To bring up the whole stack with Terraform,
run `ens workflow demo --job up` (see `workflows/demo/`). Once running, `/` is
rejected and `/?vip=true` is proxied through.

### `web`

A React 19 + React Router 7 frontend built with the Ensemble toolchain. The
`{{ensemble:*}}` placeholders in `public/index.html` are template slots for the
base path and injected env. It uses Tailwind together with shadcn theme tokens
and the shared `@ritaj/ui` library (`source/libs/ui`). This app is still a
scaffold: `main.tsx` imports `./src/router.tsx`, which does not exist yet, and
none of its features are defined.

## Conventions shared by the server apps

- Each server app is wired in its own `main.ts`: `loadConfig()`, then it creates
  the infrastructure (policy registry, engine, enrichers, manifest, …), then
  serves. Collaborators are passed to classes through their constructors, and
  nothing creates its own infrastructure. The guards' per-request behaviour
  lives in `Server.handle(request)`, which is handed its `Judge` already built.
  Optional collaborators (reject page, policy data, enrichment, authentication)
  are never `undefined` past config: each has a `Source` class whose `load()`
  returns a neutral Null Object when nothing is configured (a bare 403, an empty
  `data` document, a `Passthrough` enricher, the `Anonymous` scheme), so
  `main.ts` has no branching. Apps never depend on one another.
- `config.ts` validates every environment variable up front and throws a
  `ConfigError` for a missing or invalid value. It reads through an `EnvReader`
  (defaulting to `Deno.env`).
- Packaging lives in `source/ship/`, in a directory that mirrors the app path.
  The Dockerfiles copy prebuilt `main.js` artifacts rather than building from
  source.
