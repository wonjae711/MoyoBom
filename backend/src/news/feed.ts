import type pg from 'pg';
import type { Article, CategoryCode } from './types.js';

/** 클라이언트로 보내는 기사 형태 (REST 응답과 소켓 이벤트가 같은 형태를 쓴다) */
export interface FeedArticle {
  id: string;
  title: string;
  description: string;
  source: string;
  category: CategoryCode;
  originalLink: string;
  publishedAt: string;
}

export function toFeedArticle(article: Article): FeedArticle {
  return {
    id: article.id,
    title: article.title,
    description: article.description,
    source: article.source,
    category: article.category,
    originalLink: article.originalLink,
    publishedAt: article.publishedAt.toISOString(),
  };
}

/** 피드 정렬 순서: 발행 시각 최신순, 같으면 id 큰 순 */
export function compareFeed(a: FeedArticle, b: FeedArticle): number {
  if (a.publishedAt !== b.publishedAt) return a.publishedAt < b.publishedAt ? 1 : -1;
  return Number(b.id) - Number(a.id);
}

/** 다음 페이지 위치. "발행 시각_id" 문자열로 주고받는다 */
export interface FeedCursor {
  publishedAt: Date;
  id: string;
}

export function encodeCursor(article: FeedArticle): string {
  return `${article.publishedAt}_${article.id}`;
}

export function decodeCursor(cursor: string): FeedCursor | null {
  const match = /^(.+)_(\d+)$/.exec(cursor);
  if (!match) return null;
  const publishedAt = new Date(match[1]!);
  return Number.isNaN(publishedAt.getTime()) ? null : { publishedAt, id: match[2]! };
}

export interface FeedQuery {
  limit: number;
  before?: FeedCursor;
  category?: CategoryCode;
}

export interface FeedPage {
  articles: FeedArticle[];
  /** 더 오래된 기사가 남아 있으면 다음 요청에 넘길 커서 */
  nextCursor: string | null;
}

interface FeedRow {
  id: string;
  title: string;
  description: string;
  source: string;
  category: CategoryCode;
  original_link: string;
  published_at: Date;
}

/**
 * 뉴스 피드 목록 (F-02 처음 화면·재연결 시 누락분 보완, "더 보기").
 * 사용자가 링크로 추가한 기사(user_submitted)는 보드 안에서만 보이므로 피드에 넣지 않는다 (F-03 기본안).
 */
export async function listFeed(pool: pg.Pool, query: FeedQuery): Promise<FeedPage> {
  const params: unknown[] = [query.limit + 1];
  const where = [`source_type = 'api_collected'`];
  if (query.category) {
    params.push(query.category);
    where.push(`category = $${params.length}`);
  }
  if (query.before) {
    params.push(query.before.publishedAt, query.before.id);
    where.push(`(published_at, id) < ($${params.length - 1}, $${params.length})`);
  }

  const { rows } = await pool.query<FeedRow>(
    `SELECT id, title, description, source, category, original_link, published_at
     FROM articles
     WHERE ${where.join(' AND ')}
     ORDER BY published_at DESC, id DESC
     LIMIT $1`,
    params,
  );

  const articles = rows.slice(0, query.limit).map((row) => ({
    id: row.id,
    title: row.title,
    description: row.description,
    source: row.source,
    category: row.category,
    originalLink: row.original_link,
    publishedAt: row.published_at.toISOString(),
  }));
  const last = articles.at(-1);
  return { articles, nextCursor: rows.length > query.limit && last ? encodeCursor(last) : null };
}
