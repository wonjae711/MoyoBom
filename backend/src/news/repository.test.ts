import type pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestPool, testDatabaseUrl } from '../test/db.js';
import { insertCollectedArticles } from './repository.js';
import type { NormalizedArticle } from './types.js';

function article(link: string): NormalizedArticle {
  return {
    title: `기사 ${link}`,
    description: '요약',
    source: '한겨레',
    category: 'economy',
    originalLink: `https://www.hani.co.kr/${link}`,
    publishedAt: new Date('2026-10-01T12:00:00Z'),
  };
}

describe.skipIf(!testDatabaseUrl)('insertCollectedArticles (DB)', () => {
  let pool: pg.Pool;

  beforeAll(() => {
    pool = createTestPool();
  });
  beforeEach(async () => {
    await pool.query('TRUNCATE articles RESTART IDENTITY CASCADE');
  });
  afterAll(async () => {
    await pool.end();
  });

  it('기사를 api_collected로 저장하고 저장된 기사를 돌려준다', async () => {
    const saved = await insertCollectedArticles(pool, [article('a')]);

    expect(saved).toHaveLength(1);
    expect(saved[0]).toMatchObject({ ...article('a'), id: '1' });
    const { rows } = await pool.query('SELECT source_type, embedding FROM articles');
    expect(rows).toEqual([{ source_type: 'api_collected', embedding: null }]);
  });

  it('[예외] 이미 저장된 링크는 중복 저장하지 않고, 새 기사만 돌려준다', async () => {
    await insertCollectedArticles(pool, [article('a')]);
    const saved = await insertCollectedArticles(pool, [article('a'), article('b')]);

    expect(saved.map((a) => a.originalLink)).toEqual(['https://www.hani.co.kr/b']);
    const { rows } = await pool.query<{ count: string }>('SELECT count(*) FROM articles');
    expect(rows[0]?.count).toBe('2');
  });

  it('[예외] 한 번에 같은 링크가 두 번 들어와도 한 건만 저장한다', async () => {
    const saved = await insertCollectedArticles(pool, [article('a'), article('a')]);
    expect(saved).toHaveLength(1);
  });

  it('빈 목록이면 DB를 호출하지 않는다', async () => {
    expect(await insertCollectedArticles(pool, [])).toEqual([]);
  });
});
