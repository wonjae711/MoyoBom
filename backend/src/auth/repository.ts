import type pg from 'pg';

/** 'local'은 2026-10-06에 없앤 이메일 가입의 예전 계정 (더 이상 로그인할 수 없다) */
export type Provider = 'local' | 'kakao' | 'naver';

/** 화면에 내려주는 사용자 정보 */
export interface PublicUser {
  id: string;
  email: string | null;
  nickname: string;
  provider: Provider;
}

interface UserRow {
  id: string;
  email: string | null;
  nickname: string;
  provider: Provider;
}

function toPublicUser(row: UserRow): PublicUser {
  return { id: row.id, email: row.email, nickname: row.nickname, provider: row.provider };
}

export async function upsertSocialUser(
  pool: pg.Pool,
  input: { provider: Exclude<Provider, 'local'>; providerId: string; nickname: string },
): Promise<PublicUser> {
  const { rows } = await pool.query<UserRow>(
    `INSERT INTO users (provider, provider_id, nickname)
     VALUES ($1, $2, $3)
     ON CONFLICT (provider, provider_id) WHERE provider_id IS NOT NULL
       DO UPDATE SET updated_at = now()
     RETURNING id, email, nickname, provider`,
    [input.provider, input.providerId, input.nickname],
  );
  return toPublicUser(rows[0]!);
}

export async function findUserById(pool: pg.Pool, id: string): Promise<PublicUser | null> {
  const { rows } = await pool.query<UserRow>(
    'SELECT id, email, nickname, provider FROM users WHERE id = $1',
    [id],
  );
  return rows[0] ? toPublicUser(rows[0]) : null;
}

export async function saveRefreshToken(pool: pg.Pool, userId: string, hash: string, expiresAt: Date): Promise<void> {
  await pool.query('INSERT INTO refresh_tokens (user_id, token_hash, expires_at) VALUES ($1, $2, $3)', [
    userId,
    hash,
    expiresAt,
  ]);
}

/**
 * refresh token을 한 번 쓰고 없앤다(회전). 유효하면 주인의 user id, 없거나 만료됐으면 null.
 * DELETE ... RETURNING으로 처리해 같은 토큰으로 동시에 두 번 갱신해도 한쪽만 성공한다.
 */
export async function consumeRefreshToken(pool: pg.Pool, hash: string, now: Date): Promise<string | null> {
  const { rows } = await pool.query<{ user_id: string; expires_at: Date }>(
    'DELETE FROM refresh_tokens WHERE token_hash = $1 RETURNING user_id, expires_at',
    [hash],
  );
  const row = rows[0];
  return row && row.expires_at > now ? row.user_id : null;
}

export async function deleteRefreshToken(pool: pg.Pool, hash: string): Promise<void> {
  await pool.query('DELETE FROM refresh_tokens WHERE token_hash = $1', [hash]);
}
