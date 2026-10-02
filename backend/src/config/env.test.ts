import { describe, expect, it } from 'vitest';
import { loadEnv } from './env.js';

const valid = {
  DATABASE_URL: 'postgres://u:p@localhost:5433/db',
  JWT_SECRET: 'x'.repeat(32),
  NAVER_CLIENT_ID: 'id',
  NAVER_CLIENT_SECRET: 'secret',
  GUARDIAN_API_KEY: 'guardian',
  OPENAI_API_KEY: 'openai',
};

describe('loadEnv', () => {
  it('필수 값이 있으면 기본값을 채워 반환한다', () => {
    const env = loadEnv(valid);
    expect(env.PORT).toBe(4000);
    expect(env.NODE_ENV).toBe('development');
    expect(env.NEWS_COLLECTOR_ENABLED).toBe(true);
  });

  it('JWT_SECRET이 32자보다 짧으면 거부한다', () => {
    expect(() => loadEnv({ ...valid, JWT_SECRET: 'short' })).toThrow(/JWT_SECRET/);
  });

  it('NEWS_COLLECTOR_ENABLED=false면 자동 수집을 끈다', () => {
    expect(loadEnv({ ...valid, NEWS_COLLECTOR_ENABLED: 'false' }).NEWS_COLLECTOR_ENABLED).toBe(false);
  });

  it('필수 값이 빠지면 키 이름만 담은 에러를 던지고 값은 노출하지 않는다', () => {
    const { GUARDIAN_API_KEY: _omit, ...rest } = valid;
    let message = '';
    try {
      loadEnv({ ...rest, OPENAI_API_KEY: 'sk-should-not-leak' });
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toMatch(/GUARDIAN_API_KEY/);
    expect(message).not.toContain('sk-should-not-leak');
  });
});
