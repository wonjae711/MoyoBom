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

type Ok<T> = { ok: true } & T;

describe.skipIf(!testDatabaseUrl)('실시간 협업 보드 (Socket.io + DB)', () => {
  let pool: pg.Pool;
  let boards: BoardService;
  let http: HttpServer;
  let io: Server;
  let notifier: BoardNotifier;
  let url: string;
  const clients: Socket[] = [];
  let ownerId: string;
  let friendId: string;
  let boardId: string;

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
    boards = new BoardService(pool);
  });

  beforeEach(async () => {
    await resetDb(pool);
    ownerId = await createUser(pool, '주인');
    friendId = await createUser(pool, '친구');
    boardId = (await boards.createBoard(ownerId, '반도체 이슈')).id;
    const { token } = await boards.getInvite(boardId, ownerId);
    await boards.acceptInvite(token, friendId);

    http = createServer();
    io = new Server(http);
    attachSocketAuth(io, { jwtSecret: TEST_JWT_SECRET, appOrigin: TEST_APP_ORIGIN });
    notifier = attachBoardSync(io, boards);
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

    // 메모 수정
    const memoAck = await emit<{ item: BoardItem }>(friend, 'card:add', { boardId, type: 'memo', content: '초안', x: 0, y: 0 });
    const memoId = (memoAck as Ok<{ item: BoardItem }>).item.id;
    const updated = next<{ item: BoardItem }>(owner, 'card:updated');
    await emit(friend, 'card:update', { boardId, itemId: memoId, content: '수정본' });
    expect((await updated).item.content).toBe('수정본');

    // 삭제
    const deleted = next<{ itemId: string }>(friend, 'card:deleted');
    expect(await emit(owner, 'card:delete', { boardId, itemId: memoId })).toEqual({ ok: true });
    expect((await deleted).itemId).toBe(memoId);
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
});
