import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { createApp, type AppDeps } from './app.js';
import type { FeedPage } from './news/feed.js';
import { TEST_APP_ORIGIN, authCookie, fakeAuthDeps, fakeBoardDeps, fakeOAuthDeps } from './test/auth.js';

const emptyPage: FeedPage = { articles: [], nextCursor: null, collectedCursor: null };

function makeApp(overrides: Partial<AppDeps> = {}) {
  const listFeed = vi.fn(async () => emptyPage);
  const app = createApp({
    checkDb: async () => true,
    articles: { listFeed },
    auth: fakeAuthDeps(),
    oauth: fakeOAuthDeps(),
    boards: fakeBoardDeps(),
    appOrigin: TEST_APP_ORIGIN,
    ...overrides,
  });
  return { app, listFeed };
}

describe('GET /api/health', () => {
  it('DB가 연결되어 있으면 200과 ok를 반환한다', async () => {
    const res = await request(makeApp().app).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok', db: true });
  });

  it('DB 연결이 실패하면 503과 degraded를 반환한다', async () => {
    const res = await request(makeApp({ checkDb: async () => false }).app).get('/api/health');
    expect(res.status).toBe(503);
    expect(res.body).toEqual({ status: 'degraded', db: false });
  });
});

describe('GET /api/articles', () => {
  it('[F-07] 로그인하지 않으면 401', async () => {
    const { app, listFeed } = makeApp();
    const res = await request(app).get('/api/articles');
    expect(res.status).toBe(401);
    expect(listFeed).not.toHaveBeenCalled();
  });

  it('기본값(30건, 전체 카테고리)으로 조회한다', async () => {
    const { app, listFeed } = makeApp();
    const res = await request(app).get('/api/articles').set('Cookie', await authCookie());
    expect(res.status).toBe(200);
    expect(res.body).toEqual(emptyPage);
    expect(listFeed).toHaveBeenCalledWith({ limit: 30, before: undefined, category: undefined });
  });

  it('limit·category·before 커서를 해석해 넘긴다', async () => {
    const { app, listFeed } = makeApp();
    const before = encodeURIComponent('2026-10-01T12:00:00.000Z_42');
    await request(app)
      .get(`/api/articles?limit=10&category=economy&before=${before}`)
      .set('Cookie', await authCookie());
    expect(listFeed).toHaveBeenCalledWith({
      limit: 10,
      category: 'economy',
      before: { publishedAt: new Date('2026-10-01T12:00:00.000Z'), id: '42' },
    });
  });

  it('[C-10] collectedAfter 커서(수집 시각 마이크로초_id)를 해석해 넘긴다', async () => {
    const { app, listFeed } = makeApp();
    await request(app).get('/api/articles?limit=100&collectedAfter=1790000000123456_42').set('Cookie', await authCookie());
    expect(listFeed).toHaveBeenCalledWith({ limit: 100, collectedAfter: { micros: '1790000000123456', id: '42' } });
  });

  it('[F-04] 검색어·언론사·기간(한국 시간 날짜)을 해석해 넘긴다', async () => {
    const { app, listFeed } = makeApp();
    await request(app)
      .get(`/api/articles?q=${encodeURIComponent(' 반도체 규제 ')}&source=${encodeURIComponent('한겨레')}&from=2026-10-01&to=2026-10-03`)
      .set('Cookie', await authCookie());
    expect(listFeed).toHaveBeenCalledWith({
      limit: 30,
      q: '반도체 규제',
      source: '한겨레',
      from: new Date('2026-09-30T15:00:00.000Z'),
      to: new Date('2026-10-03T15:00:00.000Z'),
    });
  });

  it('[F-04] 기간의 시작이 끝보다 늦거나 날짜 형식이 틀리면 400', async () => {
    const { app } = makeApp();
    const cookie = await authCookie();
    expect((await request(app).get('/api/articles?from=2026-10-05&to=2026-10-01').set('Cookie', cookie)).status).toBe(400);
    expect((await request(app).get('/api/articles?from=10월1일').set('Cookie', cookie)).status).toBe(400);
  });

  it.each([
    ['limit=0', 'limit'],
    ['limit=101', 'limit'],
    ['category=weather', 'category'],
    ['before=not-a-cursor', 'before'],
    ['collectedAfter=2026-10-01_1', 'collectedAfter'],
    ['collectedAfter=1_1&before=2026-10-01T12:00:00.000Z_42', 'collectedAfter'],
  ])('잘못된 파라미터(%s)는 400', async (query, field) => {
    const { app, listFeed } = makeApp();
    const res = await request(app).get(`/api/articles?${query}`).set('Cookie', await authCookie());
    expect(res.status).toBe(400);
    expect(res.body.fields).toContain(field);
    expect(listFeed).not.toHaveBeenCalled();
  });

  it('조회 중 에러가 나면 내부 메시지를 숨기고 500을 반환한다', async () => {
    const listFeed = vi.fn(async (): Promise<FeedPage> => {
      throw new Error('password authentication failed for user "moyobom"');
    });
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = await request(makeApp({ articles: { listFeed } }).app)
      .get('/api/articles')
      .set('Cookie', await authCookie());
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: '서버 오류' });
  });
});
