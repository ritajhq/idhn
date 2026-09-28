import { join } from '@std/path'

/**
 * A directory of policy sources, laid out as
 *
 *     policies/*.rego    the policies, one per package; `package portal.admin`
 *                        is the policy a registry names `portal.admin`, and
 *                        `*_test.rego` files are their tests
 *     policies.yaml      which policies govern which actions
 *     enrichment.yaml    optional: the lookups a judge makes before evaluating
 *     data.json          optional: Rego's `data` document
 *
 * and the `version` it was taken at (a commit, a content hash), carried
 * through to the judges for people reading their logs.
 */
export class SourceTree {
  constructor(readonly dir: string, readonly version: string) {}

  get policiesDir(): string {
    return join(this.dir, 'policies')
  }

  get registryPath(): string {
    return join(this.dir, 'policies.yaml')
  }

  get enrichmentPath(): string {
    return join(this.dir, 'enrichment.yaml')
  }

  get dataPath(): string {
    return join(this.dir, 'data.json')
  }
}
