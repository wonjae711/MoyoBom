import type pg from 'pg';

/** 모든 테이블을 비운다 (users·articles를 지우면 보드·카드 등 딸린 데이터도 함께 지워진다) */
export async function resetDb(pool: pg.Pool): Promise<void> {
  await pool.query('TRUNCATE users, articles RESTART IDENTITY CASCADE');
}

/** 테스트용 이메일 가입 사용자. id를 돌려준다 */
export async function createUser(pool: pg.Pool, nickname: string): Promise<string> {
  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO users (email, password_hash, provider, nickname) VALUES ($1, 'scrypt$x', 'local', $2) RETURNING id`,
    [`${nickname}-${Math.random().toString(36).slice(2)}@example.com`, nickname],
  );
  return rows[0]!.id;
}

/** 테스트용 수집 기사. id를 돌려준다 */
export async function createArticle(pool: pg.Pool, title: string, createdAt?: Date): Promise<string> {
  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO articles (title, description, source, category, original_link, source_type, published_at, created_at)
     VALUES ($1, '요약', '한겨레', 'economy', $2, 'api_collected', now(), coalesce($3, now())) RETURNING id`,
    [title, `https://e.com/${encodeURIComponent(title)}-${Math.random().toString(36).slice(2)}`, createdAt ?? null],
  );
  return rows[0]!.id;
}
