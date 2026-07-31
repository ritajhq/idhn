# Authorization layer — phased plan

## Context

The end goal: an HTTP **Guard** sits in front of a protected service. It intercepts
requests, uses a user-authored **manifest** to figure out which `Action` is being
attempted and what `Context` facts to extract from the request (plus injected data
like auth info), asks a **Judge** for a `Decision`, and either forwards the request
or answers `403`. The Judge evaluates **Rego policies** (via OPA) that are authored
in a GitHub repo; a webhook rebuilds/redeploys the Judge with a fresh OPA bundle
whenever policies change.

This plan exists to get there in slices that never mix core domain logic with
infrastructure/tech-stack decisions (Deno vs not, OPA-WASM vs subprocess, HTTP
framework, GitHub webhooks, CI). Each phase produces something independently
testable with fakes before the next phase's infra is chosen.

**`core/` vs `libs/`** is not "pure logic vs I/O." It's "domain-specific vs
generic." Anything that speaks in this system's own vocabulary — `Action`,
`Policy`, `Context`, `Verdict`, `Decision` — belongs under `core/`, regardless
of whether it happens to do I/O, load WASM, or hold mutable state (e.g.
`judge-opa`'s OPA-WASM adapter, `judge`'s `InMemoryPolicyRegistry`). `libs/` is
reserved for genuinely generic, reusable-on-any-project utilities that carry
no authorization-domain vocabulary at all (nothing lives there yet).

## Architecture boundary (decided)

- **`core/judge`** (built) — pure domain: `Action`, `Context`, `Policy`, `Verdict`,
  `PolicyResult`, `Decision`, and `Judge` — now a **port** (an interface,
  `decide(action, context): Promise<Decision>`), not a concrete class. `LocalJudge`
  is the in-process implementation: an orchestrator constructor-injected with
  three ports (`PolicyRepository`, `PolicyEngine`, `DecisionStrategy`). No
  transport, no OPA, no I/O. `core/judge/http/` holds the transport
  implementations of the `Judge` port itself — `JudgeHttpClient` (implements
  `Judge`, calls a remote judge-server) and `buildJudgeHandler` (exposes any
  `Judge` over HTTP) — see Phase 5b.
- **`core/guard`** (built) — pure domain for the interception side. `Guard` is
  **not generic over the raw request type** and never touches it directly — that
  knowledge is entirely encapsulated inside per-request-constructed collaborators.
  `Guard` is constructed with a `Judge` (the interface, not a concrete class —
  since Phase 5b this is what makes running `Judge` in its own process possible
  without any change to `Guard` itself) plus two ports:
  - **`ActionResolver`** — `resolve(): Promise<{ action: Action; context: Context }
    | null>`. No arguments; a concrete implementation is constructed per-request
    with whatever raw data it needs closed over (e.g. the actual HTTP request).
    Fully owns turning that raw data into an `Action` + `Context` — including
    reading auth/session info as context facts. Returns `null` when it can't
    resolve an action for this request. (Originally sketched as "Manifest" +
    a separate "ContextEnricher" — collapsed into one port. The port stays
    abstract/interface-based purely for **transport-agnosticism** — so
    `core/guard` never depends on HTTP or any specific request shape — not
    because manifest-driven configuration is optional. A service owner
    necessarily needs *some* declarative way to say "this request means this
    action, extract these fields," and a manifest is the obvious, expected
    concrete implementation of this port. See Phase 4a.)
  - **`ServiceProvider`** — `forward(): Promise<void>` and `reject(): Promise<void>`.
    Also no arguments; constructed per-request with whatever it needs to actually
    proxy the call or write a rejection response. `reject()` deliberately does
    not take the `Decision` — `Decision`/allow-deny semantics stay fully inside
    `Judge`/`Guard`'s own orchestration and never leak into this port.
  - `Guard.execute(): Promise<void>` — the orchestration: call
    `actionResolver.resolve()`; if `null`, call `serviceProvider.reject()`;
    otherwise call `judge.decide(action, context)` and call
    `serviceProvider.forward()` if allowed, `serviceProvider.reject()` otherwise.
- **Concrete implementations of the ports above** — OPA-backed `PolicyEngine`
  (`core/judge-opa`), `PolicyRegistry`/`PolicyRepository` storage
  (`core/judge`'s `InMemoryPolicyRegistry`, see Phase 4), an HTTP server
  wrapping `Guard`, a manifest file loader — live alongside the domain
  packages under `core/` when they speak the domain's vocabulary (see the
  `core/` vs `libs/` note above), or under `source/apps/` once they're an
  actual running process (Phase 5). Genuinely generic, non-domain-specific
  utilities (none exist yet) would go under `libs/`.

## Phases

### Phase 1 — `core/judge` (done)
`Action`, `Context`, `Policy`, `Verdict`, `PolicyResult`, `Decision`,
`PolicyRepository`/`PolicyEngine`/`DecisionStrategy` ports, `DenyOverridesStrategy`,
`Judge` orchestrator. Tested entirely against hand-written fakes. Lives at
`source/core/judge/`.

Also includes (added in Phase 4, see below, but living in this same package
per the `core`/`libs` boundary): `PolicyRegistry` — a storage interface
extending `PolicyRepository` with `associate`/`dissociate` mutations — and
`InMemoryPolicyRegistry`, a concrete in-memory implementation.

### Phase 2 — `core/guard` (done)
Pure domain for the interception side, no HTTP server yet. See the shape under
"Architecture boundary" above: `ActionResolver` and `ServiceProvider` ports (both
zero-argument, constructed per-request by the infra layer with whatever raw data
they need closed over), and a `Guard` orchestrator using `judge.Judge` directly.

Tested with fakes for `ActionResolver` and `ServiceProvider`, and a real `Judge`
wired with Phase 1's fake `PolicyRepository`/`PolicyEngine`/a stub
`DecisionStrategy` (reusing test doubles already written for `core/judge`) — no
real HTTP, no real OPA. Lives at `source/core/guard/`.

### Phase 3 — OPA-backed `PolicyEngine` adapter (done)
A concrete `PolicyEngine` implementation that embeds OPA, evaluated in-process
via **OPA compiled to WASM** (`opa build -t wasm`), loaded through the official
`@open-policy-agent/opa-wasm` npm package (confirmed to work under Deno via the
`npm:` specifier). Decided over Microsoft's Regorus: Regorus has no currently
published/working JS or WASM package (an npm release was published and
unpublished the same day in 2024), would require consumers to run their own
Rust/wasm-pack build, and is a partial (not fully compliant) Rego
implementation — all of which conflicts with "minimal build-step ceremony" and
lower maintenance risk. OPA-WASM is official, versioned, and backed by a
CNCF-graduated, multi-vendor-governed project.

A whole policy repo's `.rego` tree compiles to **one bundle, one `policy.wasm`
module** — `opa build -t wasm` accepts multiple `-e` entrypoints in a single
build, and the OPA-WASM runtime selects which compiled rule to run per
`evaluate()` call via an entrypoint name, all against one loaded module. So
`OpaPolicyEngine` is loaded once from one bundle (`OpaPolicyEngine.load(wasmBytes)`)
and can evaluate every policy the bundle contains — there's no need for, and
we don't build, a separate WASM blob per policy. `Policy.id` is treated as a
Rego package path with a conventional rule name (e.g. `Policy("invoice.approve")`
→ entrypoint `invoice/approve/allow`, i.e. `data.invoice.approve.allow`);
undefined → `Verdict.Neutral`, `true` → `Verdict.Allow`, `false` →
`Verdict.Deny`.

**`http.send` (and other impure/network builtins) are deliberately left
unimplemented.** OPA-WASM doesn't bundle these — WASM has no socket access by
design, so the host (this adapter) would have to supply a JS function backing
any such builtin. We choose not to: `PolicyEngine.evaluate` must stay a pure
function of `(Policy, Context)`, with all external data gathered up front by
`ActionResolver` (see Phase 4a) and placed into `Context` before `Judge` is
ever consulted. A policy that calls `http.send` should fail loudly at
evaluation time rather than silently reintroducing network I/O — and hidden
side effects — into what's designed to be a deterministic, replayable step.

Lives at `source/core/judge-opa/` (domain-specific — see the `core`/`libs`
note above; not under `libs/` despite being a concrete adapter with real
WASM-loading I/O). Tested against real `.rego` fixtures, no network/webhook/
deploy concerns yet — bundle loading here starts from a local file path;
remote bundle fetching is Phase 10.

### Phase 4 — `PolicyRegistry` storage (done)
Resolves, and lets something register, which policies govern which actions.
Framed as **storage**, not a client to an already-existing registry service:
`PolicyRegistry` (in `core/judge`) extends `PolicyRepository` with
`associate(action, policy)` / `dissociate(action, policy)` — idempotent,
no-op-safe mutations on individual action/policy pairs, rather than
replacing a whole list at once. `InMemoryPolicyRegistry` is the first
concrete implementation, sufficient for tests and early development. A
SQL-backed or HTTP-fronted implementation can replace it later without
`Judge` (which only ever depends on `PolicyRepository`) changing at all —
same seam pattern as `PolicyEngine`/`OpaPolicyEngine`.

Deliberately not built here: any real backing store (SQL, a separate
service, etc.), and any authority/auth model for *who* is allowed to call
`associate`/`dissociate` — both are later infrastructure decisions the
interface doesn't need settled in advance.

### Phase 4a — manifest-driven `ActionResolver` adapter (done)
A concrete, declarative `ActionResolver` implementation, `ManifestActionResolver`,
living at `source/core/guard/manifest/` (domain-specific — produces `Action`/
`Context` — so under `core/guard` alongside `Guard` itself, per the `core`/`libs`
boundary above).

**Manifest schema** (YAML, parsed via `@std/yaml`, validated by a hand-written
parser with precise per-field error paths — no schema library dependency):

```yaml
id: billing-service

actions:
  - name: invoice.approve
    match:
      method: POST                     # string | string[]
      path: /invoices/:id/approve      # path-to-regexp pattern, string | string[]
      header:                          # optional: string | string[] | {name, value}[]
        - name: x-api-version
          value: "2"
    extract:                           # optional list
      - from: { property: path, using: id }
        as: invoiceId
      - from: { property: header, using: x-user-id }
        as: subject
      - from: { property: header, using: x-request-note }
        as: note
        optional: true                 # default false — missing ⇒ action fails to match
      - from: { property: body, using: customer.id, type: json }
        as: customerId                 # type: json | form | text; only meaningful for body
      - from: { property: constant, using: production }
        as: environment                # using is the literal value itself
```

Key decisions, each reached after deliberately surveying prior art (OPA-Envoy,
Envoy `ext_authz`, Kong's OPA plugin, Kubernetes Gateway API) rather than
inventing from scratch:
- **Declarative field extraction is a real gap in the ecosystem** — OPA/Envoy/
  Kong all forward the whole request into policy input and let Rego pick
  fields itself. We diverge deliberately: `Context` is meant to be a
  minimal, curated fact set, keeping policies free of request-shape
  knowledge.
- **Path patterns use `path-to-regexp`** (the library behind Express/React
  Router; `:id`-style params) — a real dependency, not our own matcher,
  chosen over OpenAPI's `{id}` convention since it's what `path: :id` syntax
  actually is under the hood and confirmed to work cleanly under Deno via
  `npm:`.
- **`method`/`path` accept a single value or an array**; `header` accepts a
  bare name (presence-only), an array of names, or an array of `{name,
  value}` (exact-value match). Actions are tried in document order,
  first whole match wins.
- **`extract` entries are required by default** for `query`/`header`/`body`
  sources (`path` and `constant` can never be absent once matched) — a
  missing required field fails that action's match entirely, falling
  through to the next action in the list. `optional: true` widens this to
  "omit from `Context.facts` instead." Matches this system's existing
  fail-closed defaults (`DenyOverridesStrategy`'s fallback, `Guard`'s
  unmatched-action reject).
- **Body parsing needs an explicit `type`** (`json`/`form`/`text`) since
  `extract`'s `using` (a field path) is meaningless without knowing the
  body's shape; the body is read and parsed once per request and reused
  across multiple body `extract` entries (a `Request` body can only be
  consumed once).
- **`id` is dot-prefixed onto every action `name`** when resolved into an
  actual `Action` (`invoice.approve` → `Action("billing-service.invoice.approve")`),
  guaranteeing cross-service action-name isolation without requiring
  manifest authors to write the prefix themselves.

Built against the web-standard `Request`/`URL`/`Headers` (native in Deno),
not a bespoke request type — so the real HTTP server built in Phase 5 needed
no adapter code to hand `HttpManifestActionResolver` what it needs (renamed
from `ManifestActionResolver` there, once it stopped being hypothetical).

Deliberately deferred: **external data enrichment** (e.g. "fetch
`requester.points` from a points service" as declarative config, replacing
what Phase 3 ruled out doing via Rego's `http.send`) is not part of this
schema yet — `extract`'s `constant`/`path`/`query`/`header`/`body` sources
only ever read from the request itself. A future `from.property: external`
(or similar) kind, with its own config for endpoint/method/response mapping,
caching, and failure handling, is a natural extension but intentionally out
of scope for this slice.

### Phase 4b — multi-policy integration test (done)
`source/core/judge-opa/integration.test.ts` exercises the full, real stack —
`Judge` + `InMemoryPolicyRegistry` + `OpaPolicyEngine` (loaded from the
actual compiled bundle) + `DenyOverridesStrategy` — with no fakes anywhere.
Fixture scenario: `invoice.approve.base` (allows under a $1000 threshold)
plus `invoice.approve.fraud_override` (explicitly denies when `flagged`,
otherwise stays undefined/Neutral — verified directly via `opa eval` before
wiring into the test), both registered against one `invoice.approve` action.
Proves the case that matters most: the override's explicit `Deny` wins even
when the base policy would `Allow`, using genuine OPA-compiled output rather
than synthetic `Verdict` values. Also covers the base-policy-denies and
no-policies-registered cases. `judge-opa`'s fixture `build.sh` was extended
with the two new entrypoints; the shared `policy.wasm` bundle now contains
four entrypoints total.

### Phase 4c — pluggable `PolicyRepository` storage (done)
The real answer to "which policies govern which actions." Phase 5 needed
something working immediately and stubbed it with `InMemoryPolicyRegistry`
populated at startup from the manifest, under a 1:1
action-name-equals-policy-id convention — not the real design, and it lived
in the wrong place: `judge-server` had no legitimate reason to know about
the HTTP manifest at all (that's a `guard`-side, request-recognition
concern). Both are removed — `judge-server`'s `build-server.ts` no longer
loads a manifest or calls `associate()` itself, and `Config` dropped
`manifestPath`/`SERVICE_MANIFEST_PATH` entirely.

**Cleared up an early misunderstanding while designing this phase**, worth
recording since it nearly led the design astray: the plan to author `.rego`
policies in a git repo with a path-mirrors-package-name convention (the
original webhook idea in this doc's Context section, and Phase 10's "bundle
delivery pipeline") is an **authoring/build-pipeline** concern — how source
becomes a compiled `policy.wasm` bundle — and has nothing to do with
`PolicyRepository` at runtime. `PolicyRegistry`'s existing `associate`/
`dissociate` design (Phase 4) was already correct and needed no rethink:
`Action` and `Policy` are just opaque id strings to it; nothing in
`core/judge` needs to know *why* a given action name and policy id happen to
align (that alignment is an integration-level concern, owned by whatever
writes associations into the registry — a human, an admin tool, a sync job).
The only real gap was a **persisted backing store** to replace
`InMemoryPolicyRegistry` in production.

**`source/core/judge/kv-policy-registry.ts`** — `KvPolicyRegistry implements
PolicyRegistry`, backed by `Deno.Kv` (constructor-injected, so tests use
`Deno.openKv(':memory:')` rather than touching disk). One KV row per
`(action, policy)` association — key `["policies", action.name, policy.id]`,
value `true` — chosen explicitly over one row per action holding a
`Policy[]` array: a single `kv.set`/`kv.delete` is naturally idempotent/
no-op-safe with no read-modify-write or `kv.atomic()` transaction needed,
matching `associate`/`dissociate`'s existing contract for free.
`findPoliciesFor` does a `kv.list({ prefix: ["policies", action.name] })`
and reconstructs a `Policy` from each key's third segment. Verified: 8 tests
covering the same cases as `InMemoryPolicyRegistry`'s suite, plus one
confirming two `KvPolicyRegistry` instances see the same associations when
opened against the same underlying store (proving persistence, not just
correctness of the in-process object).

**`source/apps/judge/server/`** — `config.ts` gained an optional `KV_PATH`
(passed to `Deno.openKv(path)`; omitted falls through to Deno's own default
location) — made explicit rather than always using the zero-arg default so
the store stays inspectable (`deno eval --unstable-kv` or any Deno KV
tooling can point at a known file). `build-server.ts` now just loads the OPA
bundle and opens a `KvPolicyRegistry` — no manifest, no bootstrap loop.
`deno.json`'s `start` task gained `--unstable-kv` and `--allow-write` (KV
needs both to open/persist a local store).

Deliberately not built here: a caching layer in front of `PolicyRegistry`
(the original "pluggable, *cached*" framing) — `Deno.Kv` reads are already
local/fast for the demo's scale, and premature caching would need an
invalidation strategy that has no real requirement driving it yet. Revisit
if/when write-side traffic patterns (who calls `associate`/`dissociate`, how
often) are actually known. Also not built: any authority/auth model for who
may call `associate`/`dissociate` on a live `judge-server` — still an open
integration-level question, same as noted in Phase 4.

Verified end-to-end manually against a real `judge-server` process with a
fresh KV file: confirmed `POST /decide` denies when no association exists
for an action (empty-results fallback, not an error), then seeded an
association directly into the KV file (simulating the external
integration-level writer) and confirmed both the allow and deny paths
through the real OPA-compiled demo policy work correctly afterward.

### Phase 5 — composition root / process wiring, merged with Phase 6 — HTTP transport (done)
The plan originally split "wiring" from "HTTP transport" into separate
phases, but `ServiceProvider.forward()` only means something with a real
transport — so they were merged into one runnable slice: `source/apps/guard/proxy/`,
a real Deno HTTP server (`main.ts`, `deno task start`).

**`config.ts`** — reads `SERVICE_MANIFEST_PATH`, `POLICY_BUNDLE_PATH`,
`UPSTREAM_URL` (all required, fail-fast `ConfigError` if missing/invalid),
`PROXY_PORT` (optional, defaults to `8080`). Takes an injectable `EnvReader`
(the minimal `{ get(name): string | undefined }` slice of `Deno.Env`) so
tests don't need real env vars or `Deno.env` permission.

**`build-server.ts`** — the actual composition root, run once at startup:
loads the manifest (`loadManifestFile`) and OPA bundle
(`Deno.readFile` + `OpaPolicyEngine.load`), builds one shared `Judge`, and
returns a per-request handler. Per request, builds fresh
`HttpManifestActionResolver`/`HttpServiceProvider` instances (closed over
that request) and a fresh `Guard`, then `await guard.execute()`.

**`source/core/guard/http/http-service-provider.ts`** — `HttpServiceProvider
implements ServiceProvider`. Solves a real design problem: `Deno.serve`'s
handler must return a `Response`, but `ServiceProvider.forward()`/`reject()`
are `Promise<void>` by design (deliberately opaque — `Guard` doesn't know or
care what happens after a verdict is carried out) and `Guard.execute()`
itself returns nothing usable either. Rather than having the HTTP handler
read a captured field off `HttpServiceProvider` after the fact (rejected as
a leak — the handler would have to know about an adapter-specific field,
reaching past the `ServiceProvider` interface), `HttpServiceProvider` is
constructed with a `resolve` function from `Promise.withResolvers<Response>()`,
called by `forward()`/`reject()` as their side effect. The handler creates
the promise/resolver pair *before* calling `guard.execute()`, and its return
value is just `await promise` — it already holds the exact value it needs
before `Guard` even runs; no property is ever read back off anything.
`forward()` reverse-proxies to `config.upstreamUrl` via `fetch` with
`redirect: 'manual'` (so upstream redirects are relayed raw, not
auto-followed) and relays method/headers/body; `reject()` resolves a bare
`403`.

**`source/core/guard/manifest/http-manifest-action-resolver.ts`** — renamed
from `ManifestActionResolver`: it was always built against the web-standard
`Request`, so calling it transport-agnostic was misleading. `HttpServiceProvider`
lives in the sibling `http/` folder (not `manifest/`), since it's HTTP-specific
infrastructure but not manifest-related at all.

**PolicyRegistry bootstrap (stubbed, not the real design)**: at startup,
`build-server.ts` populates `InMemoryPolicyRegistry` under a 1:1 convention
— every manifest action is governed by exactly one policy of the identical
name. This is *not* the real answer: policy-to-action associations are
meant to be a genuinely live, runtime-queryable, pluggable, possibly-cached
lookup (a KV store, a YAML file, a separate service — unspecified, written
by some other system/process, potentially changing without a redeploy) —
see Phase 4c above. The 1:1 stub exists only to prove the request pipeline
end-to-end today.

**New naming convention surfaced and fixed**: manifest `id` and action
`name`s get `.`-joined into Rego package/entrypoint paths (see Phase 3), and
Rego package identifiers cannot contain hyphens (`opa build` fails with
`rule name conflicts with built-in function` — confirmed directly). `parseManifest`
now rejects any `id` or action-name segment that isn't a valid Rego
identifier (`^[A-Za-z_][A-Za-z0-9_]*$`), with an error message explaining
composite names must use `_`, not `-`. This is the same "how do we guarantee
registered policy ids correspond to real Rego paths" integrity question
flagged when `PolicyRegistry` was designed (Phase 4) — validating manifest
identifiers up front is a partial answer; the rest belongs to Phase 4c.

Verified end-to-end manually: ran the real server against a fixture manifest
+ compiled bundle + a fake upstream `Deno.serve` instance, `curl`'d an
allowed request (real reverse-proxy relay confirmed via upstream log),
a request missing required context (403, upstream never contacted), a
request the policy denies (403), and an unmatched route (403) — plus
confirmed `loadConfig`'s fail-fast behavior with a genuinely missing env var.

**Configurable reject response, added after Phase 5 landed**: `HttpServiceProvider.reject()`
originally always answered a bare empty `403`. Since a service owner may want
their own branded/informative rejection page — and that page could
legitimately live anywhere (local disk, S3, a CDN), not just the filesystem
— `RejectResponse` (`{ body: Uint8Array<ArrayBuffer>, contentType: string }`)
is now an optional fourth constructor argument, and `source/core/guard/http/load-reject-response.ts`
fetches it via the web-standard `fetch()` (which Deno confirmed handles
`file://` URLs directly, alongside `http(s)://`) once at startup — not
re-fetched per-request, since the page is realistically static and a
network round-trip (potentially to S3) on every single rejection would be
wasteful. `build-server.ts` wires a new optional `REJECT_RESPONSE_URL` env
var through `loadConfig` into this. Content-type is taken from the fetched
response's own header when present (real HTTP sources typically set it);
falls back to inferring from the URL's file extension (`.html`, `.htm`,
`.txt`, `.json`) since `fetch` on a `file://` URL returns no `content-type`
at all (confirmed directly) and defaults to `application/octet-stream`
otherwise.

**Manual-testing aids, also added after Phase 5**: two new small apps under
`source/apps/guard/`:
- **`fake-service/`** — a tiny stand-in "protected service": renders an HTML
  page showing exactly what request it received (method, path, headers,
  body), so a request that reached it via the proxy is visually
  distinguishable from a rejected one.
- **`demo/`** — a manifest + `.rego` policy + compiled bundle + a custom
  `forbidden.html`, designed to be exercised from a browser with no
  `curl` needed: `GET /` is denied by default, `GET /?vip=true` is allowed
  (the policy checks a `vip` query param, extracted via the manifest).
  Includes a `README.md` with the exact commands to run `fake-service` and
  `guard-proxy` together and the URLs to open. Verified manually: both the
  allow path (real proxying to `fake-service`, confirmed via its request
  dump) and the reject path (custom 403 page served, correct
  `content-type: text/html; charset=utf-8`) work as designed, plus the
  bare-403 fallback when `REJECT_RESPONSE_URL` is unset.

### Phase 5b — split Judge into its own (non-public) process (done)
Until now `guard-proxy` — the process directly exposed to public traffic —
also held the `Judge` in-process, along with the OPA bundle and policy
registry. Since `Judge` is the actual authorization decision-maker, it
shouldn't share a process/attack-surface with the public HTTP gateway. Split
into two processes: `source/apps/judge/server/` (new, holds `Judge` +
`InMemoryPolicyRegistry` + `OpaPolicyEngine`, never exposed publicly) and
`source/apps/guard/proxy/` (unchanged responsibility, now talks to
judge-server over HTTP instead of holding a `Judge` locally).

**`source/core/judge/judge.ts`** — what used to be the `Judge` class is now
an interface: `{ decide(action, context): Promise<Decision> }`. The old
implementation is renamed `LocalJudge` (`local-judge.ts`), unchanged
otherwise. This is the same shape `PolicyEngine`/`PolicyRepository` already
have — `Judge` was the one collaborator in the whole design that was a
concrete class instead of a port, which is exactly what made an
in-process-only assumption invisible until now.

**`source/core/judge/http/`** — the transport adapters, kept in `core/judge`
(not a separate app-level package) since they still speak in `Judge`'s
vocabulary and contain no process-wiring:
- `wire.ts` — the wire contract, `{ action: string, context: object }` →
  `{ allowed: boolean }`. `Decision.results` (the explainability trail) is
  deliberately dropped on the wire — nothing downstream of `Guard` reads it
  (confirmed by grep before this decision), and the caller only ever needs
  `.allowed`. If audit/explainability (Phase 8) later needs `results` to
  cross the process boundary, the wire contract grows then, not
  speculatively now.
- `build-judge-handler.ts` — `buildJudgeHandler(judge: Judge)` wraps any
  `Judge` (so it works identically whether judge-server injects a
  `LocalJudge` or, hypothetically, something else) as `POST /decide`;
  anything else 404s; malformed body or missing `action`/`context` is 400.
- `judge-http-client.ts` — `JudgeHttpClient implements Judge`, the client
  side: POSTs `{action: action.name, context: {...context.facts}}` to
  `${server}/decide`, decodes `{allowed}` back into a `Decision`. A non-ok
  response throws `JudgeRequestError` — deliberately *not* swallowed into an
  implicit deny here; whether judge-server unreachability should fail closed
  is a `Guard`-level concern, i.e. Phase 7, not something to silently decide
  inside the client.

**`source/apps/judge/server/`** — mirrors `guard-proxy`'s shape exactly
(`config.ts`, `build-server.ts`, `main.ts`, own `deno.json` with its own
`fmt` block). `config.ts` reads `SERVICE_MANIFEST_PATH`, `POLICY_BUNDLE_PATH`
(both required) and `JUDGE_PORT` (optional, defaults `8081`) — no
`UPSTREAM_URL`/`REJECT_RESPONSE_URL`, since those are guard-proxy-only
concerns. `build-server.ts` does exactly what `guard-proxy`'s used to before
this split: loads the manifest and OPA bundle, populates an
`InMemoryPolicyRegistry` under the same 1:1 stub convention (see Phase 4c —
still the real gap to close), builds a `LocalJudge`, and returns
`buildJudgeHandler(judge)` as the request handler. `guard-proxy` no longer
has any of this — it only loads the manifest (for
`HttpManifestActionResolver`) and constructs a `JudgeHttpClient`.

**`source/apps/guard/proxy/`** — `config.ts` drops `bundlePath`, adds
`judgeServerUrl` (required `JUDGE_SERVER_URL`, e.g.
`http://judge.internal:8081`). `build-server.ts` no longer touches OPA or a
policy registry at all — it loads the manifest (still needed for
`HttpManifestActionResolver`, which is a guard-side concern: recognizing
*which* action an HTTP request is attempting is orthogonal to judging it) and
constructs one `new JudgeHttpClient(config.judgeServerUrl)`, injected into
`Guard` exactly where `LocalJudge` used to go — `Guard`'s constructor didn't
change at all, since it always depended on the `Judge` interface, not a
concrete class.

Verified end-to-end manually with all three real processes running
(`fake-service` :9100, `judge-server` :9300, `guard-proxy` :9200): a direct
`POST /decide` against judge-server for both an allowed and denied context;
then through the proxy, confirmed the same allow/deny outcomes end-to-end
(custom 403 page on deny, real reverse-proxy to `fake-service` on allow) —
proving `guard-proxy` no longer decides anything itself, only orchestrates
and forwards. Full workspace suite: 103 passed, 0 failed.

### Phase 5c — ship packages and a demo workflow (done)
Two additions, both ops/tooling rather than `core`/`apps` design — using the
`ens` CLI (`ens build`/`ens pack`/`ens workflow`) already established
elsewhere in this monorepo (`.ensemble/`), not anything bespoke.

**`source/ship/{guard/proxy,guard/fake-service,judge/server}/Dockerfile`** —
each a minimal `denoland/deno:alpine` image that `COPY --from=artifacts
<app>/main.js` (the bundle `ens build <app>` produces, via the `deno.bundle`
build kit registered per-app in `.ensemble/config.yaml`) and `CMD`s the
app's own permission set from its `deno.json` `start` task exactly (no
blanket `-A`). `ens pack <app> docker` builds each into `<app>:latest`.
Verified by packing all three and running them as real containers on a
shared Docker network, confirming inter-container routing and the reject
path — see the fake-service Dockerfile addition and Phase 5b's own
verification for the other two.

**`workflows/demo/`** — a Terraform config (`terraform/main.tf`, using the
`ritaj/dockercompose` provider) plus `workflow.yml`, bringing all three
ship images up together as one `dockercompose_stack` for manual testing.
Deliberately modeled on `workflows/deploy/` (same provider, same
`dockercompose_stack`/`service`/`volume`/`network` shape, same
`ENSEMBLE_WORKSPACE`-relative `run:` steps) but flattened: one stack, no
`infrastructure`/`services` module split, no per-environment `contexts/` —
this exists only for local manual testing, not a real deployment target.

- `up` job: `ens build`/`ens pack ... docker` for all three apps, `terraform
  apply`, then seeds `judge-server`'s KV-backed `PolicyRegistry` with the
  `demo.home.visit` association its policy needs (judge-server never
  bootstraps this itself — see Phase 4c — so without this step `?vip=true`
  could never allow, only ever fall back to deny).
- `down` job: `terraform destroy`. Deliberately does **not** set
  `remove_volumes_on_destroy = true` on the stack — the `judge-kv` volume
  survives teardown by default, which is fine since the seed step is
  idempotent (`associate()` is a no-op if already present).
- `up`/`down` have no `needs:` relationship, so both must always be invoked
  with an explicit `--job` (`ens workflow demo --job up` / `--job down`) —
  a bare `ens workflow demo` would run every job with no dependency
  relationship concurrently, per `@ensemble/workflow`'s own semantics.
- `source/apps/guard/demo/` (manifest, policy bundle, 403 page) is
  bind-mounted read-only into the containers that need it, rather than
  baked into the images — editing those fixtures doesn't require a rebuild,
  only source changes to the apps themselves do.

`dockercompose_stack.service` has no `build` attribute (confirmed directly
from the provider's own schema via `terraform providers schema -json`) —
only `image`, required — which is why the images have to exist first
(`ens pack`) rather than the stack building them itself.

Verified end-to-end via the actual `ens workflow demo --job up`/`--job down`
commands (not just the underlying Dockerfiles/Terraform in isolation): real
`curl` calls against all three running containers confirmed the same
deny/allow/direct-judge-server behavior proven manually in Phase 5b, and
`--job down` confirmed full teardown (containers and network gone; the
volume intentionally left, per above).

### Phase 7 — error handling & failure modes
Still not addressed: `Guard.execute()` has no failure handling — if
`ActionResolver.resolve()`, `PolicyRepository.findPoliciesFor()`,
`PolicyEngine.evaluate()`, or `DecisionStrategy.combine()` throws/rejects,
the error propagates out of `Guard.execute()` uncaught. Confirmed concretely
in Phase 5: `guard-proxy`'s handler has no try/catch either, so today an
internal error would surface as an unhandled rejection in `Deno.serve`
rather than a clean response. Needs a decision: does `Guard` catch internal
errors and treat them as an implicit reject (fail closed, consistent with
the existing unmatched-action behavior), or is catching left entirely to the
composition root / HTTP layer (both now built in Phase 5, at
`source/apps/guard/proxy/`)? Whichever is chosen must be applied consistently
and covered by tests before this is production-ready.

Phase 5b widened this: `JudgeHttpClient.decide()` now also throws
`JudgeRequestError` on any non-ok response from judge-server, and a genuine
network failure (judge-server down, unreachable) throws too — both currently
propagate out of `Guard.execute()` exactly like every other untreated
failure mode above. Whatever failure-handling strategy this phase lands on
must explicitly cover "judge-server is unreachable," since that's now a
distinct, expected-in-production failure mode (deploys, restarts, network
partitions between the two processes) rather than a hypothetical.

### Phase 8 — observability & audit
`Decision` already carries the `PolicyResult[]` that produced it, specifically
for explainability — but nothing yet says where that goes. For an
authorization system this is usually load-bearing (audit trails, incident
investigation, debugging a wrongly-denied request), not optional polish.
Likely shape: an `AuditSink`-style port `Guard` or `Judge` can be given,
called with the `Decision` after every evaluation. The port itself (speaking
in `Decision`) would live under `core`; a concrete implementation (structured
logs, an event stream, etc.) may or may not be domain-specific enough to
belong there too — exact interface and placement TBD when we get here.

### Phase 9 — CI
`deno test`, `deno lint`, `deno fmt --check` running on every push/PR, scoped
per-workspace-package. No decisions made yet on CI provider/config. Matters
before Phase 10's auto-deploy exists, and before more than one contributor is
working in the repo.

### Phase 10 — bundle delivery pipeline
GitHub webhook → build OPA bundle from the policies repo → redeploy the Judge
process with the new bundle embedded. Pure ops/CI concern, last on purpose:
nothing about `core` design depends on how the bundle physically arrives.

## Verification approach per phase
Each phase adds its own fakes/fixtures and a test suite runnable via `deno test`,
independent of later phases' infra. No phase's tests should require network
access or a real OPA binary until Phase 3+ (real OPA) — and even then, scoped
to that phase's own adapter package, not `core`. Phase 5 is the first to need
a real HTTP server and real network access in its tests (`HttpServiceProvider`'s
suite spins up an ephemeral `Deno.serve` as a fake upstream), scoped to
`source/core/guard/http/` and `source/apps/guard/proxy/`.
