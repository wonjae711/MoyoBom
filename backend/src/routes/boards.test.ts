import type pg from 'pg';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../app.js';
import { BoardService } from '../boards/service.js';
import { TEST_APP_ORIGIN, authCookie, fakeAuthDeps, fakeOAuthDeps, recordingNotifier } from '../test/auth.js';
import { createTestPool, testDatabaseUrl } from '../test/db.js';
import { createUser, resetDb } from '../test/fixtures.js';

describe.skipIf(!testDatabaseUrl)('보드 API (DB)', () => {
  let pool: pg.Pool;
  let app: ReturnType<typeof createApp>;
  let calls: ReturnType<typeof recordingNotifier>['calls'];
  let owner: { id: string; cookie: string };
  let friend: { id: string; cookie: string };

  beforeAll(() => {
    pool = createTestPool();
  });
  beforeEach(async () => {
    await resetDb(pool);
    const recorder = recordingNotifier();
    calls = recorder.calls;
    app = createApp({
      checkDb: async () => true,
      articles: { listFeed: async () => ({ articles: [], nextCursor: null }) },
      auth: fakeAuthDeps(),
      oauth: fakeOAuthDeps(),
      boards: { boards: new BoardService(pool), notifier: recorder.notifier },
      appOrigin: TEST_APP_ORIGIN,
    });
    const ownerId = await createUser(pool, '주인');
    const friendId = await createUser(pool, '친구');
    owner = { id: ownerId, cookie: await authCookie(ownerId) };
    friend = { id: friendId, cookie: await authCookie(friendId) };
  });
  afterAll(async () => {
    await pool.end();
  });

  async function createBoard(title = '반도체 이슈'): Promise<string> {
    const res = await request(app).post('/api/boards').set('Cookie', owner.cookie).send({ title });
    return res.body.board.id as string;
  }

  it('[수용 기준] 로그인하지 않으면 보드에 접근할 수 없다', async () => {
    expect((await request(app).get('/api/boards')).status).toBe(401);
    expect((await request(app).post('/api/boards').send({ title: 'x' })).status).toBe(401);
  });

  it('보드를 만들고 목록·상세를 조회한다', async () => {
    const created = await request(app).post('/api/boards').set('Cookie', owner.cookie).send({ title: '  반도체 이슈  ' });
    expect(created.status).toBe(201);
    expect(created.body.board).toMatchObject({ title: '반도체 이슈', role: 'owner' });

    const list = await request(app).get('/api/boards').set('Cookie', owner.cookie);
    expect(list.body.boards).toHaveLength(1);

    const detail = await request(app).get(`/api/boards/${created.body.board.id}`).set('Cookie', owner.cookie);
    expect(detail.status).toBe(200);
    expect(detail.body).toMatchObject({ role: 'owner', items: [], members: [{ nickname: '주인', role: 'owner' }] });
  });

  it.each([[''], ['   '], ['가'.repeat(51)]])('보드 이름이 비었거나 너무 길면 400 (%#)', async (title) => {
    const res = await request(app).post('/api/boards').set('Cookie', owner.cookie).send({ title });
    expect(res.status).toBe(400);
  });

  it('멤버가 아니거나 잘못된 id면 404, owner 전용 작업은 403', async () => {
    const boardId = await createBoard();
    expect((await request(app).get(`/api/boards/${boardId}`).set('Cookie', friend.cookie)).status).toBe(404);
    expect((await request(app).get('/api/boards/abc').set('Cookie', owner.cookie)).status).toBe(404);

    const { body } = await request(app).get(`/api/boards/${boardId}/invite`).set('Cookie', owner.cookie);
    await request(app).post(`/api/invites/${body.token}/accept`).set('Cookie', friend.cookie);
    const rename = await request(app).patch(`/api/boards/${boardId}`).set('Cookie', friend.cookie).send({ title: '바꿈' });
    expect(rename.status).toBe(403);
  });

  it('초대 링크로 친구가 참여하면 보드에 접속 중인 사람들에게 알린다', async () => {
    const boardId = await createBoard();
    const invite = await request(app).get(`/api/boards/${boardId}/invite`).set('Cookie', owner.cookie);
    expect(invite.status).toBe(200);

    const preview = await request(app).get(`/api/invites/${invite.body.token}`).set('Cookie', friend.cookie);
    expect(preview.body).toEqual({ boardId, title: '반도체 이슈', memberCount: 1 });

    const accept = await request(app).post(`/api/invites/${invite.body.token}/accept`).set('Cookie', friend.cookie);
    expect(accept.body).toEqual({ boardId, joined: true });
    expect(calls).toContainEqual(['membersChanged', boardId]);
    expect((await request(app).get(`/api/boards/${boardId}`).set('Cookie', friend.cookie)).body.role).toBe('editor');
  });

  it('[예외] 잘못되거나 재발급으로 무효가 된 초대 링크는 404', async () => {
    const boardId = await createBoard();
    const old = (await request(app).get(`/api/boards/${boardId}/invite`).set('Cookie', owner.cookie)).body.token;
    await request(app).post(`/api/boards/${boardId}/invite`).set('Cookie', owner.cookie);

    expect((await request(app).post(`/api/invites/${old}/accept`).set('Cookie', friend.cookie)).status).toBe(404);
    expect((await request(app).get('/api/invites/x').set('Cookie', friend.cookie)).status).toBe(404);
  });

  it('이름 변경·멤버 내보내기·삭제를 보드에 접속 중인 사람들에게 알린다', async () => {
    const boardId = await createBoard();
    const { body } = await request(app).get(`/api/boards/${boardId}/invite`).set('Cookie', owner.cookie);
    await request(app).post(`/api/invites/${body.token}/accept`).set('Cookie', friend.cookie);

    expect((await request(app).patch(`/api/boards/${boardId}`).set('Cookie', owner.cookie).send({ title: '새 이름' })).status).toBe(204);
    expect(
      (await request(app).delete(`/api/boards/${boardId}/members/${friend.id}`).set('Cookie', owner.cookie)).status,
    ).toBe(204);
    expect((await request(app).delete(`/api/boards/${boardId}`).set('Cookie', owner.cookie)).status).toBe(204);

    expect(calls).toEqual([
      ['membersChanged', boardId],
      ['boardRenamed', boardId, '새 이름'],
      ['memberRemoved', boardId, friend.id],
      ['boardDeleted', boardId],
    ]);
  });

  it('[보안] 다른 사이트에서 보낸 보드 생성 요청은 거절한다 (CSRF)', async () => {
    const res = await request(app)
      .post('/api/boards')
      .set('Cookie', owner.cookie)
      .set('Origin', 'https://evil.example')
      .send({ title: '몰래 만든 보드' });
    expect(res.status).toBe(403);
  });
});
