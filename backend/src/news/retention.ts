import type pg from 'pg';

/** 보관 기간 (requirements.md F-01 처리 로직 7, 기본안) */
export const RETENTION_DAYS = 30;

/**
 * 어떤 보드에도 올라가지 않은 수집 기사 중 오래된 것을 지운다.
 * 사용자가 링크로 추가한 기사(user_submitted)와 보드에 올라간 기사는 남긴다.
 * 수집 시각(created_at) 기준이라, 발행일이 오래된 기사라도 최근에 수집했으면 남는다.
 */
export async function deleteStaleArticles(pool: pg.Pool, now: Date = new Date(), days = RETENTION_DAYS): Promise<number> {
  const { rowCount } = await pool.query(
    `DELETE FROM articles a
     WHERE a.source_type = 'api_collected'
       AND a.created_at < $1::timestamptz - make_interval(days => $2)
       AND NOT EXISTS (SELECT 1 FROM board_items bi WHERE bi.article_id = a.id)`,
    [now, days],
  );
  return rowCount ?? 0;
}
