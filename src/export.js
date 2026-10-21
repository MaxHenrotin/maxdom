const sqlValue = (value) => {
  if (value === null) return 'NULL';
  if (typeof value === 'number') return String(value);
  return `'${String(value).replaceAll("'", "''")}'`;
};

// INSERT OR IGNORE, and user_id written as a lookup by email, let the file restore into any
// Maxdom database next to other accounts, whatever their ids, with `wrangler d1 execute`.
export async function exportAccount(db, user, now) {
  const mine = (sql) => db.prepare(sql).bind(user.id);
  // The shared rows the account relies on, then its own rows.
  const tables = [
    ['users', mine('SELECT email, created_at FROM users WHERE id = ?1')],
    ['shows', mine('SELECT s.* FROM shows s JOIN user_shows us ON us.show_id = s.id WHERE us.user_id = ?1')],
    ['episodes', mine('SELECT e.* FROM episodes e JOIN user_shows us ON us.show_id = e.show_id WHERE us.user_id = ?1')],
    ['books', db.prepare('SELECT * FROM books')],
    ['user_shows', mine('SELECT user_id, show_id, stopped, added_at FROM user_shows WHERE user_id = ?1')],
    ['watched', mine('SELECT user_id, episode_id, watched_at FROM watched WHERE user_id = ?1')],
    ['books_read', mine('SELECT user_id, book_id, read_at FROM books_read WHERE user_id = ?1')],
  ];
  const owner = `(SELECT id FROM users WHERE email = ${sqlValue(user.email)})`;
  const lines = [];
  for (const [table, statement] of tables) {
    const { results } = await statement.all();
    for (const row of results) {
      const columns = Object.keys(row).map((column) => `"${column}"`).join(',');
      const values = Object.entries(row).map(([column, value]) => (column === 'user_id' ? owner : sqlValue(value))).join(',');
      lines.push(`INSERT OR IGNORE INTO "${table}" (${columns}) VALUES(${values});`);
    }
  }
  return new Response(`${lines.join('\n')}\n`, {
    headers: {
      'content-type': 'application/sql; charset=utf-8',
      'content-disposition': `attachment; filename="sauvegarde-${now.slice(0, 10)}.sql"`,
    },
  });
}
