import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { createApp, type AppDeps } from './app.js';
import type { FeedPage } from './news/feed.js';

const emptyPage: FeedPage = { articles: [], nextCursor: null };

function makeApp(overrides: Partial<AppDeps> = {}) {
  const listFeed = vi.fn(async () => emptyPage);
  const app = createApp({ checkDb: async () => true, articles: { listFeed }, ...overrides });
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
  it('기본값(30건, 전체 카테고리)으로 조회한다', async () => {
    const { app, listFeed } = makeApp();
    const res = await request(app).get('/api/articles');
    expect(res.status).toBe(200);
    expect(res.body).toEqual(emptyPage);
    expect(listFeed).toHaveBeenCalledWith({ limit: 30, before: undefined, category: undefined });
  });

  it('limit·category·before 커서를 해석해 넘긴다', async () => {
    const { app, listFeed } = makeApp();
    const before = encodeURIComponent('2026-10-01T12:00:00.000Z_42');
    await request(app).get(`/api/articles?limit=10&category=economy&before=${before}`);
    expect(listFeed).toHaveBeenCalledWith({
      limit: 10,
      category: 'economy',
      before: { publishedAt: new Date('2026-10-01T12:00:00.000Z'), id: '42' },
    });
  });

  it.each([
    ['limit=0', 'limit'],
    ['limit=101', 'limit'],
    ['category=weather', 'category'],
    ['before=not-a-cursor', 'before'],
  ])('잘못된 파라미터(%s)는 400', async (query, field) => {
    const { app, listFeed } = makeApp();
    const res = await request(app).get(`/api/articles?${query}`);
    expect(res.status).toBe(400);
    expect(res.body.fields).toContain(field);
    expect(listFeed).not.toHaveBeenCalled();
  });

  it('조회 중 에러가 나면 내부 메시지를 숨기고 500을 반환한다', async () => {
    const listFeed = vi.fn(async (): Promise<FeedPage> => {
      throw new Error('password authentication failed for user "moyobom"');
    });
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = await request(makeApp({ articles: { listFeed } }).app).get('/api/articles');
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: '서버 오류' });
  });
});
