import type pg from 'pg';
import { LinkError, safeFetchHtml, type FetchedPage } from '../links/safeFetch.js';

/** 한 번에 대표 사진을 찾아볼 기사 수와 동시 요청 수 (언론사 서버에 부담을 주지 않게 작게) */
export const IMAGE_BATCH = 20;
const CONCURRENCY = 3;
/** 이보다 오래 전에 수집된 기사는 찾지 않는다 */
const MAX_AGE_HOURS = 48;

/**
 * 페이지가 밝힌 대표 사진 주소 (og:image → twitter:image). 상대 주소는 페이지 주소 기준으로 풀고,
 * 화면에 그대로 쓰므로 https 주소만 받는다(배포 화면은 https라 http 사진은 막힌다)
 */
export function findImageUrl(html: string, pageUrl: string): string | null {
  for (const key of ['og:image', 'og:image:url', 'og:image:secure_url', 'twitter:image', 'twitter:image:src']) {
    for (const tag of html.match(/<meta\s[^>]*>/gi) ?? []) {
      const name = /(?:property|name)\s*=\s*["']([^"']+)["']/i.exec(tag)?.[1]?.toLowerCase();
      if (name !== key) continue;
      const content = /content\s*=\s*["']([^"']+)["']/i.exec(tag)?.[1]?.trim().replace(/&amp;/g, '&');
      const url = content ? safeImageUrl(content, pageUrl) : null;
      if (url) return url;
    }
  }
  return null;
}

export function safeImageUrl(raw: string, base?: string): string | null {
  try {
    const url = new URL(raw, base);
    if (url.protocol !== 'https:' || url.username || url.password) return null;
    const value = url.toString();
    return value.length <= 1000 ? value : null;
  } catch {
    return null;
  }
}

/**
 * 최근 수집된 기사 중 아직 대표 사진을 찾아보지 않은 것을 골라 원문 페이지에서 og:image를 읽는다.
 * 페이지 가져오기는 링크 요약과 같은 안전한 가져오기(SSRF 방지·크기·시간 제한)를 쓴다.
 * 찾지 못하거나 실패해도 시도한 시각을 남겨 같은 기사를 다시 가져오지 않는다. 찾아본 기사 수를 돌려준다
 */
export async function enrichArticleImages(
  pool: pg.Pool,
  fetchPage: (url: string) => Promise<FetchedPage> = (url) => safeFetchHtml(url),
  limit = IMAGE_BATCH,
): Promise<number> {
  const { rows } = await pool.query<{ id: string; original_link: string }>(
    `SELECT id, original_link FROM articles
     WHERE image_checked_at IS NULL AND source_type = 'api_collected' AND created_at > now() - make_interval(hours => $2)
     ORDER BY created_at DESC LIMIT $1`,
    [limit, MAX_AGE_HOURS],
  );
  let next = 0;
  const worker = async () => {
    while (next < rows.length) {
      const row = rows[next++]!;
      let image: string | null = null;
      try {
        const page = await fetchPage(row.original_link);
        image = findImageUrl(page.html, page.finalUrl);
      } catch (error) {
        if (!(error instanceof LinkError)) console.warn('[news:images] 사진 찾기 실패:', error instanceof Error ? error.message : error);
      }
      await pool.query('UPDATE articles SET image_url = coalesce(image_url, $2), image_checked_at = now() WHERE id = $1', [
        row.id,
        image,
      ]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, rows.length) }, worker));
  return rows.length;
}
