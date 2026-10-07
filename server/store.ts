import { DatabaseSync } from 'node:sqlite';
import { validateDocument } from '../src/core.ts';
import type { Document, Revision, SavedDocument } from '../src/core.ts';

export class ConflictError extends Error {
  currentRevision: number;
  constructor(currentRevision: number) {
    super(
      `A newer version (${currentRevision}) was saved elsewhere. Reload the saved version before saving again.`,
    );
    this.currentRevision = currentRevision;
  }
}

export class RevisionStore {
  private db: DatabaseSync;
  constructor(path: string) {
    this.db = new DatabaseSync(path);
    this.db.exec(`PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;
      CREATE TABLE IF NOT EXISTS revisions (
        revision INTEGER PRIMARY KEY,
        saved_at TEXT NOT NULL,
        name TEXT NOT NULL,
        cue_count INTEGER NOT NULL,
        snapshot TEXT NOT NULL
      );`);
  }
  get(revision?: number): SavedDocument | null {
    const row = (
      revision === undefined
        ? this.db
            .prepare(
              'SELECT revision, saved_at, snapshot FROM revisions ORDER BY revision DESC LIMIT 1',
            )
            .get()
        : this.db
            .prepare('SELECT revision, saved_at, snapshot FROM revisions WHERE revision = ?')
            .get(revision)
    ) as { revision: number; saved_at: string; snapshot: string } | undefined;
    return row
      ? { ...JSON.parse(row.snapshot), revision: row.revision, savedAt: row.saved_at }
      : null;
  }
  history(): Revision[] {
    return this.db
      .prepare(
        'SELECT revision, saved_at AS savedAt, name, cue_count AS cueCount FROM revisions ORDER BY revision DESC LIMIT 50',
      )
      .all() as Revision[];
  }
  save(document: Document, expectedRevision: number): SavedDocument {
    validateDocument(document);
    if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0)
      throw new Error('A non-negative expected revision is required.');
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const current = this.db
        .prepare('SELECT COALESCE(MAX(revision), 0) AS revision FROM revisions')
        .get() as { revision: number };
      if (current.revision !== expectedRevision) throw new ConflictError(current.revision);
      const revision = current.revision + 1;
      const savedAt = new Date().toISOString();
      // Normalize the top-level shape so arbitrary client fields never enter storage.
      const clean: Document = {
        name: document.name.trim(),
        cues: document.cues.map(({ id, start, end, text, identifier, settings }) => ({
          id,
          start,
          end,
          text,
          ...(identifier ? { identifier } : {}),
          ...(settings ? { settings } : {}),
        })),
      };
      this.db
        .prepare(
          'INSERT INTO revisions (revision, saved_at, name, cue_count, snapshot) VALUES (?, ?, ?, ?, ?)',
        )
        .run(revision, savedAt, clean.name, clean.cues.length, JSON.stringify(clean));
      this.db.exec('COMMIT');
      return { ...clean, revision, savedAt };
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }
  close(): void {
    this.db.close();
  }
}
