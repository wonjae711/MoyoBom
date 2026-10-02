import type pg from 'pg';

export type Provider = 'local' | 'kakao' | 'naver';

/** 화면에 내려주는 사용자 정보 (비밀번호 해시 등은 포함하지 않는다) */
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
  password_hash: string | null;
}

function toPublicUser(row: UserRow): PublicUser {
  return { id: row.id, email: row.email, nickname: row.nickname, provider: row.provider };
}

/** 이메일 중복이면 null (users_local_email_key 위반) */
export async function createLocalUser(
  pool: pg.Pool,
  input: { email: string; passwordHash: string; nickname: string },
): Promise<PublicUser | null> {
  const { rows } = await pool.query<UserRow>(
    `INSERT INTO users (email, password_hash, provider, nickname)
     VALUES ($1, $2, 'local', $3)
     ON CONFLICT (lower(email)) WHERE provider = 'local' DO NOTHING
     RETURNING id, email, nickname, provider, password_hash`,
    [input.email, input.passwordHash, input.nickname],
  );
  return rows[0] ? toPublicUser(rows[0]) : null;
}

export async function findLocalUserByEmail(
  pool: pg.Pool,
  email: string,
): Promise<{ user: PublicUser; passwordHash: string } | null> {
  const { rows } = await pool.query<UserRow>(
    `SELECT id, email, nickname, provider, password_hash FROM users
     WHERE provider = 'local' AND lower(email) = lower($1)`,
    [email],
  );
  const row = rows[0];
  return row?.password_hash ? { user: toPublicUser(row), passwordHash: row.password_hash } : null;
}

export async function findUserById(pool: pg.Pool, id: string): Promise<PublicUser | null> {
  const { rows } = await pool.query<UserRow>(
    'SELECT id, email, nickname, provider, password_hash FROM users WHERE id = $1',
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
