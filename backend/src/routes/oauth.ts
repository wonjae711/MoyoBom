import { randomBytes, timingSafeEqual } from 'node:crypto';
import { Router } from 'express';
import { readCookie, setAuthCookies, type CookieSettings } from '../auth/http.js';
import { buildKakaoAuthorizeUrl, fetchKakaoProfile, type KakaoConfig } from '../auth/kakao.js';
import type { AuthService } from '../auth/service.js';

const STATE_COOKIE = 'oauth_state';
const STATE_TTL_MS = 10 * 60 * 1000;

export interface OAuthRouteDeps {
  auth: Pick<AuthService, 'loginWithSocial'>;
  cookies: CookieSettings;
  appOrigin: string;
  /** 키가 없으면 null → 카카오 로그인 비활성 */
  kakao: KakaoConfig | null;
}

function sameState(a: string | undefined, b: unknown): boolean {
  if (!a || typeof b !== 'string' || a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

/**
 * 소셜 로그인 (F-07). 브라우저가 직접 이동하는 주소들이라 JSON이 아니라 리다이렉트로 응답한다.
 * - GET /api/auth/providers         사용 가능한 소셜 로그인 목록
 * - GET /api/auth/kakao             카카오 인가 페이지로 이동
 * - GET /api/auth/kakao/callback    카카오가 돌려보내는 주소 → 로그인 처리 후 화면으로 이동
 */
export function createOAuthRouter(deps: OAuthRouteDeps): Router {
  const router = Router();
  const stateCookie = {
    httpOnly: true,
    secure: deps.cookies.secure,
    sameSite: 'lax' as const, // 카카오에서 돌아오는 최상위 이동(GET)에는 실려 와야 한다
    path: '/api/auth/kakao',
    maxAge: STATE_TTL_MS,
  };
  const failTo = (reason: string) => `${deps.appOrigin}/login?error=${reason}`;

  router.get('/providers', (_req, res) => {
    res.json({ kakao: deps.kakao !== null, naver: false });
  });

  router.get('/kakao', (_req, res) => {
    if (!deps.kakao) {
      res.redirect(failTo('kakao_unavailable'));
      return;
    }
    // CSRF 방지: 요청마다 임의의 state를 쿠키에 저장하고, 콜백의 state와 같은지 확인한다
    const state = randomBytes(16).toString('base64url');
    res.cookie(STATE_COOKIE, state, stateCookie);
    res.redirect(buildKakaoAuthorizeUrl(deps.kakao, state));
  });

  router.get('/kakao/callback', async (req, res) => {
    const savedState = readCookie(req.headers.cookie, STATE_COOKIE);
    res.clearCookie(STATE_COOKIE, { ...stateCookie, maxAge: undefined });

    if (!deps.kakao) {
      res.redirect(failTo('kakao_unavailable'));
      return;
    }
    // 사용자가 동의 화면에서 취소한 경우
    if (req.query.error) {
      res.redirect(failTo('kakao_cancelled'));
      return;
    }
    if (!sameState(savedState, req.query.state) || typeof req.query.code !== 'string') {
      res.redirect(failTo('kakao_invalid'));
      return;
    }

    try {
      const profile = await fetchKakaoProfile(deps.kakao, req.query.code);
      const result = await deps.auth.loginWithSocial({ provider: 'kakao', ...profile });
      setAuthCookies(res, result.tokens, deps.cookies);
      res.redirect(`${deps.appOrigin}/`);
    } catch (error) {
      console.error('[auth:kakao]', error instanceof Error ? error.message : error);
      res.redirect(failTo('kakao_failed'));
    }
  });

  return router;
}
