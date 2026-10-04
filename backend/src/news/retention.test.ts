import type pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { BoardService } from '../boards/service.js';
import { createTestPool, testDatabaseUrl } from '../test/db.js';
import { createArticle, createUser, resetDb } from '../test/fixtures.js';
import { deleteStaleArticles } from './retention.js';

describe.skipIf(!testDatabaseUrl)('미사용 기사 30일 정리 (DB, F-01 처리 로직 7)', () => {
  let pool: pg.Pool;
  const daysAgo = (n: number) => new Date(Date.now() - n * 24 * 60 * 60 * 1000);

  beforeAll(() => {
    pool = createTestPool();
  });
  beforeEach(async () => {
    await resetDb(pool);
  });
  afterAll(async () => {
    await pool.end();
  });

  it('30일 지난 수집 기사 중 보드에 올라가지 않은 것만 지운다', async () => {
    const old = await createArticle(pool, '오래됨', daysAgo(31));
    const recent = await createArticle(pool, '최근', daysAgo(29));
    const oldOnBoard = await createArticle(pool, '오래됐지만 보드에 있음', daysAgo(40));

    const userId = await createUser(pool, '기자');
    const boards = new BoardService(pool);
    const board = await boards.createBoard(userId, '보드');
    await boards.addItem(board.id, userId, { type: 'article', articleId: oldOnBoard, x: 0, y: 0 });

    expect(await deleteStaleArticles(pool)).toBe(1);
    const { rows } = await pool.query<{ id: string }>('SELECT id FROM articles ORDER BY id');
    expect(rows.map((r) => r.id)).toEqual([recent, oldOnBoard]);
    expect(rows.map((r) => r.id)).not.toContain(old);
  });

  it('[C-06] 링크로 추가한 기사도 어떤 보드에도 없게 된 지 30일이 지나면 지운다', async () => {
    const userId = await createUser(pool, '기자');
    const insert = (link: string) =>
      pool
        .query<{ id: string }>(
          `INSERT INTO articles (title, source, original_link, source_type, submitted_by, created_at)
           VALUES ($1, 's', $1, 'user_submitted', $2, $3) RETURNING id`,
          [link, userId, daysAgo(31)],
        )
        .then((r) => r.rows[0]!.id);
    await insert('https://e.com/orphan');
    const kept = await insert('https://e.com/on-board');
    const boards = new BoardService(pool);
    const board = await boards.createBoard(userId, '보드');
    await boards.addItem(board.id, userId, { type: 'article', articleId: kept, x: 0, y: 0 }, { allowSubmitted: true });

    expect(await deleteStaleArticles(pool)).toBe(1);
    const { rows } = await pool.query<{ id: string }>('SELECT id FROM articles');
    expect(rows.map((r) => r.id)).toEqual([kept]);
  });
});
