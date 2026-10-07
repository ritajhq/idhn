# Plan: the idhn console

**Status (2026-10-06):** built on `feat/console`, every step below.

The console is where people who run idhn see and change what it does. At first
it covers four things:

1. **Importing a resource:** given the URL of a service behind a guard, fetch
   that guard's manifest.
2. **Policies:** author, check, test and publish them.
3. **Associations:** for one resource, which policies govern each action.
4. **Audit:** an overview of what guards let through or refused, and why.

It is built like khatm's console: a Deno server and a React web app built by the
ensemble `react` kit, talking over **mux** and **horizon**, with the UI on
**Fluid Functionalism** and Untitled UI icons.

## Model

- **Resource:** one guarded service, as last imported: its manifest (id,
  protocol, actions, restricted fields), where it was imported from, and when.
  Re-importing replaces it.
- **Policy:** a Rego package (`shop.admin`), its tests, and optionally a `show`
  rule beside `allow`.
- **Association:** a resource's action (`<manifest id>.<action>`) and the
  policies that govern it.
- **Sources:** the versioned tree of policies, tests and associations
  (`policies.yaml`), exactly what the policy builder takes. Policies and
  associations change together and are published together.
- **Audit:** guard requests and judge decisions, joined by `decisionId` into
  trails, and summarized as an overview.

## Decisions

- **A guard serves its manifest as an action.**
  `GET
  /.well-known/idhn/manifest` resolves to the built-in action
  `<manifest id>.idhn.manifest.read`, judged by policies like any other, and
  logged like any other. Action names starting with `idhn.` are reserved. The
  console forwards the signed-in user's own credential, so policies decide who
  may import a resource; the console has no identity of its own. The manifest is
  served in its own syntax, so `parseManifest` reads it back unchanged.
- **The console owns the policy sources.** It keeps their versions in its own
  storage. Checking asks the builder for a dry run (`POST /checks`, new), and
  publishing uploads the tree (`PUT /sources`), so the builder runs in `upload`
  mode.
- **Audit has its own service.** See below.
- **Shared libs are vendored.** mux, horizon, storage and the Fluid UI kit are
  copied from khatm into `source/libs`, until the `@ritaj/*` libs get a single
  source.
- **The console sits behind an idhn guard.** Its calls are horizon
  `POST /<name>` requests, which the `http` protocol already matches.

## Audit

```
guard / judge ─stdout JSONL─▶ log shipper ─POST /records─▶ audit/server ─▶ Store
                              (Vector, Fluent Bit, OTel)        │
console ◀───────────── horizon queries ─────────────────────────┘
```

- **Emitting:** guards and judges keep writing JSON Lines to stdout, off the
  request's path. Each line gains a `recordId` (so a record delivered twice is
  kept once), a `schema` version, and its `source` (resource and instance).
- **Transport:** a log shipper posts NDJSON batches to `audit/server`, at least
  once. The server answers `503` when it can't keep up, and the shipper backs
  off. For development, the server can tail a JSONL file instead.
- **`audit/server`** (new app, separate from the console so ingestion outlives
  it): parses lines into records, refuses and reports malformed ones, redacts,
  stores, and answers horizon queries. A guard sits in front of its queries.
- **Domain (`core/audit`):**
  - `Request` and `Decision`, the records. A decision keeps each policy's
    verdict.
  - `Trail`, a request with its decision, joined at query time since they arrive
    in any order.
  - `Query`: a time window, filters (resource, action, outcome, rejection,
    subject, policy), a cursor and a limit.
  - `Overview`: outcomes over time per resource and action, the most denied
    actions and subjects, the policies that denied most, failures, and latency
    percentiles.
  - `Redaction`, through `@idhn/disclosure`: every `auth` claim is covered
    except `subject` and `status`, unless configured otherwise.
  - `Retention`: raw records 30 days, rollups a year, unless configured.
- **`Audit.Store`**, from the operations: `append(batch)`, idempotent and
  updating rollups in the same transaction; `trails(query)`; `trail(id)`;
  `overview(query)`, read from rollups; `purge(retention)`.
- **Adapters:** SQLite first (`node:sqlite`, built into Deno; one file, no extra
  service). Postgres later, behind the same port.
- **Later:** tamper evidence (hash-chained batches), export, alerts.

## Steps

1. The guard serves its manifest. **Done.**
2. Vendor mux, horizon, storage and Fluid into `source/libs`. **Done.**
3. The builder's dry run, `POST /checks`. **Done.**
4. The console's core: resources, sources, associations. **Done:**
   `@idhn/resources` and `@idhn/authoring`.
5. `core/audit` and the emitting changes. **Done.**
6. `audit/server`, with the SQLite store. **Done.**
7. The console app: server and the Fluid dashboard (Resources, Policies,
   Associations, Audit). **Done.**

## Later

- The Postgres audit store: introduce the `Audit.Store` interface then, with
  `Stores.Sqlite` as its first implementation.
- Tamper evidence, export and alerts for the audit.
- Editing `enrichment.yaml` and `data.json` in the console (kept as they are
  today).
- Taking over an existing policy repository: restoring its tree into the draft.
