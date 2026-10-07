/** The version of the audit line format a line was written in. */
export const SCHEMA = 1

/** Which process wrote an audit line. */
export interface Source {
  readonly app: string
  /** The manifest id of the resource it guards, for a guard. */
  readonly resource?: string
  /** Which one of its replicas: its host name, unless configured. */
  readonly instance: string
}

/**
 * The fields every audit line carries beside its record: a `recordId`, so a
 * line delivered twice is kept once; the `schema` it was written in; and its
 * `source`. Handed to `Log.JsonLines` as its stamp.
 */
export class Stamp {
  constructor(private readonly source: Source) {}

  fields = (): { recordId: string; schema: number; source: Source } => ({
    recordId: crypto.randomUUID(),
    schema: SCHEMA,
    source: this.source,
  })
}
