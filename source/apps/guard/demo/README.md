# Manual end-to-end demo

Run the fake protected service, the judge server, and the guard proxy
together, then browse through the proxy to see it work. The judge server is
never exposed publicly — only the guard proxy talks to it.

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

# terminal 3 — the proxy, pointed at the judge server, this demo's
# manifest (for action resolution), and its 403 page
cd source/apps/guard/proxy
SERVICE_MANIFEST_PATH=../demo/manifest.yaml \
JUDGE_SERVER_URL=http://localhost:9300 \
UPSTREAM_URL=http://localhost:9100 \
REJECT_RESPONSE_URL=file://$(pwd)/../demo/forbidden.html \
PROXY_PORT=9200 \
deno task start
```

Before the demo policy can ever allow anything, seed the association it's
governed by (judge-server never bootstraps this from the manifest — some
other integration-level actor is expected to write it into KV):

```sh
deno eval --unstable-kv "
const kv = await Deno.openKv('/tmp/judge-demo.db')
await kv.set(['policies', 'demo.home.visit', 'demo.home.visit'], true)
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
