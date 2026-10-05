import type { SocialProfile } from './kakao.js';

/**
 * 네이버 로그인 (F-07 소셜 로그인).
 * 1) 네이버 인가 페이지로 보냄 → 2) 콜백으로 받은 인가 코드를 토큰으로 교환 → 3) 회원 프로필 조회
 * https://developers.naver.com/docs/login/devguide/devguide.md
 */

const AUTHORIZE_URL = 'https://nid.naver.com/oauth2.0/authorize';
const TOKEN_URL = 'https://nid.naver.com/oauth2.0/token';
const PROFILE_URL = 'https://openapi.naver.com/v1/nid/me';
const TIMEOUT_MS = 10_000;

export interface NaverConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  fetchFn?: typeof fetch;
}

/** 네이버와 통신하다 실패. 메시지에는 키·토큰을 넣지 않는다 */
export class NaverAuthError extends Error {
  constructor(detail: string) {
    super(`네이버 로그인 실패: ${detail}`);
    this.name = 'NaverAuthError';
  }
}

export function buildNaverAuthorizeUrl(config: NaverConfig, state: string): string {
  const url = new URL(AUTHORIZE_URL);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', config.clientId);
  url.searchParams.set('redirect_uri', config.redirectUri);
  url.searchParams.set('state', state);
  return url.toString();
}

async function requestJson(fetchFn: typeof fetch, url: string, init: RequestInit, step: string): Promise<Record<string, unknown>> {
  let res: Response;
  try {
    res = await fetchFn(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch {
    throw new NaverAuthError(`${step} 요청 실패(네트워크·타임아웃)`);
  }
  const body = (await res.json().catch(() => null)) as Record<string, unknown> | null;
  // 네이버는 실패해도 200과 함께 { error } 를 보내는 경우가 있다
  if (!res.ok || !body || typeof body.error === 'string') {
    const code = body && typeof body.error === 'string' ? body.error : `HTTP ${res.status}`;
    throw new NaverAuthError(`${step} 실패(${code})`);
  }
  return body;
}

/** 인가 코드로 네이버 회원 정보를 가져온다 */
export async function fetchNaverProfile(config: NaverConfig, code: string, state: string): Promise<SocialProfile> {
  const fetchFn = config.fetchFn ?? fetch;

  const token = await requestJson(
    fetchFn,
    TOKEN_URL,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=utf-8' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        client_id: config.clientId,
        client_secret: config.clientSecret,
        code,
        state,
      }),
    },
    '토큰 발급',
  );
  if (typeof token.access_token !== 'string') throw new NaverAuthError('토큰 응답 형식 오류');

  const profile = (await requestJson(
    fetchFn,
    PROFILE_URL,
    { headers: { Authorization: `Bearer ${token.access_token}` } },
    '회원 정보 조회',
  )) as { resultcode?: unknown; response?: { id?: unknown; nickname?: unknown } };
  if (profile.resultcode !== '00' || typeof profile.response?.id !== 'string') {
    throw new NaverAuthError('회원 정보 형식 오류');
  }
  const nickname = profile.response.nickname;
  return {
    providerId: profile.response.id,
    // 별명 동의를 안 했거나 비어 있으면 기본 이름, 화면 규칙(20자)에 맞춰 자른다
    nickname: (typeof nickname === 'string' && nickname.trim() ? nickname.trim() : '네이버 사용자').slice(0, 20),
  };
}
