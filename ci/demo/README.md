# Demo

A protected service (`fake-service`) behind the standalone guard, and the idhn
console behind a guard of its own. One judge answers both guards. It judges
with what the policy builder last published: the base policies, which say who
may use the console, beneath whatever the console publishes. Every guard's and
judge's audit lines land in the audit server, which the console browses.

```
demo.localhost    ─▶ guard ─────────▶ service
console.localhost ─▶ console-guard ─▶ console ─▶ builder ─▶ judge ◀─ both guards
                                         └─────▶ audit ◀─ audit lines (volume)
```

Only the two guards can be reached, through a gateway. Everything else stays on
the stack's internal network.

## Run it

```sh
ens develop demo              # build, pack and run it, syncing app changes into the containers
deno run -A ci/demo/seed.ts   # once: publish the demo service's first policies through the console
```

`ens develop` rebuilds an app when its source changes and restarts its container
with the new build. The gateway publishes port 80.

At first the builder has published the base policies alone. The console works,
but the demo service answers `403`, since no policy governs its actions yet.
The seed writes the tree in `ci/demo/policies` into the console's draft and
publishes it:

- `demo.home.visit` lets in requests with `?vip=true`.
- `demo.stewards` lets anyone read the demo service's manifest, so it can be
  imported.

A console whose draft already has policies is left as it is.

## Try it

1. Browse `http://demo.localhost/` (refused, with the custom 403 page) and
   `http://demo.localhost/?vip=true` (proxied through to `fake-service`).
2. Open `http://console.localhost`.
3. **Resources:** import `http://guard:8080`, the demo service's guard as the
   console reaches it. `http://console-guard:8080` imports the console itself.
4. **Policies:** edit `demo.home.visit`, **Check** it, and **Publish**. The judge
   picks the new set up within a second.
5. **Associations:** pick `demo` to see which policies govern each action.
6. **Audit:** every request through either guard, with the judge's decision.

The console's own actions are governed by the base policies, in
`source/ship/demo/builder/base`. The console can't change them: a draft that
associates anything with a `console.*` action, or reuses `console.operators`,
is refused at Check and Publish. Changing who may use the console means
changing the base and re-packing the builder.

No one signs in to the demo, so every caller is anonymous, and the audit shows
no subjects.

## What's where

| File                                           | What it is                                                   |
| ---------------------------------------------- | ------------------------------------------------------------ |
| `source/ship/demo/guard/manifest.yaml`         | The service's actions: `home.visit` is `GET /`               |
| `source/ship/demo/guard/forbidden.html`        | The 403 page                                                 |
| `source/ship/demo/console-guard/manifest.yaml` | The console's actions, without authentication                |
| `source/ship/demo/builder/base/`               | The base policies: anyone may use the console                |
| `ci/demo/policies/`                            | The demo service's first policies, which `seed.ts` publishes |

The guards and the judge write their audit lines to stdout, as always, and to
the `audit-lines` volume too, which the audit server follows: the demo has no
log shipper. To watch them:

```sh
docker compose -p idhn-demo logs -f guard console-guard judge
```

The demo's configuration is baked into the images from their ship directories,
so editing it takes a re-pack (`ens develop` does one when it starts).
