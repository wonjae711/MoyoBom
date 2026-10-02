import { ProviderRequestError } from '../errors.js';
import { resolvePress } from '../press.js';
import { cleanText } from '../text.js';
import type { Category, FetchResult, NormalizedArticle } from '../types.js';
import { type FetchFn, isHttpUrl, isRecord, requestJson } from './http.js';

/**
 * NAVER API HUB 뉴스 검색. 개발자센터(openapi.naver.com) 검색 API는 2026-07-31부터 신규 발급이 끝나
 * API HUB로 이관됐다. 요청 파라미터·응답 형식은 이전과 같고 주소와 인증 헤더만 다르다.
 * 한도: 검색 API 전체 월 775,000회, 키당 초당 50회 (초과 시 429)
 */
const NAVER_NEWS_URL = 'https://naverapihub.apigw.ntruss.com/search/v1/news';
/** 한 번에 받을 수 있는 최대 개수 */
const DISPLAY = 100;

export interface NaverConfig {
  clientId: string;
  clientSecret: string;
  fetchFn?: FetchFn;
}

/**
 * 카테고리의 키워드 하나로 최신순 검색한다. 결과는 모두 그 카테고리로 분류한다.
 * 응답: { items: [{ title, originallink, link, description, pubDate }] }
 */
export async function fetchNaverNews(category: Category, query: string, config: NaverConfig): Promise<FetchResult> {
  const url = new URL(NAVER_NEWS_URL);
  url.searchParams.set('query', query);
  url.searchParams.set('display', String(DISPLAY));
  url.searchParams.set('sort', 'date');

  const body = await requestJson(
    'naver',
    url,
    {
      headers: {
        'X-NCP-APIGW-API-KEY-ID': config.clientId,
        'X-NCP-APIGW-API-KEY': config.clientSecret,
      },
    },
    config.fetchFn ?? fetch,
  );

  if (!isRecord(body) || !Array.isArray(body.items)) {
    throw new ProviderRequestError('naver', '응답 형식 오류(items 없음)');
  }

  const articles: NormalizedArticle[] = [];
  let skipped = 0;
  for (const item of body.items) {
    const article = normalizeNaverItem(item, category);
    if (article) articles.push(article);
    else skipped++;
  }
  return { articles, skipped };
}

function normalizeNaverItem(item: unknown, category: Category): NormalizedArticle | null {
  if (!isRecord(item)) return null;
  const { title, originallink, link, description, pubDate } = item;
  if (typeof title !== 'string' || typeof pubDate !== 'string') return null;

  // 원문 링크가 비어 있으면 네이버 뉴스 링크를 쓴다
  const originalLink =
    typeof originallink === 'string' && originallink.trim() ? originallink.trim() : typeof link === 'string' ? link.trim() : '';
  if (!isHttpUrl(originalLink)) return null;

  const cleanTitle = cleanText(title);
  // pubDate는 RFC1123 형식(예: "Wed, 01 Oct 2026 21:00:00 +0900")
  const publishedAt = new Date(pubDate);
  const source = resolvePress(originalLink);
  if (!cleanTitle || Number.isNaN(publishedAt.getTime()) || !source) return null;

  return {
    title: cleanTitle,
    description: typeof description === 'string' ? cleanText(description) : '',
    source,
    category: category.code,
    originalLink,
    publishedAt,
  };
}
