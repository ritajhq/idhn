/**
 * Gives the demo console its first policies: writes the tree in
 * `ci/demo/policies` into the console's draft, associates them as its
 * `policies.yaml` says, and publishes, through the console's own API. Until
 * then no policy governs the demo service's actions, so it answers 403. A
 * console whose draft already has policies is left as it is.
 *
 *   deno run -A ci/demo/seed.ts [console URL, default http://console.localhost]
 */
import { parse as parseYaml } from 'jsr:@std/yaml@^1'
import * as Contract from '@idhn/contract'
import * as Horizon from '@ritaj/horizon'
import { Client as HttpCourier } from '@ritaj/mux/client/http'

const TREE = new URL('./policies/', import.meta.url)
const TEST_SUFFIX = '_test.rego'

/** The demo's starting policy tree, as the policy builder takes it. */
class Tree {
  /** Each policy's source and tests, by file name without `.rego`. */
  async policies(): Promise<{ source: string; tests: string }[]> {
    const dir = new URL('./policies/', TREE)
    const policies = []
    for await (const entry of Deno.readDir(dir)) {
      if (!entry.name.endsWith('.rego') || entry.name.endsWith(TEST_SUFFIX)) continue
      const name = entry.name.slice(0, -'.rego'.length)
      policies.push({
        source: await Deno.readTextFile(new URL(entry.name, dir)),
        tests: await Deno.readTextFile(new URL(`${name}${TEST_SUFFIX}`, dir))
          .catch(() => ''),
      })
    }
    return policies
  }

  /** Action → the policies governing it. */
  async associations(): Promise<Record<string, string[]>> {
    const registry = parseYaml(
      await Deno.readTextFile(new URL('./policies.yaml', TREE)),
    ) as { associations: Record<string, string[]> }
    return registry.associations
  }
}

/** Writes a tree into the console's draft and publishes it. */
class Seeding {
  constructor(private readonly console: Horizon.Client, private readonly tree: Tree) {}

  async seed(): Promise<void> {
    let draft = await this.console.Ask(new Contract.Policies.Draft())
    if (draft.policies.length > 0) {
      console.log(`The console's draft already has policies (revision ${draft.revision}); nothing to seed.`)
      return
    }
    for (const { source, tests } of await this.tree.policies()) {
      draft = await this.console.Issue(new Contract.Policies.Write(draft.revision, source, tests))
    }
    for (const [action, policies] of Object.entries(await this.tree.associations())) {
      for (const policy of policies) {
        draft = await this.console.Issue(new Contract.Policies.Associate(draft.revision, action, policy))
      }
    }
    const revision = await this.console.Issue(new Contract.Policies.Publish())
    console.log(`Published ${revision.version}: ${draft.policies.length} policies.`)
  }
}

const origin = (Deno.args[0] ?? 'http://console.localhost').replace(/\/$/, '')
await new Seeding(
  new Horizon.Client(new HttpCourier(origin), { timeout: 90_000 }),
  new Tree(),
).seed()
