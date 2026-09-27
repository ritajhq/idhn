# Handoff: share the portal's session cookie with the guard in dev via lvh.me

For a local session that can reach both repositories: idhn (this one, branch
`feat/guard-authentication`) and the portal (`/home/duesabati/ritaj/portal`).
Read [handoff.md](handoff.md) and the "Who is asking: authentication" section of
[overview.md](overview.md) first.

## Goal

Sign in on the portal's auth server in a browser, then browse a service through
an idhn guard using the `session-cookie` scheme, and see the guard recognize the
session. Done when all four checks under "Verify" pass.

## The problem and the chosen fix

In the `*.localhost` dev setup the BetterAuth session cookie is host-only on
`auth.localhost`. Browsers refuse a cookie for the single-label domain
`localhost`, so a guard on `dashboard.localhost` never receives the cookie.

The owner chose to serve dev under **`lvh.me`**, a public domain whose every
subdomain resolves to `127.0.0.1`. Then `auth.lvh.me` can set a cookie with
`Domain=lvh.me`, and the browser sends it to `dashboard.lvh.me` too. Cookies
ignore ports, so each app keeps its own port. This mirrors production, where
`AUTH_COOKIE_DOMAIN` is the parent domain. No idhn code changes are expected.

## Steps

1. **Portal auth server** (`source/apps/auth/server`). Read its README and
   config first; do not assume these names.
   - Set its public URL (likely `BETTER_AUTH_URL`) to
     `http://auth.lvh.me:<port>`.
   - Set `AUTH_COOKIE_DOMAIN=lvh.me`. Check that it reaches BetterAuth's
     `advanced.crossSubDomainCookies` (`{ enabled: true, domain: 'lvh.me' }`).
   - Add `http://dashboard.lvh.me:<port>` (and any other dev frontend) to its
     trusted origins.
   - Dev runs over plain `http`, so secure cookies must stay off. Otherwise the
     browser drops the cookie, and its name gains a `__Secure-` prefix.
2. **Portal frontends**: point whatever calls the auth server at `auth.lvh.me`
   instead of `auth.localhost`. Keep this a dev-only config change if the portal
   has a dev env file for it.
3. **idhn guard**: run the standalone guard in front of the portal service, per
   `ci/demo/README.md`, with a manifest that declares:

   ```yaml
   authentication:
     scheme: session-cookie
     # server to server: the guard may call the auth server on localhost directly
     session_url: http://localhost:<auth-port>/api/auth/get-session
     cookie: better-auth.session_token # match the name the browser actually shows
   ```

   Then associate each action with a policy in the KV registry, as the demo
   README shows. A policy for a protected action checks
   `input.auth.status == "authenticated"`, and a public one ignores `auth`. The
   `profile.read` and `catalog.browse` fixtures in
   `source/core/opa/tests/fixtures/` are templates. Browse the guard at
   `http://dashboard.lvh.me:<PROXY_PORT>`.

## Verify

1. After signing in, the browser devtools show the session cookie with
   `Domain=lvh.me` (`.lvh.me`).
2. Signed out, a protected action answers **401**, and a public one passes.
3. Signed in, the protected action is forwarded. The fake-service echo, or the
   upstream, receives the request.
4. With the auth server stopped, a signed-in browser gets **503** on protected
   actions and still passes on public ones.

If the guard does not see the session, check in this order: the cookie's name
and `Domain`, the manifest's `cookie`, and a direct
`curl -H 'cookie: better-auth.session_token=<value>' <session_url>`.

## Gotchas

- `lvh.me` needs working DNS. Some routers and resolvers block public names that
  resolve to `127.0.0.1` (DNS rebinding protection). If `dig auth.lvh.me` gives
  nothing, fall back to `/etc/hosts` entries under a `.test` domain, such as
  `auth.portal.test` and `dashboard.portal.test`, with
  `AUTH_COOKIE_DOMAIN=portal.test`.
- Don't touch the production cookie settings; this is a dev configuration only.
- Report back anything that contradicts [handoff.md](handoff.md)'s assumptions
  about the portal: the get-session response shape, the cookie name, or no roles
  plugin.
- Commits: single-line messages with no body and no trailers.
