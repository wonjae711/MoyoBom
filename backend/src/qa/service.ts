import type pg from 'pg';
import { ensureArticleEmbeddings, loadBoardArticles } from '../ai/articleEmbeddings.js';
import { AnswerError, type Answerer } from '../ai/answerer.js';
import { EmbeddingError, type Embedder } from '../ai/embedder.js';
import type { AiQuota } from '../ai/quota.js';
import type { BoardService } from '../boards/service.js';
import { BoardError } from '../boards/types.js';
import { QuotaError } from '../links/service.js';

export const QA_FEATURE = 'qa';
/** 검색 대상 기사 카드 수 상한 (최근에 올린 순) */
export const MAX_QA_ARTICLES = 200;
/** 답변 근거로 넘기는 기사 수 */
export const QA_TOP_K = 5;

/** 답변 근거가 된 보드의 기사 카드 */
export interface QaSourceCard {
  n: number;
  itemId: string;
  articleId: string;
  title: string;
  source: string;
  originalLink: string;
  /** 질문과의 코사인 유사도 */
  similarity: number;
}

export interface QaResult {
  /** 관련 기사를 찾지 못했으면 false (AI 답변 없이 안내만) */
  found: boolean;
  answer: string;
  /** 검색으로 찾은 기사 (번호 순) */
  sources: QaSourceCard[];
  /** 답변에 실제로 쓴 출처 번호 */
  citations: number[];
  remaining: number;
}

export const NOT_FOUND_ANSWER = '이 보드의 기사에서는 관련 정보를 찾을 수 없어요. 관련 기사를 보드에 더 올려 보세요.';

export interface QaServiceDeps {
  pool: pg.Pool;
  boards: BoardService;
  embedder: Embedder;
  answerer: Answerer;
  quota: AiQuota;
  /** 이 유사도 미만인 기사는 근거로 쓰지 않는다 */
  minSimilarity: number;
}

/**
 * 보드 기반 질의응답 (F-12, RAG).
 * 질문 임베딩 → 보드 기사 카드 중 가까운 기사 검색(pgvector) → 그 기사만 근거로 AI 답변 + 출처 번호.
 * 답변은 묻는 사람에게만 돌려주고 저장하지 않는다. 보드 멤버라면 누구나 물을 수 있다
 */
export class QaService {
  constructor(private readonly deps: QaServiceDeps) {}

  remaining(userId: string): Promise<number> {
    return this.deps.quota.remaining(QA_FEATURE, userId);
  }

  async ask(boardId: string, userId: string, ip: string, question: string): Promise<QaResult> {
    if (!(await this.deps.boards.getRole(boardId, userId))) throw new BoardError('not_found', '보드를 찾을 수 없습니다');
    const cards = await loadBoardArticles(this.deps.pool, boardId, MAX_QA_ARTICLES);
    if (cards.length === 0) throw new BoardError('invalid', '보드에 기사 카드가 있어야 질문할 수 있습니다');

    const quota = await this.deps.quota.consume(QA_FEATURE, userId, ip);
    if (!quota.ok) throw new QuotaError(quota.scope, quota.limit);
    try {
      await ensureArticleEmbeddings(this.deps.pool, this.deps.embedder, cards);
      const [vector] = await this.deps.embedder.embed([question]);
      const sources = await this.search(boardId, vector!);
      if (sources.length === 0) {
        return { found: false, answer: NOT_FOUND_ANSWER, sources: [], citations: [], remaining: quota.remaining };
      }
      const descriptions = new Map(cards.map((c) => [c.articleId, c.description]));
      const { answer, citations } = await this.deps.answerer.answer(
        question,
        sources.map((s) => ({ n: s.n, title: s.title, source: s.source, text: descriptions.get(s.articleId) ?? '' })),
      );
      return { found: true, answer, sources, citations, remaining: quota.remaining };
    } catch (error) {
      // AI 쪽 실패로 답을 못 냈으면 사용 횟수를 돌려준다
      if (error instanceof EmbeddingError || error instanceof AnswerError) {
        await this.deps.quota.refund(QA_FEATURE, userId, ip);
      }
      throw error;
    }
  }

  /** 보드의 기사 카드 중 질문과 가까운 순으로 QA_TOP_K개 (pgvector 코사인 거리). 같은 기사가 두 번 올라가 있으면 한 번만 */
  private async search(boardId: string, vector: number[]): Promise<QaSourceCard[]> {
    const { rows } = await this.deps.pool.query<{
      item_id: string;
      article_id: string;
      title: string;
      source: string;
      original_link: string;
      similarity: number;
    }>(
      `SELECT * FROM (
         SELECT DISTINCT ON (a.id) bi.id AS item_id, a.id AS article_id, a.title, a.source, a.original_link,
           1 - (a.embedding <=> $2::vector) AS similarity
         FROM board_items bi JOIN articles a ON a.id = bi.article_id
         WHERE bi.board_id = $1 AND bi.item_type = 'article' AND a.embedding IS NOT NULL
         ORDER BY a.id, bi.id
       ) found
       WHERE similarity >= $3
       ORDER BY similarity DESC LIMIT $4`,
      [boardId, `[${vector.join(',')}]`, this.deps.minSimilarity, QA_TOP_K],
    );
    return rows.map((r, i) => ({
      n: i + 1,
      itemId: r.item_id,
      articleId: r.article_id,
      title: r.title,
      source: r.source,
      originalLink: r.original_link,
      similarity: Math.round(r.similarity * 1000) / 1000,
    }));
  }
}
