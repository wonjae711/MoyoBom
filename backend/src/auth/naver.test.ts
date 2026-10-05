import { describe, expect, it, vi } from 'vitest';
import { NaverAuthError, buildNaverAuthorizeUrl, fetchNaverProfile, type NaverConfig } from './naver.js';

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

const base: NaverConfig = {
  clientId: 'naver-id',
  clientSecret: 'naver-secret',
  redirectUri: 'http://localhost:5173/api/auth/naver/callback',
};

/** 토큰 응답과 회원 정보 응답을 정해 주는 가짜 fetch */
function naverFetch(token: () => Response, profile: () => Response) {
  return vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    if (String(url).startsWith('https://nid.naver.com/oauth2.0/token')) {
      expect(Object.fromEntries(new URLSearchParams(String(init?.body)))).toEqual({
        grant_type: 'authorization_code',
        client_id: 'naver-id',
        client_secret: 'naver-secret',
        code: 'auth-code',
        state: 'state-1',
      });
      return token();
    }
    expect(new Headers(init?.headers).get('authorization')).toBe('Bearer naver-access');
    return profile();
  });
}

describe('네이버 로그인', () => {
  it('인가 주소에 클라이언트 아이디·Callback URL·state를 담는다', () => {
    const url = new URL(buildNaverAuthorizeUrl(base, 'state-1'));
    expect(url.origin + url.pathname).toBe('https://nid.naver.com/oauth2.0/authorize');
    expect(Object.fromEntries(url.searchParams)).toEqual({
      response_type: 'code',
      client_id: 'naver-id',
      redirect_uri: 'http://localhost:5173/api/auth/naver/callback',
      state: 'state-1',
    });
  });

  it('인가 코드를 토큰으로 바꾸고 회원 id·별명을 가져온다', async () => {
    const fetchFn = naverFetch(
      () => json({ access_token: 'naver-access', token_type: 'bearer' }),
      () => json({ resultcode: '00', message: 'success', response: { id: 'naver-user-1', nickname: '  홍길동  ' } }),
    );
    expect(await fetchNaverProfile({ ...base, fetchFn }, 'auth-code', 'state-1')).toEqual({
      providerId: 'naver-user-1',
      nickname: '홍길동',
    });
  });

  it('별명을 동의하지 않았으면 기본 이름을 쓴다', async () => {
    const fetchFn = naverFetch(
      () => json({ access_token: 'naver-access' }),
      () => json({ resultcode: '00', response: { id: 'u2' } }),
    );
    expect((await fetchNaverProfile({ ...base, fetchFn }, 'auth-code', 'state-1')).nickname).toBe('네이버 사용자');
  });

  it('[예외] 네이버가 200과 함께 error를 보내도 실패로 처리하고, 메시지에 키를 넣지 않는다', async () => {
    const fetchFn = naverFetch(
      () => json({ error: 'invalid_request', error_description: 'no valid data in session' }),
      () => json({}),
    );
    const error = (await fetchNaverProfile({ ...base, fetchFn }, 'auth-code', 'state-1').catch((e) => e)) as Error;
    expect(error).toBeInstanceOf(NaverAuthError);
    expect(error.message).toBe('네이버 로그인 실패: 토큰 발급 실패(invalid_request)');
    expect(error.message).not.toContain('naver-secret');
  });

  it('[예외] 회원 정보 조회 결과 코드가 성공(00)이 아니면 실패', async () => {
    const fetchFn = naverFetch(
      () => json({ access_token: 'naver-access' }),
      () => json({ resultcode: '024', message: 'Authentication failed' }),
    );
    await expect(fetchNaverProfile({ ...base, fetchFn }, 'auth-code', 'state-1')).rejects.toBeInstanceOf(NaverAuthError);
  });
});
