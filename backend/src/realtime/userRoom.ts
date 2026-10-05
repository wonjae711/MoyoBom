import type { Server } from 'socket.io';
import type { Digest, DigestNotifier } from '../digests/service.js';

export const userRoom = (userId: string) => `user:${userId}`;
export const DIGEST_NEW_EVENT = 'digest:new';

/**
 * 사용자 본인 방 (F-09): 인증된 소켓을 user:{id} room에 넣어, 그 사용자에게만 가는 알림(다이제스트 도착)을 보낸다.
 * 같은 사용자가 여러 탭으로 접속하면 모든 탭이 받는다.
 */
export function attachUserRooms(io: Server): DigestNotifier {
  io.on('connection', (socket) => {
    void socket.join(userRoom(String(socket.data.userId)));
  });
  return {
    digestCreated(userId: string, digest: Digest) {
      io.to(userRoom(userId)).emit(DIGEST_NEW_EVENT, { digest });
    },
  };
}
