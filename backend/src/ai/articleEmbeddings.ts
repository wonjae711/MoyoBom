import type pg from 'pg';
import { EmbeddingError, type Embedder } from './embedder.js';

/** 보드에 올라간 기사 카드 한 장과 그 기사의 임베딩 (F-08·F-12 공용) */
export interface BoardArticle {
  itemId: string;
  articleId: string;
  title: string;
  description: string;
  source: string;
  originalLink: string;
  x: number;
  y: number;
  embedding: number[] | null;
}

/** 보드의 기사 카드를 최근에 올린 순으로 limit개까지 (메모·사진 카드 제외) */
export async function loadBoardArticles(pool: pg.Pool, boardId: string, limit: number): Promise<BoardArticle[]> {
  const { rows } = await pool.query<{
    item_id: string;
    article_id: string;
    title: string;
    description: string;
    source: string;
    original_link: string;
    x: number;
    y: number;
    embedding: string | null;
  }>(
    `SELECT bi.id AS item_id, a.id AS article_id, a.title, a.description, a.source, a.original_link,
       bi.position_x AS x, bi.position_y AS y, a.embedding::text AS embedding
     FROM board_items bi JOIN articles a ON a.id = bi.article_id
     WHERE bi.board_id = $1 AND bi.item_type = 'article'
     ORDER BY bi.id DESC LIMIT $2`,
    [boardId, limit],
  );
  return rows.reverse().map((r) => ({
    itemId: r.item_id,
    articleId: r.article_id,
    title: r.title,
    description: r.description,
    source: r.source,
    originalLink: r.original_link,
    x: r.x,
    y: r.y,
    embedding: r.embedding ? (JSON.parse(r.embedding) as number[]) : null,
  }));
}

/** 임베딩할 글: 제목 + 요약 */
export const articleText = (a: { title: string; description: string }) => `${a.title}\n${a.description}`;

/**
 * 임베딩이 없는 기사만 만들어 저장하고(다음부터 재사용), 임베딩이 있는 카드만 돌려준다 (F-08 처리 로직 1).
 * 한 번에 못 만들면 기사별로 다시 시도하고, 그래도 실패한 기사는 뺀다 (F-08 예외 처리).
 * 하나도 만들지 못하고 원래 있던 것도 없으면 EmbeddingError
 */
export async function ensureArticleEmbeddings<T extends BoardArticle>(pool: pg.Pool, embedder: Embedder, cards: T[]): Promise<T[]> {
  const missing = [...new Map(cards.filter((c) => !c.embedding).map((c) => [c.articleId, c])).values()];
  const created = new Map<string, number[]>();
  if (missing.length > 0) {
    try {
      const vectors = await embedder.embed(missing.map(articleText));
      missing.forEach((c, i) => created.set(c.articleId, vectors[i]!));
    } catch (error) {
      if (!(error instanceof EmbeddingError)) throw error;
      for (const c of missing) {
        try {
          const [vector] = await embedder.embed([articleText(c)]);
          created.set(c.articleId, vector!);
        } catch (single) {
          if (!(single instanceof EmbeddingError)) throw single;
        }
      }
      if (created.size === 0 && cards.every((c) => !c.embedding)) throw error;
    }
    for (const [articleId, vector] of created) {
      await pool.query('UPDATE articles SET embedding = $2::vector WHERE id = $1 AND embedding IS NULL', [
        articleId,
        `[${vector.join(',')}]`,
      ]);
    }
  }
  return cards
    .map((c) => ({ ...c, embedding: c.embedding ?? created.get(c.articleId) ?? null }))
    .filter((c) => c.embedding !== null);
}
