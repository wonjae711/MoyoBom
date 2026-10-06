import type pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestPool, testDatabaseUrl } from '../test/db.js';
import { compareFeed, decodeCollectedCursor, decodeCursor, encodeCursor, listFeed, listSources, searchTerms, type FeedArticle } from './feed.js';

function feedArticle(id: string, publishedAt: string): FeedArticle {
  return { id, title: id, description: '', source: 's', category: 'economy', originalLink: `https://e.com/${id}`, publishedAt, collectedAt: publishedAt };
}

describe('[F-04] 검색어 나누기', () => {
  it('띄어쓰기·쉼표로 나누고 최대 5개까지', () => {
    expect(searchTerms(' 수출 규제,  호르무즈 ')).toEqual(['수출', '규제', '호르무즈'])
    expect(searchTerms('a b c d e f g')).toHaveLength(5)
    expect(searchTerms(undefined)).toEqual([])
  })
})

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
    await pool.query('TRUNCATE articles RESTART IDENTITY CASCADE');
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

  /** 수집 시각을 지정해 넣는다 (created_at 기본값 now()는 한 트랜잭션 안에서 모두 같다) */
  async function insertCollected(link: string, publishedAt: string, createdAt: string) {
    await pool.query(
      `INSERT INTO articles (title, source, category, original_link, source_type, published_at, created_at)
       VALUES ($1, 's', 'economy', $2, 'api_collected', $3, $4)`,
      [link, `https://e.com/${link}`, publishedAt, createdAt],
    );
  }

  async function catchUp(from: string, limit: number) {
    const titles: string[] = [];
    let cursor: string | null = from;
    for (let i = 0; cursor && i < 20; i++) {
      const page = await listFeed(pool, { limit, collectedAfter: decodeCollectedCursor(cursor)! });
      titles.push(...page.articles.map((a) => a.title));
      if (!page.nextCursor) return { titles, last: page.collectedCursor, pages: i + 1 };
      cursor = page.nextCursor;
    }
    throw new Error('끝나지 않음');
  }

  it('[C-10] 처음 조회 때 받은 수집 위치 뒤에 수집된 기사를, 발행 시각이 오래됐어도 빠짐없이 준다', async () => {
    await insertCollected('seen', '2026-10-01T10:00:00Z', '2026-10-01T10:01:00Z');
    const first = await listFeed(pool, { limit: 30 });
    expect(first.collectedCursor).toMatch(/^\d+_\d+$/);

    // 끊긴 동안: 새 기사 40개 + 발행은 오래됐지만 늦게 수집된 기사 1개
    for (let i = 0; i < 40; i++) {
      await insertCollected(`new-${i}`, '2026-10-01T11:00:00Z', `2026-10-01T11:00:${String(i).padStart(2, '0')}.5Z`);
    }
    await insertCollected('late', '2026-09-30T08:00:00Z', '2026-10-01T11:01:00Z');

    const { titles, last } = await catchUp(first.collectedCursor!, 15);
    expect(titles).toHaveLength(41);
    expect(titles).toContain('late');
    expect(titles).not.toContain('seen');
    // 다 받은 뒤 위치에서 다시 물으면 아무것도 없다
    expect((await listFeed(pool, { limit: 15, collectedAfter: decodeCollectedCursor(last!)! })).articles).toEqual([]);
  });

  it('[C-10] 한 번에 저장돼 수집 시각이 마이크로초까지 같은 기사가 페이지보다 많아도 반복 없이 끝난다', async () => {
    await pool.query(
      `INSERT INTO articles (title, source, category, original_link, source_type, published_at)
       SELECT 'batch-' || g, 's', 'economy', 'https://e.com/batch-' || g, 'api_collected', '2026-10-01T11:00:00Z'
       FROM generate_series(1, 25) g`,
    );
    const { titles, pages } = await catchUp('0_0', 10);
    expect(new Set(titles).size).toBe(25);
    expect(titles).toHaveLength(25);
    expect(pages).toBe(3);
  });

  /** 검색용: 제목·요약·언론사·카테고리·발행 시각을 정해 넣는다 */
  async function insertFull(title: string, opts: { description?: string; source?: string; category?: string; publishedAt?: string } = {}) {
    await pool.query(
      `INSERT INTO articles (title, description, source, category, original_link, source_type, published_at)
       VALUES ($1, $2, $3, $4, $5, 'api_collected', $6)`,
      [title, opts.description ?? '', opts.source ?? '한겨레', opts.category ?? 'economy', `https://e.com/${encodeURIComponent(title)}`, opts.publishedAt ?? '2026-10-01T10:00:00Z'],
    );
  }
  const titles = (page: { articles: { title: string }[] }) => page.articles.map((a) => a.title).sort();

  it('[F-04] 검색어의 낱말이 모두 제목이나 요약에 들어 있는 기사만 찾는다 (영문 대소문자 무시)', async () => {
    await insertFull('반도체 수출 규제 확대', { description: '장비 통제' });
    await insertFull('반도체 실적 호조');
    await insertFull('수출 감소', { description: '반도체 부진' });
    await insertFull('AI 칩 경쟁');
    expect(titles(await listFeed(pool, { limit: 10, q: '반도체' }))).toEqual(['반도체 수출 규제 확대', '반도체 실적 호조', '수출 감소']);
    expect(titles(await listFeed(pool, { limit: 10, q: '반도체 수출' }))).toEqual(['반도체 수출 규제 확대', '수출 감소']);
    expect(titles(await listFeed(pool, { limit: 10, q: 'ai' }))).toEqual(['AI 칩 경쟁']);
    expect((await listFeed(pool, { limit: 10, q: '없는말' })).articles).toEqual([]);
  })

  it('[F-04] %·_ 같은 검색 기호는 글자 그대로 찾는다', async () => {
    await insertFull('금리 0.5%p 인상');
    await insertFull('금리 동결');
    expect(titles(await listFeed(pool, { limit: 10, q: '%' }))).toEqual(['금리 0.5%p 인상']);
    expect((await listFeed(pool, { limit: 10, q: '_' })).articles).toEqual([]);
  })

  it('[F-04] 카테고리·언론사·기간을 함께 걸러 내고, 검색어 없이 필터만 써도 된다', async () => {
    await insertFull('A', { source: '한겨레', category: 'economy', publishedAt: '2026-10-01T10:00:00Z' });
    await insertFull('B', { source: '조선일보', category: 'economy', publishedAt: '2026-10-02T10:00:00Z' });
    await insertFull('C', { source: '한겨레', category: 'sports', publishedAt: '2026-10-03T10:00:00Z' });
    await insertFull('D', { source: '한겨레', category: 'economy', publishedAt: '2026-10-05T10:00:00Z' });
    const page = await listFeed(pool, {
      limit: 10,
      category: 'economy',
      sources: ['한겨레'],
      from: new Date('2026-10-01T00:00:00+09:00'),
      to: new Date('2026-10-04T00:00:00+09:00'),
    })
    expect(titles(page)).toEqual(['A']);
    // 언론사 여러 곳 (B4)
    expect(titles(await listFeed(pool, { limit: 10, category: 'economy', sources: ['한겨레', '조선일보'] }))).toEqual(['A', 'B', 'D']);
  })

  it('[F-04] 걸러 낸 결과에서도 더 보기 커서와 재연결 보완(수집 순)이 같은 조건으로 동작한다', async () => {
    for (let i = 1; i <= 3; i++) await insertFull(`반도체 ${i}`, { publishedAt: `2026-10-0${i}T10:00:00Z` });
    await insertFull('야구 소식', { publishedAt: '2026-10-04T10:00:00Z' });
    const first = await listFeed(pool, { limit: 2, q: '반도체' });
    expect(first.articles.map((a) => a.title)).toEqual(['반도체 3', '반도체 2']);
    const next = await listFeed(pool, { limit: 2, q: '반도체', before: decodeCursor(first.nextCursor!)! });
    expect(next.articles.map((a) => a.title)).toEqual(['반도체 1']);
    const caught = await listFeed(pool, { limit: 10, q: '반도체', collectedAfter: { micros: '0', id: '0' } });
    expect(caught.articles.map((a) => a.title)).toEqual(['반도체 1', '반도체 2', '반도체 3']);
  })

  it('[F-04] 언론사 필터 목록은 최근 기사가 많은 순', async () => {
    await insertFull('a', { source: '조선일보' });
    await insertFull('b', { source: '한겨레' });
    await insertFull('c', { source: '한겨레' });
    expect(await listSources(pool)).toEqual([
      { source: '한겨레', count: 2 },
      { source: '조선일보', count: 1 },
    ])
  })

  it('사용자가 링크로 추가한 기사(user_submitted)는 피드에 넣지 않는다', async () => {
    await insert('api', '2026-10-01T10:00:00Z');
    await insert('user', '2026-10-01T11:00:00Z', { sourceType: 'user_submitted' });
    const page = await listFeed(pool, { limit: 10 });
    expect(page.articles.map((a) => a.title)).toEqual(['api']);
  });
});
