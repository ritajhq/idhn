# Handoff: a `horizon` protocol for the guard, with restricted fields

**Status (2026-10-06):** goal 2, restricted fields, is built, as a
protocol-neutral feature on the `http` protocol: see "What the caller may see:
restricted fields" in [overview.md](overview.md). Goal 1 needs no new code over
HTTP, since horizon packets are plain `POST /<name>` JSON requests the `http`
protocol already matches and extracts from. The dedicated `horizon` protocol
below is deferred until guards must judge horizon over WebSocket. Read [overview.md](overview.md) first, especially "Recognizing actions:
manifests and protocols" and "Who is asking: authentication". The libraries
it is about live in khatm (`/home/duesabati/ritaj/khatm/source/libs/mux` and
`.../horizon`), with copies in the portal.

## Goal

1. A guard can sit in front of a service that speaks **horizon** (commands and
   queries over **mux**) and judge each message as an action, the way it judges
   HTTP requests today.
2. The manifest can mark fields of a message's **answer** as **restricted**, and
   say how each may be shown to a caller, depending on the judgement. The three
   ways:
   - **covered**: masked entirely, such as `********`;
   - **partial**: only part is shown, such as the end of an email or a number;
   - **replacement**: a derived value is shown, such as initials instead of a
     full name.

## Decisions already taken (in khatm, 2026-10-06)

- **Authorization stays idhn's alone.** mux and horizon only provide the nouns
  (`Caller`, the `Returned` family, faults). They never decide, and never
  import idhn. The adapter depends on idhn core and on mux/horizon, never the
  reverse.
- **What a caller may see is authorization, so it belongs to idhn.** Restricted
  fields are declared in the idhn manifest. The libraries carry no restriction
  concept.
- **Internal disclosure is separate.** Hiding secrets from a service's own logs
  and audit is horizon's concern: a field is declared secret on the message and
  shown as `"[secret]"` whenever the message is written out for display. It does
  not depend on the idhn manifest (option "B": declared twice, no coupling). The
  adapter may treat such a field as never shown, as a safe default.
- **Messages are addressable.** Answers and faults travel as nested JSON, never
  JSON inside a string, so a JSON pointer reaches their fields. The guard's
  existing JSON-pointer extraction works on them unchanged.
- **Authentication is unchanged.** The guard keeps its schemes. Services behind
  it learn the caller from its `x-idhn-*` headers, through a `Mechanism` the app
  configures. That header layout is app configuration, not something mux knows.

## What the guard would read

An HTTP transport posts each packet to `/<packet leaf name>`, for example
`POST /users.get`, with this body:

```json
{
  "type": "/mux.packet/horizon.query/users.get",
  "data": {
    "query.users.get.user": "ada@example.com"
  }
}
```

The answer is the same packet echoed back, with its answer or its fault:

```json
{
  "type": "/mux.packet/horizon.query/users.get",
  "data": {
    "query.users.get.user": "ada@example.com",
    "query.result": { "value": { "user": { "email": "ada@example.com", "name": "Ada Lovelace" } } }
  }
}
```

```json
"horizon.fault": { "type": "/horizon.fault/khatm.stale_plan", "data": { "fault.message": "…" } }
```

A command uses `action.result` and carries `action.nonce`. A refusal comes back
as a `Returned` packet: `/mux.packet/mux.returned/refusal/forbidden`, wrapping
the original. Field keys contain dots, which is why JSON-pointer extraction
(`/data/query.users.get.user`) is the way to address them.

## Shape of the protocol (to design)

Following the overview: a protocol is its manifest shape, a parser, and an
`ActionResolver`, with its own guard entry point. A first sketch:

```yaml
id: khatm_control
protocol: horizon
authentication: { scheme: session-cookie, … } # as for http
actions:
  - name: users.get
    match: { packet: users.get } # the leaf, as the URL already carries it
    extract:
      - { from: { property: field, using: query.users.get.user }, as: user }
    restrict: # as on the http protocol today
      - { field: /data/query.result/value/user/email, show: { kind: partial, form: email } }
      - { field: /data/query.result/value/user/name, show: { kind: replacement, using: initials } }
```

## Settled while building restrictions

- **Policies say how, not only whether:** a package's `show` rule, beside
  `allow`, maps a field's JSON Pointer to a presentation. Across policies the
  one that withholds most wins (visible < partial < replacement < covered).
- **The manifest declares the default,** `covered` when left out; what policies
  say replaces it per field, so a forgotten field never leaks.
- **Guard-side:** the guard rewrites the answer as a proxy; services stay
  unaware. An answer it can't rewrite (not JSON) is withheld with `502`.
- **Parameters:** named kinds with parameters (`partial` with `keep`/`count` or
  `form: email`; `replacement` using `initials`, `domain` or a `constant`).
- **Arrays:** pointers take `*` for every item.

## Still open, for the `horizon` protocol

1. **WebSocket.** A guard can only check the upgrade request today. Judging each
   frame needs the guard to understand mux frames on a socket. Over WebSocket,
   credentials are presented in-band with a `/mux.presentation` control packet.
2. **The `Returned` answer.** Should a denial be answered as a horizon
   `Returned` packet instead of an HTTP status, so a WebSocket guard can answer
   in-band too? The HTTP client already maps 401, 403, 502 and 503 to the
   matching `Returned`.
