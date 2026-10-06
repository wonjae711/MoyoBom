import type pg from 'pg';
import type { Embedder } from '../ai/embedder.js';
import { EmbeddingError } from '../ai/embedder.js';
import { ensureArticleEmbeddings, loadBoardArticles } from '../ai/articleEmbeddings.js';
import type { AiQuota } from '../ai/quota.js';
import { SummaryError, type ClusterSummarizer } from '../ai/summarizer.js';
import type { BoardService, NewCluster } from '../boards/service.js';
import { BoardError, type BoardCluster } from '../boards/types.js';
import { QuotaError } from '../links/service.js';
import { averageLinkage, clusterPosition } from './algorithm.js';

export const CLUSTER_FEATURE = 'cluster';
/** 한 번에 분석하는 기사 카드 수 (최근에 올린 순). 보드당 수십 개 수준을 전제로 한 설계 (F-08 처리 로직 2) */
export const MAX_CLUSTER_ARTICLES = 60;
/** 함께 분석하는 메모·사진 카드 수 (최근에 올린 순, 2026-10-06 사용자 요청으로 포함) */
export const MAX_CLUSTER_NOTES = 40;
/** 이보다 짧은 메모는 주제를 판단하기 어려워 빼고 분석한다 */
export const MIN_NOTE_LENGTH = 4;
/** AI로 요약하는 클러스터 수 상한 (비용 보호) */
export const MAX_SUMMARIZED_CLUSTERS = 8;

/** 같은 보드를 이미 분석 중 */
export class ClusterBusyError extends Error {
  constructor() {
    super('이 보드는 지금 분석 중입니다. 잠시 후 다시 시도해 주세요');
    this.name = 'ClusterBusyError';
  }
}

export interface ClusterRunResult {
  seq: number;
  clusters: BoardCluster[];
  /** 분석한 기사 카드 수 */
  analyzed: number;
  /** 임베딩에 실패해 빠진 카드 수 */
  excluded: number;
  /** 오늘 남은 분석 횟수 (이 계정) */
  remaining: number;
}

export interface ClusterServiceDeps {
  pool: pg.Pool;
  boards: BoardService;
  embedder: Embedder;
  summarizer: ClusterSummarizer;
  quota: AiQuota;
  /** 이 유사도(코사인) 이상이면 같은 이슈로 묶는다. 실제 데이터로 조정 (F-08 예외 처리) */
  threshold: number;
}

/**
 * AI 이슈 클러스터링 (F-08).
 * 보드의 기사 카드 → (없으면) 임베딩 생성·저장 → 평균 연결 군집화 → 클러스터별 AI 요약 → 보드 클러스터 교체.
 * 카드 좌표는 바꾸지 않는다 (자동 정렬은 사용자가 따로 누른다).
 * 같은 보드를 동시에 분석하지 않는다 (서버 한 대 전제 — 메모리 잠금. C-05 기본안).
 */
export class ClusterService {
  private readonly running = new Set<string>();

  constructor(private readonly deps: ClusterServiceDeps) {}

  remaining(userId: string): Promise<number> {
    return this.deps.quota.remaining(CLUSTER_FEATURE, userId);
  }

  async run(boardId: string, userId: string, ip: string): Promise<ClusterRunResult> {
    if (!(await this.deps.boards.getRole(boardId, userId))) throw new BoardError('not_found', '보드를 찾을 수 없습니다');
    if (this.running.has(boardId)) throw new ClusterBusyError();
    this.running.add(boardId);
    try {
      const cards = await loadBoardArticles(this.deps.pool, boardId, MAX_CLUSTER_ARTICLES);
      const notes = await this.loadNotes(boardId);
      if (cards.length + notes.length < 2) throw new BoardError('invalid', '기사·메모 카드가 2개 이상 있어야 분석할 수 있습니다');

      const quota = await this.deps.quota.consume(CLUSTER_FEATURE, userId, ip);
      if (!quota.ok) throw new QuotaError(quota.scope, quota.limit);
      try {
        const embedded: Node[] = cards.length
          ? (await ensureArticleEmbeddings(this.deps.pool, this.deps.embedder, cards)).map((c) => ({
              itemId: c.itemId,
              x: c.x,
              y: c.y,
              title: c.title,
              text: c.description,
              embedding: c.embedding!,
            }))
          : [];
        embedded.push(...(await this.embedNotes(notes)));
        const groups = averageLinkage(
          embedded.map((c) => c.embedding),
          this.deps.threshold,
        ).map((indexes) => indexes.map((i) => embedded[i]!));

        const clusters: NewCluster[] = [];
        for (const [index, group] of groups.entries()) {
          const summary =
            index < MAX_SUMMARIZED_CLUSTERS ? await this.summarize(group) : { title: fallbackTitle(group), summary: '' };
          clusters.push({ ...summary, ...clusterPosition(group), itemIds: group.map((c) => c.itemId) });
        }
        const saved = await this.deps.boards.replaceClusters(boardId, userId, clusters);
        const total = cards.length + notes.length;
        return { ...saved, analyzed: embedded.length, excluded: total - embedded.length, remaining: quota.remaining };
      } catch (error) {
        // AI 쪽 실패로 결과를 못 냈으면 사용 횟수를 돌려준다
        if (error instanceof EmbeddingError || error instanceof SummaryError) {
          await this.deps.quota.refund(CLUSTER_FEATURE, userId, ip);
        }
        throw error;
      }
    } finally {
      this.running.delete(boardId);
    }
  }

  /** 요약이 실패하면 1회 다시 시도하고, 그래도 안 되면 대표 기사 제목으로 대신한다 (클러스터 자체는 보여 준다) */
  /** 메모·사진 카드 중 내용(사진은 설명)이 있는 것 — 최근에 올린 순으로 MAX_CLUSTER_NOTES개 */
  private async loadNotes(boardId: string): Promise<Note[]> {
    const { rows } = await this.deps.pool.query<{ id: string; item_type: string; content: string; x: number; y: number }>(
      `SELECT id, item_type, content, position_x AS x, position_y AS y FROM board_items
       WHERE board_id = $1 AND item_type IN ('memo', 'photo') AND char_length(btrim(coalesce(content, ''))) >= $2
       ORDER BY id DESC LIMIT $3`,
      [boardId, MIN_NOTE_LENGTH, MAX_CLUSTER_NOTES],
    );
    return rows.reverse().map((r) => ({
      itemId: r.id,
      x: r.x,
      y: r.y,
      title: r.item_type === 'memo' ? '메모' : '사진 설명',
      text: r.content.trim(),
    }));
  }

  /**
   * 메모·사진 설명 임베딩 (저장하지 않고 분석할 때마다 만든다 — 메모는 수정되므로).
   * 실패하면 메모 없이 기사만으로 분석한다
   */
  private async embedNotes(notes: Note[]): Promise<Node[]> {
    if (notes.length === 0) return [];
    try {
      const vectors = await this.deps.embedder.embed(notes.map((n) => n.text));
      return notes.map((n, i) => ({ ...n, embedding: vectors[i]! }));
    } catch (error) {
      if (!(error instanceof EmbeddingError)) throw error;
      console.warn('[clusters] 메모 임베딩 실패 — 기사만 분석:', error.message);
      return [];
    }
  }

  private async summarize(group: Node[]): Promise<{ title: string; summary: string }> {
    const input = group.map((c) => ({ title: c.title, text: c.text }));
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        return await this.deps.summarizer.summarizeCluster(input);
      } catch (error) {
        if (!(error instanceof SummaryError)) throw error;
        console.warn('[clusters] 요약 실패:', error.message);
      }
    }
    return { title: fallbackTitle(group), summary: '' };
  }
}

/** 군집화할 카드 (기사·메모·사진 공통) */
interface Note {
  itemId: string;
  x: number;
  y: number;
  /** 기사 제목, 메모·사진은 종류 이름 */
  title: string;
  text: string;
}
interface Node extends Note {
  embedding: number[];
}

/** 요약을 못 했을 때의 이름: 기사가 있으면 첫 기사 제목, 메모뿐이면 메모 첫 부분 */
function fallbackTitle(group: Node[]): string {
  const article = group.find((c) => c.title !== '메모' && c.title !== '사진 설명');
  return (article ? article.title : group[0]!.text).slice(0, 40);
}
