import { ProviderAuthError, QuotaExceededError } from './errors.js';
import type { NewsEvents } from './events.js';
import type { Article, FetchResult, NormalizedArticle, ProviderName } from './types.js';

export interface Logger {
  info(message: string): void;
  warn(message: string): void;
  error(message: string): void;
}

export interface ProviderSource {
  /** 한 주기에 보낼 요청들 (네이버: 카테고리별 요청, Guardian: 요청 1개) */
  requests: Array<() => Promise<FetchResult>>;
  /** 일일 한도가 다시 채워지는 시각 */
  quotaResetAt: (now: Date) => Date;
}

export interface CollectorDeps {
  providers: Record<ProviderName, ProviderSource>;
  save: (articles: NormalizedArticle[]) => Promise<Article[]>;
  events: NewsEvents;
  now?: () => Date;
  logger?: Logger;
}

export type RunResult =
  | { status: 'skipped'; reason: 'running' | 'quota' }
  | { status: 'done'; fetched: number; saved: number; skipped: number; failedRequests: number; quotaExceeded: boolean };

/** 다음 자정(지정한 UTC 오프셋 기준). 네이버 한도는 KST(+9), Guardian은 UTC 자정 기준으로 본다. */
export function nextMidnight(now: Date, utcOffsetHours: number): Date {
  const shifted = new Date(now.getTime() + utcOffsetHours * 3_600_000);
  shifted.setUTCHours(24, 0, 0, 0);
  return new Date(shifted.getTime() - utcOffsetHours * 3_600_000);
}

/**
 * 뉴스 수집 파이프라인 (F-01). 예외 처리 정책 (requirements.md F-01 예외 처리 표):
 * - 요청 실패: 로그만 남기고 나머지 요청은 계속, 재시도는 다음 주기에 (인증 실패는 남은 요청도 실패하므로 바로 멈춤)
 * - 일일 한도 초과: 해당 API만 자정까지 중단, 다른 API는 계속 수집
 * - 형식이 잘못된 기사: 건너뛰고 개수만 기록
 * - 중복 기사: DB의 original_link UNIQUE로 걸러내고, 새로 저장된 기사만 이벤트로 알린다
 */
export class NewsCollector {
  private readonly running = new Set<ProviderName>();
  private readonly suspendedUntil = new Map<ProviderName, Date>();
  private readonly now: () => Date;
  private readonly logger: Logger;

  constructor(private readonly deps: CollectorDeps) {
    this.now = deps.now ?? (() => new Date());
    this.logger = deps.logger ?? console;
  }

  async run(name: ProviderName): Promise<RunResult> {
    if (this.running.has(name)) return { status: 'skipped', reason: 'running' };

    const resumeAt = this.suspendedUntil.get(name);
    if (resumeAt && this.now() < resumeAt) return { status: 'skipped', reason: 'quota' };
    this.suspendedUntil.delete(name);

    this.running.add(name);
    try {
      return await this.collect(name);
    } finally {
      this.running.delete(name);
    }
  }

  private async collect(name: ProviderName): Promise<RunResult> {
    const provider = this.deps.providers[name];
    const byLink = new Map<string, NormalizedArticle>();
    let skipped = 0;
    let failedRequests = 0;
    let quotaExceeded = false;

    for (const request of provider.requests) {
      try {
        const result = await request();
        skipped += result.skipped;
        // 여러 카테고리 검색에 같은 기사가 걸리면 먼저 나온 카테고리를 유지한다
        for (const article of result.articles) {
          if (!byLink.has(article.originalLink)) byLink.set(article.originalLink, article);
        }
      } catch (error) {
        if (error instanceof QuotaExceededError) {
          const resumeAt = provider.quotaResetAt(this.now());
          this.suspendedUntil.set(name, resumeAt);
          this.logger.warn(`[news:${name}] 일일 한도 초과 — ${resumeAt.toISOString()}까지 수집 중단`);
          quotaExceeded = true;
          break;
        }
        failedRequests++;
        this.logger.error(`[news:${name}] ${error instanceof Error ? error.message : '알 수 없는 오류'}`);
        // 키가 잘못됐으면 남은 요청도 모두 실패하므로 이번 주기는 여기서 멈춘다
        if (error instanceof ProviderAuthError) break;
      }
    }

    let saved: Article[] = [];
    try {
      saved = await this.deps.save([...byLink.values()]);
    } catch (error) {
      this.logger.error(`[news:${name}] DB 저장 실패: ${error instanceof Error ? error.message : '알 수 없는 오류'}`);
    }

    if (saved.length > 0) this.deps.events.emit('articles:new', saved);
    if (skipped > 0) this.logger.warn(`[news:${name}] 형식 오류로 건너뛴 기사 ${skipped}건`);
    this.logger.info(
      `[news:${name}] 수집 ${byLink.size}건 → 신규 ${saved.length}건` +
        (failedRequests > 0 ? `, 실패한 요청 ${failedRequests}건` : ''),
    );

    return { status: 'done', fetched: byLink.size, saved: saved.length, skipped, failedRequests, quotaExceeded };
  }
}
