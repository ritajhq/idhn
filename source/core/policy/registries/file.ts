import { stringify as stringifyYaml } from '@std/yaml'
import type * as Access from '@idhn/access'
import type { Identifier } from '../identifier.ts'
import { Associations } from './associations.ts'
import type { Registry } from '../registry.ts'

/**
 * A `Registry` kept in a YAML file, keyed by action name:
 *
 *     associations:
 *       demo.home.visit:          # action name
 *         - demo.home.visit       # policies governing it
 *
 * The file is read once, by `load()`; lookups are answered from memory.
 * `associate` and `dissociate` write the whole file back, so changes survive
 * a restart but edits made to the file by hand while it runs do not reach it.
 */
export class File implements Registry {
  private constructor(
    private readonly path: string | URL,
    private readonly policiesByAction: Map<string, Identifier[]>,
  ) {}

  static async load(path: string | URL): Promise<File> {
    const text = await Deno.readTextFile(path)
    return new File(path, new Associations().parse(text))
  }

  async associate(action: Access.Action, policy: Identifier): Promise<void> {
    const policies = this.policiesByAction.get(action.name) ?? []
    if (policies.some((existing) => existing.equals(policy))) {
      return
    }
    this.policiesByAction.set(action.name, [...policies, policy])
    await this.save()
  }

  async dissociate(action: Access.Action, policy: Identifier): Promise<void> {
    const policies = this.policiesByAction.get(action.name)
    if (policies === undefined) {
      return
    }
    this.policiesByAction.set(
      action.name,
      policies.filter((existing) => !existing.equals(policy)),
    )
    await this.save()
  }

  // deno-lint-ignore require-await
  async findPoliciesFor(action: Access.Action): Promise<Identifier[]> {
    return this.policiesByAction.get(action.name) ?? []
  }

  private async save(): Promise<void> {
    const associations = Object.fromEntries(
      [...this.policiesByAction]
        .filter(([, policies]) => policies.length > 0)
        .map(([action, policies]) => [
          action,
          policies.map((policy) => policy.toString()),
        ]),
    )
    await Deno.writeTextFile(this.path, stringifyYaml({ associations }))
  }
}

