# Manual end-to-end demo

Run the fake protected service, the judge server, and the guard proxy
together, then browse through the proxy to see it work. The judge server is
never exposed publicly — only the guard proxy talks to it.

The fastest way to bring all three up together (builds/packs each app,
applies the `workflows/demo/terraform` stack, and seeds the policy registry
for you): `ens workflow demo --job up`. Tear it down with
`ens workflow demo --job down`. See `workflows/demo/workflow.yml`.

What follows is the same stack run by hand — useful when iterating on one
app without rebuilding its image each time.

```sh
# terminal 1 — the "protected" service
cd source/apps/guard/fake-service
PORT=9100 deno task start

# terminal 2 — the judge server, holding the policy bundle and its
# KV-backed policy registry (action->policy associations)
cd source/apps/judge/server
POLICY_BUNDLE_PATH=../../guard/demo/policy.wasm \
JUDGE_PORT=9300 \
KV_PATH=/tmp/judge-demo.db \
deno task start

# terminal 3 — the standalone guard, pointed at the judge server, this
# demo's manifest (for action resolution), and its 403 page
cd source/apps/guard/standalone
SERVICE_MANIFEST_PATH=../demo/manifest.yaml \
JUDGE_SERVER_URL=http://localhost:9300 \
UPSTREAM_URL=http://localhost:9100 \
REJECT_RESPONSE_URL=file://$(pwd)/../demo/forbidden.html \
PROXY_PORT=9200 \
deno task start
```

Before the demo policy can ever allow anything, seed the association it's
governed by (judge-server never bootstraps this from the manifest — some
other integration-level actor is expected to write it). Do it through the
`Policy.Registry` so the KV row layout stays private to `Policy.Registries.Kv`:

```sh
deno eval --unstable-kv "
import * as Access from '@idhn/access'
import * as Policy from '@idhn/policy'
const kv = await Deno.openKv('/tmp/judge-demo.db')
await new Policy.Registries.Kv(kv).associate(
  new Access.Action('demo.home.visit'),
  new Policy.Identifier('demo.home.visit'),
)
kv.close()
"
```

Then open in a browser:

- `http://localhost:9200/` — rejected (custom 403 page from `forbidden.html`,
  since the demo policy requires `?vip=true`).
- `http://localhost:9200/?vip=true` — allowed, proxied through to
  `fake-service`, which shows exactly what request it received.

Regenerate `policy.wasm` from `policy.rego` after editing it: `./build.sh`
(requires the `opa` CLI).
