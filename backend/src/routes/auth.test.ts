import type pg from 'pg';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../app.js';
import { LoginRateLimiter } from '../auth/rateLimit.js';
import { AuthService } from '../auth/service.js';
import { TEST_APP_ORIGIN, TEST_JWT_SECRET } from '../test/auth.js';
import { createTestPool, testDatabaseUrl } from '../test/db.js';

const user = { email: 'Reporter@Example.com', password: 'correct-horse-9', nickname: '기자' };

/** Set-Cookie 헤더에서 이름=값과 속성들을 꺼낸다 */
function cookieOf(res: request.Response, name: string): string | undefined {
  const raw = res.headers['set-cookie'] as unknown as string[] | undefined;
  return raw?.find((c) => c.startsWith(`${name}=`));
}

describe.skipIf(!testDatabaseUrl)('인증 API (DB)', () => {
  let pool: pg.Pool;
  let limiter: LoginRateLimiter;
  let app: ReturnType<typeof createApp>;

  beforeAll(() => {
    pool = createTestPool();
  });
  beforeEach(async () => {
    await pool.query('TRUNCATE users, refresh_tokens RESTART IDENTITY CASCADE');
    limiter = new LoginRateLimiter(3, 60_000);
    app = createApp({
      checkDb: async () => true,
      articles: { listFeed: async () => ({ articles: [], nextCursor: null }) },
      auth: {
        auth: new AuthService({ pool, jwtSecret: TEST_JWT_SECRET }),
        loginLimiter: limiter,
        jwtSecret: TEST_JWT_SECRET,
        cookies: { secure: false },
      },
      appOrigin: TEST_APP_ORIGIN,
    });
  });
  afterAll(async () => {
    await pool.end();
  });

  describe('회원가입', () => {
    it('가입하면 바로 로그인 상태가 되고, 토큰은 httpOnly 쿠키로만 준다', async () => {
      const res = await request(app).post('/api/auth/signup').send(user);
      expect(res.status).toBe(201);
      expect(res.body.user).toEqual({ id: '1', email: 'reporter@example.com', nickname: '기자', provider: 'local' });
      expect(JSON.stringify(res.body)).not.toMatch(/token|password/i);

      const access = cookieOf(res, 'access_token');
      const refresh = cookieOf(res, 'refresh_token');
      expect(access).toMatch(/HttpOnly/);
      expect(access).toMatch(/SameSite=Lax/);
      expect(refresh).toMatch(/HttpOnly/);
      expect(refresh).toMatch(/SameSite=Strict/);
      expect(refresh).toMatch(/Path=\/api\/auth/);
    });

    it('비밀번호는 해시로만 저장한다', async () => {
      await request(app).post('/api/auth/signup').send(user);
      const { rows } = await pool.query<{ password_hash: string }>('SELECT password_hash FROM users');
      expect(rows[0]?.password_hash).toMatch(/^scrypt\$/);
      expect(rows[0]?.password_hash).not.toContain(user.password);
    });

    it('대소문자만 다른 같은 이메일로는 다시 가입할 수 없다 (409)', async () => {
      await request(app).post('/api/auth/signup').send(user);
      const res = await request(app)
        .post('/api/auth/signup')
        .send({ ...user, email: 'REPORTER@example.com' });
      expect(res.status).toBe(409);
    });

    it.each([
      [{ ...user, email: 'not-an-email' }, 'email'],
      [{ ...user, password: 'short' }, 'password'],
      [{ ...user, nickname: '   ' }, 'nickname'],
    ])('입력값이 잘못되면 400 (%#)', async (body, field) => {
      const res = await request(app).post('/api/auth/signup').send(body);
      expect(res.status).toBe(400);
      expect(res.body.fields).toContain(field);
    });
  });

  describe('로그인', () => {
    beforeEach(async () => {
      await request(app).post('/api/auth/signup').send(user);
    });

    it('맞는 이메일·비밀번호면 로그인된다 (이메일 대소문자 무관)', async () => {
      const res = await request(app)
        .post('/api/auth/login')
        .send({ email: 'reporter@EXAMPLE.com', password: user.password });
      expect(res.status).toBe(200);
      expect(res.body.user.nickname).toBe('기자');
      expect(cookieOf(res, 'access_token')).toBeDefined();
    });

    it('틀린 비밀번호와 없는 이메일은 같은 메시지로 거절한다', async () => {
      const wrongPassword = await request(app).post('/api/auth/login').send({ email: user.email, password: 'nope-nope' });
      const unknownEmail = await request(app)
        .post('/api/auth/login')
        .send({ email: 'ghost@example.com', password: user.password });
      expect(wrongPassword.status).toBe(401);
      expect(unknownEmail.status).toBe(401);
      expect(wrongPassword.body).toEqual(unknownEmail.body);
    });

    it('정해진 횟수 이상 틀리면 맞는 비밀번호도 잠시 막는다 (429)', async () => {
      for (let i = 0; i < 3; i++) {
        await request(app).post('/api/auth/login').send({ email: user.email, password: 'wrong-pass' });
      }
      const res = await request(app).post('/api/auth/login').send({ email: user.email, password: user.password });
      expect(res.status).toBe(429);
      expect(Number(res.headers['retry-after'])).toBeGreaterThan(0);
    });
  });

  describe('로그인 유지·로그아웃', () => {
    it('[수용 기준] 로그인하지 않으면 보호된 API(피드·내 정보)에 접근할 수 없다', async () => {
      expect((await request(app).get('/api/auth/me')).status).toBe(401);
      expect((await request(app).get('/api/articles')).status).toBe(401);
    });

    it('로그인한 쿠키로 내 정보와 피드를 볼 수 있다', async () => {
      const agent = request.agent(app);
      await agent.post('/api/auth/signup').send(user);
      const me = await agent.get('/api/auth/me');
      expect(me.status).toBe(200);
      expect(me.body.user.email).toBe('reporter@example.com');
      expect((await agent.get('/api/articles')).status).toBe(200);
    });

    it('refresh token은 한 번 쓰면 새 토큰으로 바뀌고, 예전 토큰은 다시 쓸 수 없다', async () => {
      const signup = await request(app).post('/api/auth/signup').send(user);
      const oldRefresh = cookieOf(signup, 'refresh_token')!.split(';')[0]!;

      const first = await request(app).post('/api/auth/refresh').set('Cookie', oldRefresh);
      expect(first.status).toBe(200);
      const newRefresh = cookieOf(first, 'refresh_token')!.split(';')[0]!;
      expect(newRefresh).not.toBe(oldRefresh);

      const reused = await request(app).post('/api/auth/refresh').set('Cookie', oldRefresh);
      expect(reused.status).toBe(401);
      expect((await request(app).post('/api/auth/refresh').set('Cookie', newRefresh)).status).toBe(200);
    });

    it('만료된 refresh token은 거절한다', async () => {
      const signup = await request(app).post('/api/auth/signup').send(user);
      const refresh = cookieOf(signup, 'refresh_token')!.split(';')[0]!;
      await pool.query("UPDATE refresh_tokens SET expires_at = now() - interval '1 second'");
      expect((await request(app).post('/api/auth/refresh').set('Cookie', refresh)).status).toBe(401);
    });

    it('로그아웃하면 refresh token이 폐기되고 쿠키가 지워진다', async () => {
      const signup = await request(app).post('/api/auth/signup').send(user);
      const refresh = cookieOf(signup, 'refresh_token')!.split(';')[0]!;

      const logout = await request(app).post('/api/auth/logout').set('Cookie', refresh);
      expect(logout.status).toBe(204);
      expect(cookieOf(logout, 'access_token')).toMatch(/Expires=Thu, 01 Jan 1970/);
      expect((await request(app).post('/api/auth/refresh').set('Cookie', refresh)).status).toBe(401);
    });
  });

  describe('[보안] CSRF 방지', () => {
    it('다른 사이트(Origin)에서 보낸 로그인·가입 요청은 거절한다', async () => {
      const res = await request(app).post('/api/auth/signup').set('Origin', 'https://evil.example').send(user);
      expect(res.status).toBe(403);
      const { rows } = await pool.query('SELECT 1 FROM users');
      expect(rows).toHaveLength(0);
    });

    it('우리 화면 주소에서 온 요청은 통과한다', async () => {
      const res = await request(app).post('/api/auth/signup').set('Origin', TEST_APP_ORIGIN).send(user);
      expect(res.status).toBe(201);
    });
  });
});
