import type pg from 'pg';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../app.js';
import { AiQuota } from '../ai/quota.js';
import { SummaryError, type Summarizer } from '../ai/summarizer.js';
import { BoardService } from '../boards/service.js';
import { LinkError, type FetchedPage } from '../links/safeFetch.js';
import { LinkService } from '../links/service.js';
import { TEST_APP_ORIGIN, authCookie, fakeAuthDeps, fakeOAuthDeps, recordingNotifier } from '../test/auth.js';
import { createTestPool, testDatabaseUrl } from '../test/db.js';
import { createArticle, createUser, resetDb } from '../test/fixtures.js';

const BODY = '반도체 수출 규제가 장비와 정비 인력까지 넓어졌다. '.repeat(20);
const articleHtml = (title = '美, AI 칩 수출 통제 3차 확대') =>
  `<html><head><meta property="og:title" content="${title}"><meta property="og:description" content="페이지 설명"></head>
   <body><article><h1>${title}</h1><p>${BODY}</p><p>${BODY}</p></article></body></html>`;

describe.skipIf(!testDatabaseUrl)('[F-03] 링크로 기사 카드 추가 (DB)', () => {
  let pool: pg.Pool;
  let boards: BoardService;
  let app: ReturnType<typeof createApp>;
  let calls: ReturnType<typeof recordingNotifier>['calls'];
  let fetchPage: ReturnType<typeof vi.fn<(url: string) => Promise<FetchedPage>>>;
  let summarize: ReturnType<typeof vi.fn<Summarizer['summarize']>>;
  let owner: { id: string; cookie: string };
  let outsider: { id: string; cookie: string };
  let boardId: string;

  const page = (html: string, url = 'https://www.hani.co.kr/arti/1.html'): FetchedPage => ({ finalUrl: url, contentType: 'text/html', html });

  function makeApp(limits = { user: 20, ip: 50, total: 300 }) {
    const recorder = recordingNotifier();
    calls = recorder.calls;
    const links = new LinkService({ pool, boards, summarizer: { summarize }, quota: new AiQuota(pool, limits), fetchPage });
    app = createApp({
      checkDb: async () => true,
      articles: { listFeed: async () => ({ articles: [], nextCursor: null, collectedCursor: null }) },
      auth: fakeAuthDeps(),
      oauth: fakeOAuthDeps(),
      boards: { boards, notifier: recorder.notifier, links },
      appOrigin: TEST_APP_ORIGIN,
    });
  }

  const submit = (url: string, cookie = owner.cookie, id = boardId) =>
    request(app).post(`/api/boards/${id}/links`).set('Cookie', cookie).send({ url, x: 10, y: 20 });

  beforeAll(() => {
    pool = createTestPool();
    boards = new BoardService(pool);
  });
  beforeEach(async () => {
    await resetDb(pool);
    fetchPage = vi.fn(async () => page(articleHtml()));
    summarize = vi.fn(async () => '통제 대상이 장비·정비 인력으로 넓어졌다.');
    makeApp();
    const ownerId = await createUser(pool, '주인');
    const outsiderId = await createUser(pool, '외부인');
    owner = { id: ownerId, cookie: await authCookie(ownerId) };
    outsider = { id: outsiderId, cookie: await authCookie(outsiderId) };
    boardId = (await boards.createBoard(ownerId, '반도체 이슈')).id;
  });
  afterAll(async () => {
    await pool.end();
  });

  it('[수용 기준] 뉴스 URL을 넣으면 AI 요약 카드가 보드에 생기고, 접속 중인 사람들에게 알린다', async () => {
    const res = await submit('https://www.hani.co.kr/arti/1.html?utm_source=kakao');
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ reused: false, summarized: true, remaining: 19 });
    expect(res.body.item).toMatchObject({ type: 'article', x: 10, y: 20 });
    expect(res.body.item.article).toMatchObject({
      title: '美, AI 칩 수출 통제 3차 확대',
      description: '통제 대상이 장비·정비 인력으로 넓어졌다.',
      source: '한겨레',
      category: null,
      originalLink: 'https://www.hani.co.kr/arti/1.html',
    });
    expect(calls).toContainEqual(['cardAdded', boardId, res.body.item.id, owner.id]);

    const { rows } = await pool.query('SELECT source_type, submitted_by FROM articles');
    expect(rows).toEqual([{ source_type: 'user_submitted', submitted_by: owner.id }]);
  });

  it('같은 기사(추적 파라미터만 다른 주소 포함)를 다시 넣으면 저장된 기사를 재사용하고 AI를 다시 부르지 않는다', async () => {
    await submit('https://www.hani.co.kr/arti/1.html');
    const again = await submit('https://www.hani.co.kr/arti/1.html?fbclid=abc#top');
    expect(again.status).toBe(201);
    expect(again.body).toMatchObject({ reused: true, summarized: false, remaining: 19 });
    expect(summarize).toHaveBeenCalledTimes(1);
    expect(fetchPage).toHaveBeenCalledTimes(1);
    expect((await pool.query('SELECT 1 FROM articles')).rowCount).toBe(1);
  });

  it('[C-06] 이미 API로 수집된 기사 주소면 그 기사를 그대로 카드로 쓴다', async () => {
    const articleId = await createArticle(pool, '수집된 기사');
    const { rows } = await pool.query<{ original_link: string }>('SELECT original_link FROM articles WHERE id = $1', [articleId]);
    const res = await submit(rows[0]!.original_link);
    expect(res.body).toMatchObject({ reused: true });
    expect(res.body.item.articleId).toBe(articleId);
    expect(fetchPage).not.toHaveBeenCalled();
  });

  it('[보안] 보드 멤버가 아니면 페이지를 가져오거나 한도를 쓰기 전에 거절한다', async () => {
    const res = await submit('https://www.hani.co.kr/arti/1.html', outsider.cookie);
    expect(res.status).toBe(404);
    expect(fetchPage).not.toHaveBeenCalled();
  });

  it('[보안] 내부 주소로 가는 링크는 막았다고만 안내한다 (SSRF 방지, 내부 정보 노출 없음)', async () => {
    fetchPage.mockRejectedValueOnce(new LinkError('blocked', '이 주소는 가져올 수 없습니다'));
    const res = await submit('http://169.254.169.254/latest/meta-data');
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: '이 주소는 가져올 수 없습니다', code: 'blocked' });
  });

  it('[예외] 본문 추출에 실패해도 페이지 설명(og:description)으로 카드를 만든다 — AI·한도는 쓰지 않음', async () => {
    fetchPage.mockResolvedValueOnce(page('<html><head><meta property="og:title" content="짧은 글"><meta property="og:description" content="페이지가 밝힌 설명"></head><body>짧음</body></html>'));
    const res = await submit('https://www.hani.co.kr/arti/2.html');
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ summarized: false, remaining: 20 });
    expect(res.body.item.article.description).toBe('페이지가 밝힌 설명');
    expect(summarize).not.toHaveBeenCalled();
  });

  it('[예외] 요약할 내용이 전혀 없으면 "요약할 수 없는 페이지"로 안내한다', async () => {
    fetchPage.mockResolvedValueOnce(page('<html><body>로그인이 필요합니다</body></html>'));
    const res = await submit('https://www.hani.co.kr/arti/3.html');
    expect(res.status).toBe(422);
    expect(res.body.code).toBe('unreadable');
  });

  it('[예외] AI 요약이 한 번 실패하면 1회 다시 시도하고, 그래도 실패하면 오류를 알린다', async () => {
    summarize.mockRejectedValueOnce(new SummaryError('일시 오류'));
    expect((await submit('https://www.hani.co.kr/arti/4.html')).status).toBe(201);
    expect(summarize).toHaveBeenCalledTimes(2);

    summarize.mockRejectedValue(new SummaryError('계속 오류'));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const res = await submit('https://www.hani.co.kr/arti/5.html');
    expect(res.status).toBe(502);
    expect(res.body.code).toBe('summary_failed');
    expect((await pool.query("SELECT 1 FROM articles WHERE original_link LIKE '%/5.html'")).rowCount).toBe(0);
    // 실패한 요약은 하루 횟수에서 빠지지 않는다 (성공 1회만 차감)
    const quota = await request(app).get(`/api/boards/${boardId}/links/quota`).set('Cookie', owner.cookie);
    expect(quota.body).toEqual({ remaining: 19 });
  });

  it('[결정 B] 하루 한도를 넘으면 429로 알리고 AI를 부르지 않는다', async () => {
    makeApp({ user: 1, ip: 50, total: 300 });
    expect((await submit('https://www.hani.co.kr/arti/6.html')).status).toBe(201);
    const res = await submit('https://www.hani.co.kr/arti/7.html');
    expect(res.status).toBe(429);
    expect(res.body).toMatchObject({ code: 'quota', scope: 'user' });
    expect(summarize).toHaveBeenCalledTimes(1);
    const quota = await request(app).get(`/api/boards/${boardId}/links/quota`).set('Cookie', owner.cookie);
    expect(quota.body).toEqual({ remaining: 0 });
  });

  it('m. 도메인을 없앤 주소가 열리지 않으면 원래 주소로 다시 시도한다', async () => {
    fetchPage.mockRejectedValueOnce(new LinkError('fetch_failed', '사이트에 연결할 수 없습니다'));
    const res = await submit('https://m.only-mobile.example/news/1');
    expect(res.status).toBe(201);
    expect(fetchPage.mock.calls.map(([u]) => u)).toEqual(['https://only-mobile.example/news/1', 'https://m.only-mobile.example/news/1']);
  });

  it('[C-06] 다른 보드에 링크로 추가된 기사는 id만 알아서는 내 보드에 올릴 수 없다', async () => {
    const res = await submit('https://www.hani.co.kr/arti/8.html');
    const articleId = res.body.item.articleId as string;
    const otherBoard = (await boards.createBoard(outsider.id, '다른 보드')).id;
    await expect(
      boards.addItem(otherBoard, outsider.id, { type: 'article', articleId, x: 0, y: 0 }),
    ).rejects.toMatchObject({ code: 'invalid' });
    // 같은 보드 안에서는 다시 올릴 수 있다
    expect(await boards.addItem(boardId, owner.id, { type: 'article', articleId, x: 0, y: 0 })).toMatchObject({ articleId });
  });

  it.each([{}, { url: '' }, { url: 'x'.repeat(2001) }, { url: 'https://a.b', x: 'left' }])('입력이 잘못되면 400 (%#)', async (body) => {
    const res = await request(app).post(`/api/boards/${boardId}/links`).set('Cookie', owner.cookie).send(body);
    expect(res.status).toBe(400);
  });
  describe('[B12] 요약 미리보기 → 보드에 추가', () => {
    const preview = (url: string, cookie = owner.cookie) =>
      request(app).post(`/api/boards/${boardId}/links/preview`).set('Cookie', cookie).send({ url });
    const confirm = (url: string, cookie = owner.cookie) =>
      request(app).post(`/api/boards/${boardId}/links/confirm`).set('Cookie', cookie).send({ url, x: 5, y: 6 });

    it('미리보기는 요약까지만 하고 카드를 만들지 않는다. "보드에 추가"를 눌러야 카드가 생긴다', async () => {
      const res = await preview('https://www.hani.co.kr/arti/1.html');
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ reused: false, summarized: true, onBoard: false, remaining: 19 });
      expect(res.body.article).toMatchObject({ title: '美, AI 칩 수출 통제 3차 확대', description: '통제 대상이 장비·정비 인력으로 넓어졌다.' });
      expect((await boards.getSnapshot(boardId, owner.id)).items).toEqual([]);

      const added = await confirm('https://www.hani.co.kr/arti/1.html?utm_source=x');
      expect(added.status).toBe(201);
      expect(added.body.item).toMatchObject({ x: 5, y: 6, article: { title: '美, AI 칩 수출 통제 3차 확대' } });
      expect(calls.some(([name]) => name === 'cardAdded')).toBe(true);

      // 같은 주소를 다시 미리보기하면 이미 이 보드에 있다고 알린다 (AI 다시 안 부름);
      const again = await preview('https://www.hani.co.kr/arti/1.html');
      expect(again.body).toMatchObject({ reused: true, onBoard: true });
      expect(summarize).toHaveBeenCalledTimes(1);
    });

    it('[보안] 미리보기하지 않은 주소는 추가할 수 없고, 멤버가 아니면 미리보기도 못 한다', async () => {
      expect((await confirm('https://www.hani.co.kr/arti/9.html')).status).toBe(404);
      expect((await preview('https://www.hani.co.kr/arti/1.html', outsider.cookie)).status).toBe(404);
      expect(fetchPage).not.toHaveBeenCalled();
    });
  });

  it('[B7] 뉴스 화면에서 고른 기사를 보드 맨 아래 왼쪽에 추가한다', async () => {
    await boards.addItem(boardId, owner.id, { type: 'memo', content: '메모', x: -40, y: 300 });
    const articleId = await createArticle(pool, '수집된 기사');
    const res = await request(app).post(`/api/boards/${boardId}/articles`).set('Cookie', owner.cookie).send({ articleId });
    expect(res.status).toBe(201);
    expect(res.body.item).toMatchObject({ x: -40, y: 560 });
    expect(calls.some(([name]) => name === 'cardAdded')).toBe(true);
    expect((await request(app).post(`/api/boards/${boardId}/articles`).set('Cookie', outsider.cookie).send({ articleId })).status).toBe(404);
  });
});
