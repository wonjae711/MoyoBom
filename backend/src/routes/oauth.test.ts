import express from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import type { AuthResult } from '../auth/service.js';
import { TEST_APP_ORIGIN } from '../test/auth.js';
import { createOAuthRouter, safeNextPath, type OAuthRouteDeps } from './oauth.js';

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

  it('[C-12] 로그인 후 돌아갈 화면(next)을 기억했다가 로그인이 끝나면 그 화면으로 보낸다', async () => {
    const start = await request(makeApp().app).get('/api/auth/kakao?next=%2Finvite%2Fabc_DEF-1');
    const nextCookie = setCookies(start).find((c) => c.startsWith('oauth_next='))!;
    expect(nextCookie).toMatch(/HttpOnly/);

    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string | URL | Request) =>
        String(url).includes('/oauth/token')
          ? Response.json({ access_token: 'kakao-access' })
          : Response.json({ id: 42, kakao_account: { profile: { nickname: '홍길동' } } }),
      ),
    );
    const res = await request(makeApp().app)
      .get('/api/auth/kakao/callback?code=abc&state=s1')
      .set('Cookie', `oauth_state=s1; ${nextCookie.split(';')[0]}`);
    vi.unstubAllGlobals();
    expect(res.headers.location).toBe(`${TEST_APP_ORIGIN}/invite/abc_DEF-1`);
  });

  it.each(['//evil.example', '/\\evil.example', 'https://evil.example', 'invite/x', '/a b', '/' + 'a'.repeat(250)])(
    '[보안] 다른 사이트로 새는 next(%s)는 받지 않는다 (오픈 리다이렉트 방지)',
    (value) => {
      expect(safeNextPath(value)).toBeNull();
    },
  );

  it('[보안] 쿠키가 조작돼 외부 주소가 들어 있어도 우리 화면(/)으로 보낸다', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string | URL | Request) =>
        String(url).includes('/oauth/token')
          ? Response.json({ access_token: 'kakao-access' })
          : Response.json({ id: 42, kakao_account: { profile: { nickname: '홍길동' } } }),
      ),
    );
    const res = await request(makeApp().app)
      .get('/api/auth/kakao/callback?code=abc&state=s1')
      .set('Cookie', 'oauth_state=s1; oauth_next=%2F%2Fevil.example');
    vi.unstubAllGlobals();
    expect(res.headers.location).toBe(`${TEST_APP_ORIGIN}/`);
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

  it('[네이버] 같은 흐름으로 state 쿠키를 두고 인가 페이지로 보낸 뒤, 콜백에서 로그인하고 원래 화면으로 보낸다', async () => {
    const naver = { clientId: 'naver-id', clientSecret: 'naver-secret', redirectUri: `${TEST_APP_ORIGIN}/api/auth/naver/callback` };
    const { app, loginWithSocial } = makeApp({ naver });
    expect((await request(app).get('/api/auth/providers')).body).toEqual({ kakao: true, naver: true });

    const start = await request(app).get('/api/auth/naver?next=%2Finvite%2Fabc');
    const location = new URL(start.headers.location!);
    expect(location.host).toBe('nid.naver.com');
    const cookies = setCookies(start);
    const stateCookie = cookies.find((c) => c.startsWith('oauth_state='))!;
    expect(stateCookie).toMatch(/Path=\/api\/auth\/naver/);
    const state = location.searchParams.get('state')!;

    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string | URL | Request) =>
        String(url).includes('nid.naver.com/oauth2.0/token')
          ? Response.json({ access_token: 'naver-access' })
          : Response.json({ resultcode: '00', response: { id: 'naver-9', nickname: '네이버친구' } }),
      ),
    );
    const res = await request(app)
      .get(`/api/auth/naver/callback?code=abc&state=${state}`)
      .set('Cookie', cookies.map((c) => c.split(';')[0]).join('; '));
    vi.unstubAllGlobals();
    expect(res.headers.location).toBe(`${TEST_APP_ORIGIN}/invite/abc`);
    expect(loginWithSocial).toHaveBeenCalledWith({ provider: 'naver', providerId: 'naver-9', nickname: '네이버친구' });
    expect(setCookies(res).some((c) => c.startsWith('access_token='))).toBe(true);
  });

  it('[네이버] 취소·state 불일치·키 없음은 네이버용 안내 코드로 로그인 화면에 돌려보낸다', async () => {
    const naver = { clientId: 'naver-id', clientSecret: 'naver-secret', redirectUri: `${TEST_APP_ORIGIN}/api/auth/naver/callback` };
    const { app, loginWithSocial } = makeApp({ naver });
    const cancelled = await request(app)
      .get('/api/auth/naver/callback?error=access_denied&state=s1')
      .set('Cookie', 'oauth_state=s1');
    expect(cancelled.headers.location).toBe(`${TEST_APP_ORIGIN}/login?error=naver_cancelled`);
    const invalid = await request(app).get('/api/auth/naver/callback?code=abc&state=attacker').set('Cookie', 'oauth_state=s1');
    expect(invalid.headers.location).toBe(`${TEST_APP_ORIGIN}/login?error=naver_invalid`);
    expect((await request(makeApp().app).get('/api/auth/naver')).headers.location).toBe(
      `${TEST_APP_ORIGIN}/login?error=naver_unavailable`,
    );
    expect(loginWithSocial).not.toHaveBeenCalled();
  });

  it('카카오 키가 없으면 로그인 화면으로 돌려보낸다', async () => {
    const res = await request(makeApp({ kakao: null }).app).get('/api/auth/kakao');
    expect(res.headers.location).toBe(`${TEST_APP_ORIGIN}/login?error=kakao_unavailable`);
  });
});
