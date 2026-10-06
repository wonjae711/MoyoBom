import type pg from 'pg';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../app.js';
import { ACCESS_COOKIE, REFRESH_COOKIE } from '../auth/http.js';
import { AuthService } from '../auth/service.js';
import { TEST_APP_ORIGIN, TEST_JWT_SECRET, fakeBoardDeps, fakeOAuthDeps } from '../test/auth.js';
import { createTestPool, testDatabaseUrl } from '../test/db.js';

/** Set-Cookie 헤더에서 이름=값과 속성들을 꺼낸다 */
function cookieOf(res: request.Response, name: string): string | undefined {
  const raw = res.headers['set-cookie'] as unknown as string[] | undefined;
  return raw?.find((c) => c.startsWith(`${name}=`));
}

describe.skipIf(!testDatabaseUrl)('인증 API (DB)', () => {
  let pool: pg.Pool;
  let service: AuthService;
  let app: ReturnType<typeof createApp>;

  /** 카카오로 로그인한 상태의 쿠키 (소셜 콜백이 심어 주는 것과 같다) */
  async function session(providerId = '42') {
    const { tokens } = await service.loginWithSocial({ provider: 'kakao', providerId, nickname: '기자' });
    return { access: `${ACCESS_COOKIE}=${tokens.accessToken}`, refresh: `${REFRESH_COOKIE}=${tokens.refreshToken}` };
  }

  beforeAll(() => {
    pool = createTestPool();
  });
  beforeEach(async () => {
    await pool.query('TRUNCATE users, refresh_tokens RESTART IDENTITY CASCADE');
    service = new AuthService({ pool, jwtSecret: TEST_JWT_SECRET });
    app = createApp({
      checkDb: async () => true,
      articles: { listFeed: async () => ({ articles: [], nextCursor: null, collectedCursor: null }) },
      auth: { auth: service, jwtSecret: TEST_JWT_SECRET, cookies: { secure: false } },
      oauth: fakeOAuthDeps(),
      boards: fakeBoardDeps(),
      appOrigin: TEST_APP_ORIGIN,
    });
  });
  afterAll(async () => {
    await pool.end();
  });

  it('이메일 가입·로그인 API는 없다 (2026-10-06 소셜 로그인만 남김)', async () => {
    const body = { email: 'reporter@example.com', password: 'correct-horse-9', nickname: '기자' };
    expect((await request(app).post('/api/auth/signup').send(body)).status).toBe(404);
    expect((await request(app).post('/api/auth/login').send(body)).status).toBe(404);
    const { rows } = await pool.query(`SELECT column_name FROM information_schema.columns WHERE table_name = 'users'`);
    expect(rows.map((r: { column_name: string }) => r.column_name)).not.toContain('password_hash');
  });

  describe('로그인 유지·로그아웃', () => {
    it('[수용 기준] 로그인하지 않으면 보호된 API(피드·내 정보)에 접근할 수 없다', async () => {
      expect((await request(app).get('/api/auth/me')).status).toBe(401);
      expect((await request(app).get('/api/articles')).status).toBe(401);
    });

    it('로그인한 쿠키로 내 정보와 피드를 볼 수 있다', async () => {
      const { access } = await session();
      const me = await request(app).get('/api/auth/me').set('Cookie', access);
      expect(me.status).toBe(200);
      expect(me.body.user).toMatchObject({ nickname: '기자', provider: 'kakao' });
      expect((await request(app).get('/api/articles').set('Cookie', access)).status).toBe(200);
    });

    it('refresh token은 한 번 쓰면 새 토큰으로 바뀌고, 예전 토큰은 다시 쓸 수 없다', async () => {
      const { refresh: oldRefresh } = await session();
      const first = await request(app).post('/api/auth/refresh').set('Cookie', oldRefresh);
      expect(first.status).toBe(200);
      expect(JSON.stringify(first.body)).not.toMatch(/token/i); // 토큰은 httpOnly 쿠키로만
      const newRefresh = cookieOf(first, 'refresh_token')!.split(';')[0]!;
      expect(newRefresh).not.toBe(oldRefresh);

      expect((await request(app).post('/api/auth/refresh').set('Cookie', oldRefresh)).status).toBe(401);
      expect((await request(app).post('/api/auth/refresh').set('Cookie', newRefresh)).status).toBe(200);
    });

    it('만료된 refresh token은 거절한다', async () => {
      const { refresh } = await session();
      await pool.query("UPDATE refresh_tokens SET expires_at = now() - interval '1 second'");
      expect((await request(app).post('/api/auth/refresh').set('Cookie', refresh)).status).toBe(401);
    });

    it('로그아웃하면 refresh token이 폐기되고 쿠키가 지워진다', async () => {
      const { refresh } = await session();
      const logout = await request(app).post('/api/auth/logout').set('Cookie', refresh);
      expect(logout.status).toBe(204);
      expect(cookieOf(logout, 'access_token')).toMatch(/Expires=Thu, 01 Jan 1970/);
      expect((await request(app).post('/api/auth/refresh').set('Cookie', refresh)).status).toBe(401);
    });
  });

  describe('소셜 로그인 사용자', () => {
    it('같은 카카오 계정은 두 번째 로그인 때 새로 가입되지 않고, 바꾼 닉네임도 덮어쓰지 않는다', async () => {
      const first = await service.loginWithSocial({ provider: 'kakao', providerId: '42', nickname: '홍길동' });
      await pool.query("UPDATE users SET nickname = '새이름' WHERE id = $1", [first.user.id]);
      const second = await service.loginWithSocial({ provider: 'kakao', providerId: '42', nickname: '홍길동' });

      expect(second.user).toEqual({ id: first.user.id, email: null, nickname: '새이름', provider: 'kakao' });
      const { rows } = await pool.query('SELECT count(*)::int AS n FROM users');
      expect(rows[0]).toEqual({ n: 1 });
    });
  });

  describe('[보안] CSRF 방지', () => {
    it('다른 사이트(Origin)에서 보낸 인증 요청은 거절한다', async () => {
      const { refresh } = await session();
      const res = await request(app).post('/api/auth/logout').set('Origin', 'https://evil.example').set('Cookie', refresh);
      expect(res.status).toBe(403);
      expect((await request(app).post('/api/auth/refresh').set('Cookie', refresh)).status).toBe(200); // 폐기되지 않음
    });

    it('우리 화면 주소에서 온 요청은 통과한다', async () => {
      const { refresh } = await session();
      expect((await request(app).post('/api/auth/refresh').set('Origin', TEST_APP_ORIGIN).set('Cookie', refresh)).status).toBe(200);
    });
  });
});
