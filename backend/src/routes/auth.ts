import { Router } from 'express';
import { REFRESH_COOKIE, clearAuthCookies, readCookie, requireAuth, setAuthCookies, type CookieSettings } from '../auth/http.js';
import type { AuthService } from '../auth/service.js';

export interface AuthRouteDeps {
  auth: Pick<AuthService, 'refresh' | 'logout' | 'getUser'>;
  jwtSecret: string;
  cookies: CookieSettings;
}

/**
 * /api/auth — 토큰 갱신, 로그아웃, 내 정보 (F-07).
 * 로그인·가입은 카카오·네이버 소셜 로그인만 쓴다 (routes/oauth.ts). 이메일 가입·로그인은 2026-10-06 사용자 결정으로 제거
 */
export function createAuthRouter(deps: AuthRouteDeps): Router {
  const router = Router();

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
