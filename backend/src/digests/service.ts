import type pg from 'pg';
import type { DigestWriter } from '../ai/digestWriter.js';
import type { AiQuota } from '../ai/quota.js';
import { SummaryError } from '../ai/summarizer.js';
import { QuotaError } from '../links/service.js';
import { escapeLike } from '../news/feed.js';
import { CATEGORIES } from '../news/types.js';

export const DIGEST_FEATURE = 'digest';
export const DIGEST_MANUAL_FEATURE = 'digest_manual';
/** 1인당 구독 수 (사용자 결정 2026-10-05) */
export const MAX_SUBSCRIPTIONS = 3;
/** 다이제스트 하나에 넣는 기사 수 */
export const MAX_DIGEST_ARTICLES = 20;
/** 놓친 실행은 받는 시각부터 이 시간 안에만 늦게라도 만든다 */
export const LATE_LIMIT_MS = 3 * 60 * 60 * 1000;
/** "만드는 중"인 채 이 시간이 지나면(도중에 서버 종료) 다시 시도한다 */
export const STALE_PENDING_MS = 10 * 60 * 1000;
/** 대상 기사 구간의 최대 길이 */
export const MAX_WINDOW_MS = 24 * 60 * 60 * 1000;
export const DIGEST_RETENTION_DAYS = 30;

const KST_OFFSET_MS = 9 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

export class DigestError extends Error {
  constructor(
    readonly code: 'not_found' | 'invalid',
    message: string,
  ) {
    super(message);
    this.name = 'DigestError';
  }
}

export interface SubscriptionInput {
  categories: string[];
  keywords: string[];
  sendHour: number;
}

export interface Subscription extends SubscriptionInput {
  id: string;
  active: boolean;
  createdAt: string;
}

export interface DigestArticle {
  id: string;
  title: string;
  source: string;
  link: string;
}

export interface Digest {
  id: string;
  subscriptionId: string | null;
  kind: 'scheduled' | 'manual';
  slot: string | null;
  status: 'ok' | 'empty' | 'failed';
  title: string;
  summary: string | null;
  articles: DigestArticle[];
  windowStart: string;
  windowEnd: string;
  readAt: string | null;
  createdAt: string;
}

export interface DigestNotifier {
  digestCreated(userId: string, digest: Digest): void;
}

/** 받는 시각(한국 시간 hour시 정각) 중 now 이전의 가장 최근 시각 */
export function latestSlot(now: Date, hour: number): Date {
  const kst = new Date(now.getTime() + KST_OFFSET_MS);
  const slot = Date.UTC(kst.getUTCFullYear(), kst.getUTCMonth(), kst.getUTCDate(), hour) - KST_OFFSET_MS;
  return new Date(slot > now.getTime() ? slot - DAY_MS : slot);
}

const CATEGORY_LABELS = new Map<string, string>(CATEGORIES.map((c) => [c.code, c.label]));

/** 구독 주제를 사람이 읽는 이름으로: "경제·IT·과학 + 반도체" */
export function topicName(sub: Pick<SubscriptionInput, 'categories' | 'keywords'>): string {
  const categories = sub.categories.map((c) => CATEGORY_LABELS.get(c) ?? c).join('·');
  const keywords = sub.keywords.join(', ');
  return [categories, keywords].filter(Boolean).join(' + ');
}

interface SubscriptionRow {
  id: string;
  user_id: string;
  categories: string[];
  keywords: string[];
  send_hour: number;
  active: boolean;
  created_at: Date;
}

const toSubscription = (r: SubscriptionRow): Subscription => ({
  id: r.id,
  categories: r.categories,
  keywords: r.keywords,
  sendHour: r.send_hour,
  active: r.active,
  createdAt: r.created_at.toISOString(),
});

interface DigestRow {
  id: string;
  subscription_id: string | null;
  kind: Digest['kind'];
  slot: Date | null;
  status: Digest['status'];
  title: string;
  summary: string | null;
  articles: DigestArticle[];
  window_start: Date;
  window_end: Date;
  read_at: Date | null;
  created_at: Date;
}

const DIGEST_COLUMNS =
  'id, subscription_id, kind, slot, status, title, summary, articles, window_start, window_end, read_at, created_at';

const toDigest = (r: DigestRow): Digest => ({
  id: r.id,
  subscriptionId: r.subscription_id,
  kind: r.kind,
  slot: r.slot?.toISOString() ?? null,
  status: r.status,
  title: r.title,
  summary: r.summary,
  articles: r.articles,
  windowStart: r.window_start.toISOString(),
  windowEnd: r.window_end.toISOString(),
  readAt: r.read_at?.toISOString() ?? null,
  createdAt: r.created_at.toISOString(),
});

export interface DigestServiceDeps {
  pool: pg.Pool;
  writer: DigestWriter;
  /** 예약 실행: 계정 한도 = 구독 수, 서비스 전체 하루 한도 */
  scheduledQuota: AiQuota;
  /** "지금 받아보기": 계정·IP·전체 하루 한도 */
  manualQuota: AiQuota;
  notifier: DigestNotifier;
}

/**
 * 뉴스 다이제스트 (F-09, 설계: requirements.md F-09 설계 표 · C-08).
 * 구독 조건(카테고리·키워드)에 맞는 최근 수집 기사 → AI 브리핑 → 앱 안 알림함에 저장하고 접속 중이면 바로 알린다.
 */
export class DigestService {
  constructor(private readonly deps: DigestServiceDeps) {}

  // ---------- 구독 ----------

  async listSubscriptions(userId: string): Promise<Subscription[]> {
    const { rows } = await this.deps.pool.query<SubscriptionRow>(
      'SELECT * FROM digest_subscriptions WHERE user_id = $1 ORDER BY id',
      [userId],
    );
    return rows.map(toSubscription);
  }

  /** 1인당 3개 — 같은 사용자의 동시 생성은 사용자 행 잠금으로 줄 세워 개수를 넘지 않게 한다 */
  async createSubscription(userId: string, input: SubscriptionInput): Promise<Subscription> {
    const client = await this.deps.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT 1 FROM users WHERE id = $1 FOR UPDATE', [userId]);
      const { rows: count } = await client.query<{ n: number }>(
        'SELECT count(*)::int AS n FROM digest_subscriptions WHERE user_id = $1',
        [userId],
      );
      if (count[0]!.n >= MAX_SUBSCRIPTIONS) {
        throw new DigestError('invalid', `구독은 ${MAX_SUBSCRIPTIONS}개까지 만들 수 있습니다`);
      }
      const { rows } = await client.query<SubscriptionRow>(
        `INSERT INTO digest_subscriptions (user_id, categories, keywords, send_hour) VALUES ($1, $2, $3, $4) RETURNING *`,
        [userId, input.categories, input.keywords, input.sendHour],
      );
      await client.query('COMMIT');
      return toSubscription(rows[0]!);
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async updateSubscription(
    userId: string,
    id: string,
    patch: Partial<SubscriptionInput> & { active?: boolean },
  ): Promise<Subscription> {
    const { rows } = await this.deps.pool.query<SubscriptionRow>(
      `UPDATE digest_subscriptions SET
         categories = coalesce($3, categories), keywords = coalesce($4, keywords),
         send_hour = coalesce($5, send_hour), active = coalesce($6, active), updated_at = now()
       WHERE id = $1 AND user_id = $2 RETURNING *`,
      [id, userId, patch.categories ?? null, patch.keywords ?? null, patch.sendHour ?? null, patch.active ?? null],
    );
    if (!rows[0]) throw new DigestError('not_found', '구독을 찾을 수 없습니다');
    return toSubscription(rows[0]);
  }

  /** 구독만 지우고 받은 알림은 남긴다 (subscription_id는 null) */
  async deleteSubscription(userId: string, id: string): Promise<void> {
    const { rowCount } = await this.deps.pool.query('DELETE FROM digest_subscriptions WHERE id = $1 AND user_id = $2', [
      id,
      userId,
    ]);
    if (!rowCount) throw new DigestError('not_found', '구독을 찾을 수 없습니다');
  }

  // ---------- 알림함 ----------

  async listDigests(
    userId: string,
    options: { before?: string; limit?: number } = {},
  ): Promise<{ digests: Digest[]; unread: number; nextBefore: string | null }> {
    const limit = options.limit ?? 20;
    const { rows } = await this.deps.pool.query<DigestRow>(
      `SELECT ${DIGEST_COLUMNS} FROM digests
       WHERE user_id = $1 AND status <> 'pending' AND ($2::bigint IS NULL OR id < $2)
       ORDER BY id DESC LIMIT $3`,
      [userId, options.before ?? null, limit + 1],
    );
    const { rows: unread } = await this.deps.pool.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM digests WHERE user_id = $1 AND read_at IS NULL AND status <> 'pending'`,
      [userId],
    );
    const page = rows.slice(0, limit).map(toDigest);
    return { digests: page, unread: unread[0]!.n, nextBefore: rows.length > limit ? page.at(-1)!.id : null };
  }

  async markRead(userId: string, id: string): Promise<void> {
    const { rowCount } = await this.deps.pool.query(
      `UPDATE digests SET read_at = coalesce(read_at, now()) WHERE id = $1 AND user_id = $2 AND status <> 'pending'`,
      [id, userId],
    );
    if (!rowCount) throw new DigestError('not_found', '알림을 찾을 수 없습니다');
  }

  async markAllRead(userId: string): Promise<void> {
    await this.deps.pool.query('UPDATE digests SET read_at = now() WHERE user_id = $1 AND read_at IS NULL', [userId]);
  }

  async deleteOldDigests(now: Date = new Date(), days = DIGEST_RETENTION_DAYS): Promise<number> {
    const { rowCount } = await this.deps.pool.query(
      'DELETE FROM digests WHERE created_at < $1::timestamptz - make_interval(days => $2)',
      [now, days],
    );
    return rowCount ?? 0;
  }

  // ---------- 만들기 ----------

  /**
   * 예약 실행 (5분마다). 받는 시각이 지났고 3시간이 넘지 않은 구독을 처리한다.
   * 구독을 만들기 전의 받는 시각은 건너뛴다(만들자마자 지난 시각 다이제스트가 오지 않게).
   * (구독, 받는 시각)에 pending 행을 먼저 넣은 실행만 진행하므로 겹쳐 실행돼도 한 번만 만든다.
   */
  async runDue(now: Date = new Date()): Promise<Digest[]> {
    const { rows: subs } = await this.deps.pool.query<SubscriptionRow>(
      'SELECT * FROM digest_subscriptions WHERE active ORDER BY id',
    );
    const made: Digest[] = [];
    for (const sub of subs) {
      const slot = latestSlot(now, sub.send_hour);
      if (now.getTime() - slot.getTime() > LATE_LIMIT_MS || sub.created_at > slot) continue;
      try {
        const digest = await this.runScheduled(sub, slot);
        if (digest) made.push(digest);
      } catch (error) {
        console.error('[digests] 생성 실패:', error instanceof Error ? error.message : error);
      }
    }
    return made;
  }

  private async runScheduled(sub: SubscriptionRow, slot: Date): Promise<Digest | null> {
    const { rows: previous } = await this.deps.pool.query<{ window_end: Date }>(
      `SELECT window_end FROM digests
       WHERE subscription_id = $1 AND kind = 'scheduled' AND status <> 'pending' AND slot < $2
       ORDER BY slot DESC LIMIT 1`,
      [sub.id, slot],
    );
    const windowStart = new Date(Math.max(previous[0]?.window_end.getTime() ?? 0, slot.getTime() - MAX_WINDOW_MS));
    const { rows: claimed } = await this.deps.pool.query<{ id: string }>(
      `INSERT INTO digests (user_id, subscription_id, kind, slot, window_start, window_end)
       VALUES ($1, $2, 'scheduled', $3, $4, $3)
       ON CONFLICT (subscription_id, slot) DO UPDATE SET created_at = now()
         WHERE digests.status = 'pending' AND digests.created_at < now() - make_interval(secs => $5)
       RETURNING id`,
      [sub.user_id, sub.id, slot, windowStart, STALE_PENDING_MS / 1000],
    );
    if (!claimed[0]) return null;
    return this.fill(claimed[0].id, sub, windowStart, slot, async () => {
      const quota = await this.deps.scheduledQuota.consume(DIGEST_FEATURE, sub.user_id, 'scheduler');
      return quota.ok ? () => this.deps.scheduledQuota.refund(DIGEST_FEATURE, sub.user_id, 'scheduler') : null;
    });
  }

  /** "지금 받아보기": 최근 24시간 기사로 바로 하나 만든다 (발표 시연용). 한도를 넘으면 QuotaError */
  async runNow(userId: string, subscriptionId: string, ip: string, now: Date = new Date()): Promise<Digest> {
    const { rows } = await this.deps.pool.query<SubscriptionRow>(
      'SELECT * FROM digest_subscriptions WHERE id = $1 AND user_id = $2',
      [subscriptionId, userId],
    );
    const sub = rows[0];
    if (!sub) throw new DigestError('not_found', '구독을 찾을 수 없습니다');
    const quota = await this.deps.manualQuota.consume(DIGEST_MANUAL_FEATURE, userId, ip);
    if (!quota.ok) throw new QuotaError(quota.scope, quota.limit);
    const refund = () => this.deps.manualQuota.refund(DIGEST_MANUAL_FEATURE, userId, ip);

    const windowStart = new Date(now.getTime() - MAX_WINDOW_MS);
    const { rows: claimed } = await this.deps.pool.query<{ id: string }>(
      `INSERT INTO digests (user_id, subscription_id, kind, window_start, window_end)
       VALUES ($1, $2, 'manual', $3, $4) RETURNING id`,
      [userId, sub.id, windowStart, now],
    );
    // 기사가 없어 AI를 부르지 않았으면 횟수를 돌려준다 (fill 안에서 처리)
    return (await this.fill(claimed[0]!.id, sub, windowStart, now, async () => refund, refund))!;
  }

  /**
   * pending 행을 채운다: 대상 기사 조회 → 없으면 empty(AI 호출 없음) → AI 브리핑(1번 재시도) →
   * 실패하거나 한도가 없으면 기사 목록만 담아 failed. 저장 후 사용자에게 알린다
   */
  private async fill(
    digestId: string,
    sub: SubscriptionRow,
    windowStart: Date,
    windowEnd: Date,
    acquire: () => Promise<(() => Promise<void>) | null>,
    onEmpty?: () => Promise<void>,
  ): Promise<Digest> {
    const articles = await this.findArticles(sub, windowStart, windowEnd);
    const topic = topicName({ categories: sub.categories, keywords: sub.keywords });
    const fallbackTitle = `${topic} 브리핑`;
    let result: { status: Digest['status']; title: string; summary: string | null };

    if (articles.length === 0) {
      await onEmpty?.();
      result = { status: 'empty', title: fallbackTitle, summary: null };
    } else {
      const refund = await acquire();
      result = { status: 'failed', title: fallbackTitle, summary: null };
      if (refund) {
        const input = articles.map((a) => ({ title: a.title, text: a.description, source: a.source }));
        for (let attempt = 0; attempt < 2 && result.status === 'failed'; attempt++) {
          try {
            const text = await this.deps.writer.write(topic, input);
            result = { status: 'ok', ...text };
          } catch (error) {
            if (!(error instanceof SummaryError)) throw error;
            console.warn('[digests] 요약 실패:', error.message);
          }
        }
        if (result.status === 'failed') await refund();
      }
    }

    const copied: DigestArticle[] = articles.map((a) => ({ id: a.id, title: a.title, source: a.source, link: a.original_link }));
    const { rows } = await this.deps.pool.query<DigestRow>(
      `UPDATE digests SET status = $2, title = $3, summary = $4, articles = $5::jsonb, created_at = now()
       WHERE id = $1 RETURNING ${DIGEST_COLUMNS}`,
      [digestId, result.status, result.title, result.summary, JSON.stringify(copied)],
    );
    const digest = toDigest(rows[0]!);
    this.deps.notifier.digestCreated(sub.user_id, digest);
    return digest;
  }

  /** 구간 안에 수집된 API 기사 중 카테고리에 속하거나 키워드가 제목·요약에 든 기사, 최신 발행순 20개 (링크 기사 제외 — C-06). 키워드의 %·_는 escapeLike로 막는다(LIKE 기본 이스케이프가 역슬래시) */
  private async findArticles(sub: SubscriptionRow, from: Date, to: Date) {
    const { rows } = await this.deps.pool.query<{
      id: string;
      title: string;
      description: string;
      source: string;
      original_link: string;
    }>(
      `SELECT id, title, description, source, original_link FROM articles
       WHERE source_type = 'api_collected' AND created_at > $1 AND created_at <= $2
         AND (category = ANY($3::text[])
              OR (title || ' ' || description) ILIKE ANY($4::text[]))
       ORDER BY published_at DESC NULLS LAST, id DESC LIMIT $5`,
      [from, to, sub.categories, sub.keywords.map((k) => `%${escapeLike(k)}%`), MAX_DIGEST_ARTICLES],
    );
    return rows;
  }
}
