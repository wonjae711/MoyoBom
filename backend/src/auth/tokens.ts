import { createHash, randomBytes } from 'node:crypto';
import { SignJWT, jwtVerify } from 'jose';

/** access token 15분 / refresh token 14일 (requirements.md F-07 토큰 정책) */
export const ACCESS_TOKEN_TTL_SECONDS = 15 * 60;
export const REFRESH_TOKEN_TTL_SECONDS = 14 * 24 * 60 * 60;

const ALGORITHM = 'HS256';

function keyOf(secret: string): Uint8Array {
  return new TextEncoder().encode(secret);
}

export async function signAccessToken(userId: string, secret: string, now: Date = new Date()): Promise<string> {
  const issuedAt = Math.floor(now.getTime() / 1000);
  return new SignJWT({})
    .setProtectedHeader({ alg: ALGORITHM })
    .setSubject(userId)
    .setIssuedAt(issuedAt)
    .setExpirationTime(issuedAt + ACCESS_TOKEN_TTL_SECONDS)
    .sign(keyOf(secret));
}

/** 유효하면 사용자 id, 서명이 틀리거나 만료됐으면 null */
export async function verifyAccessToken(token: string, secret: string): Promise<string | null> {
  try {
    const { payload } = await jwtVerify(token, keyOf(secret), { algorithms: [ALGORITHM] });
    return typeof payload.sub === 'string' && /^\d+$/.test(payload.sub) ? payload.sub : null;
  } catch {
    return null;
  }
}

/** refresh token 원문은 쿠키로만 보내고, DB에는 SHA-256 해시만 저장한다 */
export function createRefreshToken(): { token: string; hash: string } {
  const token = randomBytes(32).toString('base64url');
  return { token, hash: hashRefreshToken(token) };
}

export function hashRefreshToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}
