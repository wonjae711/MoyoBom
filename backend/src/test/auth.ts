import { ACCESS_COOKIE } from '../auth/http.js';
import { LoginRateLimiter } from '../auth/rateLimit.js';
import type { AuthRouteDeps } from '../routes/auth.js';
import type { OAuthRouteDeps } from '../routes/oauth.js';
import { signAccessToken } from '../auth/tokens.js';

export const TEST_JWT_SECRET = 'test-secret-that-is-at-least-32-characters-long';
export const TEST_APP_ORIGIN = 'http://localhost:5173';

/** 로그인된 요청을 흉내 내는 Cookie 헤더 */
export async function authCookie(userId = '1', now?: Date): Promise<string> {
  return `${ACCESS_COOKIE}=${await signAccessToken(userId, TEST_JWT_SECRET, now)}`;
}

/** DB 없이 쓰는 인증 의존성 (인증 자체를 시험하지 않는 테스트용) */
export function fakeAuthDeps(): AuthRouteDeps {
  return {
    auth: {
      signup: async () => null,
      login: async () => null,
      refresh: async () => null,
      logout: async () => {},
      getUser: async (id) => ({ id, email: 'user@example.com', nickname: '테스터', provider: 'local' }),
    },
    loginLimiter: new LoginRateLimiter(),
    jwtSecret: TEST_JWT_SECRET,
    cookies: { secure: false },
  };
}

/** 소셜 로그인 의존성 (카카오 비활성) */
export function fakeOAuthDeps(): OAuthRouteDeps {
  return {
    auth: {
      loginWithSocial: async () => {
        throw new Error('사용하지 않음');
      },
    },
    cookies: { secure: false },
    appOrigin: TEST_APP_ORIGIN,
    kakao: null,
  };
}
