/**
 * Writes structured log entries as JSON Lines — one JSON object per line —
 * to stdout by default. Each entry is tagged with the `event` it records, so
 * a log shipper (Vector, Fluent Bit, the container runtime's log driver)
 * can filter and route entries without parsing anything else.
 *
 * Writing is synchronous and local on purpose: shipping entries to wherever
 * they are stored is the shipper's job, never this process's, so logging adds
 * no network I/O to the path it records.
 */
export class JsonLines {
  constructor(
    private readonly writeLine: (line: string) => void = console.log,
  ) {}

  write(event: string, fields: object): void {
    this.writeLine(JSON.stringify({ event, ...fields }))
  }

  /** Writes an error — typically one nothing else handled — as a single entry, stack trace included, instead of free-form text. */
  writeError(event: string, error: unknown): void {
    if (!(error instanceof Error)) {
      return this.write(event, { error: String(error) })
    }
    this.write(event, {
      error: error.message,
      name: error.constructor.name,
      stack: error.stack,
    })
  }
}
