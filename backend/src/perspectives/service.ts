import type pg from 'pg';
import { ensureArticleEmbeddings } from '../ai/articleEmbeddings.js';
import { EmbeddingError, type Embedder } from '../ai/embedder.js';
import { PerspectiveError, type PerspectiveJudge } from '../ai/perspectiveJudge.js';
import type { AiQuota } from '../ai/quota.js';
import type { BoardService } from '../boards/service.js';
import { BoardError } from '../boards/types.js';
import { QuotaError } from '../links/service.js';
import type { FeedArticle } from '../news/feed.js';
import type { CategoryCode } from '../news/types.js';

export const PERSPECTIVE_FEATURE = 'perspective';
/** 후보를 찾는 기간 (수집 기준 최근 N일) */
export const CANDIDATE_DAYS = 7;
/** 낱말 검색으로 가져와 임베딩까지 비교할 후보 수 */
export const MAX_CANDIDATES = 40;
/** AI에게 비교를 맡기고 화면에 보여 줄 최대 기사 수 */
export const MAX_RESULTS = 6;
/** 한 언론사에서 보여 줄 최대 기사 수 */
export const MAX_PER_SOURCE = 2;
/** AI에게 넘기는 보드 기사 수 */
export const MAX_BOARD_ARTICLES = 8;
/** 검색에 쓸 핵심 낱말 수 */
export const MAX_KEYWORDS = 6;

export type PerspectiveKind = 'different' | 'other_source';

export interface PerspectiveItem {
  /** different = AI가 확신을 갖고 "다른 시각"이라고 본 기사, other_source = 같은 이슈의 다른 언론사 기사 */
  kind: PerspectiveKind;
  /** different일 때 보드 기사와 무엇이 다른지 */
  reason: string;
  /** 이슈(보드 기사 평균)와의 코사인 유사도 */
  similarity: number;
  article: FeedArticle;
}

export interface PerspectiveResult {
  /** none = 같은 이슈의 다른 언론사 기사를 찾지 못함 (사용 횟수 차감 안 함) */
  status: 'ok' | 'none';
  /** 보드 기사들이 이 이슈를 다루는 방식 (AI 한 문장, 비교 실패·none이면 빈 문자열) */
  boardView: string;
  /** AI 비교에 성공했는지 (실패하면 모두 other_source로만 보여 준다) */
  judged: boolean;
  items: PerspectiveItem[];
  remaining: number;
}

export interface PerspectiveServiceDeps {
  pool: pg.Pool;
  boards: BoardService;
  embedder: Embedder;
  judge: PerspectiveJudge;
  quota: AiQuota;
  /** 이 유사도 미만인 후보는 같은 이슈로 보지 않는다 */
  minSimilarity: number;
}

/** 제목에서 떼어 낼 조사·어미 (긴 것부터) */
const PARTICLES = ['으로부터', '에서는', '에게서', '까지는', '으로는', '이라며', '라며', '에서', '에게', '으로', '까지', '부터', '보다', '처럼', '이란', '이며', '하고', '와', '과', '은', '는', '이', '가', '을', '를', '에', '의', '도', '로', '만'];
/** 이슈를 가리키지 않는 흔한 낱말 */
const STOPWORDS = new Set(['단독', '속보', '종합', '기자', '뉴스', '오늘', '내일', '어제', '올해', '지난', '관련', '대한', '위해', '통해', '이번', '사진', '영상', '포토', '인터뷰', '논란', '발표', '전망', '공개', 'the', 'and', 'for', 'with', 'from', 'that', 'this', 'over', 'after', 'says', 'into']);

/** 낱말 끝의 조사를 떼어 낸다 (남는 글자가 2자 이상일 때만) */
export function stripParticle(word: string): string {
  for (const p of PARTICLES) {
    if (word.endsWith(p) && word.length - p.length >= 2) return word.slice(0, -p.length);
  }
  return word;
}

/**
 * 보드 이슈의 기사 제목에서 검색 낱말을 고른다: 여러 기사 제목에 나올수록, 길수록 앞에.
 * 형태소 분석 없이 조사만 떼는 단순한 방식 (F-13 "최소한의 프로토타입")
 */
export function extractKeywords(titles: string[], max = MAX_KEYWORDS): string[] {
  const df = new Map<string, number>();
  for (const title of titles) {
    const words = new Set(
      title
        .toLowerCase()
        .split(/[^\p{L}\p{N}]+/u)
        .map(stripParticle)
        .filter((w) => w.length >= 2 && !STOPWORDS.has(w) && !/^\d+$/.test(w)),
    );
    for (const w of words) df.set(w, (df.get(w) ?? 0) + 1);
  }
  return [...df.entries()]
    .sort((a, b) => b[1] - a[1] || b[0].length - a[0].length || a[0].localeCompare(b[0]))
    .slice(0, max)
    .map(([w]) => w);
}

const escapeLike = (text: string) => text.replace(/[\\%_]/g, (c) => `\\${c}`);

export function cosine(a: number[], b: number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i]! * b[i]!;
    na += a[i]! * a[i]!;
    nb += b[i]! * b[i]!;
  }
  return na === 0 || nb === 0 ? 0 : dot / Math.sqrt(na * nb);
}

function centroid(vectors: number[][]): number[] {
  const sum = new Array<number>(vectors[0]!.length).fill(0);
  for (const v of vectors) v.forEach((x, i) => (sum[i]! += x));
  return sum.map((x) => x / vectors.length);
}

interface CandidateRow {
  id: string;
  title: string;
  description: string;
  source: string;
  category: CategoryCode;
  original_link: string;
  published_at: Date;
  created_at: Date;
  image_url: string | null;
  embedding: string | null;
}

/**
 * 반대 관점 기사 추천 (F-13, 2026-10-09 사용자 결정: AI 시각 비교 + 다른 언론사, AI 정리 패널의 이슈별 버튼).
 * 이슈(클러스터)의 기사 제목에서 낱말을 골라 최근 수집 기사 중 다른 언론사 후보를 찾고 → 임베딩으로 같은 이슈인지 거른 뒤
 * → AI가 보드 기사와 비교해 확신을 갖고 "다른 시각"이라고 본 기사만 이유와 함께 추천한다. 확신이 없으면 "같은 이슈, 다른 언론사"로만 보여 준다.
 * 결과는 묻는 사람에게만 돌려주고 저장하지 않는다
 */
export class PerspectiveService {
  constructor(private readonly deps: PerspectiveServiceDeps) {}

  remaining(userId: string): Promise<number> {
    return this.deps.quota.remaining(PERSPECTIVE_FEATURE, userId);
  }

  async find(boardId: string, clusterId: string, userId: string, ip: string): Promise<PerspectiveResult> {
    if (!(await this.deps.boards.getRole(boardId, userId))) throw new BoardError('not_found', '보드를 찾을 수 없습니다');
    const issue = await this.loadIssue(boardId, clusterId);
    if (issue.length === 0) throw new BoardError('invalid', '기사 카드가 있는 이슈에서만 다른 시각을 찾을 수 있어요');

    const quota = await this.deps.quota.consume(PERSPECTIVE_FEATURE, userId, ip);
    if (!quota.ok) throw new QuotaError(quota.scope, quota.limit);
    const refund = () => this.deps.quota.refund(PERSPECTIVE_FEATURE, userId, ip);
    try {
      const board = await ensureArticleEmbeddings(this.deps.pool, this.deps.embedder, issue);
      if (board.length === 0) throw new EmbeddingError('이슈 기사의 임베딩을 만들지 못했습니다');
      const center = centroid(board.map((a) => a.embedding!));

      const rows = await this.searchCandidates(boardId, issue);
      const candidates = await ensureArticleEmbeddings(
        this.deps.pool,
        this.deps.embedder,
        rows.map((r) => ({ ...r, articleId: r.id, embedding: r.embedding ? (JSON.parse(r.embedding) as number[]) : null })),
      );
      const picked = pickCandidates(
        candidates.map((c) => ({ row: c, similarity: cosine(center, c.embedding!) })),
        this.deps.minSimilarity,
      );
      if (picked.length === 0) {
        // 보여 줄 것이 없으면 사용 횟수를 돌려준다
        await refund();
        return { status: 'none', boardView: '', judged: false, items: [], remaining: quota.remaining + 1 };
      }

      let judged = true;
      let boardView = '';
      const verdicts = new Map<number, { different: boolean; reason: string }>();
      try {
        const result = await this.deps.judge.judge(
          board.slice(-MAX_BOARD_ARTICLES).map((a, i) => ({ n: i + 1, title: a.title, source: a.source, text: a.description })),
          picked.map((p, i) => ({ n: i + 1, title: p.row.title, source: p.row.source, text: p.row.description })),
        );
        boardView = result.boardView;
        for (const v of result.verdicts) verdicts.set(v.n, { different: v.relation === 'different' && v.confident, reason: v.reason });
      } catch (error) {
        if (!(error instanceof PerspectiveError)) throw error;
        // 비교만 실패했으면 찾은 기사는 "다른 언론사"로 보여 주고, AI 판단을 못 했으니 횟수는 돌려준다
        console.error('[perspectives] AI 비교 실패:', error.message);
        judged = false;
        await refund();
      }

      const items: PerspectiveItem[] = picked.map((p, i) => {
        const v = verdicts.get(i + 1);
        return {
          kind: v?.different ? 'different' : 'other_source',
          reason: v?.different ? v.reason : '',
          similarity: Math.round(p.similarity * 1000) / 1000,
          article: toFeed(p.row),
        };
      });
      items.sort((a, b) => (a.kind === b.kind ? b.similarity - a.similarity : a.kind === 'different' ? -1 : 1));
      return { status: 'ok', boardView, judged, items, remaining: judged ? quota.remaining : quota.remaining + 1 };
    } catch (error) {
      if (error instanceof EmbeddingError) await refund();
      throw error;
    }
  }

  /** 이슈에 묶인 기사 카드 (메모·사진 제외). 이슈가 이 보드의 것이 아니면 not_found */
  private async loadIssue(boardId: string, clusterId: string) {
    if (!/^\d+$/.test(clusterId)) throw new BoardError('not_found', '이슈를 찾을 수 없습니다');
    const found = await this.deps.pool.query('SELECT 1 FROM clusters WHERE id = $1 AND board_id = $2', [clusterId, boardId]);
    if (found.rowCount === 0) throw new BoardError('not_found', '이슈를 찾을 수 없습니다');
    const { rows } = await this.deps.pool.query<{
      article_id: string;
      title: string;
      description: string;
      source: string;
      embedding: string | null;
    }>(
      `SELECT DISTINCT ON (a.id) a.id AS article_id, a.title, a.description, a.source, a.embedding::text AS embedding
       FROM cluster_items ci
       JOIN board_items bi ON bi.id = ci.board_item_id
       JOIN articles a ON a.id = bi.article_id
       WHERE ci.cluster_id = $1 AND bi.item_type = 'article'
       ORDER BY a.id`,
      [clusterId],
    );
    return rows.map((r) => ({
      articleId: r.article_id,
      title: r.title,
      description: r.description,
      source: r.source,
      embedding: r.embedding ? (JSON.parse(r.embedding) as number[]) : null,
    }));
  }

  /**
   * 최근 CANDIDATE_DAYS일 수집 기사 중 이슈 낱말이 들어간 다른 언론사 기사 (보드에 이미 있는 기사·같은 언론사 제외).
   * 낱말이 많이 겹칠수록 앞에 (pg_trgm 인덱스와 같은 식으로 ILIKE)
   */
  private async searchCandidates(boardId: string, issue: { title: string; source: string }[]): Promise<CandidateRow[]> {
    const keywords = extractKeywords(issue.map((a) => a.title));
    if (keywords.length === 0) return [];
    const patterns = keywords.map((k) => `%${escapeLike(k)}%`);
    const minHits = keywords.length >= 3 ? 2 : 1;
    const { rows } = await this.deps.pool.query<CandidateRow>(
      `SELECT id, title, description, source, category, original_link, published_at, created_at, image_url, embedding::text AS embedding
       FROM (
         SELECT a.*, (SELECT count(*) FROM unnest($3::text[]) p WHERE (a.title || ' ' || a.description) ILIKE p ESCAPE '\\') AS hits
         FROM articles a
         WHERE a.source_type = 'api_collected'
           AND a.created_at > now() - make_interval(days => $4)
           AND (a.title || ' ' || a.description) ILIKE ANY ($3::text[])
           AND NOT (a.source = ANY ($2::text[]))
           AND NOT EXISTS (SELECT 1 FROM board_items bi WHERE bi.board_id = $1 AND bi.article_id = a.id)
       ) c
       WHERE hits >= $5
       ORDER BY hits DESC, published_at DESC
       LIMIT $6`,
      [boardId, [...new Set(issue.map((a) => a.source))], patterns, CANDIDATE_DAYS, minHits, MAX_CANDIDATES],
    );
    return rows;
  }
}

/** 같은 이슈로 볼 만큼 가까운 후보만, 가까운 순으로, 한 언론사에서 MAX_PER_SOURCE개까지 */
export function pickCandidates<T extends { source: string }>(
  scored: { row: T; similarity: number }[],
  minSimilarity: number,
): { row: T; similarity: number }[] {
  const perSource = new Map<string, number>();
  const picked: { row: T; similarity: number }[] = [];
  for (const c of [...scored].sort((a, b) => b.similarity - a.similarity)) {
    if (c.similarity < minSimilarity) break;
    const count = perSource.get(c.row.source) ?? 0;
    if (count >= MAX_PER_SOURCE) continue;
    perSource.set(c.row.source, count + 1);
    picked.push(c);
    if (picked.length >= MAX_RESULTS) break;
  }
  return picked;
}

function toFeed(row: Omit<CandidateRow, 'embedding'>): FeedArticle {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    source: row.source,
    category: row.category,
    originalLink: row.original_link,
    publishedAt: row.published_at.toISOString(),
    collectedAt: row.created_at.toISOString(),
    imageUrl: row.image_url,
  };
}
