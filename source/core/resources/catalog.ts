import type { DatabaseSync } from 'node:sqlite'
import { Resource } from './resource.ts'

/** The resources imported so far, one per manifest id, kept in SQLite. */
export class Catalog {
  private constructor(private readonly db: DatabaseSync) {}

  /** The catalog kept in `db`, its table created if it doesn't exist yet. */
  static open(db: DatabaseSync): Catalog {
    db.exec(`
      CREATE TABLE IF NOT EXISTS resources (
        id TEXT PRIMARY KEY,
        document TEXT NOT NULL
      ) STRICT
    `)
    return new Catalog(db)
  }

  /** Keeps `resource`, replacing what was imported before under its id. */
  save(resource: Resource): void {
    this.db.prepare(
      `INSERT INTO resources (id, document) VALUES (?, ?)
       ON CONFLICT (id) DO UPDATE SET document = excluded.document`,
    ).run(resource.id, JSON.stringify(resource.toDocument()))
  }

  all(): Resource[] {
    return this.db.prepare('SELECT document FROM resources ORDER BY id')
      .all()
      .map((row) => Resource.fromDocument(JSON.parse(String(row.document))))
  }

  find(id: string): Resource | undefined {
    const row = this.db.prepare('SELECT document FROM resources WHERE id = ?')
      .get(id)
    return row === undefined
      ? undefined
      : Resource.fromDocument(JSON.parse(String(row.document)))
  }

  remove(id: string): void {
    this.db.prepare('DELETE FROM resources WHERE id = ?').run(id)
  }
}
