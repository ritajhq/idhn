/** Where named settings come from (process environment variables, in practice), so the reader never touches a runtime global and tests can supply a lightweight fake. `Deno.env` satisfies it as is. */
export interface Source {
  get(name: string): string | undefined
}
