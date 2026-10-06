import { parseCookie } from 'cookie';
import type { CookieOptions, RequestHandler, Response } from 'express';
import { ACCESS_TOKEN_TTL_SECONDS, REFRESH_TOKEN_TTL_SECONDS, verifyAccessToken } from './tokens.js';
import type { AuthTokens } from './service.js';

export const ACCESS_COOKIE = 'access_token';
export const REFRESH_COOKIE = 'refresh_token';
/** refresh token은 토큰 갱신·로그아웃 요청에만 실려 가도록 경로를 좁힌다 */
const REFRESH_COOKIE_PATH = '/api/auth';

export interface CookieSettings {
  /** 배포(HTTPS)에서는 true */
  secure: boolean;
}

/**
 * 토큰은 JS에서 읽을 수 없는 httpOnly 쿠키로만 보낸다 (XSS로 토큰을 훔쳐 가지 못하게).
 * SameSite: access는 Lax, refresh는 Strict — 다른 사이트에서 보낸 요청에는 실리지 않는다.
 */
export function setAuthCookies(res: Response, tokens: AuthTokens, settings: CookieSettings): void {
  const base: CookieOptions = { httpOnly: true, secure: settings.secure };
  res.cookie(ACCESS_COOKIE, tokens.accessToken, {
    ...base,
    sameSite: 'lax',
    path: '/',
    maxAge: ACCESS_TOKEN_TTL_SECONDS * 1000,
  });
  res.cookie(REFRESH_COOKIE, tokens.refreshToken, {
    ...base,
    sameSite: 'strict',
    path: REFRESH_COOKIE_PATH,
    maxAge: REFRESH_TOKEN_TTL_SECONDS * 1000,
  });
}

export function clearAuthCookies(res: Response, settings: CookieSettings): void {
  res.clearCookie(ACCESS_COOKIE, { httpOnly: true, secure: settings.secure, sameSite: 'lax', path: '/' });
  res.clearCookie(REFRESH_COOKIE, {
    httpOnly: true,
    secure: settings.secure,
    sameSite: 'strict',
    path: REFRESH_COOKIE_PATH,
  });
}

export function readCookie(cookieHeader: string | undefined, name: string): string | undefined {
  return cookieHeader ? parseCookie(cookieHeader)[name] : undefined;
}

/** 로그인한 사용자만 통과. 통과하면 res.locals.userId에 사용자 id가 담긴다 */
export function requireAuth(jwtSecret: string): RequestHandler {
  return async (req, res, next) => {
    const token = readCookie(req.headers.cookie, ACCESS_COOKIE);
    const userId = token ? await verifyAccessToken(token, jwtSecret) : null;
    if (!userId) {
      res.status(401).json({ error: '로그인이 필요합니다' });
      return;
    }
    res.locals.userId = userId;
    next();
  };
}

/**
 * CSRF 방지: 상태를 바꾸는 요청(POST 등)은 우리 화면 주소에서 온 것만 받는다.
 * 브라우저는 이런 요청에 Origin 헤더를 붙이므로, 다른 사이트에서 보낸 요청은 여기서 막힌다.
 * Origin이 없는 요청(curl, 서버 간 호출)은 쿠키를 자동으로 싣지 않으므로 통과시킨다.
 */
export function checkOrigin(appOrigin: string): RequestHandler {
  const safeMethods = new Set(['GET', 'HEAD', 'OPTIONS']);
  return (req, res, next) => {
    const origin = req.headers.origin;
    if (safeMethods.has(req.method) || !origin || origin === appOrigin) {
      next();
      return;
    }
    res.status(403).json({ error: '허용되지 않은 출처의 요청입니다' });
  };
}
