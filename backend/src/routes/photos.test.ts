import type pg from 'pg';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../app.js';
import { BoardService } from '../boards/service.js';
import { PhotoService } from '../photos/service.js';
import { TEST_APP_ORIGIN, authCookie, fakeAuthDeps, fakeOAuthDeps, recordingNotifier } from '../test/auth.js';
import { createTestPool, testDatabaseUrl } from '../test/db.js';
import { createUser, resetDb } from '../test/fixtures.js';
import { MemoryPhotoStorage } from '../test/photos.js';

const UUID = '0b6f1c5e-1f7a-4c1e-9a55-2f1d6c3b7a10';

describe.skipIf(!testDatabaseUrl)('사진 카드 API (F-05, DB)', () => {
  let pool: pg.Pool;
  let boards: BoardService;
  let storage: MemoryPhotoStorage;
  let owner: { id: string; cookie: string };
  let outsider: { id: string; cookie: string };
  let boardId: string;

  const makeApp = (withPhotos = true) =>
    createApp({
      checkDb: async () => true,
      articles: { listFeed: async () => ({ articles: [], nextCursor: null, collectedCursor: null }) },
      auth: fakeAuthDeps(),
      oauth: fakeOAuthDeps(),
      boards: {
        boards,
        notifier: recordingNotifier().notifier,
        photos: withPhotos ? new PhotoService({ pool, boards, storage, newId: () => UUID }) : undefined,
      },
      appOrigin: TEST_APP_ORIGIN,
    });

  beforeAll(() => {
    pool = createTestPool();
    boards = new BoardService(pool);
  });
  beforeEach(async () => {
    await resetDb(pool);
    storage = new MemoryPhotoStorage();
    const ownerId = await createUser(pool, '주인');
    const outsiderId = await createUser(pool, '외부인');
    owner = { id: ownerId, cookie: await authCookie(ownerId) };
    outsider = { id: outsiderId, cookie: await authCookie(outsiderId) };
    boardId = (await boards.createBoard(ownerId, '사진 보드')).id;
  });
  afterAll(async () => {
    await pool.end();
  });

  const upload = (cookie: string, body: object, app = makeApp()) =>
    request(app).post(`/api/boards/${boardId}/photos`).set('Cookie', cookie).set('Origin', TEST_APP_ORIGIN).send(body);

  it('멤버는 업로드 허가증(key·url·fields)을 받는다', async () => {
    const res = await upload(owner.cookie, { contentType: 'image/jpeg', size: 1234 });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      key: `boards/${boardId}/${UUID}.jpg`,
      url: 'https://s3.test/photos',
      fields: { key: `boards/${boardId}/${UUID}.jpg`, 'Content-Type': 'image/jpeg' },
    });
  });

  it('[예외] 형식 400 · 10MB 초과 413 · 멤버 아님 404 · 요청 형식 오류 400 · 로그인 안 함 401', async () => {
    expect((await upload(owner.cookie, { contentType: 'image/gif', size: 10 })).status).toBe(400);
    expect((await upload(owner.cookie, { contentType: 'image/png', size: 10 * 1024 * 1024 + 1 })).status).toBe(413);
    expect((await upload(outsider.cookie, { contentType: 'image/png', size: 10 })).status).toBe(404);
    expect((await upload(owner.cookie, { contentType: 'image/png' })).status).toBe(400);
    expect((await request(makeApp()).post(`/api/boards/${boardId}/photos`).send({})).status).toBe(401);
  });

  it('사진 보기는 멤버만 잠깐 쓰는 S3 주소로 넘겨준다', async () => {
    const key = `boards/${boardId}/${UUID}.png`;
    const item = await boards.addItem(boardId, owner.id, { type: 'photo', imageKey: key, content: null, x: 0, y: 0 });
    const path = `/api/boards/${boardId}/items/${item.id}/photo`;

    const res = await request(makeApp()).get(path).set('Cookie', owner.cookie);
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe(`https://s3.test/photos/${key}?expires=300`);
    expect(res.headers['cache-control']).toBe('private, max-age=240');

    expect((await request(makeApp()).get(path).set('Cookie', outsider.cookie)).status).toBe(404);
    expect((await request(makeApp()).get(`/api/boards/${boardId}/items/abc/photo`).set('Cookie', owner.cookie)).status).toBe(404);
  });

  it('보드를 지우면 그 보드의 사진도 지운다', async () => {
    storage.put(`boards/${boardId}/${UUID}.png`);
    const res = await request(makeApp()).delete(`/api/boards/${boardId}`).set('Cookie', owner.cookie).set('Origin', TEST_APP_ORIGIN);
    expect(res.status).toBe(204);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(storage.objects.size).toBe(0);
  });

  it('[예외] 사진 기능이 꺼져 있으면(버킷 미설정) 503', async () => {
    expect((await upload(owner.cookie, { contentType: 'image/png', size: 10 }, makeApp(false))).status).toBe(503);
  });
});
