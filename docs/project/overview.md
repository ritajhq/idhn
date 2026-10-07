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

| App                | Package                  | Kind         | What it does                                                               |
| ------------------ | ------------------------ | ------------ | -------------------------------------------------------------------------- |
| `guard/standalone` | `@idhn/guard-standalone` | HTTP server  | Reverse proxy that asks a remote judge-server for each decision            |
| `guard/embedded`   | `@idhn/guard-embedded`   | HTTP server  | Reverse proxy that runs its Judge in-process, with no separate judge       |
| `fake-service`     | `@idhn/fake-service`     | HTTP server  | Stand-in protected service that echoes what it received (demo only)        |
| `judge/server`     | `@idhn/judge-server`     | HTTP server  | Serves a `Judge.Behavior` over HTTP; internal only, never exposed publicly |
| `policy/builder`   | `@idhn/policy-builder`   | HTTP server  | Checks, tests and compiles policy sources; judges pull the result          |
| `audit/server`     | `@idhn/audit-server`     | HTTP server  | Keeps guard and judge records from log shippers, answers audit queries     |
| `console/server`   | `@idhn/console-server`   | HTTP server  | The console: resources, policies, associations and the audit, over horizon |
| `console/web`      | `@idhn/console-web`      | Web frontend | The console's dashboard, on Fluid Functionalism                            |

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

A `body` extract reads a `json` or `form` body by a dot-path (`using: data.place`)
or, when `using` starts with `/`, by a JSON Pointer (`using: /data/action.place`),
which reaches keys that themselves contain dots. Extraction reads a copy of the
request, so the guard still forwards the body untouched.

Everything under `match` and `from` is the vocabulary of that protocol. The
manifest code (`source/core/guard/manifest/`) keeps the protocol-neutral part
(`id`, action names, the parser registry) apart from the HTTP part
(`manifest/http/`). Supporting another protocol means adding its manifest shape,
its parser and its own `ActionResolver`, and giving it its own guard entry point
that pairs that resolver with a matching `ServiceProvider`.
`loadManifestFile(path, protocol)` rejects a manifest declared for a different
protocol than the entry point serves. Only `http` exists today.

### Reading a guard's manifest

Every guard serves its own manifest at `GET /.well-known/idhn/manifest`, so the
console can import a resource from its guard's URL. Reading it is an action like
any other, `<manifest id>.idhn.manifest.read`: the guard authenticates the
caller with the manifest's scheme, asks the judge, logs it as a `guard.request`,
and answers it itself without asking the service. Until a policy is associated
with it, everyone is refused, as for any action. The answer is the manifest in
its own syntax with every default spelled out (`writeManifest`), so
`parseManifest` reads back exactly what the guard holds. A policy's `show` rule
can restrict fields of it like any answer.

Action names starting with `idhn.` are reserved for actions like this one, and a
manifest declaring one is refused.

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

### What the service receives

A forwarded request tells the protected service who is calling, so the
service never has to take "who is asking" from a parameter the caller fills
in. The guard always drops every `x-idhn-*` header the caller sent, then, for
an authenticated caller, sets:

| Header           | Value                                                                        |
| ---------------- | ---------------------------------------------------------------------------- |
| `x-idhn-subject` | The subject.                                                                 |
| `x-idhn-issuer`  | The issuer.                                                                  |
| `x-idhn-claims`  | The claims the manifest lists, as base64url-encoded JSON (unpadded).         |

Any other caller (anonymous, invalid, unavailable) gets no `x-idhn-*` header.
This happens in every enforcement mode (`CallerHeaders`,
`source/core/guard/http/caller-headers.ts`). The service can trust these
headers only while it can't be reached except through its guard.

### What the caller may see: restricted fields

Some answers hold data that not every caller may see in full: an email, a phone
number, a full name. A manifest action lists those fields under `restrict`, and
the guard rewrites the service's JSON answer before relaying it, so the service
returns the same answer to everyone and never decides who sees what.

```yaml
actions:
  - name: members.list
    match: { method: GET, path: /members }
    restrict:
      - field: /members/*/email # a JSON Pointer; `*` is every item of a list
      - field: /members/*/phone
        show: { kind: partial, keep: last, count: 4 }
```

Each field is shown in one of four ways, from least to most withheld:

| Presentation  | Written as                                                        | `ada@example.com`, `Ada Lovelace`        |
| ------------- | ----------------------------------------------------------------- | ---------------------------------------- |
| `visible`     | `visible`                                                         | unchanged                                |
| `partial`     | `{ kind: partial, keep: first \| last, count: N }`                | `••••••.com` (last 4)                    |
|               | `{ kind: partial, form: email }`                                  | `••••••@example.com`                     |
| `replacement` | `{ kind: replacement, using: initials \| domain }`                | `A. L.`, `example.com`                   |
|               | `{ kind: replacement, using: constant, value: "…" }`              | the value                                |
| `covered`     | `covered`                                                         | `••••••`                                 |

The mask never reveals how long the value was. A presentation that can't apply
to a value (the initials of a number, the last characters of an object) covers
it, and so does keeping as many characters as the value has.

**Who decides.** The manifest's `show` is only the default: `covered` when it
is left out. A policy may say how each field is shown to *this* caller with a
`show` rule, an object from the field's JSON Pointer to a presentation, beside
its `allow` rule:

```rego
package member.directory

allow if input.auth.status == "authenticated"

show["/members/*/email"] := {"kind": "partial", "form": "email"}

show["/members/*/name"] := "visible" if input.auth.claims.role == "admin"
```

When several policies govern the action, the one that withholds most wins for
each field, as a deny overrides an allow. What they say replaces the manifest's
default for that field; a field no policy mentions keeps its default, so a
restricted field never shows because a policy forgot it. The policy builder
compiles a package's `show` rule as an entrypoint whenever the package declares
one (`<package>/show`, beside `<package>/allow`). The judge-server returns the
result as `disclosure` next to `allowed`. The `authn-only` and `permissive`
levels ask no policy, so the manifest's defaults apply as they are.

**What gets rewritten.** Only an allowed request's answer, and only when its
action restricts something. The answer is then read whole and must be JSON: its
fields are rewritten, and the `content-length`, `content-encoding` and `etag`
that described the original are dropped. An empty answer passes as it is. An
answer that isn't JSON is **withheld**: the guard answers `502` (`rejection:
withheld` in the request log) rather than relay it with restricted fields in
it. Fields an answer doesn't have are left alone.

The same applies to [horizon](handoff-horizon-protocol.md) messages over HTTP,
whose answers are JSON: a query's answer sits at `/data/query.result/value`,
for example `/data/query.result/value/users/*/email`.

## Where a policy's facts come from

`Policy.Engine.evaluate` is a pure function of `(policy, context)`. It makes no
network calls, so a policy can only use what is already in its input. Besides
the `auth` fact above, there are three sources, from most to least static:

1. **The request.** The manifest's `extract` entries put path, query, header,
   body or constant values into the `Context`. This happens in the Guard.
2. **Reference data (`data`).** For slow-changing lists such as an allow-list,
   `POLICY_DATA_PATH` points to a JSON file that `OPA.PolicyEngine.load` hands
   to OPA as Rego's `data` document (or it comes as `data.json` in a policy
   builder's sources). Policies read `data.<key>`. It is fixed for the engine's
   lifetime: a judge pulling from a policy builder loads a new engine with each
   new policy set (see [`judge/server`](#judgeserver)), while one reading files
   needs a restart.
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

Both carry a `timestamp` (when handling started) and `durationMs`. Every line
also carries a `recordId` (a UUID, so the audit keeps a line delivered twice
only once), the `schema` of the audit line format it was written in (`1`), and
its `source`: the `app` (`guard` or `judge`), the `resource` a guard guards (its
manifest id), and the `instance`, read from `INSTANCE` or else the container's
`HOSTNAME`. The audit service reads these lines; see
[console-plan.md](console-plan.md#audit).

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
  It is also the answer, recorded as `rejection: withheld`, when the service
  did answer but its answer has restricted fields and isn't JSON, so they
  can't be rewritten (see [restricted fields](#what-the-caller-may-see-restricted-fields)).
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

| Env var                 | Required  | Default | Meaning                                                      |
| ----------------------- | --------- | ------- | ------------------------------------------------------------ |
| `ENFORCEMENT`           | no        | `full`  | `full`, `authn-only` or `permissive` (see below)             |
| `SERVICE_MANIFEST_PATH` | yes       | —       | `protocol: http` manifest used to resolve action and context |
| `JUDGE_SERVER_URL`      | at `full` | —       | Internal URL of `judge/server`                               |
| `JUDGE_TIMEOUT_MS`      | no        | `5000`  | How long to wait for a judgement before answering `503`      |
| `UPSTREAM_URL`          | yes       | —       | The protected service's address                              |
| `REJECT_RESPONSE_URL`   | no        | —       | URL (`file://`, `https://`, …) of a custom rejection body    |
| `PROXY_PORT`            | no        | `8080`  | Public listening port                                        |

`ENFORCEMENT` sets how much of its job the guard does. Both guards read it:

| Level        | Authenticates | Asks the judge | Lets through                                     |
| ------------ | ------------- | -------------- | ------------------------------------------------ |
| `full`       | yes           | yes            | what the policies allow                          |
| `authn-only` | yes           | no             | any authenticated caller (others get 401 or 503) |
| `permissive` | no            | no             | everyone                                         |

Anything but `full` is for development only, to put a service behind a guard
before its policies, or its authentication, exist. `Enforcement` picks the judge
and the authentication for the level: `authn-only` asks a
`Judge.AuthenticatedOnly`, which allows a caller the `auth` fact reports as
authenticated, and `permissive` asks a `Judge.Permissive`, which allows
everything, with the `none` scheme. At either, the judge's own settings are
neither needed nor read. The guard still resolves the action from the manifest,
so a request no action matches is still rejected with `403` at every level, on
purpose: a route the manifest doesn't map shows up while developing instead of
slipping through unnoticed. Neither stand-in evaluates a policy, so the
`guard.request` lines carry no `decisionId`, and the guard logs its level once
at startup as `guard.started`.

Run it with `deno task start`. It is shipped as
`source/ship/guard/standalone/Dockerfile`, and the demo ships it with its
configuration as `source/ship/demo/guard/` (see [Demo](#demo)).

### `guard/embedded`

Does the same job as `guard/standalone`, but composes its own Judge in-process
([main.ts](../../source/apps/guard/embedded/main.ts): OPA engine, file registry,
enrichers, `Judge.Local`) instead of calling a judge-server over HTTP. It
authenticates the same way, with the same supported schemes. That wiring is
deliberately its own: it is not shared with `judge/server`, so each app decides
for itself which engine, registry and enrichers to use. It needs write
permission, since the file registry writes associations back to its file.

| Env var                 | Required  | Default | Meaning                                                       |
| ----------------------- | --------- | ------- | ------------------------------------------------------------- |
| `ENFORCEMENT`           | no        | `full`  | `full`, `authn-only` or `permissive` (see `guard/standalone`) |
| `SERVICE_MANIFEST_PATH` | yes       | —       | Manifest used to resolve action and context                   |
| `POLICY_BUNDLE_PATH`    | at `full` | —       | OPA WASM policy bundle                                        |
| `POLICY_REGISTRY_PATH`  | at `full` | —       | YAML file of action → policy associations                     |
| `POLICY_DATA_PATH`      | no        | —       | JSON file loaded as Rego's `data`                             |
| `ENRICHMENT_PATH`       | no        | —       | YAML file of enrichment lookups                               |
| `JUDGE_TIMEOUT_MS`      | no        | `5000`  | How long the guard waits for a judgement                      |
| `UPSTREAM_URL`          | yes       | —       | The protected service's address                               |
| `REJECT_RESPONSE_URL`   | no        | —       | Custom rejection body                                         |
| `PROXY_PORT`            | no        | `8080`  | Public listening port                                         |

Its build is shipped in the `guard/base` image (`source/ship/guard/base/`).
Services extend that image (`FROM guard/base`) and call
`/opt/guard/start-guard.sh` from their own `CMD`.

### `judge/server`

The Judge as its own non-public process
([main.ts](../../source/apps/judge/server/main.ts)). It judges with a policy
set (`Distribution.PolicySet`: the OPA WASM bundle, the registry, and
optionally the enrichment lookups and the `data` document), which
`JudgeAssembly` builds into a `Judge.Local` that uses a
`DenyOverridesStrategy`, defaulting to deny. It serves that judge over HTTP
with `Judge.Http.Server`, through a `Judge.Reloadable`, so a new set takes
effect without a restart. It only reads the registry and never writes to it.

It takes its policy set from one of two places:

- **A policy builder** (`POLICY_SOURCE_URL`), the way to run it in production.
  `PolicyPuller` fetches the builder's current set at startup and then asks
  again every `POLICY_POLL_MS`, with the `ETag` of the set it has, so an
  unchanged set costs an empty `304`. `PolicyLoader` builds each newer set into
  a judge and hands it to the `Judge.Reloadable`: a judgement already under way
  finishes with the judge it started with, and a set that fails to build keeps
  the last good judge in place. The judge keeps nothing of its own, so any
  number of replicas can pull from the same builder, and a new or restarted
  one simply fetches the current set. Until its first set loads, every
  judgement fails as unavailable, so the guard answers `503` with
  `Retry-After`. A builder that can't be reached, or has nothing yet, only
  delays new policies.
- **Files** (`POLICY_BUNDLE_PATH` and the others), read once at startup, as the
  demo does. Changing them means restarting the judge.

Each load is logged as `judge.policies_loaded` or `judge.policies_load_failed`
with the set's version. Pulling going wrong is logged once as
`judge.policies_pull_failed`, not at every poll, and its end as
`judge.policies_pull_recovered`.

| Env var                | Required         | Default | Meaning                                                          |
| ---------------------- | ---------------- | ------- | ---------------------------------------------------------------- |
| `POLICY_SOURCE_URL`    | no               | —       | The policy builder to pull policy sets from                      |
| `POLICY_POLL_MS`       | no               | `5000`  | How often to ask the builder for a newer set                     |
| `POLICY_BUNDLE_PATH`   | without a source | —       | OPA WASM policy bundle                                           |
| `POLICY_REGISTRY_PATH` | without a source | —       | YAML file of action → policy associations                        |
| `POLICY_DATA_PATH`     | no               | —       | JSON file loaded as Rego's `data`                                |
| `ENRICHMENT_PATH`      | no               | —       | YAML file of enrichment lookups                                  |
| `MAX_DECISION_MS`      | no               | `5000`  | Longest a judgement may take for a caller that sends no deadline |
| `JUDGE_PORT`           | no               | `8081`  | Listening port                                                   |

Run it with `deno task start`. It is shipped as
`source/ship/judge/server/Dockerfile`, and the demo ships it with its
configuration as `source/ship/demo/judge/`.

### `policy/builder`

Turns policy sources into the policy sets judges pull
([main.ts](../../source/apps/policy/builder/main.ts)), so no judge needs
rebuilding or restarting when a policy changes. Its sources are a directory
laid out as

```
policies/*.rego    one policy per package: `package shop.admin` is the policy
                   a registry names `shop.admin`; `*_test.rego` are its tests
policies.yaml      which policies govern which actions
enrichment.yaml    optional: the lookups a judge makes before evaluating
data.json          optional: Rego's `data` document
```

`Compiler` refuses a source tree with every problem it finds at once: a
registry naming a policy no file declares, a malformed registry, enrichment or
`data`, and whatever `opa check` reports. It then runs `opa test` when there are
tests, and compiles with `opa build`, one entrypoint per package's `allow` rule.
This is the place for further Rego rules to enforce. `Builds` publishes each
set that compiles to the `Distribution.Publication` judges pull from, at
`GET /policies` (`Distribution.Http.Server`, with an `ETag` and `304`, or `503`
before anything has been published). A refused tree publishes nothing, so
judges keep the last good set. Each outcome is logged as `builder.built` or
`builder.refused`, with the version and the problems.

`POLICY_SOURCE` picks where the sources come from, one per deployment:

- **`upload`** (the default): `PUT /sources` takes a tar of the sources (for
  one, `git archive HEAD` of a policies repository), versioned by its
  `x-policy-version` header. It is built on the spot and answered `200` with
  the version, `422` with every problem, or `400` for what isn't a tar. Only an
  upload that built is kept in `STATE_DIR`, and published again after a
  restart. This is the builder's only state, so it runs as one instance.
  `POST /checks` takes the same tar as a dry run: it is checked, tested and
  compiled, answered `200` or `422` with every problem the same way, and then
  thrown away, publishing nothing. The console uses it to tell an author
  whether sources would build before publishing them.
- **`git`**: clones `GIT_URL` at `GIT_REF` and fetches it every `GIT_POLL_MS`,
  each new commit versioned by its id. A clone or fetch that fails is logged
  as `builder.source_failed` and tried again at the next poll.
- **`directory`**: a local directory (`SOURCE_DIR`), watched with
  `Deno.watchFs`, or hashed every `SOURCE_POLL_MS` where the filesystem gives
  no change notifications (`SOURCE_WATCH=poll`), each change versioned by that
  hash. For running it by hand.

**The base.** `BASE_SOURCES_DIR` names policies the deployment owns rather
than whoever publishes sources: a tree with its own `policies/*.rego` and
`policies.yaml` (anything else in it is ignored). `Base` builds every tree
with the base beneath it, so no publication can take the base's policies
away, and refuses a tree that replaces a base policy or governs an action the
base governs: with deny-overrides, one more policy on such an action could
deny it. That is where the console's own actions are governed, so the console
can't lock its operators out. At start the builder publishes the base alone,
so judges have policies, and the console is reachable, before anything has
been published. Changing the base means changing the deployment.

`GET /health` answers with the version published.

| Env var          | Required     | Default                   | Meaning                                    |
| ---------------- | ------------ | ------------------------- | ------------------------------------------ |
| `POLICY_SOURCE`  | no           | `upload`                  | `upload`, `git` or `directory`             |
| `STATE_DIR`      | no           | `/var/lib/policy-builder` | Where the last good upload is kept         |
| `BASE_SOURCES_DIR` | no         | —                         | The deployment's base policies             |
| `GIT_URL`        | for `git`    | —                         | Repository to clone                        |
| `GIT_REF`        | no           | `main`                    | Branch or tag to follow                    |
| `GIT_POLL_MS`    | no           | `30000`                   | How often to fetch                         |
| `GIT_WORK_DIR`   | no           | `/tmp/policy-sources`     | Where to clone                             |
| `SOURCE_DIR`     | for `directory` | —                      | Directory of sources                       |
| `SOURCE_WATCH`   | no           | `native`                  | `native` (`Deno.watchFs`) or `poll`        |
| `SOURCE_POLL_MS` | no           | `2000`                    | How often to hash, with `poll`             |
| `OPA_PATH`       | no           | `opa`                     | The `opa` CLI                              |
| `GIT_PATH`       | no           | `git`                     | The `git` CLI                              |
| `BUILDER_PORT`   | no           | `8082`                    | Listening port                             |

`PUT /sources` and `POST /checks` have no authentication: keep the builder on an internal network,
never routed publicly. It is shipped as `source/ship/policy/builder/Dockerfile`,
which carries `git` and the static `opa` binary.

### `audit/server`

Keeps what guards and judges did, and answers questions about it
([main.ts](../../source/apps/audit/server/main.ts)). Guards and judges still
only write JSON Lines to stdout; a log shipper (Vector, Fluent Bit, an
OpenTelemetry collector) posts them in batches to `POST /records`, at least
once. Each batch is read (`Audit.Ingestion`): `guard.request` and
`judge.decision` lines become records, other lines are ignored, and lines that
can't be read are reported in the answer without holding back the rest. Each
decision's context is redacted before it is kept: every field of `auth` is
covered but `status` and `subject`, unless kept with `AUDIT_KEEP_AUTH`, and the
facts named in `AUDIT_COVER_FACTS` are covered too.

Records are kept in SQLite (`Audit.Stores.Sqlite`, one file). A record kept
before (same `recordId`) is not kept or counted again, so a shipper may resend
freely. Each new record also counts towards per-minute rollups, in the same
transaction, which overviews are read from. Raw records are kept
`AUDIT_RAW_DAYS`, rollups `AUDIT_ROLLUP_DAYS`, and the rest is purged every
`AUDIT_PURGE_EVERY_MS`. A batch that can't be kept, or one sent while
`AUDIT_MAX_CONCURRENT_BATCHES` are being taken in, is answered `503` with
`Retry-After`, and the shipper keeps it and retries.

The console asks it horizon queries (`audit.overview`, `audit.trails`,
`audit.trail`), posted to their names. For development, `AUDIT_TAIL_PATH`
follows a JSON Lines file instead of waiting for a shipper.

| Env var                        | Required | Default                        | Meaning                                                |
| ------------------------------ | -------- | ------------------------------ | ------------------------------------------------------ |
| `AUDIT_DB_PATH`                | no       | `/var/lib/idhn-audit/audit.db` | The SQLite file                                        |
| `AUDIT_RAW_DAYS`               | no       | `30`                           | How long raw records are kept                          |
| `AUDIT_ROLLUP_DAYS`            | no       | `365`                          | How long rollups are kept                              |
| `AUDIT_KEEP_AUTH`              | no       | —                              | `auth` fields kept in the clear (`claims.role,issuer`) |
| `AUDIT_COVER_FACTS`            | no       | —                              | JSON Pointers of other facts to cover (`/email`)       |
| `AUDIT_INGEST_TOKEN`           | no       | —                              | Bearer token shippers must present                     |
| `AUDIT_MAX_CONCURRENT_BATCHES` | no       | `4`                            | Batches taken in at once                               |
| `AUDIT_TAIL_PATH`              | no       | —                              | A JSON Lines file to follow                            |
| `AUDIT_TAIL_POLL_MS`           | no       | `1000`                         | How often to read it                                   |
| `AUDIT_PURGE_EVERY_MS`         | no       | `3600000`                      | How often to purge                                     |
| `AUDIT_PORT`                   | no       | `8083`                         | Listening port                                         |

Queries carry no authentication: keep it internal, reached only by the console
and the shippers. It is shipped as `source/ship/audit/server/Dockerfile`.

### `fake-service`

A small stand-in for a protected service, used only for manual testing. It
replies with an HTML page that shows the method, path, query, headers and body
it received, so you can tell that a request made it through the Guard. It
listens on `PORT` (default `9100`). It is shipped as
`source/ship/fake-service/Dockerfile`, and the demo ships it as
`source/ship/demo/service/`.

### Demo

The `demo` workload ([ci/demo/delivery.yml](../../ci/demo/delivery.yml)) runs
the fake-service, the judge-server and the standalone guard behind a gateway on
`http://demo.localhost`: `ens develop demo` locally, or
`ens deploy demo compose`. Each image bakes in its demo configuration from its
ship directory:

- `source/ship/demo/guard/manifest.yaml`: service `demo` with a single action,
  `home.visit` (`GET /`), which extracts the optional `vip` query parameter into
  the context. `forbidden.html` is the custom 403 page.
- `source/ship/demo/judge/policy.rego`: `demo.home.visit` allows the request
  only when `vip == "true"`. `policy.wasm` is the compiled bundle; regenerate it
  with `./build.sh`, which requires the `opa` CLI. `policies.yaml` is the policy
  registry, associating the action with that policy.

Once running, `/` is rejected and `/?vip=true` is proxied through. The
[README](../../ci/demo/README.md) also explains how to run the three apps by
hand.

### `console/server` and `console/web`

Where people who run idhn see and change what it does
([console-plan.md](console-plan.md)). The web app is a sidebar dashboard on
Fluid Functionalism (`@ritaj/ui`, Untitled UI icons), built by the ensemble
`react` kit. It talks to the server only in horizon messages over mux, each
posted to its own name (`POST /policies.write`), which the server answers
([main.ts](../../source/apps/console/server/main.ts)):

- **Resources** (`@idhn/resources`): a resource is imported from its guard's URL
  by reading the manifest the guard serves (see "Reading a guard's manifest"),
  presenting the caller's own cookie or authorization header, so the guard's
  policies decide who may import it. The console keeps the last import of each,
  by manifest id.
- **Policies and associations** (`@idhn/authoring`): the console owns the policy
  sources. Everyone edits one shared draft; each change makes a new draft
  revision, and a change based on a revision someone else has changed since is
  refused (`Stale`), so nobody's work is overwritten. A policy is named by the
  package its source declares. Checking asks the builder for a dry run
  (`POST /checks`); publishing uploads the tree (`PUT /sources`), and records it
  as the next revision (`r1`, `r2`, …), which can be restored into the draft.
  The builder must run in `upload` mode.
- **Audit**: queries are passed on to `audit/server` as asked.

The console keeps its state in one SQLite file. It must sit behind an idhn
guard: it learns who is calling from the guard's `x-idhn-*` headers
(`Mechanisms.CallerHeaders`), and the guard judges each call as an action.
[manifest.yaml](../../source/apps/console/server/manifest.yaml) is that guard's
manifest, one action per call plus `app.open` for the page; associate policies
with those actions in the console itself.

| Env var              | Required | Default                            | Meaning                              |
| -------------------- | -------- | ---------------------------------- | ------------------------------------ |
| `POLICY_BUILDER_URL` | yes      | —                                  | The policy builder, in `upload` mode |
| `AUDIT_URL`          | yes      | —                                  | The audit server                     |
| `CONSOLE_DB_PATH`    | no       | `/var/lib/idhn-console/console.db` | The SQLite file                      |
| `CONSOLE_DIST`       | no       | `source/artifacts/console/web`     | The built web app                    |
| `CONSOLE_PORT`       | no       | `8084`                             | Listening port                       |

Both builds ship together as `source/ship/console/server/Dockerfile`.

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
