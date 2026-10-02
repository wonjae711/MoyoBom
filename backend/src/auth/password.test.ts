import { describe, expect, it } from 'vitest';
import { hashPassword, verifyPassword } from './password.js';

describe('비밀번호 해시', () => {
  it('맞는 비밀번호만 통과한다', async () => {
    const stored = await hashPassword('correct horse battery');
    expect(await verifyPassword('correct horse battery', stored)).toBe(true);
    expect(await verifyPassword('wrong password', stored)).toBe(false);
  });

  it('같은 비밀번호라도 매번 다른 salt로 다른 해시가 나온다', async () => {
    const [a, b] = await Promise.all([hashPassword('same-password'), hashPassword('same-password')]);
    expect(a).not.toBe(b);
    expect(a.startsWith('scrypt$')).toBe(true);
    expect(a).not.toContain('same-password');
  });

  it('형식이 깨진 저장값은 실패로 처리한다', async () => {
    expect(await verifyPassword('x', 'not-a-hash')).toBe(false);
    expect(await verifyPassword('x', 'bcrypt$1$2$3$a$b')).toBe(false);
  });
});
