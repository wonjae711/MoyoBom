import type pg from 'pg';
import { getDummyHash, hashPassword, verifyPassword } from './password.js';
import {
  REFRESH_TOKEN_TTL_SECONDS,
  createRefreshToken,
  hashRefreshToken,
  signAccessToken,
} from './tokens.js';
import {
  consumeRefreshToken,
  createLocalUser,
  deleteRefreshToken,
  findLocalUserByEmail,
  findUserById,
  saveRefreshToken,
  upsertSocialUser,
  type Provider,
  type PublicUser,
} from './repository.js';

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
}

export interface AuthResult {
  user: PublicUser;
  tokens: AuthTokens;
}

export interface AuthServiceDeps {
  pool: pg.Pool;
  jwtSecret: string;
  now?: () => Date;
}

export class AuthService {
  private readonly now: () => Date;

  constructor(private readonly deps: AuthServiceDeps) {
    this.now = deps.now ?? (() => new Date());
  }

  /** 이메일이 이미 쓰이고 있으면 null */
  async signup(input: { email: string; password: string; nickname: string }): Promise<AuthResult | null> {
    const user = await createLocalUser(this.deps.pool, {
      email: input.email,
      passwordHash: await hashPassword(input.password),
      nickname: input.nickname,
    });
    return user ? { user, tokens: await this.issueTokens(user.id) } : null;
  }

  /** 이메일이 없거나 비밀번호가 틀리면 null (어느 쪽인지 구분해서 알려주지 않는다) */
  async login(email: string, password: string): Promise<AuthResult | null> {
    const found = await findLocalUserByEmail(this.deps.pool, email);
    // 없는 이메일이어도 비밀번호 검증과 같은 시간을 써서 가입 여부가 응답 시간으로 드러나지 않게 한다
    const valid = await verifyPassword(password, found?.passwordHash ?? (await getDummyHash()));
    if (!found || !valid) return null;
    return { user: found.user, tokens: await this.issueTokens(found.user.id) };
  }

  /** refresh token을 새 토큰 쌍으로 바꾼다(회전). 무효하거나 만료됐으면 null */
  async refresh(refreshToken: string): Promise<AuthResult | null> {
    const userId = await consumeRefreshToken(this.deps.pool, hashRefreshToken(refreshToken), this.now());
    if (!userId) return null;
    const user = await findUserById(this.deps.pool, userId);
    return user ? { user, tokens: await this.issueTokens(user.id) } : null;
  }

  /** 소셜 로그인: 처음이면 가입, 이미 가입했으면 로그인 */
  async loginWithSocial(input: {
    provider: Exclude<Provider, 'local'>;
    providerId: string;
    nickname: string;
  }): Promise<AuthResult> {
    const user = await upsertSocialUser(this.deps.pool, input);
    return { user, tokens: await this.issueTokens(user.id) };
  }

  async logout(refreshToken: string | undefined): Promise<void> {
    if (refreshToken) await deleteRefreshToken(this.deps.pool, hashRefreshToken(refreshToken));
  }

  getUser(userId: string): Promise<PublicUser | null> {
    return findUserById(this.deps.pool, userId);
  }

  private async issueTokens(userId: string): Promise<AuthTokens> {
    const now = this.now();
    const refresh = createRefreshToken();
    await saveRefreshToken(
      this.deps.pool,
      userId,
      refresh.hash,
      new Date(now.getTime() + REFRESH_TOKEN_TTL_SECONDS * 1000),
    );
    return { accessToken: await signAccessToken(userId, this.deps.jwtSecret, now), refreshToken: refresh.token };
  }
}
