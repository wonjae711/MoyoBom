import type { Server } from 'socket.io';
import { ACCESS_COOKIE, readCookie } from '../auth/http.js';
import { verifyAccessToken } from '../auth/tokens.js';

export const UNAUTHORIZED = 'unauthorized';

/**
 * 소켓 연결 인증 (설계 원칙 5: WebSocket 연결도 JWT 인증 필수).
 * 같은 출처의 연결은 브라우저가 access_token 쿠키를 함께 보내므로 그것을 검증한다.
 * 다른 사이트에서 연결을 여는 공격(Cross-Site WebSocket Hijacking)을 막기 위해 Origin도 확인한다.
 * 실패하면 클라이언트는 connect_error(message: 'unauthorized')를 받는다.
 */
export function attachSocketAuth(io: Server, options: { jwtSecret: string; appOrigin: string }): void {
  io.use(async (socket, next) => {
    const { origin, cookie } = socket.handshake.headers;
    if (origin && origin !== options.appOrigin) {
      next(new Error(UNAUTHORIZED));
      return;
    }
    const token = readCookie(cookie, ACCESS_COOKIE);
    const userId = token ? await verifyAccessToken(token, options.jwtSecret) : null;
    if (!userId) {
      next(new Error(UNAUTHORIZED));
      return;
    }
    socket.data.userId = userId;
    next();
  });
}
