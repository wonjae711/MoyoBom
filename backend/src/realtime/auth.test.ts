import { createServer, type Server as HttpServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { Server } from 'socket.io';
import { io as connect, type Socket } from 'socket.io-client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { TEST_APP_ORIGIN, TEST_JWT_SECRET, authCookie } from '../test/auth.js';
import { ACCESS_TOKEN_TTL_SECONDS } from '../auth/tokens.js';
import { UNAUTHORIZED, attachSocketAuth } from './auth.js';

describe('소켓 연결 인증', () => {
  let http: HttpServer;
  let io: Server;
  let url: string;
  const clients: Socket[] = [];

  beforeEach(async () => {
    http = createServer();
    io = new Server(http);
    attachSocketAuth(io, { jwtSecret: TEST_JWT_SECRET, appOrigin: TEST_APP_ORIGIN });
    io.on('connection', (socket) => socket.emit('hello', socket.data.userId));
    await new Promise<void>((resolve) => http.listen(0, resolve));
    url = `http://localhost:${(http.address() as AddressInfo).port}`;
  });

  afterEach(async () => {
    clients.splice(0).forEach((socket) => socket.disconnect());
    await new Promise<void>((resolve) => io.close(() => resolve()));
  });

  /** 연결되면 서버가 알려준 userId, 거절되면 에러 메시지 */
  function tryConnect(headers: Record<string, string>): Promise<{ userId?: string; error?: string }> {
    const socket = connect(url, { transports: ['websocket'], forceNew: true, reconnection: false, extraHeaders: headers });
    clients.push(socket);
    return new Promise((resolve) => {
      socket.once('hello', (userId: string) => resolve({ userId }));
      socket.once('connect_error', (error) => resolve({ error: error.message }));
    });
  }

  it('[수용 기준] 로그인 쿠키 없이 연결하면 거부한다', async () => {
    expect(await tryConnect({})).toEqual({ error: UNAUTHORIZED });
  });

  it('유효한 access token 쿠키가 있으면 연결되고 사용자 id를 알 수 있다', async () => {
    expect(await tryConnect({ Cookie: await authCookie('7'), Origin: TEST_APP_ORIGIN })).toEqual({ userId: '7' });
  });

  it('만료된 토큰으로는 연결할 수 없다', async () => {
    const expired = await authCookie('7', new Date(Date.now() - (ACCESS_TOKEN_TTL_SECONDS + 5) * 1000));
    expect(await tryConnect({ Cookie: expired })).toEqual({ error: UNAUTHORIZED });
  });

  it('[보안] 다른 사이트에서 연 연결은 쿠키가 있어도 거부한다', async () => {
    expect(await tryConnect({ Cookie: await authCookie('7'), Origin: 'https://evil.example' })).toEqual({
      error: UNAUTHORIZED,
    });
  });
});
