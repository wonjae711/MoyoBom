import type pg from 'pg';
import type { Article, CategoryCode, NormalizedArticle } from './types.js';

interface ArticleRow {
  id: string;
  title: string;
  description: string;
  source: string;
  category: CategoryCode;
  original_link: string;
  published_at: Date;
  created_at: Date;
}

/**
 * 수집 기사를 저장하고, **새로 저장된 기사만** 돌려준다.
 * 중복 판별은 original_link UNIQUE 제약 + ON CONFLICT DO NOTHING (F-01 처리 로직 4~5).
 */
export async function insertCollectedArticles(pool: pg.Pool, articles: NormalizedArticle[]): Promise<Article[]> {
  if (articles.length === 0) return [];

  const { rows } = await pool.query<ArticleRow>(
    `INSERT INTO articles (title, description, source, category, original_link, source_type, published_at)
     SELECT t.title, t.description, t.source, t.category, t.original_link, 'api_collected', t.published_at
     FROM unnest($1::text[], $2::text[], $3::text[], $4::text[], $5::text[], $6::timestamptz[])
       AS t(title, description, source, category, original_link, published_at)
     ON CONFLICT (original_link) DO NOTHING
     RETURNING id, title, description, source, category, original_link, published_at, created_at`,
    [
      articles.map((a) => a.title),
      articles.map((a) => a.description),
      articles.map((a) => a.source),
      articles.map((a) => a.category),
      articles.map((a) => a.originalLink),
      articles.map((a) => a.publishedAt),
    ],
  );

  return rows.map((row) => ({
    id: row.id,
    title: row.title,
    description: row.description,
    source: row.source,
    category: row.category,
    originalLink: row.original_link,
    publishedAt: row.published_at,
    createdAt: row.created_at,
  }));
}
