import { extractFromHtml } from '@extractus/article-extractor';
import { resolvePress } from '../news/press.js';
import { cleanText } from '../news/text.js';
import { findImageUrl } from '../news/images.js';

/** 추적용 쿼리 파라미터 — 같은 기사를 같은 주소로 보기 위해 지운다 */
const TRACKING = /^(utm_\w+|fbclid|gclid|dclid|msclkid|igshid|mc_cid|mc_eid|_ga|ref|ref_src|cmpid|from)$/i;

/**
 * 같은 기사를 한 주소로 맞춘다 (F-03 처리 로직 1: 중복 판별 전 URL 정규화).
 * 추적 파라미터·#해시 제거, 호스트 소문자, 모바일 도메인(m., mobile.) 통일, 기본 포트 제거.
 */
export function normalizeUrl(input: string): URL | null {
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    return null;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  url.hash = '';
  url.hostname = url.hostname.toLowerCase().replace(/^(m|mobile)\.(?=[^.]+\.[^.]+)/, '');
  for (const key of [...url.searchParams.keys()]) if (TRACKING.test(key)) url.searchParams.delete(key);
  url.searchParams.sort();
  if (url.pathname.length > 1) url.pathname = url.pathname.replace(/\/+$/, '');
  return url;
}

export interface ExtractedPage {
  title: string;
  /** 페이지가 스스로 밝힌 요약(og:description 등) */
  metaDescription: string;
  /** 본문 텍스트. 추출에 실패하면 빈 문자열 */
  bodyText: string;
  source: string;
  publishedAt: Date | null;
  /** 대표 사진 주소 (og:image, https만) */
  imageUrl: string | null;
}

const MAX_BODY_CHARS = 6000;
const MAX_TITLE_CHARS = 300;

function metaContent(html: string, keys: string[]): string {
  for (const tag of html.match(/<meta\s[^>]*>/gi) ?? []) {
    const name = /(?:property|name)\s*=\s*["']([^"']+)["']/i.exec(tag)?.[1]?.toLowerCase();
    if (!name || !keys.includes(name)) continue;
    const content = /content\s*=\s*["']([^"']*)["']/i.exec(tag)?.[1];
    if (content) return cleanText(content);
  }
  return '';
}

function htmlToText(html: string): string {
  return cleanText(
    html
      .replace(/<(script|style|noscript|figure|figcaption)[\s\S]*?<\/\1>/gi, ' ')
      .replace(/<\/(p|div|li|h\d|br)>/gi, '\n')
      .replace(/<br\s*\/?>/gi, '\n'),
  );
}

/**
 * 웹 페이지에서 제목·설명·본문·언론사·발행 시각을 뽑는다 (F-03 처리 로직 2).
 * 본문 추출(@extractus/article-extractor — 이미 받아 온 HTML만 해석하고 직접 요청은 하지 않음)이 실패해도
 * og 메타 태그는 따로 읽어 대체 정보로 쓴다.
 */
export async function extractPage(html: string, url: URL): Promise<ExtractedPage> {
  const article = await extractFromHtml(html, url.toString(), { contentLengthThreshold: 120 }).catch(() => null);
  const title = cleanText(article?.title ?? '') || metaContent(html, ['og:title', 'twitter:title']) || cleanText(/<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1] ?? '');
  const metaDescription = metaContent(html, ['og:description', 'description', 'twitter:description']) || cleanText(article?.description ?? '');
  const bodyText = article?.content ? htmlToText(article.content).slice(0, MAX_BODY_CHARS) : '';
  const publishedRaw = article?.published || metaContent(html, ['article:published_time', 'og:article:published_time', 'pubdate']);
  const published = publishedRaw ? new Date(publishedRaw) : null;

  return {
    title: title.slice(0, MAX_TITLE_CHARS),
    metaDescription: metaDescription.slice(0, 500),
    bodyText,
    source: resolvePress(url.toString()) ?? url.hostname,
    publishedAt: published && !Number.isNaN(published.getTime()) ? published : null,
    imageUrl: findImageUrl(html, url.toString()),
  };
}
