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
  return db;
}
