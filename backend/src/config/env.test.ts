import { describe, expect, it } from 'vitest';
import { loadEnv } from './env.js';

const valid = {
  DATABASE_URL: 'postgres://u:p@localhost:5433/db',
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
