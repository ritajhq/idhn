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
  `PolicyResult`, `Decision`, and the `Judge` orchestrator, constructor-injected
  with three ports: `PolicyRepository`, `PolicyEngine`, `DecisionStrategy`. No
  transport, no OPA, no I/O.
- **`core/guard`** (built) — pure domain for the interception side. `Guard` is
  **not generic over the raw request type** and never touches it directly — that
  knowledge is entirely encapsulated inside per-request-constructed collaborators.
  `Guard` is constructed with a `Judge` (used directly, per the earlier decision
  to prefer less indirection since the in-process→HTTP seam already lives inside
  `Judge`'s own injected ports) plus two ports:
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

### Phase 4c — pluggable, cached `PolicyRepository` (new, not yet started)
The real answer to "which policies govern which actions." Phase 5 (below)
needed something working today and stubbed it with `InMemoryPolicyRegistry`
under a 1:1 action-name-equals-policy-id convention — not the real design.
The actual association is meant to be a genuinely live, runtime-queryable
lookup, written by some other system/process (a KV store, a YAML file, a
separate service — unspecified/pluggable), that can change without a
redeploy but not so often that a cache in front of it is unwarranted. Needs
its own port design plus a caching layer, with the exact backing store,
cache invalidation strategy, and how the write side is exposed all still
open — deliberately deferred rather than designed ad hoc inside Phase 5.

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
