import { randomBytes, timingSafeEqual } from 'node:crypto';
import { Router } from 'express';
import { readCookie, setAuthCookies, type CookieSettings } from '../auth/http.js';
import { buildKakaoAuthorizeUrl, fetchKakaoProfile, type KakaoConfig, type SocialProfile } from '../auth/kakao.js';
import { buildNaverAuthorizeUrl, fetchNaverProfile, type NaverConfig } from '../auth/naver.js';
import type { AuthService } from '../auth/service.js';

const STATE_COOKIE = 'oauth_state';
const NEXT_COOKIE = 'oauth_next';
const STATE_TTL_MS = 10 * 60 * 1000;

/**
 * 로그인 후 돌아갈 화면 경로 (C-12, 예: 초대 페이지 /invite/abc).
 * 우리 화면 안의 경로만 허용한다 — "//evil.com"이나 "/\\evil.com"처럼 다른 사이트로 새는 주소(오픈 리다이렉트)는 버린다.
 */
export function safeNextPath(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 200) return null;
  if (!/^\/[A-Za-z0-9\-._~/?=&%]*$/.test(value)) return null;
  if (value.startsWith('//')) return null;
  return value;
}

export interface OAuthRouteDeps {
  auth: Pick<AuthService, 'loginWithSocial'>;
  cookies: CookieSettings;
  appOrigin: string;
  /** 키가 없으면 null → 카카오 로그인 비활성 */
  kakao: KakaoConfig | null;
  /** 키가 없으면 null → 네이버 로그인 비활성 */
  naver?: NaverConfig | null;
}

type ProviderName = 'kakao' | 'naver';

/** 소셜 로그인 제공자마다 다른 부분: 인가 주소와 인가 코드 → 회원 정보 */
interface SocialProvider {
  authorizeUrl(state: string): string;
  fetchProfile(code: string, state: string): Promise<SocialProfile>;
}

function sameState(a: string | undefined, b: unknown): boolean {
  if (!a || typeof b !== 'string' || a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

/**
 * 소셜 로그인 (F-07, 카카오·네이버). 브라우저가 직접 이동하는 주소들이라 JSON이 아니라 리다이렉트로 응답한다.
 * - GET /api/auth/providers            사용 가능한 소셜 로그인 목록
 * - GET /api/auth/{kakao|naver}?next=   인가 페이지로 이동 (next: 로그인 후 돌아갈 화면, 내부 경로만)
 * - GET /api/auth/{kakao|naver}/callback 제공자가 돌려보내는 주소 → 로그인 처리 후 화면으로 이동
 * 두 제공자 모두 같은 흐름: state 쿠키로 CSRF 방지, 실패는 /login?error={제공자}_{이유}
 */
export function createOAuthRouter(deps: OAuthRouteDeps): Router {
  const router = Router();
  const kakao = deps.kakao;
  const naver = deps.naver ?? null;
  const providers: Record<ProviderName, SocialProvider | null> = {
    kakao: kakao && {
      authorizeUrl: (state) => buildKakaoAuthorizeUrl(kakao, state),
      fetchProfile: (code) => fetchKakaoProfile(kakao, code),
    },
    naver: naver && {
      authorizeUrl: (state) => buildNaverAuthorizeUrl(naver, state),
      fetchProfile: (code, state) => fetchNaverProfile(naver, code, state),
    },
  };

  router.get('/providers', (_req, res) => {
    res.json({ kakao: providers.kakao !== null, naver: providers.naver !== null });
  });

  for (const name of ['kakao', 'naver'] as const) {
    const stateCookie = {
      httpOnly: true,
      secure: deps.cookies.secure,
      sameSite: 'lax' as const, // 제공자에서 돌아오는 최상위 이동(GET)에는 실려 와야 한다
      path: `/api/auth/${name}`,
      maxAge: STATE_TTL_MS,
    };
    const failTo = (reason: string) => `${deps.appOrigin}/login?error=${name}_${reason}`;

    router.get(`/${name}`, (req, res) => {
      const provider = providers[name];
      if (!provider) {
        res.redirect(failTo('unavailable'));
        return;
      }
      // CSRF 방지: 요청마다 임의의 state를 쿠키에 저장하고, 콜백의 state와 같은지 확인한다
      const state = randomBytes(16).toString('base64url');
      res.cookie(STATE_COOKIE, state, stateCookie);
      // 로그인 후 돌아갈 화면은 state와 같은 수명의 쿠키에 둔다 (검사를 통과한 내부 경로만)
      const next = safeNextPath(req.query.next);
      if (next) res.cookie(NEXT_COOKIE, next, stateCookie);
      else res.clearCookie(NEXT_COOKIE, { ...stateCookie, maxAge: undefined });
      res.redirect(provider.authorizeUrl(state));
    });

    router.get(`/${name}/callback`, async (req, res) => {
      const savedState = readCookie(req.headers.cookie, STATE_COOKIE);
      const next = safeNextPath(readCookie(req.headers.cookie, NEXT_COOKIE)) ?? '/';
      res.clearCookie(STATE_COOKIE, { ...stateCookie, maxAge: undefined });
      res.clearCookie(NEXT_COOKIE, { ...stateCookie, maxAge: undefined });

      const provider = providers[name];
      if (!provider) {
        res.redirect(failTo('unavailable'));
        return;
      }
      // 사용자가 동의 화면에서 취소한 경우
      if (req.query.error) {
        res.redirect(failTo('cancelled'));
        return;
      }
      if (!sameState(savedState, req.query.state) || typeof req.query.code !== 'string') {
        res.redirect(failTo('invalid'));
        return;
      }

      try {
        const profile = await provider.fetchProfile(req.query.code, req.query.state as string);
        const result = await deps.auth.loginWithSocial({ provider: name, ...profile });
        setAuthCookies(res, result.tokens, deps.cookies);
        res.redirect(`${deps.appOrigin}${next}`);
      } catch (error) {
        console.error(`[auth:${name}]`, error instanceof Error ? error.message : error);
        res.redirect(failTo('failed'));
      }
    });
  }

  return router;
}
