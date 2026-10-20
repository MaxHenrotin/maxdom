// The dump has the shape of `wrangler d1 export`, so the restore command in the README works on it.
const sqlValue = (value) => {
  if (value === null) return 'NULL';
  if (typeof value === 'number') return String(value);
  return `'${String(value).replaceAll("'", "''")}'`;
};

// Tables come before indexes, in creation order. D1 keeps its own tables under _cf_.
const SCHEMA_SQL = `
  SELECT type, name, sql FROM sqlite_master
  WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite\\_%' ESCAPE '\\' AND name NOT LIKE '\\_cf\\_%' ESCAPE '\\'
  ORDER BY type = 'index', rowid`;

export async function exportDatabase(db, now) {
  const { results: objects } = await db.prepare(SCHEMA_SQL).all();
  const lines = ['PRAGMA defer_foreign_keys=TRUE;'];
  for (const { type, name, sql } of objects) {
    lines.push(`${sql};`);
    if (type !== 'table') continue;
    const { results } = await db.prepare(`SELECT * FROM "${name}"`).all();
    for (const row of results) {
      const columns = Object.keys(row).map((column) => `"${column}"`).join(',');
      lines.push(`INSERT INTO "${name}" (${columns}) VALUES(${Object.values(row).map(sqlValue).join(',')});`);
    }
  }
  return new Response(`${lines.join('\n')}\n`, {
    headers: {
      'content-type': 'application/sql; charset=utf-8',
      'content-disposition': `attachment; filename="sauvegarde-${now.slice(0, 10)}.sql"`,
    },
  });
}
