import type pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestPool, testDatabaseUrl } from '../test/db.js';
import { resetDb } from '../test/fixtures.js';
import { AiQuota } from './quota.js';

describe.skipIf(!testDatabaseUrl)('[C-07·결정 B] AI 하루 한도 (DB)', () => {
  let pool: pg.Pool;

  beforeAll(() => {
    pool = createTestPool();
  });
  beforeEach(async () => {
    await resetDb(pool);
  });
  afterAll(async () => {
    await pool.end();
  });

  it('계정 한도까지만 쓸 수 있고, 남은 횟수를 알려 준다', async () => {
    const quota = new AiQuota(pool, { user: 2, ip: 10, total: 10 });
    expect(await quota.consume('f', 'u1', '1.1.1.1')).toEqual({ ok: true, remaining: 1 });
    expect(await quota.consume('f', 'u1', '1.1.1.1')).toEqual({ ok: true, remaining: 0 });
    expect(await quota.consume('f', 'u1', '1.1.1.1')).toEqual({ ok: false, scope: 'user', limit: 2 });
    expect(await quota.consume('f', 'u2', '1.1.1.1')).toMatchObject({ ok: true }); // 다른 계정은 따로
    expect(await quota.remaining('f', 'u1')).toBe(0);
  });

  it('계정을 여러 개 만들어도 같은 IP·서비스 전체 한도에 걸린다', async () => {
    const quota = new AiQuota(pool, { user: 10, ip: 2, total: 3 });
    expect(await quota.consume('f', 'a', '1.1.1.1')).toMatchObject({ ok: true });
    expect(await quota.consume('f', 'b', '1.1.1.1')).toMatchObject({ ok: true });
    expect(await quota.consume('f', 'c', '1.1.1.1')).toEqual({ ok: false, scope: 'ip', limit: 2 });
    expect(await quota.consume('f', 'd', '2.2.2.2')).toMatchObject({ ok: true });
    expect(await quota.consume('f', 'e', '3.3.3.3')).toEqual({ ok: false, scope: 'total', limit: 3 });
  });

  it('한 한도에 걸리면 다른 한도도 차감하지 않는다', async () => {
    const quota = new AiQuota(pool, { user: 5, ip: 1, total: 5 });
    await quota.consume('f', 'a', '1.1.1.1');
    await quota.consume('f', 'a', '1.1.1.1'); // IP 한도 초과
    expect(await quota.remaining('f', 'a')).toBe(4);
  });

  it('돌려받으면 세 한도 모두 1회씩 다시 쓸 수 있다', async () => {
    const quota = new AiQuota(pool, { user: 1, ip: 1, total: 1 });
    await quota.consume('f', 'a', '1.1.1.1');
    await quota.refund('f', 'a', '1.1.1.1');
    expect(await quota.consume('f', 'a', '1.1.1.1')).toEqual({ ok: true, remaining: 0 });
  });

  it('동시에 많이 요청해도 한도를 넘지 않는다', async () => {
    const quota = new AiQuota(pool, { user: 3, ip: 100, total: 100 });
    const results = await Promise.all(Array.from({ length: 10 }, () => quota.consume('f', 'u', '1.1.1.1')));
    expect(results.filter((r) => r.ok)).toHaveLength(3);
  });
});
