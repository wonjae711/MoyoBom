/**
 * 카카오 로그인 (REST API 방식, F-07 소셜 로그인).
 * 1) 카카오 인가 페이지로 보냄 → 2) 콜백으로 받은 인가 코드를 토큰으로 교환 → 3) 사용자 정보 조회
 * https://developers.kakao.com/docs/ko/kakaologin/rest-api
 */

const AUTHORIZE_URL = 'https://kauth.kakao.com/oauth/authorize';
const TOKEN_URL = 'https://kauth.kakao.com/oauth/token';
const USER_URL = 'https://kapi.kakao.com/v2/user/me';
const TIMEOUT_MS = 10_000;

export interface KakaoConfig {
  restApiKey: string;
  clientSecret: string;
  redirectUri: string;
  fetchFn?: typeof fetch;
}

export interface SocialProfile {
  providerId: string;
  nickname: string;
}

/** 카카오와 통신하다 실패. 메시지에는 키·토큰을 넣지 않는다 */
export class KakaoAuthError extends Error {
  constructor(detail: string) {
    super(`카카오 로그인 실패: ${detail}`);
    this.name = 'KakaoAuthError';
  }
}

export function buildKakaoAuthorizeUrl(config: KakaoConfig, state: string): string {
  const url = new URL(AUTHORIZE_URL);
  url.searchParams.set('client_id', config.restApiKey);
  url.searchParams.set('redirect_uri', config.redirectUri);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('state', state);
  return url.toString();
}

async function requestJson(fetchFn: typeof fetch, url: string, init: RequestInit, step: string): Promise<unknown> {
  let res: Response;
  try {
    res = await fetchFn(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch {
    throw new KakaoAuthError(`${step} 요청 실패(네트워크·타임아웃)`);
  }
  const body: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    const code = typeof body === 'object' && body && 'error_code' in body ? String(body.error_code) : `HTTP ${res.status}`;
    throw new KakaoAuthError(`${step} 실패(${code})`);
  }
  return body;
}

/** 인가 코드로 카카오 사용자 정보를 가져온다 */
export async function fetchKakaoProfile(config: KakaoConfig, code: string): Promise<SocialProfile> {
  const fetchFn = config.fetchFn ?? fetch;

  const token = (await requestJson(
    fetchFn,
    TOKEN_URL,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=utf-8' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        client_id: config.restApiKey,
        client_secret: config.clientSecret,
        redirect_uri: config.redirectUri,
        code,
      }),
    },
    '토큰 발급',
  )) as { access_token?: unknown };
  if (typeof token.access_token !== 'string') throw new KakaoAuthError('토큰 응답 형식 오류');

  const user = (await requestJson(
    fetchFn,
    USER_URL,
    { headers: { Authorization: `Bearer ${token.access_token}` } },
    '사용자 정보 조회',
  )) as { id?: unknown; kakao_account?: { profile?: { nickname?: unknown } }; properties?: { nickname?: unknown } };

  if (typeof user.id !== 'number' && typeof user.id !== 'string') throw new KakaoAuthError('사용자 정보 형식 오류');
  const nickname = user.kakao_account?.profile?.nickname ?? user.properties?.nickname;
  return {
    providerId: String(user.id),
    // 닉네임 동의를 안 했거나 비어 있으면 기본 이름, 화면 규칙(20자)에 맞춰 자른다
    nickname: (typeof nickname === 'string' && nickname.trim() ? nickname.trim() : '카카오 사용자').slice(0, 20),
  };
}
