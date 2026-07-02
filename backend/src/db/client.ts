import Database from "better-sqlite3";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

/** Default on-disk database file (overridable via LIVESTAGE_DB, e.g. ":memory:" in tests). */
export const DB_PATH = process.env.LIVESTAGE_DB ?? join(here, "../../livestage.db");

/**
 * Opens the SQLite database, applies pragmas needed for safe local concurrent access
 * (foreign keys, WAL, a busy timeout so the poller and a portal write don't collide),
 * and creates the schema if it is missing.
 */
export function openDatabase(path: string = DB_PATH): Database.Database {
  const db = new Database(path);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.pragma("busy_timeout = 5000");
  const schema = readFileSync(join(here, "schema.sql"), "utf8");
  db.exec(schema);
  migrateStartIdempotencyKey(db);
  return db;
}

/**
 * Rebuilds start_idempotency if it still has the old global `key` PRIMARY KEY. The namespace is
 * per project (PRIMARY KEY (project_id, key) in schema.sql), but CREATE TABLE IF NOT EXISTS leaves
 * an existing local db on the old shape, and SQLite cannot alter a primary key in place.
 */
function migrateStartIdempotencyKey(db: Database.Database): void {
  const pkCols = db
    .prepare(`SELECT name FROM pragma_table_info('start_idempotency') WHERE pk > 0 ORDER BY pk`)
    .all() as { name: string }[];
  if (pkCols.length !== 1 || pkCols[0].name !== "key") return;

  db.transaction(() => {
    db.exec(`
      ALTER TABLE start_idempotency RENAME TO start_idempotency_old;
      CREATE TABLE start_idempotency (
        key TEXT NOT NULL,
        project_id TEXT NOT NULL,
        session_id TEXT NOT NULL,
        request_hash TEXT NOT NULL,
        created_at TEXT NOT NULL,
        PRIMARY KEY (project_id, key),
        FOREIGN KEY (session_id) REFERENCES activity_sessions(id)
      );
      INSERT INTO start_idempotency (key, project_id, session_id, request_hash, created_at)
        SELECT key, project_id, session_id, request_hash, created_at FROM start_idempotency_old;
      DROP TABLE start_idempotency_old;
    `);
  })();
}
