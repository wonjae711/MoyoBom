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
  /** 우리 DB에 수집된 시각. 재연결 시 "마지막으로 받은 시점 이후 수집분"을 받는 기준 (C-10) */
  collectedAt: string;
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
    collectedAt: article.createdAt.toISOString(),
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

/**
 * 수집 순서 커서 (C-10). "수집 시각(epoch 마이크로초)_id" 문자열로 주고받는다.
 * 한 번에 저장한 기사들은 created_at이 마이크로초까지 같아서, 밀리초로 자르면 같은 묶음을 계속 다시 받게 된다.
 */
export interface CollectedCursor {
  micros: string;
  id: string;
}

export function decodeCollectedCursor(cursor: string): CollectedCursor | null {
  const match = /^(\d{1,17})_(\d{1,18})$/.exec(cursor);
  return match ? { micros: match[1]!, id: match[2]! } : null;
}

export interface FeedQuery {
  limit: number;
  before?: FeedCursor;
  /** 지정하면 이 위치 뒤에 수집된 기사를 수집 순서(먼저 수집된 것부터)로 준다 — 재연결 시 누락분 보완용 */
  collectedAfter?: CollectedCursor;
  category?: CategoryCode;
}

export interface FeedPage {
  articles: FeedArticle[];
  /**
   * 이어서 받을 커서. 남은 게 없으면 null.
   * 기본 조회는 더 오래된 기사(before에 넘김), collectedAfter 조회는 더 늦게 수집된 기사(collectedAfter에 넘김)
   */
  nextCursor: string | null;
  /** 여기까지 수집된 기사는 받은 셈이라는 위치 (다음 collectedAfter 조회의 시작점). 수집된 기사가 없으면 null */
  collectedCursor: string | null;
}

interface FeedRow {
  id: string;
  title: string;
  description: string;
  source: string;
  category: CategoryCode;
  original_link: string;
  published_at: Date;
  created_at: Date;
  created_us: string;
}

const FEED_COLUMNS = `id, title, description, source, category, original_link, published_at, created_at,
  (extract(epoch FROM created_at) * 1000000)::bigint::text AS created_us`;

const collectedCursorOf = (row: { created_us: string; id: string }) => `${row.created_us}_${row.id}`;

function toFeedRow(row: FeedRow): FeedArticle {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    source: row.source,
    category: row.category,
    originalLink: row.original_link,
    publishedAt: row.published_at.toISOString(),
    collectedAt: row.created_at.toISOString(),
  };
}

/**
 * 뉴스 피드 목록 (F-02 처음 화면, "더 보기", 재연결 시 누락분 보완).
 * 사용자가 링크로 추가한 기사(user_submitted)는 보드 안에서만 보이므로 피드에 넣지 않는다 (F-03 기본안).
 */
export function listFeed(pool: pg.Pool, query: FeedQuery): Promise<FeedPage> {
  return query.collectedAfter ? listCollectedAfter(pool, query, query.collectedAfter) : listLatest(pool, query);
}

/** 발행 시각 최신순. 지금까지 수집된 마지막 위치(collectedCursor)도 같이 준다 */
async function listLatest(pool: pg.Pool, query: FeedQuery): Promise<FeedPage> {
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

  const [{ rows }, latest] = await Promise.all([
    pool.query<FeedRow>(
      `SELECT ${FEED_COLUMNS}
       FROM articles
       WHERE ${where.join(' AND ')}
       ORDER BY published_at DESC, id DESC
       LIMIT $1`,
      params,
    ),
    pool.query<FeedRow>(
      `SELECT ${FEED_COLUMNS} FROM articles WHERE source_type = 'api_collected' ORDER BY created_at DESC, id DESC LIMIT 1`,
    ),
  ]);

  const articles = rows.slice(0, query.limit).map(toFeedRow);
  const last = articles.at(-1);
  return {
    articles,
    nextCursor: rows.length > query.limit && last ? encodeCursor(last) : null,
    collectedCursor: latest.rows[0] ? collectedCursorOf(latest.rows[0]) : null,
  };
}

/** after 뒤에 수집된 기사를 수집 순서대로 (카테고리 조건은 똑같이 적용) */
async function listCollectedAfter(pool: pg.Pool, query: FeedQuery, after: CollectedCursor): Promise<FeedPage> {
  const params: unknown[] = [query.limit + 1, after.micros, after.id];
  const where = [
    `source_type = 'api_collected'`,
    // 마이크로초 정수를 그대로 timestamptz로 바꿔 비교 (부동소수점 변환 오차 방지)
    `(created_at, id) > (timestamptz 'epoch' + $2::bigint * interval '1 microsecond', $3::bigint)`,
  ];
  if (query.category) {
    params.push(query.category);
    where.push(`category = $${params.length}`);
  }

  const { rows } = await pool.query<FeedRow>(
    `SELECT ${FEED_COLUMNS}
     FROM articles
     WHERE ${where.join(' AND ')}
     ORDER BY created_at, id
     LIMIT $1`,
    params,
  );

  const page = rows.slice(0, query.limit);
  const last = page.at(-1);
  const reached = last ? collectedCursorOf(last) : `${after.micros}_${after.id}`;
  return {
    articles: page.map(toFeedRow),
    nextCursor: rows.length > query.limit ? reached : null,
    collectedCursor: reached,
  };
}
