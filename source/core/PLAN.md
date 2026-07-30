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

### Phase 4a — manifest-driven `ActionResolver` adapter
A concrete, declarative `ActionResolver` implementation — domain-specific (it
produces `Action`/`Context`), so it belongs under `core/guard` alongside
`Guard` itself, per the `core`/`libs` boundary above.
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

### Phase 4b — multi-policy integration test
Before trusting `DenyOverridesStrategy` in production, run it against *real*
compiled OPA policies rather than synthetic `Verdict` values from a fake
engine. Compile two or more genuine `.rego` fixtures (extending the pattern
already used in `judge-opa`'s tests) representing a realistic multi-policy
scenario for one action (e.g. a base policy + an override), and exercise the
full `Judge` (real `PolicyRepository` + real `OpaPolicyEngine` +
`DenyOverridesStrategy`) end-to-end. Closes the gap between "combination logic
is unit-tested" and "combination logic is proven correct against actual Rego
semantics."

### Phase 5 — composition root / process wiring
Nothing so far actually runs as a process — every phase to this point is a
library package. This phase is where concrete adapters get instantiated and
wired together: `new Judge(policyRepository, policyEngine, decisionStrategy)`,
`new Guard(judge, actionResolver, serviceProvider)`, built from real
configuration (env vars vs a config file — undecided) and started as a running
service. Belongs in `source/apps/` per the existing workspace layout. Also the
place to decide process-level concerns: how the manifest (Phase 4a) and OPA
bundle (Phase 3/4) are located/loaded at startup, and what happens if either
is missing or invalid at boot (fail-fast is the likely default, to be
confirmed here).

### Phase 6 — HTTP transport
Two adapters, both thin, built on top of Phase 5's composition root:
- A concrete `ActionResolver` + `ServiceProvider` pair backed by a real HTTP
  framework/request object — `ActionResolver` reads the manifest (Phase 4a) to
  identify the action and pull context, `ServiceProvider` proxies the request
  to the protected service or writes a `403`.
- If/when Judge needs to run as a separate deployable from Guard, an
  HTTP-calling `PolicyRepository`/`PolicyEngine` pair (or a single client
  wrapping both) that a remote Guard process could use instead of the Phase
  3/4 in-process adapters — no change to `core/judge` or `core/guard`
  required, per the architecture boundary above.

### Phase 7 — error handling & failure modes
Not yet addressed anywhere: `Guard.execute()` currently has no failure
handling — if `ActionResolver.resolve()`, `PolicyRepository.findPoliciesFor()`,
`PolicyEngine.evaluate()`, or `DecisionStrategy.combine()` throws/rejects, the
error propagates out of `Guard.execute()` uncaught. Needs a decision: does
`Guard` catch internal errors and treat them as an implicit reject (fail
closed, consistent with the existing unmatched-action behavior), or is
catching left entirely to the composition root (Phase 5) / HTTP layer (Phase
6)? Whichever is chosen must be applied consistently and covered by tests
before this is production-ready — right now it's an unhandled gap, not a
made decision.

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
access, a real OPA binary, or a real HTTP server until Phase 3+ (real OPA) and
Phase 6 (real HTTP) respectively — and even then, scoped to that phase's own
adapter package, not `core`.
