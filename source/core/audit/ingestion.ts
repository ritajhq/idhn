import { MalformedLineError, parseLine } from './line.ts'
import type { Decision, Request } from './records.ts'
import type { Redaction } from './redaction.ts'
import type { Sqlite } from './stores/sqlite.ts'

/** What became of a batch of lines. */
export interface Report {
  /** Records kept for the first time. */
  readonly accepted: number
  /** Records kept before, delivered again. */
  readonly duplicates: number
  /** Lines of no concern to the audit (`guard.started`, say). */
  readonly ignored: number
  /** Audit lines that could not be read, by line number (from 1), and why. */
  readonly refused: readonly { line: number; reason: string }[]
}

/**
 * Takes a batch of log lines (NDJSON, as a log shipper sends them), reads
 * the audit records among them, redacts each decision's context, and keeps
 * them all at once. A line that can't be read is refused and reported,
 * without holding back the rest: one bad line must not cost the batch.
 */
export class Ingestion {
  constructor(
    private readonly store: Sqlite,
    private readonly redaction: Redaction,
  ) {}

  async ingest(batch: string): Promise<Report> {
    const records: (Request | Decision)[] = []
    const refused: { line: number; reason: string }[] = []
    let ignored = 0
    const lines = batch.split('\n')
    for (const [index, text] of lines.entries()) {
      if (text.trim() === '') continue
      try {
        const parsed = await parseLine(text)
        if (parsed.kind === 'ignored') ignored++
        if (parsed.kind === 'request') records.push(parsed.record)
        if (parsed.kind === 'decision') {
          records.push(this.redaction.apply(parsed.record))
        }
      } catch (error) {
        if (!(error instanceof MalformedLineError)) throw error
        refused.push({ line: index + 1, reason: error.message })
      }
    }
    const { appended, duplicates } = this.store.append(records)
    return { accepted: appended, duplicates, ignored, refused }
  }
}
