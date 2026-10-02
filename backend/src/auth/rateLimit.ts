/**
 * 로그인 실패 제한 (비밀번호 무작위 대입 방지).
 * 같은 IP+이메일로 windowMs 안에 maxFailures번 틀리면 남은 시간 동안 로그인을 막는다.
 * 단일 서버 메모리에 저장한다 — Redis를 쓰지 않는 현재 구조(CLAUDE.md)에 맞춘 단순한 방식.
 */
export class LoginRateLimiter {
  private readonly failures = new Map<string, { count: number; resetAt: number }>();

  constructor(
    private readonly maxFailures = 5,
    private readonly windowMs = 15 * 60 * 1000,
    private readonly now: () => number = Date.now,
  ) {}

  /** 막혀 있으면 다시 시도할 수 있을 때까지 남은 초, 아니면 0 */
  retryAfterSeconds(key: string): number {
    const entry = this.failures.get(key);
    if (!entry) return 0;
    const remaining = entry.resetAt - this.now();
    if (remaining <= 0) {
      this.failures.delete(key);
      return 0;
    }
    return entry.count >= this.maxFailures ? Math.ceil(remaining / 1000) : 0;
  }

  recordFailure(key: string): void {
    const now = this.now();
    const entry = this.failures.get(key);
    if (!entry || entry.resetAt <= now) {
      this.failures.set(key, { count: 1, resetAt: now + this.windowMs });
    } else {
      entry.count++;
    }
    this.prune(now);
  }

  reset(key: string): void {
    this.failures.delete(key);
  }

  /** 오래된 기록을 정리해 메모리가 계속 늘지 않게 한다 */
  private prune(now: number): void {
    if (this.failures.size < 10_000) return;
    for (const [key, entry] of this.failures) {
      if (entry.resetAt <= now) this.failures.delete(key);
    }
  }
}
