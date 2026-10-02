import type pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestPool, testDatabaseUrl } from '../test/db.js';
import { compareFeed, decodeCursor, encodeCursor, listFeed, type FeedArticle } from './feed.js';

function feedArticle(id: string, publishedAt: string): FeedArticle {
  return { id, title: id, description: '', source: 's', category: 'economy', originalLink: `https://e.com/${id}`, publishedAt };
}

describe('피드 커서·정렬', () => {
  it('커서를 문자열로 바꿨다가 그대로 되돌린다', () => {
    const article = feedArticle('42', '2026-10-01T12:00:00.000Z');
    expect(decodeCursor(encodeCursor(article))).toEqual({
      publishedAt: new Date('2026-10-01T12:00:00.000Z'),
      id: '42',
    });
  });

  it.each(['', 'abc', '2026-10-01_', 'not-a-date_5'])('형식이 틀린 커서(%s)는 null', (cursor) => {
    expect(decodeCursor(cursor)).toBeNull();
  });

  it('최신순, 같은 시각이면 id 큰 순으로 정렬한다', () => {
    const list = [
      feedArticle('1', '2026-10-01T10:00:00.000Z'),
      feedArticle('3', '2026-10-01T12:00:00.000Z'),
      feedArticle('2', '2026-10-01T12:00:00.000Z'),
    ];
    expect(list.sort(compareFeed).map((a) => a.id)).toEqual(['3', '2', '1']);
  });
});

describe.skipIf(!testDatabaseUrl)('listFeed (DB)', () => {
  let pool: pg.Pool;

  async function insert(link: string, publishedAt: string, extra: { category?: string; sourceType?: string } = {}) {
    await pool.query(
      `INSERT INTO articles (title, source, category, original_link, source_type, published_at)
       VALUES ($1, 's', $2, $3, $4, $5)`,
      [link, extra.category ?? 'economy', `https://e.com/${link}`, extra.sourceType ?? 'api_collected', publishedAt],
    );
  }

  beforeAll(() => {
    pool = createTestPool();
  });
  beforeEach(async () => {
    await pool.query('TRUNCATE articles RESTART IDENTITY');
  });
  afterAll(async () => {
    await pool.end();
  });

  it('최신순으로 limit만큼 주고, 남은 기사가 있으면 커서를 준다', async () => {
    await insert('old', '2026-10-01T09:00:00Z');
    await insert('mid', '2026-10-01T10:00:00Z');
    await insert('new', '2026-10-01T11:00:00Z');

    const page = await listFeed(pool, { limit: 2 });
    expect(page.articles.map((a) => a.title)).toEqual(['new', 'mid']);
    expect(page.nextCursor).not.toBeNull();

    const next = await listFeed(pool, { limit: 2, before: decodeCursor(page.nextCursor!)! });
    expect(next.articles.map((a) => a.title)).toEqual(['old']);
    expect(next.nextCursor).toBeNull();
  });

  it('발행 시각이 같은 기사도 페이지 경계에서 빠지거나 겹치지 않는다', async () => {
    for (const link of ['a', 'b', 'c']) await insert(link, '2026-10-01T10:00:00Z');

    const first = await listFeed(pool, { limit: 2 });
    const second = await listFeed(pool, { limit: 2, before: decodeCursor(first.nextCursor!)! });
    const titles = [...first.articles, ...second.articles].map((a) => a.title);
    expect(titles.sort()).toEqual(['a', 'b', 'c']);
  });

  it('카테고리로 거를 수 있다', async () => {
    await insert('econ', '2026-10-01T10:00:00Z', { category: 'economy' });
    await insert('sport', '2026-10-01T11:00:00Z', { category: 'sports' });
    const page = await listFeed(pool, { limit: 10, category: 'sports' });
    expect(page.articles.map((a) => a.title)).toEqual(['sport']);
  });

  it('사용자가 링크로 추가한 기사(user_submitted)는 피드에 넣지 않는다', async () => {
    await insert('api', '2026-10-01T10:00:00Z');
    await insert('user', '2026-10-01T11:00:00Z', { sourceType: 'user_submitted' });
    const page = await listFeed(pool, { limit: 10 });
    expect(page.articles.map((a) => a.title)).toEqual(['api']);
  });
});
