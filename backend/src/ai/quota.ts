import type pg from 'pg';

/** 하루 한도 (2026-10-04 확정 B: 계정 + IP + 서비스 전체). 값은 환경 변수로 바꿀 수 있다 */
export interface QuotaLimits {
  user: number;
  ip: number;
  total: number;
}

export type QuotaScope = keyof QuotaLimits;

export type QuotaResult = { ok: true; remaining: number } | { ok: false; scope: QuotaScope; limit: number };

/**
 * 비용이 드는 AI 호출의 하루 사용량 (F-03, C-07). 한국 시간 자정에 새로 센다.
 * 세 한도(계정·IP·전체)를 한 트랜잭션에서 함께 차감해, 하나라도 넘으면 아무것도 차감하지 않는다.
 * 행 단위 원자적 증가(조건부 UPSERT)라 동시에 요청해도 한도를 넘지 않는다.
 */
export class AiQuota {
  constructor(
    private readonly pool: pg.Pool,
    private readonly limits: QuotaLimits,
  ) {}

  async consume(feature: string, userId: string, ip: string): Promise<QuotaResult> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const checks: [QuotaScope, string][] = [
        ['user', userId],
        ['ip', ip],
        ['total', 'all'],
      ];
      let userCount = 0;
      for (const [scope, subject] of checks) {
        const limit = this.limits[scope];
        const { rows } = await client.query<{ count: number }>(
          `INSERT INTO ai_usage (day, feature, scope, subject, count)
           VALUES ((now() AT TIME ZONE 'Asia/Seoul')::date, $1, $2, $3, 1)
           ON CONFLICT (day, feature, scope, subject)
             DO UPDATE SET count = ai_usage.count + 1 WHERE ai_usage.count < $4
           RETURNING count`,
          [feature, scope, subject, limit],
        );
        if (!rows[0] || limit <= 0) {
          await client.query('ROLLBACK');
          return { ok: false, scope, limit };
        }
        if (scope === 'user') userCount = rows[0].count;
      }
      await client.query('COMMIT');
      return { ok: true, remaining: Math.max(0, this.limits.user - userCount) };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  /** 요약이 끝내 실패하면 차감한 1회를 돌려준다 (사용자 탓이 아닌 실패로 하루 횟수가 줄지 않도록) */
  async refund(feature: string, userId: string, ip: string): Promise<void> {
    await this.pool.query(
      `UPDATE ai_usage SET count = greatest(count - 1, 0)
       WHERE day = (now() AT TIME ZONE 'Asia/Seoul')::date AND feature = $1
         AND ((scope = 'user' AND subject = $2) OR (scope = 'ip' AND subject = $3) OR (scope = 'total' AND subject = 'all'))`,
      [feature, userId, ip],
    );
  }

  /** 오늘 이 계정이 더 쓸 수 있는 횟수 */
  async remaining(feature: string, userId: string): Promise<number> {
    const { rows } = await this.pool.query<{ count: number }>(
      `SELECT count FROM ai_usage
       WHERE day = (now() AT TIME ZONE 'Asia/Seoul')::date AND feature = $1 AND scope = 'user' AND subject = $2`,
      [feature, userId],
    );
    return Math.max(0, this.limits.user - (rows[0]?.count ?? 0));
  }
}
