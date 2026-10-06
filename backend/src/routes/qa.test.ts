import type pg from 'pg';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../app.js';
import { AnswerError, type Answerer } from '../ai/answerer.js';
import { EMBEDDING_DIMENSIONS, EmbeddingError, type Embedder } from '../ai/embedder.js';
import { AiQuota } from '../ai/quota.js';
import { BoardService } from '../boards/service.js';
import { NOT_FOUND_ANSWER, QaService } from '../qa/service.js';
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

describe.skipIf(!testDatabaseUrl)('[F-12] 보드 기반 질의응답 (DB)', () => {
  let pool: pg.Pool;
  let boards: BoardService;
  let app: ReturnType<typeof createApp>;
  let embed: ReturnType<typeof vi.fn<Embedder['embed']>>;
  let answer: ReturnType<typeof vi.fn<Answerer['answer']>>;
  let owner: { id: string; cookie: string };
  let member: { id: string; cookie: string };
  let outsider: { id: string; cookie: string };
  let boardId: string;

  function makeApp(limits = { user: 30, ip: 60, total: 300 }, maxArticles?: number) {
    const qa = new QaService({ pool, boards, embedder: { embed }, answerer: { answer }, quota: new AiQuota(pool, limits), minSimilarity: 0.5, maxArticles });
    app = createApp({
      checkDb: async () => true,
      articles: { listFeed: async () => ({ articles: [], nextCursor: null, collectedCursor: null }) },
      auth: fakeAuthDeps(),
      oauth: fakeOAuthDeps(),
      boards: { boards, notifier: recordingNotifier().notifier, qa },
      appOrigin: TEST_APP_ORIGIN,
    });
  }

  async function card(title: string) {
    const articleId = await createArticle(pool, title);
    return (await boards.addItem(boardId, owner.id, { type: 'article', articleId, x: 0, y: 0 })).id;
  }
  const ask = (question: string, cookie = owner.cookie) =>
    request(app).post(`/api/boards/${boardId}/ask`).set('Cookie', cookie).send({ question });
  const quota = async () => (await request(app).get(`/api/boards/${boardId}/ask/quota`).set('Cookie', owner.cookie)).body;

  beforeAll(() => {
    pool = createTestPool();
    boards = new BoardService(pool);
  });
  beforeEach(async () => {
    await resetDb(pool);
    embed = vi.fn(async (texts: string[]) => texts.map(topicVector));
    answer = vi.fn(async (_q, sources) => ({ answer: `기사 ${sources.length}건을 보면 규제가 확대됐다 [1]`, citations: [1] }));
    makeApp();
    const ids = await Promise.all(['주인', '참여자', '외부인'].map((n) => createUser(pool, n)));
    owner = { id: ids[0]!, cookie: await authCookie(ids[0]!) };
    member = { id: ids[1]!, cookie: await authCookie(ids[1]!) };
    outsider = { id: ids[2]!, cookie: await authCookie(ids[2]!) };
    boardId = (await boards.createBoard(owner.id, '질문 보드')).id;
    const { token } = await boards.getInvite(boardId, owner.id);
    await boards.acceptInvite(token, member.id);
  });
  afterAll(async () => {
    await pool.end();
  });

  it('[수용 기준] 질문과 가까운 보드 기사만 근거로 답하고, 출처 카드를 번호와 함께 돌려준다', async () => {
    const chips = [await card('반도체 수출 규제'), await card('반도체 장비 통제')];
    await card('중동 유가 급등');
    await boards.addItem(boardId, owner.id, { type: 'memo', content: '반도체 메모는 근거가 아니다', x: 0, y: 0 });

    const res = await ask('반도체 규제는 어떻게 되고 있어?', member.cookie); // 참여자도 물을 수 있다
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ found: true, citations: [1], remaining: 29 });
    // 중동 기사는 유사도가 낮아 빠진다
    expect(res.body.sources.map((s: { n: number }) => s.n)).toEqual([1, 2]);
    expect(res.body.sources.map((s: { itemId: string }) => s.itemId).sort()).toEqual([...chips].sort());
    const [question, given] = answer.mock.calls[0]!;
    expect(question).toBe('반도체 규제는 어떻게 되고 있어?');
    expect(given.map((s) => s.title).sort()).toEqual(['반도체 수출 규제', '반도체 장비 통제']);
    expect(given[0]!.text).toBe('요약');
  });

  it('[Codex 324f857] 검색은 근거 설명을 읽은 최근 카드 범위 안에서만 하고, 근거 설명이 비지 않는다', async () => {
    makeApp(undefined, 2);
    const old = await card('반도체 오래된 기사');
    // 범위 밖 카드의 기사는 예전에 임베딩이 저장돼 있어도 출처로 잡히면 안 된다
    await pool.query(`UPDATE articles SET embedding = $2::vector WHERE id = (SELECT article_id FROM board_items WHERE id = $1)`, [
      old,
      `[${topicVector('반도체 오래된 기사').join(',')}]`,
    ]);
    const recent = [await card('반도체 새 기사 1'), await card('반도체 새 기사 2')];
    const res = await ask('반도체 소식은?');
    expect(res.body.sources.map((s: { itemId: string }) => s.itemId).sort()).toEqual([...recent].sort());
    const [, given] = answer.mock.calls[0]!;
    expect(given.every((s) => s.text === '요약')).toBe(true);
  });

  it('[예외] 관련 기사가 없으면 AI 답변 없이 "찾을 수 없다"고 안내한다', async () => {
    await card('중동 유가 급등');
    const res = await ask('프로야구 개막은 언제야?');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ found: false, answer: NOT_FOUND_ANSWER, sources: [], citations: [], remaining: 29 });
    expect(answer).not.toHaveBeenCalled();
  });

  it('기사 임베딩은 저장해 두고 다음 질문에서 재사용한다', async () => {
    await card('반도체 A');
    await card('반도체 B');
    await ask('반도체 전망은?');
    await ask('반도체 다른 질문');
    expect(embed.mock.calls.map(([texts]) => texts.length)).toEqual([2, 1, 1]); // 기사 2건 → 질문 → 질문
  });

  it('[예외] AI 호출이 실패하면 502로 알리고 사용 횟수를 돌려준다', async () => {
    await card('반도체 A');
    vi.spyOn(console, 'error').mockImplementation(() => {});
    answer.mockRejectedValueOnce(new AnswerError('오류'));
    expect((await ask('반도체 전망은?')).body.code).toBe('ai_failed');
    embed.mockRejectedValue(new EmbeddingError('장애'));
    expect((await ask('반도체 전망은?')).status).toBe(502);
    expect(await quota()).toEqual({ remaining: 30 });
  });

  it('질문 검증 400, 기사 카드가 없으면 400, 멤버가 아니면 404, 하루 한도를 넘으면 429', async () => {
    expect((await ask(' ')).status).toBe(400);
    expect((await ask('가'.repeat(301))).status).toBe(400);
    expect((await ask('반도체 전망은?')).status).toBe(400);
    await card('반도체 A');
    expect((await ask('반도체 전망은?', outsider.cookie)).status).toBe(404);
    expect(embed).not.toHaveBeenCalled();

    makeApp({ user: 1, ip: 60, total: 300 });
    expect((await ask('반도체 전망은?')).status).toBe(200);
    const res = await ask('반도체 전망은?');
    expect(res.status).toBe(429);
    expect(res.body).toMatchObject({ code: 'quota', scope: 'user' });
  });
});
