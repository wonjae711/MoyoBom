import { describe, expect, it, vi } from 'vitest';
import { KakaoAuthError, buildKakaoAuthorizeUrl, fetchKakaoProfile, type KakaoConfig } from './kakao.js';

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

const base: KakaoConfig = {
  restApiKey: 'rest-key',
  clientSecret: 'client-secret',
  redirectUri: 'http://localhost:5173/api/auth/kakao/callback',
};

describe('카카오 로그인', () => {
  it('인가 주소에 REST API 키·리다이렉트 URI·state를 담는다', () => {
    const url = new URL(buildKakaoAuthorizeUrl(base, 'state-123'));
    expect(url.origin + url.pathname).toBe('https://kauth.kakao.com/oauth/authorize');
    expect(Object.fromEntries(url.searchParams)).toEqual({
      client_id: 'rest-key',
      redirect_uri: 'http://localhost:5173/api/auth/kakao/callback',
      response_type: 'code',
      state: 'state-123',
    });
  });

  it('인가 코드를 토큰으로 바꾸고 사용자 id·닉네임을 가져온다', async () => {
    const fetchFn = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      if (String(url).startsWith('https://kauth.kakao.com/oauth/token')) {
        const body = new URLSearchParams(String(init?.body));
        expect(Object.fromEntries(body)).toMatchObject({
          grant_type: 'authorization_code',
          client_id: 'rest-key',
          client_secret: 'client-secret',
          code: 'auth-code',
        });
        return json({ access_token: 'kakao-access' });
      }
      expect((init?.headers as Record<string, string>).Authorization).toBe('Bearer kakao-access');
      return json({ id: 1234567890, kakao_account: { profile: { nickname: '홍길동' } } });
    });

    expect(await fetchKakaoProfile({ ...base, fetchFn }, 'auth-code')).toEqual({
      providerId: '1234567890',
      nickname: '홍길동',
    });
  });

  it('닉네임이 없으면 기본 이름, 20자가 넘으면 자른다', async () => {
    const profileWith = (nickname?: string) =>
      vi.fn(async (url: string | URL | Request) =>
        String(url).includes('/oauth/token')
          ? json({ access_token: 't' })
          : json({ id: 1, kakao_account: { profile: nickname === undefined ? {} : { nickname } } }),
      );
    expect((await fetchKakaoProfile({ ...base, fetchFn: profileWith() }, 'c')).nickname).toBe('카카오 사용자');
    expect((await fetchKakaoProfile({ ...base, fetchFn: profileWith('가'.repeat(30)) }, 'c')).nickname).toHaveLength(20);
  });

  it('[예외] 토큰 발급 실패는 에러 코드만 담아 알리고 키는 노출하지 않는다', async () => {
    const fetchFn = vi.fn(async () => json({ error: 'invalid_grant', error_code: 'KOE320' }, 400));
    const error = await fetchKakaoProfile({ ...base, fetchFn }, 'bad').catch((e: Error) => e);
    expect(error).toBeInstanceOf(KakaoAuthError);
    expect((error as Error).message).toContain('KOE320');
    expect((error as Error).message).not.toContain('client-secret');
  });

  it('[예외] 네트워크 오류·타임아웃도 KakaoAuthError로 감싼다', async () => {
    const fetchFn = vi.fn(async () => {
      throw new TypeError('fetch failed');
    });
    await expect(fetchKakaoProfile({ ...base, fetchFn }, 'c')).rejects.toBeInstanceOf(KakaoAuthError);
  });
});
