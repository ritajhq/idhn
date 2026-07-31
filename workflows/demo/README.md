# demo workflow

Brings up `fake-service`, `judge-server`, and `guard-proxy` together via
Terraform + the `ritaj/dockercompose` provider — the same pattern
`workflows/deploy/` uses, minus the per-environment `contexts/` split (this
exists purely for local manual testing, not a real deployment target).

```sh
ens workflow demo --job up
ens workflow demo --job down
```

`up` builds and packs all three apps (`ens build`/`ens pack ... docker`),
applies `terraform/` (one `dockercompose_stack` on its own network:
`fake-service` on :9100, `judge-server` on :9300, `guard-proxy` on :9200),
and seeds `judge-server`'s KV-backed policy registry with the association
`source/apps/guard/demo`'s policy needs — judge-server never bootstraps this
itself (see `source/core/PLAN.md`'s Phase 4c), so without this step
`?vip=true` could never allow.

`down` runs `terraform destroy`. The `judge-kv` Docker volume survives
teardown by default (`dockercompose_stack`'s `remove_volumes_on_destroy` is
left at its default `false`) — harmless, since the seed step is idempotent
and a fresh `up` just reuses or re-seeds it.

Both jobs must be run with an explicit `--job` — `up` and `down` have no
`needs:` relationship between them, so a bare `ens workflow demo` would run
both concurrently.

`terraform/` bind-mounts `source/apps/guard/demo/` (manifest, policy
bundle, 403 page) read-only into the containers that need it, so editing
those fixtures doesn't require rebuilding an image — only source changes to
the apps themselves do.
