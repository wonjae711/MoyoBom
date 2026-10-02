import { describe, expect, it } from 'vitest';
import { TEST_JWT_SECRET } from '../test/auth.js';
import {
  ACCESS_TOKEN_TTL_SECONDS,
  createRefreshToken,
  hashRefreshToken,
  signAccessToken,
  verifyAccessToken,
} from './tokens.js';

describe('access token', () => {
  it('서명한 사용자 id를 되돌려준다', async () => {
    const token = await signAccessToken('42', TEST_JWT_SECRET);
    expect(await verifyAccessToken(token, TEST_JWT_SECRET)).toBe('42');
  });

  it('다른 키로 서명된 토큰은 거부한다', async () => {
    const token = await signAccessToken('42', 'another-secret-that-is-at-least-32-chars!!');
    expect(await verifyAccessToken(token, TEST_JWT_SECRET)).toBeNull();
  });

  it('15분이 지나면 만료된다', async () => {
    const issuedAt = new Date(Date.now() - (ACCESS_TOKEN_TTL_SECONDS + 5) * 1000);
    const token = await signAccessToken('42', TEST_JWT_SECRET, issuedAt);
    expect(await verifyAccessToken(token, TEST_JWT_SECRET)).toBeNull();
  });

  it('위조·손상된 토큰은 거부한다', async () => {
    const token = await signAccessToken('42', TEST_JWT_SECRET);
    const [header, , signature] = token.split('.');
    const forgedPayload = Buffer.from(JSON.stringify({ sub: '1' })).toString('base64url');
    expect(await verifyAccessToken(`${header}.${forgedPayload}.${signature}`, TEST_JWT_SECRET)).toBeNull();
    expect(await verifyAccessToken('garbage', TEST_JWT_SECRET)).toBeNull();
  });
});

describe('refresh token', () => {
  it('원문과 다른 해시를 만들고, 같은 원문은 같은 해시가 된다', () => {
    const { token, hash } = createRefreshToken();
    expect(hash).not.toBe(token);
    expect(hashRefreshToken(token)).toBe(hash);
    expect(createRefreshToken().token).not.toBe(token);
  });
});
