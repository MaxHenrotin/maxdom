import { describe, expect, it } from 'vitest';
import { upsertShowStatements } from '../src/db.js';
import { createD1 } from './d1.js';

const show = { id: 7, name: 'Show', status: 'Running', image_url: null, premiered_year: 2020, tvmaze_updated: 1 };
const episode = (id, number) => ({ id, show_id: 7, season: 1, number, name: `E${number}`, airstamp: '2020-01-01', runtime: 30 });

describe('upsertShowStatements', () => {
  it('writes any number of episodes in the same four statements', async () => {
    const db = createD1();
    const episodes = Array.from({ length: 220 }, (_, i) => episode(i + 1, i + 1));
    const statements = upsertShowStatements(db, show, episodes);
    expect(statements).toHaveLength(4);

    await db.batch(statements);

    const { results } = await db.prepare('SELECT * FROM episodes WHERE id IN (1, 220) ORDER BY id').all();
    expect(results).toEqual([
      { id: 1, show_id: 7, season: 1, number: 1, name: 'E1', airstamp: '2020-01-01', runtime: 30 },
      { id: 220, show_id: 7, season: 1, number: 220, name: 'E220', airstamp: '2020-01-01', runtime: 30 },
    ]);
  });

  it('removes episodes TVmaze no longer lists, with their watched rows', async () => {
    const db = createD1();
    await db.batch(upsertShowStatements(db, show, [episode(1, 1), episode(2, 2)]));
    await db.prepare("INSERT INTO watched VALUES (1, 2, 'x')").run();

    await db.batch(upsertShowStatements(db, show, [episode(1, 1), episode(3, 2)]));

    const { results: episodes } = await db.prepare('SELECT id FROM episodes ORDER BY id').all();
    expect(episodes.map((ep) => ep.id)).toEqual([1, 3]);
    expect((await db.prepare('SELECT COUNT(*) AS n FROM watched').first()).n).toBe(0);
  });
});
