type SqlJsDatabase = import('sql.js').Database;

export interface Migration {
  version: number;
  description: string;
  up: (db: SqlJsDatabase) => void;
}

export const MIGRATIONS: Migration[] = [
  {
    version: 1,
    description: 'Create todos table',
    up: (db) => {
      db.run(`
        CREATE TABLE IF NOT EXISTS todos (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          title TEXT NOT NULL,
          done INTEGER DEFAULT 0,
          created_at TEXT DEFAULT (datetime('now'))
        )
      `);
    },
  },
  {
    version: 2,
    description: 'Add priority column to todos',
    up: (db) => {
      db.run('ALTER TABLE todos ADD COLUMN priority INTEGER DEFAULT 0');
    },
  },
];

export function getDbVersion(db: SqlJsDatabase): number {
  const result = db.exec('PRAGMA user_version');
  return (result[0]?.values[0]?.[0] as number) ?? 0;
}

export interface MigrationResult {
  fromVersion: number;
  toVersion: number;
  applied: Pick<Migration, 'version' | 'description'>[];
}

export function runMigrations(db: SqlJsDatabase): MigrationResult {
  const fromVersion = getDbVersion(db);

  const pending = MIGRATIONS
    .filter((m) => m.version > fromVersion)
    .sort((a, b) => a.version - b.version);

  const applied: Pick<Migration, 'version' | 'description'>[] = [];

  for (const migration of pending) {
    try {
      db.run('BEGIN TRANSACTION');
      migration.up(db);
      db.run(`PRAGMA user_version = ${migration.version}`);
      db.run('COMMIT');
      applied.push({ version: migration.version, description: migration.description });
      console.log(`[migration] v${migration.version}: ${migration.description}`);
    } catch (err) {
      db.run('ROLLBACK');
      throw new Error(
        `Migration v${migration.version} (${migration.description}) failed: ${err instanceof Error ? err.message : err}`
      );
    }
  }

  return {
    fromVersion,
    toVersion: getDbVersion(db),
    applied,
  };
}
