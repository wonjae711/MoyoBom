import express from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import type { AuthResult } from '../auth/service.js';
import { TEST_APP_ORIGIN } from '../test/auth.js';
import { createOAuthRouter, type OAuthRouteDeps } from './oauth.js';

const kakao = { restApiKey: 'rest-key', clientSecret: 'secret', redirectUri: `${TEST_APP_ORIGIN}/api/auth/kakao/callback` };

function makeApp(overrides: Partial<OAuthRouteDeps> = {}) {
  const loginWithSocial = vi.fn(
    async (): Promise<AuthResult> => ({
      user: { id: '9', email: null, nickname: '홍길동', provider: 'kakao' },
      tokens: { accessToken: 'our-access', refreshToken: 'our-refresh' },
    }),
  );
  const app = express();
  app.use('/api/auth', createOAuthRouter({ auth: { loginWithSocial }, cookies: { secure: false }, appOrigin: TEST_APP_ORIGIN, kakao, ...overrides }));
  return { app, loginWithSocial };
}

function setCookies(res: request.Response): string[] {
  return (res.headers['set-cookie'] as unknown as string[] | undefined) ?? [];
}

describe('소셜 로그인 라우트', () => {
  it('사용 가능한 소셜 로그인 목록을 알려준다', async () => {
    expect((await request(makeApp().app).get('/api/auth/providers')).body).toEqual({ kakao: true, naver: false });
    expect((await request(makeApp({ kakao: null }).app).get('/api/auth/providers')).body).toEqual({
      kakao: false,
      naver: false,
    });
  });

  it('카카오 로그인을 누르면 state 쿠키를 저장하고 카카오 인가 페이지로 보낸다', async () => {
    const res = await request(makeApp().app).get('/api/auth/kakao');
    expect(res.status).toBe(302);
    const location = new URL(res.headers.location!);
    expect(location.host).toBe('kauth.kakao.com');

    const stateCookie = setCookies(res).find((c) => c.startsWith('oauth_state='))!;
    expect(stateCookie).toMatch(/HttpOnly/);
    expect(stateCookie.split(';')[0]).toBe(`oauth_state=${location.searchParams.get('state')}`);
  });

  it('콜백의 state가 맞으면 로그인 쿠키를 주고 화면으로 보낸다', async () => {
    const { app, loginWithSocial } = makeApp();
    // 카카오 사용자 정보 조회 대신 가짜 fetch 사용
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string | URL | Request) =>
        String(url).includes('/oauth/token')
          ? Response.json({ access_token: 'kakao-access' })
          : Response.json({ id: 42, kakao_account: { profile: { nickname: '홍길동' } } }),
      ),
    );
    const res = await request(app)
      .get('/api/auth/kakao/callback?code=abc&state=s1')
      .set('Cookie', 'oauth_state=s1');
    vi.unstubAllGlobals();

    expect(res.status).toBe(302);
    expect(res.headers.location).toBe(`${TEST_APP_ORIGIN}/`);
    expect(loginWithSocial).toHaveBeenCalledWith({ provider: 'kakao', providerId: '42', nickname: '홍길동' });
    expect(setCookies(res).some((c) => c.startsWith('access_token=our-access'))).toBe(true);
  });

  it('[보안] state가 없거나 다르면 로그인하지 않는다 (CSRF 방지)', async () => {
    const { app, loginWithSocial } = makeApp();
    const mismatch = await request(app).get('/api/auth/kakao/callback?code=abc&state=attacker').set('Cookie', 'oauth_state=s1');
    const missing = await request(app).get('/api/auth/kakao/callback?code=abc&state=s1');
    expect(mismatch.headers.location).toBe(`${TEST_APP_ORIGIN}/login?error=kakao_invalid`);
    expect(missing.headers.location).toBe(`${TEST_APP_ORIGIN}/login?error=kakao_invalid`);
    expect(loginWithSocial).not.toHaveBeenCalled();
  });

  it('[예외] 사용자가 카카오 동의 화면에서 취소하면 로그인 화면으로 돌려보낸다', async () => {
    const res = await request(makeApp().app)
      .get('/api/auth/kakao/callback?error=access_denied&state=s1')
      .set('Cookie', 'oauth_state=s1');
    expect(res.headers.location).toBe(`${TEST_APP_ORIGIN}/login?error=kakao_cancelled`);
  });

  it('[예외] 카카오 통신이 실패하면 로그인 화면에 실패를 알린다', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ error_code: 'KOE320' }, { status: 400 })));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = await request(makeApp().app)
      .get('/api/auth/kakao/callback?code=expired&state=s1')
      .set('Cookie', 'oauth_state=s1');
    vi.unstubAllGlobals();
    expect(res.headers.location).toBe(`${TEST_APP_ORIGIN}/login?error=kakao_failed`);
  });

  it('카카오 키가 없으면 로그인 화면으로 돌려보낸다', async () => {
    const res = await request(makeApp({ kakao: null }).app).get('/api/auth/kakao');
    expect(res.headers.location).toBe(`${TEST_APP_ORIGIN}/login?error=kakao_unavailable`);
  });
});
