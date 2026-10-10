import { createServer, type Server as HttpServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import type pg from 'pg';
import { Server } from 'socket.io';
import { io as connect, type Socket } from 'socket.io-client';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { BoardService } from '../boards/service.js';
import type { BoardItem, BoardSnapshot } from '../boards/types.js';
import { TEST_APP_ORIGIN, TEST_JWT_SECRET, authCookie } from '../test/auth.js';
import { createTestPool, testDatabaseUrl } from '../test/db.js';
import { createArticle, createUser, resetDb } from '../test/fixtures.js';
import { attachSocketAuth } from './auth.js';
import { attachBoardSync, type AckResult, type BoardNotifier } from './boardSync.js';
import { PhotoService } from '../photos/service.js';
import { MemoryPhotoStorage } from '../test/photos.js';

type Ok<T> = { ok: true } & T;

/** 스냅샷 조회 직후에 끼어들 수 있게 한 BoardService (join 순서 경쟁 상태 재현용) */
class HookedBoards extends BoardService {
  afterSnapshot: ((userId: string) => Promise<void>) | null = null;

  override async getSnapshot(boardId: string, userId: string): Promise<BoardSnapshot> {
    const snapshot = await super.getSnapshot(boardId, userId);
    await this.afterSnapshot?.(userId);
    return snapshot;
  }
}

describe.skipIf(!testDatabaseUrl)('실시간 협업 보드 (Socket.io + DB)', () => {
  let pool: pg.Pool;
  let boards: HookedBoards;
  let http: HttpServer;
  let io: Server;
  let notifier: BoardNotifier;
  let url: string;
  const clients: Socket[] = [];
  let ownerId: string;
  let friendId: string;
  let boardId: string;
  let storage: MemoryPhotoStorage;

  async function client(userId: string): Promise<Socket> {
    const socket = connect(url, {
      transports: ['websocket'],
      forceNew: true,
      extraHeaders: { Cookie: await authCookie(userId), Origin: TEST_APP_ORIGIN },
    });
    clients.push(socket);
    await new Promise<void>((resolve, reject) => {
      socket.once('connect', () => resolve());
      socket.once('connect_error', reject);
    });
    return socket;
  }

  function emit<T = Record<string, unknown>>(socket: Socket, event: string, payload: unknown): Promise<AckResult & T> {
    return socket.timeout(3000).emitWithAck(event, payload) as Promise<AckResult & T>;
  }

  function next<T>(socket: Socket, event: string): Promise<T> {
    return new Promise((resolve) => socket.once(event, resolve));
  }

  /** 이벤트가 오지 않는지 확인 (짧게 기다림) */
  function nothing(socket: Socket, event: string, ms = 150): Promise<boolean> {
    return new Promise((resolve) => {
      const onEvent = () => resolve(false);
      socket.once(event, onEvent);
      setTimeout(() => {
        socket.off(event, onEvent);
        resolve(true);
      }, ms);
    });
  }

  beforeAll(() => {
    pool = createTestPool();
    boards = new HookedBoards(pool);
  });

  beforeEach(async () => {
    await resetDb(pool);
    boards.afterSnapshot = null;
    ownerId = await createUser(pool, '주인');
    friendId = await createUser(pool, '친구');
    boardId = (await boards.createBoard(ownerId, '반도체 이슈')).id;
    const { token } = await boards.getInvite(boardId, ownerId);
    await boards.acceptInvite(token, friendId);

    http = createServer();
    io = new Server(http);
    attachSocketAuth(io, { jwtSecret: TEST_JWT_SECRET, appOrigin: TEST_APP_ORIGIN });
    storage = new MemoryPhotoStorage();
    notifier = attachBoardSync(io, boards, new PhotoService({ pool, boards, storage }));
    await new Promise<void>((resolve) => http.listen(0, resolve));
    url = `http://localhost:${(http.address() as AddressInfo).port}`;
  });

  afterEach(async () => {
    clients.splice(0).forEach((socket) => socket.disconnect());
    await new Promise<void>((resolve) => io.close(() => resolve()));
  });

  afterAll(async () => {
    await pool.end();
  });

  async function joinedPair() {
    const [owner, friend] = await Promise.all([client(ownerId), client(friendId)]);
    await emit(owner, 'board:join', { boardId });
    await emit(friend, 'board:join', { boardId });
    return { owner, friend };
  }

  it('보드에 들어가면 현재 상태(스냅샷)를 받는다', async () => {
    const socket = await client(ownerId);
    const res = await emit<{ snapshot: BoardSnapshot }>(socket, 'board:join', { boardId });
    expect(res.ok).toBe(true);
    expect((res as Ok<{ snapshot: BoardSnapshot }>).snapshot).toMatchObject({ role: 'owner', items: [] });
  });

  it('[C-11] 스냅샷을 뜬 직후 다른 사람이 카드를 추가해도, 들어오는 사람은 스냅샷이나 이벤트로 반드시 받는다', async () => {
    const owner = await client(ownerId);
    await emit(owner, 'board:join', { boardId });
    const friend = await client(friendId);
    const received: BoardItem[] = [];
    friend.on('card:added', ({ item }: { item: BoardItem }) => received.push(item));

    // 친구의 스냅샷 조회가 끝난 순간 멈추게 하고, 그 사이에 주인이 카드를 추가한다
    let reached!: () => void;
    const atGate = new Promise<void>((resolve) => (reached = resolve));
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    boards.afterSnapshot = async (userId) => {
      if (userId !== friendId) return;
      reached();
      await gate;
    };

    const joining = emit<{ snapshot: BoardSnapshot }>(friend, 'board:join', { boardId });
    await atGate;
    const ack = await emit<{ item: BoardItem }>(owner, 'card:add', { boardId, type: 'memo', content: '사이에 추가', x: 0, y: 0 });
    const addedId = (ack as Ok<{ item: BoardItem }>).item.id;
    release();
    const { snapshot } = (await joining) as Ok<{ snapshot: BoardSnapshot }>;
    await new Promise((resolve) => setTimeout(resolve, 50));

    const seen = [...snapshot.items, ...received].map((item) => item.id);
    expect(seen).toContain(addedId);
  });

  it('[C-11] 스냅샷 조회가 실패하면 room에서 다시 빠져 그 보드 소식을 받지 않는다', async () => {
    const owner = await client(ownerId);
    await emit(owner, 'board:join', { boardId });
    const friend = await client(friendId);
    boards.afterSnapshot = async (userId) => {
      if (userId === friendId) throw new Error('DB 장애 흉내');
    };

    expect(await emit(friend, 'board:join', { boardId })).toMatchObject({ ok: false, error: 'server_error' });
    const inRoom = await io.in(`board:${boardId}`).fetchSockets();
    expect(inRoom.map((s) => String(s.data.userId))).toEqual([ownerId]);
    const silent = nothing(friend, 'card:added');
    await emit(owner, 'card:add', { boardId, type: 'memo', content: 'x', x: 0, y: 0 });
    expect(await silent).toBe(true);
  });

  it('[보안] 멤버가 아니면 보드 room에 들어갈 수 없고, 그 보드 소식도 받지 못한다', async () => {
    const outsiderId = await createUser(pool, '외부인');
    const { owner } = await joinedPair();
    const outsider = await client(outsiderId);

    expect(await emit(outsider, 'board:join', { boardId })).toMatchObject({ ok: false, error: 'not_found' });
    const silent = nothing(outsider, 'card:added');
    await emit(owner, 'card:add', { boardId, type: 'memo', content: '비밀', x: 0, y: 0 });
    expect(await silent).toBe(true);
  });

  it('[수용 기준] 한 명이 카드를 추가·이동·수정·삭제하면 다른 사람 화면에 즉시 반영된다', async () => {
    const { owner, friend } = await joinedPair();
    const articleId = await createArticle(pool, '반도체 수출 급증');

    // 추가: 보낸 사람은 ack로 서버 id를 받고(clientId로 임시 카드와 짝지음), 다른 사람은 이벤트로 받는다
    const added = next<{ item: BoardItem; by: string }>(friend, 'card:added');
    const addAck = await emit<{ item: BoardItem; clientId: string }>(owner, 'card:add', {
      boardId,
      type: 'article',
      articleId,
      x: 10,
      y: 20,
      clientId: 'temp-1',
    });
    expect(addAck).toMatchObject({ ok: true, clientId: 'temp-1' });
    const item = (addAck as Ok<{ item: BoardItem }>).item;
    expect(await added).toEqual({ boardId, item, by: ownerId });
    expect(item.article?.title).toBe('반도체 수출 급증');

    // 이동
    const moved = next<{ item: BoardItem }>(owner, 'card:moved');
    expect(await emit(friend, 'card:move', { boardId, itemId: item.id, x: 300, y: 400, rotation: 5 })).toMatchObject({ ok: true });
    expect((await moved).item).toMatchObject({ x: 300, y: 400, rotation: 5 });
    expect(await emit(friend, 'card:move', { boardId, itemId: item.id, x: 300, y: 400, scale: 2 })).toMatchObject({ ok: true, item: { scale: 2 } });
    expect(await emit(friend, 'card:move', { boardId, itemId: item.id, x: 300, y: 400, scale: 9 })).toMatchObject({ ok: false, error: 'invalid' });

    // 메모 수정
    const memoAck = await emit<{ item: BoardItem }>(friend, 'card:add', { boardId, type: 'memo', content: '초안', x: 0, y: 0 });
    const memoId = (memoAck as Ok<{ item: BoardItem }>).item.id;
    const updated = next<{ item: BoardItem }>(owner, 'card:updated');
    await emit(friend, 'card:update', { boardId, itemId: memoId, content: '수정본' });
    expect((await updated).item.content).toBe('수정본');

    // 삭제
    const deleted = next<{ itemId: string; version: number }>(friend, 'card:deleted');
    const deleteAck = await emit<{ version: number }>(owner, 'card:delete', { boardId, itemId: memoId });
    expect(deleteAck).toMatchObject({ ok: true });
    // 삭제 이벤트도 순번을 담는다 — 받은 쪽은 이 순번 이하의 늦은 이벤트로 카드를 되살리지 않는다 (L-02)
    expect(await deleted).toMatchObject({ itemId: memoId, version: (deleteAck as Ok<{ version: number }>).version });
  });

  it('[F-10] 연결선을 긋고 지우면 다른 사람 화면에 바로 반영된다', async () => {
    const { owner, friend } = await joinedPair();
    const ids: string[] = [];
    for (const content of ['A', 'B']) {
      const ack = await emit<{ item: BoardItem }>(owner, 'card:add', { boardId, type: 'memo', content, x: 0, y: 0 });
      ids.push((ack as Ok<{ item: BoardItem }>).item.id);
    }

    const added = next<{ connection: { id: string; fromId: string; toId: string } }>(friend, 'connection:added');
    const ack = await emit<{ connection: { id: string } }>(owner, 'connection:add', { boardId, fromId: ids[1], toId: ids[0] });
    expect(ack).toMatchObject({ ok: true });
    expect((await added).connection).toMatchObject({ fromId: ids[0], toId: ids[1] });
    expect(await emit(friend, 'connection:add', { boardId, fromId: ids[0], toId: ids[1] })).toMatchObject({ ok: false, error: 'invalid' });

    const deleted = next<{ connectionId: string; version: number }>(owner, 'connection:deleted');
    const connectionId = (ack as Ok<{ connection: { id: string } }>).connection.id;
    expect(await emit(friend, 'connection:delete', { boardId, connectionId })).toMatchObject({ ok: true });
    expect(await deleted).toMatchObject({ connectionId });
  });

  it('드래그 중 위치(card:moving)는 다른 사람에게 중계만 하고 DB에는 저장하지 않는다', async () => {
    const { owner, friend } = await joinedPair();
    const ack = await emit<{ item: BoardItem }>(owner, 'card:add', { boardId, type: 'memo', content: 'x', x: 0, y: 0 });
    const itemId = (ack as Ok<{ item: BoardItem }>).item.id;

    const moving = next<{ itemId: string; x: number; y: number; by: string }>(friend, 'card:moving');
    owner.emit('card:moving', { boardId, itemId, x: 50, y: 60 });
    expect(await moving).toEqual({ boardId, itemId, x: 50, y: 60, by: ownerId });

    const { items } = await boards.getSnapshot(boardId, ownerId);
    expect(items[0]).toMatchObject({ x: 0, y: 0 });
  });

  it('[예외] 이미 삭제된 카드를 옮기거나 지우면 ack로 실패를 알려 화면을 되돌리게 한다', async () => {
    const { owner, friend } = await joinedPair();
    const ack = await emit<{ item: BoardItem }>(owner, 'card:add', { boardId, type: 'memo', content: 'x', x: 0, y: 0 });
    const itemId = (ack as Ok<{ item: BoardItem }>).item.id;
    await emit(owner, 'card:delete', { boardId, itemId });

    expect(await emit(friend, 'card:move', { boardId, itemId, x: 1, y: 1 })).toMatchObject({ ok: false, error: 'not_found' });
    expect(await emit(friend, 'card:delete', { boardId, itemId })).toMatchObject({ ok: false, error: 'not_found' });
  });

  it('[예외] 형식이 잘못된 요청은 처리하지 않고 invalid로 답한다', async () => {
    const { owner } = await joinedPair();
    expect(await emit(owner, 'card:add', { boardId, type: 'memo', x: 0, y: 0 })).toMatchObject({ ok: false, error: 'invalid' });
    expect(await emit(owner, 'card:move', { boardId, itemId: '1', x: 'left', y: 0 })).toMatchObject({ ok: false, error: 'invalid' });
    expect(await emit(owner, 'card:add', { boardId, type: 'photo', x: 0, y: 0 })).toMatchObject({ ok: false, error: 'invalid' });
  });

  it('[수용 기준] 연결이 끊긴 동안 바뀐 내용은 다시 들어오면 스냅샷으로 정확히 복원된다', async () => {
    const { owner, friend } = await joinedPair();
    friend.disconnect();
    await emit(owner, 'card:add', { boardId, type: 'memo', content: '끊긴 동안 추가', x: 5, y: 5 });

    friend.connect();
    await new Promise<void>((resolve) => friend.once('connect', () => resolve()));
    const rejoin = await emit<{ snapshot: BoardSnapshot }>(friend, 'board:join', { boardId });
    expect((rejoin as Ok<{ snapshot: BoardSnapshot }>).snapshot.items.map((i) => i.content)).toEqual(['끊긴 동안 추가']);
  });

  it('내보낸 멤버의 연결은 보드에서 빠지고, 이후 소식도 받지 못한다', async () => {
    const { owner, friend } = await joinedPair();
    const removed = next<{ boardId: string }>(friend, 'board:removed');
    await boards.removeMember(boardId, ownerId, friendId);
    await notifier.memberRemoved(boardId, friendId);
    expect(await removed).toEqual({ boardId });

    const silent = nothing(friend, 'card:added');
    await emit(owner, 'card:add', { boardId, type: 'memo', content: 'x', x: 0, y: 0 });
    expect(await silent).toBe(true);
    expect(await emit(friend, 'card:add', { boardId, type: 'memo', content: 'x', x: 0, y: 0 })).toMatchObject({
      ok: false,
      error: 'not_found',
    });
  });

  it('보드가 삭제되면 접속 중인 모두에게 알린다', async () => {
    const { friend } = await joinedPair();
    const deleted = next<{ boardId: string }>(friend, 'board:deleted');
    await boards.deleteBoard(boardId, ownerId);
    await notifier.boardDeleted(boardId);
    expect(await deleted).toEqual({ boardId });
  });

  describe('사진 카드 (F-05)', () => {
    const photoKey = () => `boards/${boardId}/0b6f1c5e-1f7a-4c1e-9a55-2f1d6c3b7a10.jpg`;

    it('[수용 기준] 올린 사진으로 카드를 추가·설명 수정·이동·삭제할 수 있고, 삭제하면 S3 사진도 지운다', async () => {
      const { owner, friend } = await joinedPair();
      storage.put(photoKey(), { contentType: 'image/jpeg' });

      const added = next<{ item: BoardItem }>(friend, 'card:added');
      const res = await emit<{ item: BoardItem }>(owner, 'card:add', {
        boardId, type: 'photo', imageKey: photoKey(), content: '  현장 사진  ', x: 10, y: 20,
      });
      expect(res).toMatchObject({ ok: true, item: { type: 'photo', imageKey: photoKey(), content: '현장 사진' } });
      const itemId = (res as Ok<{ item: BoardItem }>).item.id;
      expect((await added).item.id).toBe(itemId);

      expect(await emit(friend, 'card:update', { boardId, itemId, content: '설명 바꿈' })).toMatchObject({
        ok: true, item: { content: '설명 바꿈' },
      });
      expect(await emit(friend, 'card:move', { boardId, itemId, x: 50, y: 60 })).toMatchObject({ ok: true, item: { x: 50, y: 60 } });

      expect(await emit(owner, 'card:delete', { boardId, itemId })).toMatchObject({ ok: true });
      await new Promise((resolve) => setTimeout(resolve, 50)); // 삭제는 커밋 뒤 따로 진행
      expect(storage.objects.has(photoKey())).toBe(false);
    });

    it('[예외] 올라가지 않은 사진·다른 보드의 사진·이미 카드로 만든 사진은 거절한다', async () => {
      const { owner } = await joinedPair();
      const add = (imageKey: string) => emit(owner, 'card:add', { boardId, type: 'photo', imageKey, x: 0, y: 0 });

      expect(await add(photoKey())).toMatchObject({ ok: false, error: 'not_uploaded' });
      const other = 'boards/999/0b6f1c5e-1f7a-4c1e-9a55-2f1d6c3b7a10.jpg';
      storage.put(other, { contentType: 'image/jpeg' });
      expect(await add(other)).toMatchObject({ ok: false, error: 'invalid' });

      storage.put(photoKey(), { contentType: 'image/jpeg' });
      expect(await add(photoKey())).toMatchObject({ ok: true });
      expect(await add(photoKey())).toMatchObject({ ok: false, error: 'invalid' });
    });

    it('[예외] 멤버가 아니면 사진이 올라가 있어도 카드를 만들 수 없다', async () => {
      const strangerId = await createUser(pool, '외부인');
      const stranger = await client(strangerId);
      storage.put(photoKey(), { contentType: 'image/jpeg' });
      expect(await emit(stranger, 'card:add', { boardId, type: 'photo', imageKey: photoKey(), x: 0, y: 0 })).toMatchObject({
        ok: false, error: 'not_found',
      });
    });
  });
});
