import { describe, expect, it } from 'vitest';
import { LoginRateLimiter } from './rateLimit.js';

describe('LoginRateLimiter', () => {
  it('정해진 횟수만큼 틀리면 남은 시간 동안 막고, 시간이 지나면 풀린다', () => {
    let now = 0;
    const limiter = new LoginRateLimiter(3, 60_000, () => now);

    limiter.recordFailure('ip:a@b.com');
    limiter.recordFailure('ip:a@b.com');
    expect(limiter.retryAfterSeconds('ip:a@b.com')).toBe(0);
    limiter.recordFailure('ip:a@b.com');
    expect(limiter.retryAfterSeconds('ip:a@b.com')).toBe(60);

    now = 30_000;
    expect(limiter.retryAfterSeconds('ip:a@b.com')).toBe(30);
    now = 60_000;
    expect(limiter.retryAfterSeconds('ip:a@b.com')).toBe(0);
  });

  it('로그인에 성공하면 실패 기록을 지운다', () => {
    const limiter = new LoginRateLimiter(2, 60_000, () => 0);
    limiter.recordFailure('k');
    limiter.reset('k');
    limiter.recordFailure('k');
    expect(limiter.retryAfterSeconds('k')).toBe(0);
  });

  it('다른 키(다른 이메일·IP)에는 영향이 없다', () => {
    const limiter = new LoginRateLimiter(1, 60_000, () => 0);
    limiter.recordFailure('ip:a@b.com');
    expect(limiter.retryAfterSeconds('ip:a@b.com')).toBeGreaterThan(0);
    expect(limiter.retryAfterSeconds('ip:c@d.com')).toBe(0);
  });
});
