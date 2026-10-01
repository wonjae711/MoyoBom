import { ProviderRequestError } from '../errors.js';
import { cleanText } from '../text.js';
import type { CategoryCode, FetchResult, NormalizedArticle } from '../types.js';
import { type FetchFn, isHttpUrl, isRecord, requestJson } from './http.js';

const GUARDIAN_SEARCH_URL = 'https://content.guardianapis.com/search';
/**
 * 30분마다 한 번, 카테고리 구분 없이 최신 기사를 받는다 (무료 키: 하루 500회·초당 1회 → 하루 48회 사용).
 * 30분 사이에 50건 넘게 올라오면 일부는 놓칠 수 있다.
 */
const PAGE_SIZE = 50;
const SOURCE_NAME = 'The Guardian';
/** 수집하는 콘텐츠 종류 (gallery·interactive 등 텍스트 기사가 아닌 것은 제외) */
const ARTICLE_TYPES = new Set(['article', 'liveblog']);

/** Guardian sectionId → 카테고리. 목록에 없는 섹션은 국내 기준 해외 뉴스이므로 world로 분류한다. */
const SECTION_TO_CATEGORY: Record<string, CategoryCode> = {
  politics: 'politics',
  'us-news': 'world',
  world: 'world',
  'australia-news': 'world',
  'uk-news': 'world',
  business: 'economy',
  money: 'economy',
  society: 'society',
  education: 'society',
  environment: 'society',
  'global-development': 'society',
  media: 'society',
  technology: 'tech',
  science: 'tech',
  games: 'tech',
  culture: 'culture',
  books: 'culture',
  artanddesign: 'culture',
  stage: 'culture',
  lifeandstyle: 'culture',
  food: 'culture',
  travel: 'culture',
  fashion: 'culture',
  sport: 'sports',
  football: 'sports',
  film: 'entertainment',
  music: 'entertainment',
  'tv-and-radio': 'entertainment',
};

export interface GuardianConfig {
  apiKey: string;
  fetchFn?: FetchFn;
}

/** 응답: { response: { status: 'ok', results: [{ type, sectionId, webTitle, webUrl, webPublicationDate, fields: { trailText } }] } } */
export async function fetchGuardianNews(config: GuardianConfig): Promise<FetchResult> {
  const url = new URL(GUARDIAN_SEARCH_URL);
  url.searchParams.set('api-key', config.apiKey);
  url.searchParams.set('order-by', 'newest');
  url.searchParams.set('page-size', String(PAGE_SIZE));
  url.searchParams.set('show-fields', 'trailText');

  const body = await requestJson('guardian', url, {}, config.fetchFn ?? fetch);
  const response = isRecord(body) ? body.response : undefined;
  if (!isRecord(response) || response.status !== 'ok' || !Array.isArray(response.results)) {
    throw new ProviderRequestError('guardian', '응답 형식 오류');
  }

  const articles: NormalizedArticle[] = [];
  let skipped = 0;
  for (const item of response.results) {
    if (isRecord(item) && typeof item.type === 'string' && !ARTICLE_TYPES.has(item.type)) continue;
    const article = normalizeGuardianItem(item);
    if (article) articles.push(article);
    else skipped++;
  }
  return { articles, skipped };
}

function normalizeGuardianItem(item: unknown): NormalizedArticle | null {
  if (!isRecord(item)) return null;
  const { webTitle, webUrl, webPublicationDate, sectionId, fields } = item;
  if (typeof webTitle !== 'string' || typeof webUrl !== 'string' || typeof webPublicationDate !== 'string') {
    return null;
  }

  const title = cleanText(webTitle);
  const publishedAt = new Date(webPublicationDate);
  if (!title || !isHttpUrl(webUrl) || Number.isNaN(publishedAt.getTime())) return null;

  const trailText = isRecord(fields) && typeof fields.trailText === 'string' ? fields.trailText : '';
  return {
    title,
    description: cleanText(trailText),
    source: SOURCE_NAME,
    category: (typeof sectionId === 'string' && SECTION_TO_CATEGORY[sectionId]) || 'world',
    originalLink: webUrl,
    publishedAt,
  };
}
