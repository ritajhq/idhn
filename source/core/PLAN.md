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

## Architecture boundary (decided)

- **`core/judge`** (built) — pure domain: `Action`, `Context`, `Policy`, `Verdict`,
  `PolicyResult`, `Decision`, and the `Judge` orchestrator, constructor-injected
  with three ports: `PolicyRepository`, `PolicyEngine`, `DecisionStrategy`. No
  transport, no OPA, no I/O.
- **`core/guard`** (next) — pure domain for the interception side. `Guard` is
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
- **Everything below is infrastructure**, built as adapters outside `core`,
  implementing the ports above: OPA-backed `PolicyEngine`, a policy-bundle-backed
  `PolicyRepository`, an HTTP server wrapping `Guard`, a manifest file loader,
  OPA bundle build/deploy tooling. None of this is designed yet — deliberately
  deferred until the ports that constrain it exist.

## Phases

### Phase 1 — `core/judge` (done)
`Action`, `Context`, `Policy`, `Verdict`, `PolicyResult`, `Decision`,
`PolicyRepository`/`PolicyEngine`/`DecisionStrategy` ports, `DenyOverridesStrategy`,
`Judge` orchestrator. Tested entirely against hand-written fakes. Lives at
`source/core/judge/`.

### Phase 2 — `core/guard` (next slice to build)
Pure domain for the interception side, no HTTP server yet. See the shape under
"Architecture boundary" above: `ActionResolver` and `ServiceProvider` ports (both
zero-argument, constructed per-request by the infra layer with whatever raw data
they need closed over), and a `Guard` orchestrator using `judge.Judge` directly.

Tested with fakes for `ActionResolver` and `ServiceProvider`, and a real `Judge`
wired with Phase 1's fake `PolicyRepository`/`PolicyEngine`/a stub
`DecisionStrategy` (reusing test doubles already written for `core/judge`) — no
real HTTP, no real OPA.

### Phase 3 — OPA-backed `PolicyEngine` adapter
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

`Policy.id` is treated as a Rego package path with a conventional rule name
(e.g. `Policy("invoice.approve")` → query `data.invoice.approve.allow`);
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

Lives outside `core` (e.g. `source/libs/judge-opa/`). Tested against real
`.rego` fixtures, no network/webhook/deploy concerns yet — bundle loading here
starts from a local file path; remote bundle fetching is Phase 6.

### Phase 4 — `PolicyRepository` adapter
Resolves action → governing `Policy` references. Likely backed by metadata
embedded in the same Rego bundle (e.g. package annotations or a manifest file
shipped alongside the `.rego` sources) rather than a separate store — exact
mechanism TBD when we get here, kept independent of Phase 3's engine choice.

### Phase 4a — manifest-driven `ActionResolver` adapter
A concrete, declarative `ActionResolver` implementation living outside `core`.
Config-driven: a service owner authors a manifest describing, per action, how
to recognize it from a request (e.g. method + path pattern) and which fields
to extract into `Context`. Also the natural place to declare **external data
enrichment** — e.g. "fetch `requester.points` from the points service" — as
config (source name, endpoint, method, response-field mapping) rather than as
something a Rego policy fetches itself mid-evaluation (see Phase 3's
`http.send` note — this is the actual mechanism that replaces it). Exact
manifest schema, the enrichment-fetch mechanism, caching, and failure handling
(what happens if an external source is unreachable) are all open design
questions to resolve when we start this phase — not yet decided.

### Phase 5 — HTTP transport
Two adapters, both thin:
- Wrap `Guard` behind an actual HTTP server (the reverse-proxy/interceptor
  process) — implements `RequestDescriptor` construction from a real framework's
  request object, and turns `Outcome` into either a proxied call to the
  protected service or a `403` response.
- If/when Judge needs to run as a separate deployable, an HTTP-calling
  `PolicyRepository`/`PolicyEngine` pair (or a single client wrapping both) that
  a remote Guard process could use instead of the Phase 3/4 in-process adapters —
  no change to `core/judge` or `core/guard` required, per the architecture
  boundary above.

### Phase 6 — Bundle delivery pipeline
GitHub webhook → build OPA bundle from the policies repo → redeploy the Judge
process with the new bundle embedded. Pure ops/CI concern, last on purpose:
nothing about `core` design depends on how the bundle physically arrives.

## Verification approach per phase
Each phase adds its own fakes/fixtures and a test suite runnable via `deno test`,
independent of later phases' infra. No phase's tests should require network
access, a real OPA binary, or a real HTTP server until Phase 3+ (real OPA) and
Phase 5 (real HTTP) respectively — and even then, scoped to that phase's own
adapter package, not `core`.
