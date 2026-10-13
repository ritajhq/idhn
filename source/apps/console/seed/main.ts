/**
 * Gives a console its first policies: writes a policy tree (as the policy
 * builder takes it) into the console's draft, associates them as its
 * `policies.yaml` says, writes the lookups its `enrichment.yaml` declares,
 * each providing to the policies its `provides_to` names, and publishes,
 * through the console's own API. A console whose draft already has policies
 * is left as it is.
 *
 * A lookup's `actions` are not read: the console makes each for every
 * action the policies it provides to govern. So every lookup must say
 * `provides_to`, or nothing is seeded. The tree's `data.json` is not
 * written: the console has no command for it.
 *
 *   deno run -A source/apps/console/seed/main.ts <console URL> <tree>
 *
 * The demo's, with no one signing in:
 *
 *   deno run -A source/apps/console/seed/main.ts http://console.localhost ci/demo/policies
 *
 * Behind a guard that authenticates by session cookie, present an operator's
 * session as `CONSOLE_COOKIE=<name>=<value>`: the guard judges every call
 * like any other, and the revision is published in that operator's name.
 */
import { parse as parseYaml } from '@std/yaml'
import { resolve, toFileUrl } from '@std/path'
import * as Contract from '@idhn/contract'
import * as Horizon from '@ritaj/horizon'
import * as MUX from '@ritaj/mux'
import { Client as HttpCourier } from '@ritaj/mux/client/http'

const TEST_SUFFIX = '_test.rego'

/** One lookup as `enrichment.yaml` declares it. */
interface DeclaredLookup {
  as: string
  http: { url: string }
  ttl_seconds?: number
  timeout_ms?: number
  optional?: boolean
  provides_to?: string[]
}

/** A policy tree on disk, as the policy builder takes it. */
class Tree {
  constructor(private readonly root: URL) {}

  /** Each policy's source and tests, by file name without `.rego`. */
  async policies(): Promise<{ source: string; tests: string }[]> {
    const dir = new URL('./policies/', this.root)
    const policies = []
    for await (const entry of Deno.readDir(dir)) {
      if (!entry.name.endsWith('.rego') || entry.name.endsWith(TEST_SUFFIX)) {
        continue
      }
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
      await Deno.readTextFile(new URL('./policies.yaml', this.root)),
    ) as { associations: Record<string, string[]> }
    return registry.associations
  }

  /** The lookups `enrichment.yaml` declares; none without one. Throws when one doesn't say who it provides to. */
  async lookups(): Promise<DeclaredLookup[]> {
    let text: string
    try {
      text = await Deno.readTextFile(new URL('./enrichment.yaml', this.root))
    } catch (error) {
      if (error instanceof Deno.errors.NotFound) return []
      throw error
    }
    const lookups =
      (parseYaml(text) as { lookups?: DeclaredLookup[] } | null)?.lookups ?? []
    const unprovided = lookups.filter((lookup) => !lookup.provides_to?.length)
      .map((lookup) => lookup.as)
    if (unprovided.length > 0) {
      throw new Error(
        `enrichment.yaml: ${
          unprovided.join(', ')
        } must say provides_to: the policies whose actions each is made for`,
      )
    }
    return lookups
  }
}

/** Writes a tree into the console's draft and publishes it. */
class Seeding {
  constructor(
    private readonly console: Horizon.Client,
    private readonly tree: Tree,
  ) {}

  async seed(): Promise<void> {
    let draft = await this.console.Ask(new Contract.Policies.Draft())
    if (draft.policies.length > 0) {
      console.log(
        `The console's draft already has policies (revision ${draft.revision}); nothing to seed.`,
      )
      return
    }
    const lookups = await this.tree.lookups()
    for (const { source, tests } of await this.tree.policies()) {
      draft = await this.console.Issue(
        new Contract.Policies.Write(draft.revision, source, tests),
      )
    }
    for (
      const [action, policies] of Object.entries(await this.tree.associations())
    ) {
      for (const policy of policies) {
        draft = await this.console.Issue(
          new Contract.Policies.Associate(draft.revision, action, policy),
        )
      }
    }
    for (const lookup of lookups) {
      draft = await this.console.Issue(
        new Contract.Lookups.Write(draft.revision, {
          name: lookup.as,
          url: lookup.http.url,
          ttlSeconds: lookup.ttl_seconds ?? 0,
          timeoutMs: lookup.timeout_ms,
          optional: lookup.optional ?? false,
        }),
      )
      for (const policy of lookup.provides_to ?? []) {
        draft = await this.console.Issue(
          new Contract.Lookups.Provide(draft.revision, lookup.as, policy),
        )
      }
    }
    const revision = await this.console.Issue(new Contract.Policies.Publish())
    console.log(
      `Published ${revision.version}: ${draft.policies.length} policies, ${draft.lookups.length} lookups.`,
    )
  }
}

const [origin, tree] = Deno.args
if (origin === undefined || tree === undefined) {
  console.error(
    'Usage: deno run -A source/apps/console/seed/main.ts <console URL> <tree>',
  )
  Deno.exit(2)
}

const courier = new HttpCourier(origin.replace(/\/$/, ''))
const session = Deno.env.get('CONSOLE_COOKIE')
if (session !== undefined) {
  const at = session.indexOf('=')
  courier.Carry(
    new MUX.Credentials.Cookie(session.slice(0, at), session.slice(at + 1)),
  )
}

await new Seeding(
  new Horizon.Client(courier, { timeout: 90_000 }),
  new Tree(toFileUrl(resolve(tree) + '/')),
).seed()
