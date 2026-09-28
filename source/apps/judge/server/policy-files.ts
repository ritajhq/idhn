import * as Distribution from '@idhn/distribution'

/**
 * A policy set kept as files — the bundle, the registry, and optionally the
 * data and the enrichment lookups — read once, as they are when `read()` is
 * called. For a judge that isn't given its policies by a policy builder.
 */
export class PolicyFiles {
  constructor(
    private readonly bundlePath: string,
    private readonly registryPath: string,
    private readonly dataPath: string | undefined,
    private readonly enrichmentPath: string | undefined,
  ) {}

  async read(): Promise<Distribution.PolicySet> {
    return new Distribution.PolicySet(
      'files',
      await Deno.readFile(this.bundlePath),
      await Deno.readTextFile(this.registryPath),
      await this.readOptional(this.enrichmentPath),
      await this.readOptional(this.dataPath),
    )
  }

  private readOptional(path: string | undefined): Promise<string | undefined> {
    return path === undefined ? Promise.resolve(undefined) : Deno.readTextFile(path)
  }
}
