import type pg from 'pg';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../app.js';
import { EMBEDDING_DIMENSIONS, EmbeddingError, type Embedder } from '../ai/embedder.js';
import { AiQuota } from '../ai/quota.js';
import { SummaryError, type ClusterSummarizer } from '../ai/summarizer.js';
import { BoardService } from '../boards/service.js';
import { ClusterService } from '../clusters/service.js';
import { TEST_APP_ORIGIN, authCookie, fakeAuthDeps, fakeOAuthDeps, recordingNotifier } from '../test/auth.js';
import { createTestPool, testDatabaseUrl } from '../test/db.js';
import { createArticle, createUser, resetDb } from '../test/fixtures.js';

/** 제목의 주제어로 방향이 정해지는 가짜 임베딩: 반도체 → 0번 축, 중동 → 1번 축, 그 밖 → 2번 축 */
function topicVector(text: string): number[] {
  const v = new Array<number>(EMBEDDING_DIMENSIONS).fill(0);
  const axis = text.includes('반도체') ? 0 : text.includes('중동') ? 1 : 2;
  v[axis] = 1;
  v[3 + (text.length % 5)] = 0.1; // 같은 주제 안에서도 조금씩 다르게
  return v;
}

describe.skipIf(!testDatabaseUrl)('[F-08] AI 이슈 클러스터링 (DB)', () => {
  let pool: pg.Pool;
  let boards: BoardService;
  let app: ReturnType<typeof createApp>;
  let calls: ReturnType<typeof recordingNotifier>['calls'];
  let embed: ReturnType<typeof vi.fn<Embedder['embed']>>;
  let summarizeCluster: ReturnType<typeof vi.fn<ClusterSummarizer['summarizeCluster']>>;
  let owner: { id: string; cookie: string };
  let editor: { id: string; cookie: string };
  let outsider: { id: string; cookie: string };
  let boardId: string;
  let service: ClusterService;

  function makeApp(limits = { user: 10, ip: 30, total: 200 }) {
    const recorder = recordingNotifier();
    calls = recorder.calls;
    service = new ClusterService({
      pool,
      boards,
      embedder: { embed },
      summarizer: { summarizeCluster },
      quota: new AiQuota(pool, limits),
      threshold: 0.8,
    });
    app = createApp({
      checkDb: async () => true,
      articles: { listFeed: async () => ({ articles: [], nextCursor: null, collectedCursor: null }) },
      auth: fakeAuthDeps(),
      oauth: fakeOAuthDeps(),
      boards: { boards, notifier: recorder.notifier, clusters: service },
      appOrigin: TEST_APP_ORIGIN,
    });
  }

  /** 기사 카드를 보드에 올리고 카드 id를 돌려준다 */
  async function card(title: string, x = 0, y = 0) {
    const articleId = await createArticle(pool, title);
    return (await boards.addItem(boardId, owner.id, { type: 'article', articleId, x, y })).id;
  }
  const run = (cookie = owner.cookie) => request(app).post(`/api/boards/${boardId}/clusters`).set('Cookie', cookie);

  beforeAll(() => {
    pool = createTestPool();
    boards = new BoardService(pool);
  });
  beforeEach(async () => {
    await resetDb(pool);
    embed = vi.fn(async (texts: string[]) => texts.map(topicVector));
    summarizeCluster = vi.fn(async (articles) => ({ title: `이슈 ${articles.length}건`, summary: '공통 이슈 요약' }));
    makeApp();
    const ids = await Promise.all(['주인', '편집자', '외부인'].map((n) => createUser(pool, n)));
    owner = { id: ids[0]!, cookie: await authCookie(ids[0]!) };
    editor = { id: ids[1]!, cookie: await authCookie(ids[1]!) };
    outsider = { id: ids[2]!, cookie: await authCookie(ids[2]!) };
    boardId = (await boards.createBoard(owner.id, '이슈 보드')).id;
    const { token } = await boards.getInvite(boardId, owner.id);
    await boards.acceptInvite(token, editor.id);
  });
  afterAll(async () => {
    await pool.end();
  });

  it('[수용 기준] 관련 기사끼리 묶고 그룹마다 AI 요약을 붙인다 — 카드 좌표는 바꾸지 않는다', async () => {
    const chips = [await card('반도체 수출 규제', 0, 0), await card('반도체 장비 통제', 300, 0), await card('반도체 소재 영향', 0, 300)];
    const mideast = [await card('중동 긴장 고조', 900, 0), await card('중동 유가 급등', 900, 300)];
    await card('프로야구 개막', 2000, 2000);
    await boards.addItem(boardId, owner.id, { type: 'memo', content: '메모는 분석에서 빠진다', x: 0, y: 0 });
    const before = (await boards.getSnapshot(boardId, owner.id)).items.map((i) => [i.id, i.x, i.y]);

    const res = await run(editor.cookie); // 편집자도 실행할 수 있다 (C-05 기본안)
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ analyzed: 6, excluded: 0, remaining: 9 });
    expect(res.body.clusters.map((c: { itemIds: string[] }) => c.itemIds)).toEqual([chips, mideast]);
    expect(res.body.clusters[0]).toMatchObject({ title: '이슈 3건', summary: '공통 이슈 요약' });
    expect(calls).toContainEqual(['clustersChanged', boardId, '2']);

    const snapshot = await boards.getSnapshot(boardId, owner.id);
    expect(snapshot.items.map((i) => [i.id, i.x, i.y])).toEqual(before);
    expect(snapshot.clusters).toHaveLength(2);
  });

  it('임베딩은 한 번 만들면 저장해 두고 다시 분석할 때 재사용한다. 다시 분석하면 클러스터를 새 결과로 바꾼다', async () => {
    await card('반도체 A');
    await card('반도체 B');
    await run();
    expect(embed).toHaveBeenCalledTimes(1);

    await card('반도체 C');
    const again = await run();
    expect(embed).toHaveBeenCalledTimes(2);
    expect(embed.mock.calls[1]![0]).toHaveLength(1); // 새 기사만
    expect(again.body.clusters).toHaveLength(1);
    expect(again.body.clusters[0].itemIds).toHaveLength(3);
    expect((await pool.query('SELECT 1 FROM clusters')).rowCount).toBe(1);
  });

  it('[예외] 일부 기사 임베딩이 실패하면 그 기사만 빼고 분석한다', async () => {
    await card('반도체 A');
    await card('반도체 B');
    await card('반도체 실패할 기사');
    embed.mockImplementation(async (texts: string[]) => {
      if (texts.length > 1 || texts[0]!.includes('실패')) throw new EmbeddingError('일시 오류');
      return texts.map(topicVector);
    });
    const res = await run();
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ analyzed: 2, excluded: 1 });
    expect(res.body.clusters[0].itemIds).toHaveLength(2);
  });

  it('[예외] 임베딩이 전부 실패하면 오류를 알리고 사용 횟수를 돌려준다', async () => {
    await card('반도체 A');
    await card('반도체 B');
    embed.mockRejectedValue(new EmbeddingError('서비스 장애'));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = await run();
    expect(res.status).toBe(502);
    expect(res.body.code).toBe('ai_failed');
    expect((await request(app).get(`/api/boards/${boardId}/clusters/quota`).set('Cookie', owner.cookie)).body).toEqual({
      remaining: 10,
    });
  });

  it('[예외] 클러스터 요약이 실패해도 대표 기사 제목으로 클러스터는 보여 준다', async () => {
    await card('반도체 수출 규제 확대');
    await card('반도체 장비 통제');
    summarizeCluster.mockRejectedValue(new SummaryError('오류'));
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const res = await run();
    expect(res.body.clusters[0]).toMatchObject({ title: '반도체 수출 규제 확대', summary: '' });
  });

  it('같은 보드를 동시에 두 번 분석하지 않는다 (409)', async () => {
    await card('반도체 A');
    await card('반도체 B');
    let release!: () => void;
    embed.mockImplementationOnce(
      (texts) => new Promise((resolve) => (release = () => resolve(texts.map(topicVector)))),
    );
    const first = run().then((r) => r); // supertest는 then을 불러야 요청을 보낸다
    await new Promise((r) => setTimeout(r, 50));
    const second = await run();
    expect(second.status).toBe(409);
    release();
    expect((await first).status).toBe(201);
  });

  it('기사 카드가 2개 미만이면 400, 멤버가 아니면 404, 하루 한도를 넘으면 429', async () => {
    await card('반도체 A');
    expect((await run()).status).toBe(400);
    expect((await run(outsider.cookie)).status).toBe(404);
    expect(embed).not.toHaveBeenCalled();

    makeApp({ user: 1, ip: 30, total: 200 });
    await card('반도체 B');
    expect((await run()).status).toBe(201);
    const res = await run();
    expect(res.status).toBe(429);
    expect(res.body).toMatchObject({ code: 'quota', scope: 'user' });
  });

  it('[수용 기준] "자동 정렬"은 묶인 카드를 클러스터 옆으로 옮기고, "원래대로"는 손대지 않은 카드만 제자리로 돌린다', async () => {
    const a = await card('반도체 A', 10, 20);
    const b = await card('반도체 B', 500, 600);
    const c = await card('반도체 C', -300, 40);
    const { body } = await run();
    const clusterId = body.clusters[0].id as string;

    const arranged = await request(app).post(`/api/boards/${boardId}/clusters/${clusterId}/arrange`).set('Cookie', editor.cookie);
    expect(arranged.status).toBe(200);
    expect(arranged.body.items.map((i: { arranged: boolean }) => i.arranged)).toEqual([true, true, true]);
    expect(calls.some(([name]) => name === 'cardsMoved')).toBe(true);

    // 정렬 뒤 누군가 B를 손으로 옮김
    await boards.moveItem(boardId, owner.id, b, { x: 777, y: 888 });

    const restored = await request(app).post(`/api/boards/${boardId}/clusters/${clusterId}/restore`).set('Cookie', owner.cookie);
    expect(restored.body.items.map((i: { id: string }) => i.id).sort()).toEqual([a, c].sort());
    const items = new Map((await boards.getSnapshot(boardId, owner.id)).items.map((i) => [i.id, i]));
    expect(items.get(a)).toMatchObject({ x: 10, y: 20, arranged: false });
    expect(items.get(c)).toMatchObject({ x: -300, y: 40, arranged: false });
    expect(items.get(b)).toMatchObject({ x: 777, y: 888, arranged: false }); // 사람의 배치가 우선
  });

  it('"제안 무시"는 클러스터만 지우고 카드는 그대로 둔다', async () => {
    await card('반도체 A');
    await card('반도체 B');
    const { body } = await run();
    const res = await request(app).delete(`/api/boards/${boardId}/clusters/${body.clusters[0].id}`).set('Cookie', owner.cookie);
    expect(res.status).toBe(204);
    const snapshot = await boards.getSnapshot(boardId, owner.id);
    expect(snapshot.clusters).toEqual([]);
    expect(snapshot.items).toHaveLength(2);
    expect(
      (await request(app).delete(`/api/boards/${boardId}/clusters/${body.clusters[0].id}`).set('Cookie', owner.cookie)).status,
    ).toBe(404);
  });

  it('클러스터에 든 카드를 지우면 클러스터에서도 빠진다', async () => {
    const a = await card('반도체 A');
    await card('반도체 B');
    await card('반도체 C');
    await run();
    await boards.deleteItem(boardId, owner.id, a);
    const [cluster] = (await boards.getSnapshot(boardId, owner.id)).clusters;
    expect(cluster!.itemIds).not.toContain(a);
    expect(cluster!.itemIds).toHaveLength(2);
  });
});
