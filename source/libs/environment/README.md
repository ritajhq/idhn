# @idhn/environment

Reads and validates named settings (environment variables, in practice) without
depending on any runtime. The `Reader` takes a `Source` — anything with
`get(name): string | undefined` — so the entry point of each app decides where
values come from (`Deno.env`, a plain object in a test) and nothing in here
touches a runtime global.

```ts
import * as Environment from '@idhn/environment'

const environment = new Environment.Reader(Deno.env)

environment.requireString('MANIFEST_PATH') // throws if unset or empty
environment.optionalString('KV_PATH') // undefined if unset or empty
environment.requireUrl('UPSTREAM_URL') // a URL, throws if unset or malformed
environment.optionalUrl('REJECT_URL') // a URL or undefined
environment.port('PROXY_PORT', 8080) // 1–65535, the fallback if unset
```

An empty value counts as unset. A missing or malformed value throws
`Environment.InvalidError`, naming the setting.

The reader knows nothing about any app's settings. Each app describes its own in
a small class that names the variables and defaults, and builds its typed
configuration from a `Reader` (see `source/apps/*/config.ts`).
