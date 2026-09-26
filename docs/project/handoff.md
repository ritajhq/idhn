# Handoff: state of the core packages and the auth integration plan

Read [overview.md](overview.md) first for the architecture. This document
records what changed recently, the working conventions, and the agreed (not yet
implemented) authentication design, so work can continue in a fresh session.

## Where things stand

The old `@idhn/judge` package was split, and every package now exports through a
namespace (`import * as Judge from '@idhn/judge'`; names drop the namespace
prefix).

| Package       | Namespace | Holds                                                                                                                                                                         |
| ------------- | --------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `core/access` | `Access`  | `Action`, `Context` (`Context.with()` refuses to overwrite a fact)                                                                                                            |
| `core/policy` | `Policy`  | `Identifier` (dotted path, exposes `segments`), `Verdict`, `Result`, `Engine`, `Repository`, `Registry`, `Registries.InMemory`, `Registries.Kv`                               |
| `core/judge`  | `Judge`   | `Behavior` (the port), `Local`, `Decision`, `DecisionStrategy`, `DenyOverridesStrategy`, `Enricher`, `Enrichers.*` (`Passthrough`, `Chain`, `HttpLookup`, `Source`), `Http.*` |
| `core/opa`    | `OPA`     | `PolicyEngine` (OPA WASM), `DataSource` (Rego `data`), `EntrypointNotFoundError`                                                                                              |
| `core/guard`  | (flat)    | `Guard`, manifests (`manifest/http/` is the HTTP part; `protocol` tag), `HttpServiceProvider`, `RejectResponses.*`                                                            |

Facts reach a policy from three places: the request (manifest `extract`), OPA
`data` (`POLICY_DATA_PATH`), and enrichment lookups run by `Judge.Local`
(`ENRICHMENT_PATH`). See the "Where a policy's facts come from" section of the
overview.

## Conventions the owner asked for

- **`main.ts` instantiates all infrastructure**, then builds domain objects and
  injects the infrastructure into them through constructors. Nothing else (a
  `Server`, a config step, a shared "assembly") creates its own infrastructure.
  Apps never depend on other apps, and shared wiring between apps is not
  centralized: small duplication across apps is accepted.
- **Classes, not standalone functions**, except the main entry point. Existing
  plain functions still left: `loadConfig` and its env helpers in each
  `config.ts`, `loadManifestFile`, `parseManifest`, `Judge.Http.buildHandler`,
  and some test helpers. Convert them when asked.
- **Optional collaborators use Null Objects**, not `undefined` and ternaries:
  each has a `Source` class whose `load()` returns a neutral object when unset.
- Names use the namespace supplied by the import; if a name would be exactly the
  namespace, ask the owner.
- Ask before introducing a new interface; go concrete first.
- The owner's global `~/.claude/CLAUDE.md` is not in this repo. Its rules
  include: early returns, no `if`/`else` ladders that select behavior, avoid
  recursion, `.tsx` files in kebab-case, single-line commit messages with no
  body and no trailers.

## Agreed design: authentication (not implemented)

- Authentication only **reports** what it found; it never rejects. Whether
  authentication is required is decided by the policies.
- An `Access.Identity` (authenticated / anonymous / invalid, `subject`,
  `issuer`, open `claims`) is contributed to the `Context` under the reserved
  fact `auth`. Only the authenticator may write `auth`: `Context.with()` already
  throws on a conflict, and the manifest parser must reject `as: auth`.
- An `Authenticator` port, per request like `ActionResolver`, behind which every
  technology does: present, extract (protocol-specific), verify (credential-
  specific), resolve identity, assert an outcome.
- **No chain, no per-action selection.** The service manifest declares exactly
  one scheme, inside its protocol-tagged section:
  `authentication: { scheme: ..., ...settings }`. The parser dispatches on
  `scheme` like it does on `protocol`. `main.ts` wires the set of schemes the
  deployment supports, and startup fails if the manifest names an unsupported
  one.
- Non-secret settings (issuer, audience, URLs, claim mapping) live in the
  manifest. That was a deliberate choice: the manifest owner is trusted with
  which identity provider a service trusts. Secrets never go there; they are
  read from the environment in `main.ts`.
- Policies should use roles and claims, not hardcoded username lists. Use `data`
  or enrichment lookups for what the identity provider cannot say.

### First adapter: the portal's session cookie

The portal (`/home/duesabati/ritaj/portal/source/apps/auth/server`) uses
**BetterAuth** with email+password and the `username` plugin, with **server-side
sessions in Postgres carried in a cookie**. There is no JWT, bearer or roles
plugin, and no other portal service validates a session yet.

- Scheme `session-cookie`: forward the request's `Cookie` header to the auth
  server's `GET /api/auth/get-session`, which returns the session and user or
  nothing. Cache briefly by a hash of the cookie (the cost is revocation lag).
- Identity: `subject` = `user.id`; claims `username`, `email`, `name`,
  `emailVerified`. There are no roles, so authorization data (for example
  "manager of this place", see `place-managers` in the portal) comes from `data`
  or enrichment lookups keyed by the subject.
- **Risk to check first:** per the auth server's README, in the `*.localhost`
  dev setup the session cookie is host-only on `auth.localhost`, so a guard in
  front of `dashboard.localhost` would not receive it. It should work on a real
  domain with `AUTH_COOKIE_DOMAIN` set. Alternatives: enable BetterAuth's
  `bearer` plugin, or test only on a real multi-label domain.

### Phases

1. `Access.Identity`, the `Authenticator` port, the reserved `auth` fact and the
   guard flow, with fakes only.
2. Manifest `authentication` block, scheme dispatch in the parser, and the
   startup check.
3. The `session-cookie` adapter (then `bearer-jwt` if a JWT provider appears).
4. Policy patterns: nested placeholders in enrichment lookups (today
   `HttpLookup` placeholders read only top-level facts, so `{auth.subject}` does
   not resolve), fixture Rego for role checks, and an integration test through
   `Judge.Local`.

## Open items

- Nothing writes the `POLICY_DATA_PATH` file or the KV policy-registry rows.
  Options: ship `data.json` in the policy bundle (the Phase 10 pipeline in
  `source/core/PLAN.md`), an external sync job, or drop the data feature and use
  lookups.
- 401 versus 403 is parked: the guard no longer knows whether authentication was
  required.
- A failed non-optional enrichment lookup makes judge-server answer 500 and
  `Judge.Http.Client` throw `RequestError`; how the guard treats that is the
  open Phase 7 question in `PLAN.md`.
- `EnvReader` in each `config.ts` only existed for the (now deleted) config
  tests and can be removed.
- `source/core/PLAN.md` was reflowed by `deno fmt`, and still uses old names
  (`judge-opa`, `OpaPolicyEngine`, `LocalJudge`) in its historical sections.
