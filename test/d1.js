import { readdirSync, readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

// An in-memory database with the schema built by the real migrations.
export function migratedDatabase() {
  const sqlite = new DatabaseSync(':memory:');
  for (const file of readdirSync('migrations').sort()) sqlite.exec(readFileSync(`migrations/${file}`, 'utf8'));
  return sqlite;
}

// Stand-in for the D1 binding, with user 1, the owner most tests act as.
export function createD1() {
  const sqlite = migratedDatabase();
  sqlite.exec("INSERT INTO users (id, email, created_at) VALUES (1, 'owner@example.com', 'x')");
  const statement = (sql, args = []) => ({
    bind: (...values) => statement(sql, values),
    all: async () => ({ results: sqlite.prepare(sql).all(...args) }),
    first: async () => sqlite.prepare(sql).get(...args) ?? null,
    run: async () => ({ meta: { changes: Number(sqlite.prepare(sql).run(...args).changes) } }),
  });
  return {
    prepare: (sql) => statement(sql),
    batch: async (statements) => {
      for (const s of statements) await s.run();
    },
  };
}
