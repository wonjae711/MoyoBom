import { createServer, type Server as HttpServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { Server } from 'socket.io';
import { io as connect, type Socket } from 'socket.io-client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { NewsEvents } from '../news/events.js';
import type { Article } from '../news/types.js';
import { MAX_BROADCAST, NEW_ARTICLES_EVENT, attachNewsFeed, type NewArticlesPayload } from './newsFeed.js';

function article(id: number, minute: number): Article {
  return {
    id: String(id),
    title: `기사 ${id}`,
    description: '',
    source: '한겨레',
    category: 'economy',
    originalLink: `https://e.com/${id}`,
    publishedAt: new Date(Date.UTC(2026, 9, 1, 12, minute)),
    createdAt: new Date(),
  };
}

function nextPayload(socket: Socket): Promise<NewArticlesPayload> {
  return new Promise((resolve) => socket.once(NEW_ARTICLES_EVENT, resolve));
}

describe('실시간 뉴스 피드 (Socket.io)', () => {
  let http: HttpServer;
  let io: Server;
  let events: NewsEvents;
  let url: string;
  const clients: Socket[] = [];

  async function client(): Promise<Socket> {
    const socket = connect(url, { transports: ['websocket'], forceNew: true });
    clients.push(socket);
    await new Promise<void>((resolve) => socket.once('connect', () => resolve()));
    // 서버가 room에 넣을 때까지 한 틱 기다린다
    await new Promise((resolve) => setTimeout(resolve, 20));
    return socket;
  }

  beforeEach(async () => {
    http = createServer();
    io = new Server(http);
    events = new NewsEvents();
    attachNewsFeed(io, events);
    await new Promise<void>((resolve) => http.listen(0, resolve));
    url = `http://localhost:${(http.address() as AddressInfo).port}`;
  });

  afterEach(async () => {
    clients.splice(0).forEach((socket) => socket.disconnect());
    await new Promise<void>((resolve) => io.close(() => resolve()));
  });

  it('새 기사가 저장되면 접속한 모든 클라이언트에 최신순으로 보낸다', async () => {
    const [a, b] = await Promise.all([client(), client()]);
    const received = Promise.all([nextPayload(a), nextPayload(b)]);

    const startedAt = Date.now();
    events.emit('articles:new', [article(1, 0), article(2, 30), article(3, 10)]);
    const [payloadA, payloadB] = await received;

    // 수용 기준: 저장 후 3초 이내 반영
    expect(Date.now() - startedAt).toBeLessThan(3000);
    expect(payloadA).toEqual(payloadB);
    expect(payloadA.articles.map((x) => x.id)).toEqual(['2', '3', '1']);
    expect(payloadA).toMatchObject({ total: 3, truncated: false });
    expect(payloadA.articles[0]).toEqual({
      id: '2',
      title: '기사 2',
      description: '',
      source: '한겨레',
      category: 'economy',
      originalLink: 'https://e.com/2',
      publishedAt: '2026-10-01T12:30:00.000Z',
      collectedAt: expect.any(String),
      imageUrl: null,
    });
  });

  it(`한 번에 ${MAX_BROADCAST}건이 넘으면 최신 기사만 보내고 truncated로 알린다`, async () => {
    const socket = await client();
    const received = nextPayload(socket);
    events.emit(
      'articles:new',
      Array.from({ length: MAX_BROADCAST + 10 }, (_, i) => article(i + 1, i)),
    );
    const payload = await received;
    expect(payload.articles).toHaveLength(MAX_BROADCAST);
    expect(payload.articles[0]?.id).toBe(String(MAX_BROADCAST + 10));
    expect(payload).toMatchObject({ total: MAX_BROADCAST + 10, truncated: true });
  });

  it('재연결하면 다시 피드 room에 들어가 이후 기사를 받는다', async () => {
    const socket = await client();
    socket.disconnect();
    socket.connect();
    await new Promise<void>((resolve) => socket.once('connect', () => resolve()));
    await new Promise((resolve) => setTimeout(resolve, 20));

    const received = nextPayload(socket);
    events.emit('articles:new', [article(1, 0)]);
    expect((await received).articles).toHaveLength(1);
  });
});
