/**
 * Where a policy bundle's reference data (Rego's `data` document) lives — a
 * JSON file — or nowhere. `load()` yields a document either way, an empty one
 * when nothing is configured, so nothing downstream handles "no data".
 */
export class DataSource {
  constructor(private readonly path: string | URL | undefined) {}

  async load(): Promise<Record<string, unknown>> {
    if (this.path === undefined) {
      return {}
    }
    return JSON.parse(await Deno.readTextFile(this.path))
  }
}
