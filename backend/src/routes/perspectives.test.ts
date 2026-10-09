import type pg from 'pg';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../app.js';
import { EMBEDDING_DIMENSIONS, EmbeddingError, type Embedder } from '../ai/embedder.js';
import { PerspectiveError, type PerspectiveJudge } from '../ai/perspectiveJudge.js';
import { AiQuota } from '../ai/quota.js';
import { BoardService } from '../boards/service.js';
import { PerspectiveService } from '../perspectives/service.js';
import { TEST_APP_ORIGIN, authCookie, fakeAuthDeps, fakeOAuthDeps, recordingNotifier } from '../test/auth.js';
import { createTestPool, testDatabaseUrl } from '../test/db.js';
import { createArticle, createUser, resetDb } from '../test/fixtures.js';

/** 주제어로 방향이 정해지는 가짜 임베딩: 반도체 → 0번 축, 중동 → 1번 축, 그 밖 → 2번 축 */
function topicVector(text: string): number[] {
  const v = new Array<number>(EMBEDDING_DIMENSIONS).fill(0);
  v[text.includes('반도체') ? 0 : text.includes('중동') ? 1 : 2] = 1;
  v[3 + (text.length % 5)] = 0.1;
  return v;
}

type Item = { kind: string; reason: string; article: { title: string; source: string } };

describe.skipIf(!testDatabaseUrl)('[F-13] 반대 관점 기사 추천 (DB)', () => {
  let pool: pg.Pool;
  let boards: BoardService;
  let app: ReturnType<typeof createApp>;
  let embed: ReturnType<typeof vi.fn<Embedder['embed']>>;
  let judge: ReturnType<typeof vi.fn<PerspectiveJudge['judge']>>;
  let owner: { id: string; cookie: string };
  let member: { id: string; cookie: string };
  let outsider: { id: string; cookie: string };
  let boardId: string;

  function makeApp(limits = { user: 20, ip: 40, total: 200 }) {
    const perspectives = new PerspectiveService({ pool, boards, embedder: { embed }, judge: { judge }, quota: new AiQuota(pool, limits), minSimilarity: 0.5 });
    app = createApp({
      checkDb: async () => true,
      articles: { listFeed: async () => ({ articles: [], nextCursor: null, collectedCursor: null }) },
      auth: fakeAuthDeps(),
      oauth: fakeOAuthDeps(),
      boards: { boards, notifier: recordingNotifier().notifier, perspectives },
      appOrigin: TEST_APP_ORIGIN,
    });
  }

  /** 수집 기사 (보드에 올리지 않은 후보) */
  async function collected(title: string, source: string, daysAgo = 0) {
    const { rows } = await pool.query<{ id: string }>(
      `INSERT INTO articles (title, description, source, category, original_link, source_type, published_at, created_at)
       VALUES ($1, '요약', $2, 'economy', $3, 'api_collected', now() - make_interval(days => $4), now() - make_interval(days => $4)) RETURNING id`,
      [title, source, `https://e.com/${Math.random().toString(36).slice(2)}`, daysAgo],
    );
    return rows[0]!.id;
  }
  async function card(title: string) {
    const articleId = await createArticle(pool, title); // 한겨레
    return (await boards.addItem(boardId, owner.id, { type: 'article', articleId, x: 0, y: 0 })).id;
  }
  async function issue(itemIds: string[], board = boardId) {
    const { clusters } = await boards.replaceClusters(board, owner.id, [{ title: '반도체 규제', summary: '', x: 0, y: 0, itemIds }]);
    return clusters[0]!.id;
  }
  const find = (clusterId: string, cookie = owner.cookie, board = boardId) =>
    request(app).post(`/api/boards/${board}/clusters/${clusterId}/perspectives`).set('Cookie', cookie);

  beforeAll(() => {
    pool = createTestPool();
    boards = new BoardService(pool);
  });
  beforeEach(async () => {
    await resetDb(pool);
    embed = vi.fn(async (texts: string[]) => texts.map(topicVector));
    judge = vi.fn(async (_board, candidates) => ({
      boardView: '보드 기사들은 규제 강화의 배경을 주로 다뤄요',
      verdicts: candidates.map((c) =>
        c.n === 1 ? { n: 1, relation: 'different' as const, confident: true, reason: '규제로 피해를 보는 업계 입장을 다뤄요' } : { n: c.n, relation: 'similar' as const, confident: true, reason: '' },
      ),
    }));
    makeApp();
    const ids = await Promise.all(['주인', '참여자', '외부인'].map((n) => createUser(pool, n)));
    owner = { id: ids[0]!, cookie: await authCookie(ids[0]!) };
    member = { id: ids[1]!, cookie: await authCookie(ids[1]!) };
    outsider = { id: ids[2]!, cookie: await authCookie(ids[2]!) };
    boardId = (await boards.createBoard(owner.id, '관점 보드')).id;
    const { token } = await boards.getInvite(boardId, owner.id);
    await boards.acceptInvite(token, member.id);
  });
  afterAll(async () => {
    await pool.end();
  });

  it('[수용 기준] 같은 이슈의 다른 언론사 기사를 찾고, AI가 확신한 "다른 시각"만 이유와 함께 앞에 둔다', async () => {
    const clusterId = await issue([await card('반도체 수출 규제 강화'), await card('반도체 수출 규제 영향')]);
    await collected('반도체 수출 규제 반발 업계', '조선일보');
    await collected('반도체 수출 규제 수혜 기업', '매일경제');
    await collected('반도체 수출 규제 세 번째', '조선일보');
    await collected('반도체 수출 규제 네 번째', '조선일보'); // 한 언론사는 2건까지
    await collected('반도체 수출 규제 후속', '한겨레'); // 보드 이슈와 같은 언론사는 뺀다
    await collected('반도체 수출 규제 지난주', '경향신문', 8); // 7일보다 오래된 기사는 뺀다
    await collected('중동 수출 규제 여파', '동아일보'); // 낱말은 겹치지만 다른 이슈 (유사도 낮음)

    const res = await find(clusterId, member.cookie); // 참여자도 쓸 수 있다
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: 'ok', judged: true, boardView: '보드 기사들은 규제 강화의 배경을 주로 다뤄요', remaining: 19 });
    const items = res.body.items as Item[];
    expect(items).toHaveLength(3);
    expect(items[0]).toMatchObject({ kind: 'different', reason: '규제로 피해를 보는 업계 입장을 다뤄요' });
    expect(items.slice(1).every((i) => i.kind === 'other_source' && i.reason === '')).toBe(true);
    const sources = items.map((i) => i.article.source);
    expect(sources.filter((s) => s === '조선일보')).toHaveLength(2);
    expect(sources).not.toContain('한겨레');
    expect(sources).not.toContain('경향신문');
    expect(sources).not.toContain('동아일보');
    // AI에는 보드 이슈 기사와 후보만 넘긴다
    const [boardGiven, candidatesGiven] = judge.mock.calls[0]!;
    expect(boardGiven.map((a) => a.title).sort()).toEqual(['반도체 수출 규제 강화', '반도체 수출 규제 영향']);
    expect(candidatesGiven).toHaveLength(3);
  });

  it('이름 하나로 불리는 이슈는 그 낱말 하나만 겹쳐도 후보로 찾는다', async () => {
    const clusterId = await issue([await card('부캉이 건강 우려 커져'), await card('부캉이 보러 북항 방문객 몰려')]);
    await collected('소주병에 등장한 부캉이', '경향신문');
    const res = await find(clusterId);
    expect(res.body.status).toBe('ok');
    expect((res.body.items as Item[]).map((i) => i.article.title)).toEqual(['소주병에 등장한 부캉이']);
  });

  it('보드에 이미 올린 기사는 후보에서 뺀다', async () => {
    const clusterId = await issue([await card('반도체 수출 규제 강화'), await card('반도체 수출 규제 영향')]);
    const onBoard = await collected('반도체 수출 규제 반발', '조선일보');
    await boards.addItem(boardId, owner.id, { type: 'article', articleId: onBoard, x: 0, y: 0 });
    const res = await find(clusterId);
    expect(res.body).toMatchObject({ status: 'none', items: [] });
  });

  it('[예외] 같은 이슈의 다른 언론사 기사가 없으면 AI를 부르지 않고 사용 횟수도 차감하지 않는다', async () => {
    const clusterId = await issue([await card('반도체 수출 규제 강화'), await card('반도체 수출 규제 영향')]);
    await collected('중동 수출 규제 여파', '동아일보');
    const res = await find(clusterId);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'none', boardView: '', judged: false, items: [], remaining: 20 });
    expect(judge).not.toHaveBeenCalled();
    expect((await request(app).get(`/api/boards/${boardId}/perspectives/quota`).set('Cookie', owner.cookie)).body).toEqual({ remaining: 20 });
  });

  it('[예외] AI 비교가 실패하면 찾은 기사를 "다른 언론사"로만 보여 주고 사용 횟수를 돌려준다', async () => {
    judge.mockRejectedValue(new PerspectiveError('비교 서비스 오류 (HTTP 500)'));
    const clusterId = await issue([await card('반도체 수출 규제 강화'), await card('반도체 수출 규제 영향')]);
    await collected('반도체 수출 규제 반발 업계', '조선일보');
    const res = await find(clusterId);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: 'ok', judged: false, boardView: '', remaining: 20 });
    expect((res.body.items as Item[]).every((i) => i.kind === 'other_source')).toBe(true);
  });

  it('[예외] 확신이 없는 "다른 시각"은 추천하지 않는다', async () => {
    judge.mockImplementation(async (_b, c) => ({
      boardView: '요약',
      verdicts: c.map((x) => ({ n: x.n, relation: 'different' as const, confident: false, reason: '아마 다를 수도' })),
    }));
    const clusterId = await issue([await card('반도체 수출 규제 강화'), await card('반도체 수출 규제 영향')]);
    await collected('반도체 수출 규제 반발 업계', '조선일보');
    const res = await find(clusterId);
    expect((res.body.items as Item[]).map((i) => [i.kind, i.reason])).toEqual([['other_source', '']]);
  });

  it('[예외] 임베딩이 실패하면 502이고 사용 횟수를 돌려준다', async () => {
    embed.mockRejectedValue(new EmbeddingError('임베딩 서비스 오류 (HTTP 500)'));
    const clusterId = await issue([await card('반도체 수출 규제 강화'), await card('반도체 수출 규제 영향')]);
    const res = await find(clusterId);
    expect(res.status).toBe(502);
    expect(res.body.error).not.toMatch(/https?:|HTTP/);
    expect((await request(app).get(`/api/boards/${boardId}/perspectives/quota`).set('Cookie', owner.cookie)).body).toEqual({ remaining: 20 });
  });

  it('후보 기사의 임베딩도 저장해 두고 다음에 재사용한다', async () => {
    const clusterId = await issue([await card('반도체 수출 규제 강화'), await card('반도체 수출 규제 영향')]);
    await collected('반도체 수출 규제 반발 업계', '조선일보');
    await find(clusterId);
    await find(clusterId);
    expect(embed.mock.calls.map(([texts]) => texts.length)).toEqual([2, 1]); // 보드 기사 2건 → 후보 1건, 두 번째는 호출 없음
  });

  it('보드 멤버가 아니면 404, 다른 보드의 이슈도 404, 메모만 있는 이슈는 400', async () => {
    const clusterId = await issue([await card('반도체 수출 규제 강화'), await card('반도체 수출 규제 영향')]);
    expect((await find(clusterId, outsider.cookie)).status).toBe(404);

    const other = (await boards.createBoard(owner.id, '다른 보드')).id;
    const memo = await boards.addItem(other, owner.id, { type: 'memo', content: '반도체 규제 메모', x: 0, y: 0 });
    const memoIssue = await issue([memo.id], other);
    expect((await find(memoIssue)).status).toBe(404); // 이 보드의 이슈가 아님
    expect((await find(memoIssue, owner.cookie, other)).status).toBe(400);
    expect((await find('abc')).status).toBe(404);
    expect(judge).not.toHaveBeenCalled();
  });

  it('하루 한도를 넘으면 429', async () => {
    makeApp({ user: 0, ip: 40, total: 200 });
    const clusterId = await issue([await card('반도체 수출 규제 강화'), await card('반도체 수출 규제 영향')]);
    const res = await find(clusterId);
    expect(res.status).toBe(429);
    expect(res.body).toMatchObject({ code: 'quota', scope: 'user' });
  });
});
