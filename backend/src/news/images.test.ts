import type pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { LinkError } from '../links/safeFetch.js';
import { createTestPool, testDatabaseUrl } from '../test/db.js';
import { createArticle, resetDb } from '../test/fixtures.js';
import { enrichArticleImages, findImageUrl } from './images.js';

describe('[기사 사진] 대표 사진 주소 찾기', () => {
  it('og:image를 먼저, 없으면 twitter:image를 쓰고 상대 주소는 페이지 기준으로 푼다', () => {
    expect(findImageUrl('<meta property="og:image" content="https://img.example/a.jpg?w=1&amp;h=2">', 'https://news.example/1')).toBe(
      'https://img.example/a.jpg?w=1&h=2',
    );
    expect(findImageUrl('<meta name="twitter:image" content="/photo/b.png">', 'https://news.example/articles/1')).toBe(
      'https://news.example/photo/b.png',
    );
  });

  it('[보안] https가 아닌 주소·사용자 정보가 든 주소·이상한 값은 받지 않는다', () => {
    expect(findImageUrl('<meta property="og:image" content="http://img.example/a.jpg">', 'https://n.example/')).toBeNull();
    expect(findImageUrl('<meta property="og:image" content="javascript:alert(1)">', 'https://n.example/')).toBeNull();
    expect(findImageUrl('<meta property="og:image" content="https://u:p@img.example/a.jpg">', 'https://n.example/')).toBeNull();
    expect(findImageUrl('<html>사진 없음</html>', 'https://n.example/')).toBeNull();
  });
});

describe.skipIf(!testDatabaseUrl)('[기사 사진] 수집 기사의 대표 사진 채우기 (DB)', () => {
  let pool: pg.Pool;
  beforeAll(() => {
    pool = createTestPool();
  });
  beforeEach(async () => {
    await resetDb(pool);
  });
  afterAll(async () => {
    await pool.end();
  });

  it('아직 찾아보지 않은 최근 기사만 가져와 사진 주소를 저장하고, 찾지 못하거나 실패해도 다시 가져오지 않는다', async () => {
    const withImage = await createArticle(pool, '사진 있는 기사');
    const withoutImage = await createArticle(pool, '사진 없는 기사');
    const broken = await createArticle(pool, '열리지 않는 기사');
    const old = await createArticle(pool, '오래된 기사', new Date(Date.now() - 3 * 86_400_000));
    const links = new Map(
      (await pool.query<{ id: string; original_link: string }>('SELECT id, original_link FROM articles')).rows.map((r) => [r.original_link, r.id]),
    );
    const fetchPage = vi.fn(async (url: string) => {
      const id = links.get(url);
      if (id === broken) throw new LinkError('fetch_failed', '실패');
      const html = id === withImage ? '<meta property="og:image" content="https://img.example/1.jpg">' : '<p>본문</p>';
      return { finalUrl: url, contentType: 'text/html', html };
    });

    expect(await enrichArticleImages(pool, fetchPage)).toBe(3);
    const rows = new Map(
      (await pool.query<{ id: string; image_url: string | null; image_checked_at: Date | null }>('SELECT id, image_url, image_checked_at FROM articles')).rows.map(
        (r) => [r.id, r],
      ),
    );
    expect(rows.get(withImage)?.image_url).toBe('https://img.example/1.jpg');
    expect(rows.get(withoutImage)).toMatchObject({ image_url: null });
    expect(rows.get(withoutImage)?.image_checked_at).not.toBeNull();
    expect(rows.get(broken)?.image_checked_at).not.toBeNull();
    expect(rows.get(old)?.image_checked_at).toBeNull(); // 48시간 넘은 기사는 찾지 않음

    expect(await enrichArticleImages(pool, fetchPage)).toBe(0);
    expect(fetchPage).toHaveBeenCalledTimes(3);
  });
});
