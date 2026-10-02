import { Router } from 'express';
import { z } from 'zod';
import {
  REFRESH_COOKIE,
  clearAuthCookies,
  clientKey,
  readCookie,
  requireAuth,
  setAuthCookies,
  type CookieSettings,
} from '../auth/http.js';
import type { LoginRateLimiter } from '../auth/rateLimit.js';
import type { AuthService } from '../auth/service.js';

const emailSchema = z.email().trim().toLowerCase().max(254);

const signupSchema = z.object({
  email: emailSchema,
  password: z.string().min(8, '비밀번호는 8자 이상').max(128),
  nickname: z.string().trim().min(1).max(20),
});

const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1).max(128),
});

export interface AuthRouteDeps {
  auth: Pick<AuthService, 'signup' | 'login' | 'refresh' | 'logout' | 'getUser'>;
  loginLimiter: LoginRateLimiter;
  jwtSecret: string;
  cookies: CookieSettings;
}

/** /api/auth — 이메일 회원가입·로그인, 토큰 갱신, 로그아웃, 내 정보 (F-07) */
export function createAuthRouter(deps: AuthRouteDeps): Router {
  const router = Router();

  router.post('/signup', async (req, res) => {
    const parsed = signupSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: '입력값을 확인해 주세요', fields: parsed.error.issues.map((i) => i.path.join('.')) });
      return;
    }
    const result = await deps.auth.signup(parsed.data);
    if (!result) {
      res.status(409).json({ error: '이미 가입된 이메일입니다' });
      return;
    }
    setAuthCookies(res, result.tokens, deps.cookies);
    res.status(201).json({ user: result.user });
  });

  router.post('/login', async (req, res) => {
    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: '입력값을 확인해 주세요', fields: parsed.error.issues.map((i) => i.path.join('.')) });
      return;
    }
    const key = clientKey(req, parsed.data.email);
    const retryAfter = deps.loginLimiter.retryAfterSeconds(key);
    if (retryAfter > 0) {
      res.setHeader('Retry-After', String(retryAfter));
      res.status(429).json({ error: '로그인 시도가 너무 많습니다. 잠시 후 다시 시도해 주세요' });
      return;
    }

    const result = await deps.auth.login(parsed.data.email, parsed.data.password);
    if (!result) {
      deps.loginLimiter.recordFailure(key);
      res.status(401).json({ error: '이메일 또는 비밀번호가 올바르지 않습니다' });
      return;
    }
    deps.loginLimiter.reset(key);
    setAuthCookies(res, result.tokens, deps.cookies);
    res.json({ user: result.user });
  });

  router.post('/refresh', async (req, res) => {
    const token = readCookie(req.headers.cookie, REFRESH_COOKIE);
    const result = token ? await deps.auth.refresh(token) : null;
    if (!result) {
      clearAuthCookies(res, deps.cookies);
      res.status(401).json({ error: '다시 로그인해 주세요' });
      return;
    }
    setAuthCookies(res, result.tokens, deps.cookies);
    res.json({ user: result.user });
  });

  router.post('/logout', async (req, res) => {
    await deps.auth.logout(readCookie(req.headers.cookie, REFRESH_COOKIE));
    clearAuthCookies(res, deps.cookies);
    res.status(204).end();
  });

  router.get('/me', requireAuth(deps.jwtSecret), async (_req, res) => {
    const user = await deps.auth.getUser(res.locals.userId!);
    if (!user) {
      clearAuthCookies(res, deps.cookies);
      res.status(401).json({ error: '다시 로그인해 주세요' });
      return;
    }
    res.json({ user });
  });

  return router;
}
