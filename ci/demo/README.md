# Demo

A protected service (`guard/fake-service`) behind the standalone guard, which
asks a separate judge-server for every decision. Only the guard is reachable,
through a gateway on `http://demo.localhost`; the judge-server stays on the
stack's internal network.

## Run it with ens

```sh
ens develop demo            # build, pack and run it, syncing app changes into the containers
ens deploy demo compose     # or: run it once, from published images
```

`ens develop` rebuilds an app when its source changes and restarts its container
with the new build. The gateway publishes port 80.

Then open in a browser:

- `http://demo.localhost/`: rejected, with the custom 403 page, since the demo
  policy requires `?vip=true`.
- `http://demo.localhost/?vip=true`: allowed and proxied through to
  `fake-service`, which shows exactly what request it received.

Each request logs one `guard.request` line (guard) and one `judge.decision` line
(judge), sharing a `decisionId`:

```sh
docker compose -p idhn-demo logs -f guard judge
```

The demo's configuration is baked into the images from their ship directories,
so editing it takes a re-pack (`ens develop` does one when it starts):

| File                                    | What it is                                               |
| --------------------------------------- | -------------------------------------------------------- |
| `source/ship/demo/guard/manifest.yaml`  | The service's actions: `home.visit` is `GET /`           |
| `source/ship/demo/guard/forbidden.html` | The 403 page                                             |
| `source/ship/demo/judge/policy.rego`    | `demo.home.visit` allows only when `vip == true`         |
| `source/ship/demo/judge/policy.wasm`    | The compiled bundle; regenerate with `./build.sh`        |
| `source/ship/demo/judge/policies.yaml`  | The policy registry: which policies govern which actions |

`build.sh` requires the `opa` CLI.

## Run it by hand

Useful when iterating on one app without packing images.

```sh
# terminal 1: the protected service
cd source/apps/guard/fake-service
PORT=9100 deno task start

# terminal 2: the judge server, holding the policy bundle and the policy
# registry (action -> policy associations)
cd source/apps/judge/server
POLICY_BUNDLE_PATH=../../../ship/demo/judge/policy.wasm \
POLICY_REGISTRY_PATH=../../../ship/demo/judge/policies.yaml \
JUDGE_PORT=9300 \
deno task start

# terminal 3: the standalone guard, pointed at the judge server, the demo's
# manifest (for action resolution) and its 403 page
cd source/apps/guard/standalone
SERVICE_MANIFEST_PATH=../../../ship/demo/guard/manifest.yaml \
JUDGE_SERVER_URL=http://localhost:9300 \
UPSTREAM_URL=http://localhost:9100 \
REJECT_RESPONSE_URL=file://$(pwd)/../../../ship/demo/guard/forbidden.html \
PROXY_PORT=9200 \
deno task start
```

Then browse `http://localhost:9200/` and `http://localhost:9200/?vip=true`.
