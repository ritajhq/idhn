import type { DatabaseSync } from 'node:sqlite'
import { Draft } from './draft.ts'
import { Revision } from './revision.ts'

/** A change based on a draft revision someone else has changed since. */
export class StaleDraftError extends Error {
  constructor(readonly basedOn: number, readonly current: number) {
    super(
      `The draft changed since you opened it (revision ${basedOn}, now ${current}): reload it and make your change again`,
    )
  }
}

/** A revision there is none of. */
export class UnknownRevisionError extends Error {}

/**
 * Where the console keeps the policy sources it owns, in SQLite: the one
 * draft everyone authors, and every revision published from it.
 */
export class Workspace {
  private constructor(private readonly db: DatabaseSync) {}

  /** The workspace kept in `db`, its tables created if they don't exist yet. */
  static open(db: DatabaseSync): Workspace {
    db.exec(`
      CREATE TABLE IF NOT EXISTS draft (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        document TEXT NOT NULL
      ) STRICT;
      CREATE TABLE IF NOT EXISTS revisions (
        number INTEGER PRIMARY KEY,
        published_at TEXT NOT NULL,
        published_by TEXT NOT NULL,
        draft_revision INTEGER NOT NULL,
        files TEXT NOT NULL
      ) STRICT;
    `)
    return new Workspace(db)
  }

  draft(): Draft {
    const row = this.db.prepare('SELECT document FROM draft WHERE id = 1').get()
    return row === undefined
      ? Draft.empty()
      : Draft.fromDocument(JSON.parse(String(row.document)))
  }

  /**
   * Applies `change` to the draft and saves it as its next revision, unless
   * the draft is no longer at revision `basedOn` (throws `StaleDraftError`).
   * Whatever `change` throws leaves the draft as it was.
   */
  edit(basedOn: number, change: (draft: Draft) => void): Draft {
    const draft = this.draft()
    if (draft.revision !== basedOn) {
      throw new StaleDraftError(basedOn, draft.revision)
    }
    change(draft)
    const saved = draft.next()
    this.db.prepare(
      `INSERT INTO draft (id, document) VALUES (1, ?)
       ON CONFLICT (id) DO UPDATE SET document = excluded.document`,
    ).run(JSON.stringify(saved.toDocument()))
    return saved
  }

  /** The number the next published revision takes. */
  nextRevisionNumber(): number {
    const row = this.db.prepare(
      'SELECT COALESCE(MAX(number), 0) + 1 AS next FROM revisions',
    ).get()
    return Number(row?.next ?? 1)
  }

  record(revision: Revision): void {
    this.db.prepare(
      `INSERT INTO revisions (number, published_at, published_by, draft_revision, files)
       VALUES (?, ?, ?, ?, ?)`,
    ).run(
      revision.number,
      revision.publishedAt.toISOString(),
      revision.publishedBy,
      revision.draftRevision,
      JSON.stringify(revision.files),
    )
  }

  /** Every revision published, newest first. */
  revisions(): Revision[] {
    return this.db.prepare('SELECT * FROM revisions ORDER BY number DESC')
      .all()
      .map((row) => this.revisionOf(row))
  }

  /** Throws `UnknownRevisionError`. */
  revision(number: number): Revision {
    const row = this.db.prepare('SELECT * FROM revisions WHERE number = ?')
      .get(number)
    if (row === undefined) {
      throw new UnknownRevisionError(`There is no revision r${number}`)
    }
    return this.revisionOf(row)
  }

  private revisionOf(row: Record<string, unknown>): Revision {
    return new Revision(
      Number(row.number),
      new Date(String(row.published_at)),
      String(row.published_by),
      Number(row.draft_revision),
      JSON.parse(String(row.files)),
    )
  }
}
