import type pg from 'pg';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../app.js';
import type { DigestWriter } from '../ai/digestWriter.js';
import { AiQuota } from '../ai/quota.js';
import { SummaryError } from '../ai/summarizer.js';
import { BoardService } from '../boards/service.js';
import { DigestService, latestSlot, topicName, type Digest } from '../digests/service.js';
import { TEST_APP_ORIGIN, authCookie, fakeAuthDeps, fakeOAuthDeps, recordingNotifier } from '../test/auth.js';
import { createTestPool, testDatabaseUrl } from '../test/db.js';
import { createUser, resetDb } from '../test/fixtures.js';

const kst = (text: string) => new Date(`${text}+09:00`);

describe('[F-09] 받는 시각 계산 (한국 시간)', () => {
  it('지금 이전의 가장 최근 hour시 정각을 돌려준다', () => {
    expect(latestSlot(kst('2030-01-02T08:10:00'), 8)).toEqual(kst('2030-01-02T08:00:00'));
    expect(latestSlot(kst('2030-01-02T07:59:00'), 8)).toEqual(kst('2030-01-01T08:00:00'));
    expect(latestSlot(kst('2030-01-02T08:00:00'), 8)).toEqual(kst('2030-01-02T08:00:00'));
    // 한국 0시 = 전날 15시(UTC)
    expect(latestSlot(kst('2030-01-02T00:30:00'), 0)).toEqual(kst('2030-01-02T00:00:00'));
    expect(latestSlot(kst('2030-01-02T00:30:00'), 23)).toEqual(kst('2030-01-01T23:00:00'));
  });

  it('구독 주제 이름', () => {
    expect(topicName({ categories: ['economy', 'tech'], keywords: ['반도체'] })).toBe('경제·IT·과학 + 반도체');
    expect(topicName({ categories: [], keywords: ['금리', '환율'] })).toBe('금리, 환율');
  });
});

describe.skipIf(!testDatabaseUrl)('[F-09] 뉴스 다이제스트 (DB)', () => {
  let pool: pg.Pool;
  let app: ReturnType<typeof createApp>;
  let service: DigestService;
  let write: ReturnType<typeof vi.fn<DigestWriter['write']>>;
  let delivered: [string, Digest][];
  let me: { id: string; cookie: string };
  let other: { id: string; cookie: string };

  const SLOT = kst('2030-01-02T08:00:00');
  const AFTER = new Date(SLOT.getTime() + 10 * 60_000);

  function makeApp(manual = { user: 5, ip: 10, total: 100 }, scheduled = { user: 3, ip: 1e9, total: 300 }) {
    delivered = [];
    service = new DigestService({
      pool,
      writer: { write },
      scheduledQuota: new AiQuota(pool, scheduled),
      manualQuota: new AiQuota(pool, manual),
      notifier: { digestCreated: (userId, digest) => delivered.push([userId, digest]) },
    });
    app = createApp({
      checkDb: async () => true,
      articles: { listFeed: async () => ({ articles: [], nextCursor: null, collectedCursor: null }) },
      auth: fakeAuthDeps(),
      oauth: fakeOAuthDeps(),
      boards: { boards: new BoardService(pool), notifier: recordingNotifier().notifier },
      digests: { digests: service },
      appOrigin: TEST_APP_ORIGIN,
    });
  }

  async function article(title: string, opts: { category?: string; collectedAt?: Date; submitted?: boolean } = {}) {
    const { rows } = await pool.query<{ id: string }>(
      `INSERT INTO articles (title, description, source, category, original_link, source_type, published_at, created_at)
       VALUES ($1, '요약', '한겨레', $2, $3, $4, $5, $5) RETURNING id`,
      [
        title,
        opts.submitted ? null : (opts.category ?? 'economy'),
        `https://e.com/${Math.random().toString(36).slice(2)}`,
        opts.submitted ? 'user_submitted' : 'api_collected',
        opts.collectedAt ?? new Date(SLOT.getTime() - 60 * 60_000),
      ],
    );
    return rows[0]!.id;
  }

  /** 구독을 만들고, 받는 시각보다 먼저 만든 것으로 맞춘다 */
  async function subscribe(body: object, cookie = me.cookie) {
    const res = await request(app).post('/api/digests/subscriptions').set('Cookie', cookie).send(body);
    if (res.status === 201) {
      await pool.query(`UPDATE digest_subscriptions SET created_at = $2 WHERE id = $1`, [
        res.body.subscription.id,
        new Date(SLOT.getTime() - 2 * 86_400_000),
      ]);
    }
    return res;
  }
  const inbox = async (cookie = me.cookie) => (await request(app).get('/api/digests').set('Cookie', cookie)).body;

  beforeAll(() => {
    pool = createTestPool();
  });
  beforeEach(async () => {
    await resetDb(pool);
    write = vi.fn(async (topic: string, articles) => ({ title: `${topic} 소식 ${articles.length}건`, summary: '종합 요약' }));
    makeApp();
    const ids = await Promise.all(['나', '다른 사람'].map((n) => createUser(pool, n)));
    me = { id: ids[0]!, cookie: await authCookie(ids[0]!) };
    other = { id: ids[1]!, cookie: await authCookie(ids[1]!) };
  });
  afterAll(async () => {
    await pool.end();
  });

  describe('구독', () => {
    it('카테고리·키워드·받는 시각으로 만들고, 고치고, 끄고, 지운다 — 본인 것만', async () => {
      const created = await subscribe({ categories: ['economy', 'economy'], keywords: [' 반도체 '], sendHour: 8 });
      expect(created.status).toBe(201);
      const sub = created.body.subscription;
      expect(sub).toMatchObject({ categories: ['economy'], keywords: ['반도체'], sendHour: 8, active: true });

      const patched = await request(app)
        .patch(`/api/digests/subscriptions/${sub.id}`)
        .set('Cookie', me.cookie)
        .send({ sendHour: 21, active: false });
      expect(patched.body.subscription).toMatchObject({ sendHour: 21, active: false, categories: ['economy'] });

      expect((await request(app).patch(`/api/digests/subscriptions/${sub.id}`).set('Cookie', other.cookie).send({ active: true })).status).toBe(404);
      expect((await request(app).delete(`/api/digests/subscriptions/${sub.id}`).set('Cookie', other.cookie)).status).toBe(404);
      expect((await request(app).get('/api/digests/subscriptions').set('Cookie', other.cookie)).body.subscriptions).toEqual([]);
      expect((await request(app).delete(`/api/digests/subscriptions/${sub.id}`).set('Cookie', me.cookie)).status).toBe(204);
    });

    it('[검증] 빈 구독·없는 카테고리·키워드 6개·시각 범위 밖은 400, 1인당 3개까지', async () => {
      expect((await subscribe({ sendHour: 8 })).status).toBe(400);
      expect((await subscribe({ categories: ['weather'], sendHour: 8 })).status).toBe(400);
      expect((await subscribe({ keywords: ['a', 'b', 'c', 'd', 'e', 'f'], sendHour: 8 })).status).toBe(400);
      expect((await subscribe({ categories: ['economy'], sendHour: 24 })).status).toBe(400);
      const [first] = await Promise.all([1, 2, 3, 4].map(() => subscribe({ categories: ['economy'], sendHour: 8 })));
      expect(first!.status).toBe(201);
      const { rows } = await pool.query('SELECT 1 FROM digest_subscriptions WHERE user_id = $1', [me.id]);
      expect(rows).toHaveLength(3); // 동시에 4번 만들어도 3개
      const res = await subscribe({ keywords: ['금리'], sendHour: 8 });
      expect(res.status).toBe(400);
      expect(res.body.error).toContain('3개');
    });
  });

  describe('예약 실행', () => {
    it('[수용 기준] 받는 시각이 되면 구독한 카테고리·키워드 기사만 담아 만들고 본인에게 알린다', async () => {
      await subscribe({ categories: ['economy'], keywords: ['반도체'], sendHour: 8 });
      const economy = await article('금리 동결', { category: 'economy' });
      const keyword = await article('반도체 수출 호조', { category: 'tech' });
      await article('프로야구 개막', { category: 'sports' });
      await article('반도체 링크 기사', { submitted: true }); // 링크로 추가한 기사는 제외 (C-06)
      await article('어제 경제 기사', { category: 'economy', collectedAt: new Date(SLOT.getTime() - 25 * 3_600_000) }); // 24시간 밖
      await article('받는 시각 뒤 기사', { category: 'economy', collectedAt: new Date(SLOT.getTime() + 60_000) });

      const made = await service.runDue(AFTER);
      expect(made).toHaveLength(1);
      expect(made[0]).toMatchObject({ kind: 'scheduled', status: 'ok', title: '경제 + 반도체 소식 2건', summary: '종합 요약' });
      expect(made[0]!.slot).toBe(SLOT.toISOString());
      expect(made[0]!.articles.map((a) => a.id).sort()).toEqual([economy, keyword].sort());
      expect(delivered.map(([userId]) => userId)).toEqual([me.id]);

      const box = await inbox();
      expect(box.unread).toBe(1);
      expect(box.digests).toHaveLength(1);
      expect((await inbox(other.cookie)).digests).toEqual([]);
    });

    it('[중복 방지] 같은 구독·같은 받는 시각에는 동시에 여러 번 확인해도 한 번만 만든다', async () => {
      await subscribe({ categories: ['economy'], sendHour: 8 });
      await article('금리 동결');
      const results = await Promise.all([service.runDue(AFTER), service.runDue(AFTER), service.runDue(AFTER)]);
      expect(results.flat()).toHaveLength(1);
      expect(await service.runDue(new Date(AFTER.getTime() + 5 * 60_000))).toEqual([]);
      expect(write).toHaveBeenCalledTimes(1);
    });

    it('[놓친 실행] 받는 시각부터 3시간 안이면 늦게라도 만들고, 넘으면 건너뛴다. 꺼진 구독·만들기 전의 시각도 건너뛴다', async () => {
      await subscribe({ categories: ['economy'], sendHour: 8 });
      await article('금리 동결');
      expect(await service.runDue(new Date(SLOT.getTime() + 3 * 3_600_000 + 60_000))).toEqual([]);
      expect(await service.runDue(new Date(SLOT.getTime() + 2 * 3_600_000))).toHaveLength(1);

      const fresh = await request(app).post('/api/digests/subscriptions').set('Cookie', other.cookie).send({ categories: ['economy'], sendHour: 8 });
      await pool.query('UPDATE digest_subscriptions SET created_at = $2 WHERE id = $1', [fresh.body.subscription.id, AFTER]);
      const paused = await subscribe({ categories: ['economy'], sendHour: 8 }, other.cookie);
      await request(app).patch(`/api/digests/subscriptions/${paused.body.subscription.id}`).set('Cookie', other.cookie).send({ active: false });
      expect(await service.runDue(AFTER)).toEqual([]);
    });

    it('[중복 방지] "만드는 중"인 채 10분 넘게 남은 행(도중에 서버 종료)은 다음 확인 때 다시 만든다', async () => {
      const { body } = await subscribe({ categories: ['economy'], sendHour: 8 });
      await article('금리 동결');
      await pool.query(
        `INSERT INTO digests (user_id, subscription_id, kind, slot, window_start, window_end, created_at)
         VALUES ($1, $2, 'scheduled', $3, $3, $3, now() - interval '5 minutes')`,
        [me.id, body.subscription.id, SLOT],
      );
      expect(await service.runDue(AFTER)).toEqual([]); // 5분 — 아직 다른 실행이 만드는 중일 수 있음
      await pool.query(`UPDATE digests SET created_at = now() - interval '11 minutes'`);
      const made = await service.runDue(AFTER);
      expect(made).toHaveLength(1);
      expect(made[0]!.status).toBe('ok');
    });

    it('[예외] 조건에 맞는 기사가 없으면 AI 없이 "새 소식 없음"으로 알린다', async () => {
      await subscribe({ categories: ['culture'], sendHour: 8 });
      await article('금리 동결', { category: 'economy' });
      const [digest] = await service.runDue(AFTER);
      expect(digest).toMatchObject({ status: 'empty', title: '생활·문화 브리핑', summary: null, articles: [] });
      expect(write).not.toHaveBeenCalled();
    });

    it('[예외] AI 요약이 두 번 실패하면 기사 목록만 담아 전달하고 사용 횟수를 돌려준다', async () => {
      await subscribe({ categories: ['economy'], sendHour: 8 });
      await article('금리 동결');
      write.mockRejectedValue(new SummaryError('오류'));
      vi.spyOn(console, 'warn').mockImplementation(() => {});
      const [digest] = await service.runDue(AFTER);
      expect(digest).toMatchObject({ status: 'failed', title: '경제 브리핑', summary: null });
      expect(digest!.articles).toHaveLength(1);
      expect(write).toHaveBeenCalledTimes(2);
      const { rows } = await pool.query(`SELECT count FROM ai_usage WHERE feature = 'digest' AND scope = 'user'`);
      expect(rows[0]?.count ?? 0).toBe(0);
    });

    it('다음 다이제스트는 지난번 이후 수집된 기사만 담는다', async () => {
      await subscribe({ categories: ['economy'], sendHour: 8 });
      await article('어제 기사', { collectedAt: new Date(SLOT.getTime() - 3_600_000) });
      await service.runDue(AFTER);
      const next = new Date(SLOT.getTime() + 86_400_000);
      const today = await article('오늘 기사', { collectedAt: new Date(next.getTime() - 3_600_000) });
      const [digest] = await service.runDue(new Date(next.getTime() + 60_000));
      expect(digest!.articles.map((a) => a.id)).toEqual([today]);
      expect(digest!.windowStart).toBe(SLOT.toISOString());
    });
  });

  describe('지금 받아보기·알림함', () => {
    it('"지금 받아보기"는 최근 24시간 기사로 바로 만들고, 하루 한도를 넘으면 429. 기사가 없으면 횟수를 돌려준다', async () => {
      makeApp({ user: 1, ip: 10, total: 100 });
      const { body } = await subscribe({ categories: ['economy'], sendHour: 8 });
      const run = () => request(app).post(`/api/digests/subscriptions/${body.subscription.id}/run`).set('Cookie', me.cookie);

      const empty = await run(); // 최근 24시간에 수집된 기사 없음
      expect(empty.body.digest).toMatchObject({ kind: 'manual', status: 'empty', slot: null });
      await article('방금 들어온 금리 기사', { collectedAt: new Date() });
      const ok = await run();
      expect(ok.status).toBe(201);
      expect(ok.body.digest).toMatchObject({ kind: 'manual', status: 'ok' });
      expect((await run()).status).toBe(429);
      expect((await request(app).post(`/api/digests/subscriptions/${body.subscription.id}/run`).set('Cookie', other.cookie)).status).toBe(404);
    });

    it('읽음·모두 읽음은 본인 것만, 구독을 지워도 받은 알림은 남는다', async () => {
      const { body } = await subscribe({ categories: ['economy'], sendHour: 8 });
      await article('금리 동결');
      const [digest] = await service.runDue(AFTER);

      expect((await request(app).post(`/api/digests/${digest!.id}/read`).set('Cookie', other.cookie)).status).toBe(404);
      expect((await request(app).post(`/api/digests/${digest!.id}/read`).set('Cookie', me.cookie)).status).toBe(204);
      const box = await inbox();
      expect(box.unread).toBe(0);
      expect(box.digests[0].readAt).not.toBeNull();

      await request(app).delete(`/api/digests/subscriptions/${body.subscription.id}`).set('Cookie', me.cookie);
      const after = await inbox();
      expect(after.digests).toHaveLength(1);
      expect(after.digests[0].subscriptionId).toBeNull();

      await pool.query('UPDATE digests SET read_at = NULL');
      expect((await request(app).post('/api/digests/read-all').set('Cookie', me.cookie)).status).toBe(204);
      expect((await inbox()).unread).toBe(0);
    });

    it('[Codex 068152f 리뷰 3] "모두 읽음"은 아직 만드는 중인 다이제스트를 건드리지 않는다', async () => {
      const { body } = await subscribe({ categories: ['economy'], sendHour: 8 });
      await pool.query(
        `INSERT INTO digests (user_id, subscription_id, kind, slot, window_start, window_end) VALUES ($1, $2, 'scheduled', $3, $3, $3)`,
        [me.id, body.subscription.id, SLOT],
      );
      await request(app).post('/api/digests/read-all').set('Cookie', me.cookie);
      const { rows } = await pool.query(`SELECT read_at FROM digests WHERE status = 'pending'`);
      expect(rows[0].read_at).toBeNull();
    });

    it('[Codex 068152f 리뷰 4] "지금 받아보기"가 도중에 실패하면 만드는 중 행을 지우고 횟수를 돌려준다', async () => {
      makeApp({ user: 1, ip: 10, total: 100 });
      const { body } = await subscribe({ categories: ['economy'], sendHour: 8 });
      await article('방금 들어온 금리 기사', { collectedAt: new Date() });
      write.mockRejectedValueOnce(new Error('DB 연결 끊김')); // AI 실패가 아닌 예상 못 한 오류
      vi.spyOn(console, 'error').mockImplementation(() => {});
      const run = () => request(app).post(`/api/digests/subscriptions/${body.subscription.id}/run`).set('Cookie', me.cookie);
      expect((await run()).status).toBe(500);
      expect((await pool.query(`SELECT 1 FROM digests`)).rowCount).toBe(0);
      expect((await run()).status).toBe(201); // 횟수를 돌려받아 한도 1회로 다시 할 수 있다
    });

    it('[Codex 068152f 리뷰 4] 서버가 꺼져 남은 "지금 받아보기" 만드는 중 행은 다음 확인 때 지운다', async () => {
      const { body } = await subscribe({ categories: ['economy'], sendHour: 8 });
      await pool.query(
        `INSERT INTO digests (user_id, subscription_id, kind, window_start, window_end, created_at)
         VALUES ($1, $2, 'manual', now(), now(), now() - interval '11 minutes')`,
        [me.id, body.subscription.id],
      );
      await service.runDue(new Date(SLOT.getTime() - 3_600_000));
      expect((await pool.query(`SELECT 1 FROM digests WHERE kind = 'manual'`)).rowCount).toBe(0);
    });

    it('30일 지난 알림은 정리한다', async () => {
      await subscribe({ categories: ['economy'], sendHour: 8 });
      await service.runDue(AFTER);
      expect(await service.deleteOldDigests(new Date(Date.now() + 31 * 86_400_000))).toBe(1);
    });
  });
});
