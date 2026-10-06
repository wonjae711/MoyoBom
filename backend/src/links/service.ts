import type pg from 'pg';
import type { AiQuota, QuotaScope } from '../ai/quota.js';
import { SummaryError, type Summarizer } from '../ai/summarizer.js';
import type { BoardService } from '../boards/service.js';
import { BoardError, type BoardItem } from '../boards/types.js';
import { extractPage, normalizeUrl, type ExtractedPage } from './extract.js';
import { LinkError, safeFetchHtml, type FetchedPage } from './safeFetch.js';

export const SUMMARY_FEATURE = 'link_summary';
/** 이보다 본문이 짧으면 AI 요약 대신 페이지가 밝힌 설명(og:description)을 쓴다 */
const MIN_BODY_FOR_SUMMARY = 200;

/** 하루 한도를 넘음 (계정·IP·전체 중 어느 것인지) */
export class QuotaError extends Error {
  constructor(
    readonly scope: QuotaScope,
    readonly limit: number,
  ) {
    super(
      scope === 'user'
        ? `오늘 AI 요약을 모두 사용했습니다 (하루 ${limit}회). 내일 다시 이용해 주세요`
        : scope === 'ip'
          ? '이 네트워크에서 오늘 사용할 수 있는 AI 요약을 모두 사용했습니다'
          : '오늘 서비스 전체 AI 요약 한도에 도달했습니다. 내일 다시 이용해 주세요',
    );
    this.name = 'QuotaError';
  }
}

/** 페이지에서 요약할 내용을 찾지 못함 */
export class UnreadableError extends Error {
  constructor() {
    super('요약할 수 없는 페이지입니다. 기사 주소가 맞는지 확인해 주세요');
    this.name = 'UnreadableError';
  }
}

export interface LinkResult {
  item: BoardItem;
  /** 이미 저장된 기사를 다시 썼다 (AI 호출·한도 차감 없음) */
  reused: boolean;
  /** AI로 요약했다 (false면 페이지 설명을 그대로 씀) */
  summarized: boolean;
  /** 오늘 남은 요약 횟수 (이 계정) */
  remaining: number;
}

/** 링크 요약 미리보기 (B12): 보드에 올리기 전에 보여 줄 기사 */
export interface LinkPreview {
  article: { id: string; title: string; description: string; source: string; publishedAt: string | null };
  reused: boolean;
  summarized: boolean;
  /** 이미 이 보드에 올라가 있는 기사 (같은 주소 안내 후 중단) */
  onBoard: boolean;
  remaining: number;
}

export interface LinkServiceDeps {
  pool: pg.Pool;
  boards: BoardService;
  summarizer: Summarizer;
  quota: AiQuota;
  fetchPage?: (url: string) => Promise<FetchedPage>;
}

/**
 * 링크로 기사 카드 추가 (F-03).
 * 정규화 → 이미 있는 기사면 재사용 → 없으면 SSRF 안전 가져오기 → 본문 추출 → (한도 차감 후) AI 요약 → 저장 → 보드에 카드 추가.
 * 같은 주소는 한 기사로만 저장한다 (original_link UNIQUE). API로 이미 수집된 기사면 그 기사를 그대로 쓴다 (C-06).
 */
export class LinkService {
  private readonly fetchPage: (url: string) => Promise<FetchedPage>;

  constructor(private readonly deps: LinkServiceDeps) {
    this.fetchPage = deps.fetchPage ?? ((url) => safeFetchHtml(url));
  }

  remaining(userId: string): Promise<number> {
    return this.deps.quota.remaining(SUMMARY_FEATURE, userId);
  }

  async addLink(input: { boardId: string; userId: string; ip: string; url: string; x: number; y: number }): Promise<LinkResult> {
    const { boards } = this.deps;
    // 보드 멤버가 아니면 페이지를 가져오거나 한도를 쓰기 전에 거절
    if (!(await boards.getRole(input.boardId, input.userId))) throw new BoardError('not_found', '보드를 찾을 수 없습니다');

    const url = normalizeUrl(input.url);
    if (!url) throw new LinkError('invalid_url', '올바른 http/https 주소를 입력해 주세요');
    const link = url.toString();

    const existing = await this.findArticle(link);
    if (existing) {
      const item = await this.addCard(input, existing);
      return { item, reused: true, summarized: false, remaining: await this.remaining(input.userId) };
    }

    const page = await this.fetchWithMobileFallback(input.url, url);
    const extracted = await extractPage(page.html, url);
    const { description, summarized, remaining } = await this.describe(extracted, input);
    if (!extracted.title && !description) throw new UnreadableError();

    const articleId = await this.saveArticle(link, extracted, description, input.userId);
    const item = await this.addCard(input, articleId);
    return { item, reused: false, summarized, remaining: remaining ?? (await this.remaining(input.userId)) };
  }

  /**
   * 미리보기 (B12, 프로토타입 "요약 미리보기 → 보드에 추가"): 가져오기·요약·기사 저장까지 하고 카드는 만들지 않는다.
   * 요약 한도는 여기서 쓴다. 저장한 기사는 보드에 올리지 않으면 30일 뒤 정리된다 (C-06)
   */
  async previewLink(input: { boardId: string; userId: string; ip: string; url: string }): Promise<LinkPreview> {
    const { boards } = this.deps;
    if (!(await boards.getRole(input.boardId, input.userId))) throw new BoardError('not_found', '보드를 찾을 수 없습니다');
    const url = normalizeUrl(input.url);
    if (!url) throw new LinkError('invalid_url', '올바른 http/https 주소를 입력해 주세요');
    const link = url.toString();

    let articleId = await this.findArticle(link);
    let reused = true;
    let summarized = false;
    let remaining: number | undefined;
    if (!articleId) {
      const page = await this.fetchWithMobileFallback(input.url, url);
      const extracted = await extractPage(page.html, url);
      const described = await this.describe(extracted, input);
      if (!extracted.title && !described.description) throw new UnreadableError();
      articleId = await this.saveArticle(link, extracted, described.description, input.userId);
      reused = false;
      summarized = described.summarized;
      remaining = described.remaining;
    }
    const { rows } = await this.deps.pool.query<{
      title: string;
      description: string;
      source: string;
      published_at: Date | null;
      on_board: boolean;
    }>(
      `SELECT a.title, a.description, a.source, a.published_at,
         EXISTS (SELECT 1 FROM board_items bi WHERE bi.board_id = $2 AND bi.article_id = a.id) AS on_board
       FROM articles a WHERE a.id = $1`,
      [articleId, input.boardId],
    );
    const a = rows[0]!;
    return {
      article: { id: articleId, title: a.title, description: a.description, source: a.source, publishedAt: a.published_at?.toISOString() ?? null },
      reused,
      summarized,
      onBoard: a.on_board,
      remaining: remaining ?? (await this.remaining(input.userId)),
    };
  }

  /** 미리보기한 주소의 기사를 카드로 올린다 (같은 주소를 다시 보내므로 다른 보드의 기사 id로는 올릴 수 없다 — C-06) */
  async confirmLink(input: { boardId: string; userId: string; url: string; x: number; y: number }): Promise<BoardItem> {
    const url = normalizeUrl(input.url);
    if (!url) throw new LinkError('invalid_url', '올바른 http/https 주소를 입력해 주세요');
    const articleId = await this.findArticle(url.toString());
    if (!articleId) throw new BoardError('not_found', '미리보기가 만료됐어요. 주소를 다시 입력해 주세요');
    return this.addCard(input, articleId);
  }

  private async findArticle(link: string): Promise<string | null> {
    const { rows } = await this.deps.pool.query<{ id: string }>('SELECT id FROM articles WHERE original_link = $1', [link]);
    return rows[0]?.id ?? null;
  }

  private addCard(input: { boardId: string; userId: string; x: number; y: number }, articleId: string) {
    return this.deps.boards.addItem(
      input.boardId,
      input.userId,
      { type: 'article', articleId, x: input.x, y: input.y },
      { allowSubmitted: true },
    );
  }

  /** m. 도메인을 없앤 주소가 열리지 않으면(그 사이트는 모바일 주소만 있음) 원래 주소로 다시 시도 */
  private async fetchWithMobileFallback(raw: string, normalized: URL): Promise<FetchedPage> {
    try {
      return await this.fetchPage(normalized.toString());
    } catch (error) {
      const original = new URL(raw.trim());
      const hostChanged = original.hostname.toLowerCase() !== normalized.hostname;
      if (!(error instanceof LinkError) || error.code !== 'fetch_failed' || !hostChanged) throw error;
      original.hostname = original.hostname.toLowerCase();
      original.hash = '';
      return this.fetchPage(original.toString());
    }
  }

  /**
   * 카드 설명: 본문이 충분하면 AI 요약(한도 차감, 실패 시 1회 재시도), 아니면 페이지가 밝힌 설명.
   * 본문 추출에 실패했지만 og:description이 있으면 AI 없이 카드를 만든다 (F-03 예외 처리)
   */
  private async describe(
    page: ExtractedPage,
    input: { userId: string; ip: string },
  ): Promise<{ description: string; summarized: boolean; remaining?: number }> {
    if (page.bodyText.length < MIN_BODY_FOR_SUMMARY) {
      if (!page.metaDescription) throw new UnreadableError();
      return { description: page.metaDescription, summarized: false };
    }
    const quota = await this.deps.quota.consume(SUMMARY_FEATURE, input.userId, input.ip);
    if (!quota.ok) throw new QuotaError(quota.scope, quota.limit);
    const request = { title: page.title, text: page.bodyText };
    try {
      return { description: await this.summarizeWithRetry(request), summarized: true, remaining: quota.remaining };
    } catch (error) {
      await this.deps.quota.refund(SUMMARY_FEATURE, input.userId, input.ip);
      throw error;
    }
  }

  private async summarizeWithRetry(request: { title: string; text: string }): Promise<string> {
    try {
      return await this.deps.summarizer.summarize(request);
    } catch (first) {
      if (!(first instanceof SummaryError)) throw first;
      console.warn('[links] 요약 실패, 1회 재시도:', first.message);
      return this.deps.summarizer.summarize(request);
    }
  }

  /** 같은 주소를 동시에 제출해도 기사는 하나만 남는다 */
  private async saveArticle(link: string, page: ExtractedPage, description: string, userId: string): Promise<string> {
    const { rows } = await this.deps.pool.query<{ id: string }>(
      `INSERT INTO articles (title, description, source, original_link, source_type, submitted_by, published_at)
       VALUES ($1, $2, $3, $4, 'user_submitted', $5, $6)
       ON CONFLICT (original_link) DO NOTHING
       RETURNING id`,
      [page.title || page.source, description, page.source, link, userId, page.publishedAt],
    );
    return rows[0]?.id ?? (await this.findArticle(link))!;
  }
}
