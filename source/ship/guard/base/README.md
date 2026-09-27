# guard/base

A base image for embedding guard directly in a service's own container, rather
than running it as a separate reverse-proxy process (see
`source/ship/guard/standalone/` for that model instead) or as a separately
deployed judge process. This is the shape a self-hostable, single-image tool
wants: one container, one image to distribute, no extra ports or processes for
an operator to configure.

Judge runs in-process here (composed by `apps/guard/embedded` itself, backed by
`Judge.Local`) — there's no `JUDGE_SERVER_URL` to set and no judge-server
container to run alongside it. Ships `/opt/guard/main.js` (built from
`apps/guard/embedded`, which wires `Guard` to that in-process judge) and
`/opt/guard/start-guard.sh`, with no `CMD`/`ENTRYPOINT` of its own. A consuming
Dockerfile:

```dockerfile
FROM guard/base:latest

# ... add your service ...

CMD ["sh", "-c", "/opt/guard/start-guard.sh && exec my-service"]
```

`start-guard.sh` launches guard in the background (`deno run ... &`) so the
consumer's own `CMD` can `exec` its service in the foreground as the container's
PID 1. Guard reads its config from the environment:

- `SERVICE_MANIFEST_PATH` — action-resolution manifest (required)
- `POLICY_BUNDLE_PATH` — the OPA policy bundle (required)
- `POLICY_REGISTRY_PATH` — YAML file associating actions with the policies that
  govern them (required)
- `POLICY_DATA_PATH` — JSON file loaded as Rego's `data` document, for
  slow-changing reference data such as allow-lists (optional)
- `ENRICHMENT_PATH` — YAML file declaring HTTP lookups run before policies are
  evaluated (optional; see `docs/project/overview.md`)
- `UPSTREAM_URL` — the protected service's own internal address (required —
  point this at wherever your service actually listens)
- `REJECT_RESPONSE_URL` — custom rejection body (optional)
- `PROXY_PORT` — the port guard listens on publicly (optional, default `8080`)

Like `source/apps/judge/server/`, the policy registry's action/policy
associations come from the file at `POLICY_REGISTRY_PATH`
(`Policy.Registries.File`): ship it with the embedding service.
