import type { Server, Socket } from 'socket.io';
import { z } from 'zod';
import type { BoardService } from '../boards/service.js';
import { BoardError } from '../boards/types.js';

export const boardRoom = (boardId: string) => `board:${boardId}`;

const id = z.string().regex(/^\d+$/);
const coord = z.number().finite().min(-1_000_000).max(1_000_000);

const schemas = {
  'board:join': z.object({ boardId: id }),
  'board:leave': z.object({ boardId: id }),
  'card:add': z.discriminatedUnion('type', [
    z.object({ boardId: id, type: z.literal('article'), articleId: id, x: coord, y: coord, clientId: z.string().max(64).optional() }),
    z.object({
      boardId: id,
      type: z.literal('memo'),
      content: z.string().max(2000),
      x: coord,
      y: coord,
      clientId: z.string().max(64).optional(),
    }),
  ]),
  'card:moving': z.object({ boardId: id, itemId: id, x: coord, y: coord }),
  'card:move': z.object({ boardId: id, itemId: id, x: coord, y: coord, rotation: z.number().finite().min(-360).max(360).optional() }),
  'card:update': z.object({ boardId: id, itemId: id, content: z.string().max(2000) }),
  'card:delete': z.object({ boardId: id, itemId: id }),
};

export type AckResult = { ok: true; [key: string]: unknown } | { ok: false; error: string; message?: string };
type Ack = (result: AckResult) => void;

/** REST API에서 일어난 변경을 보드에 접속 중인 사람들에게 알린다 */
export interface BoardNotifier {
  boardRenamed(boardId: string, title: string): void;
  boardDeleted(boardId: string): Promise<void>;
  membersChanged(boardId: string): void;
  /** 내보낸 사람의 연결을 보드 room에서 빼고 알린다 */
  memberRemoved(boardId: string, userId: string): Promise<void>;
}

/**
 * F-05 실시간 협업 보드.
 * - board:join → 멤버인지 확인하고 room에 넣은 뒤, ack로 현재 보드 전체 상태(스냅샷)를 준다 (재연결 시에도 같은 방법으로 복원)
 *   스냅샷 조회가 실패하면 room에서 다시 뺀다
 * - card:add/move/update/delete → DB 저장 후 ack로 결과를 주고, 같은 room의 다른 사람에게 브로드캐스트
 *   실패하면 ack {ok:false}로 알려 클라이언트가 Optimistic Update를 되돌린다
 * - card:moving → 드래그 중 위치. DB에 저장하지 않고 중계만 한다 (클라이언트가 50~100ms 간격으로 보냄)
 * 동시 수정은 last-write-wins (설계 원칙 3).
 */
export function attachBoardSync(io: Server, boards: BoardService): BoardNotifier {
  io.on('connection', (socket: Socket) => {
    const userId = String(socket.data.userId);

    /** 입력 검사 → 처리 → ack. 처리 중 에러는 코드로 바꿔 ack로 돌려준다 */
    function on<E extends keyof typeof schemas>(
      event: E,
      handler: (input: z.infer<(typeof schemas)[E]>) => Promise<AckResult | void>,
    ) {
      socket.on(event as string, async (raw: unknown, ack?: unknown) => {
        const reply: Ack = typeof ack === 'function' ? (ack as Ack) : () => {};
        const parsed = schemas[event].safeParse(raw);
        if (!parsed.success) {
          reply({ ok: false, error: 'invalid', message: '요청 형식이 올바르지 않습니다' });
          return;
        }
        try {
          const result = await handler(parsed.data as z.infer<(typeof schemas)[E]>);
          if (result) reply(result);
        } catch (error) {
          if (error instanceof BoardError) {
            // 이미 삭제된 카드에 대한 요청 등 — 무시하고 기록만 남긴다 (F-05 예외 처리)
            if (error.code === 'not_found') console.warn(`[board] ${event} 대상 없음 (user ${userId})`);
            reply({ ok: false, error: error.code, message: error.message });
          } else {
            console.error(`[board] ${event} 처리 실패:`, error instanceof Error ? error.message : error);
            reply({ ok: false, error: 'server_error', message: '서버 오류' });
          }
        }
      });
    }

    // 순서가 중요하다 (C-11): 멤버 확인 → room 참여 → 스냅샷.
    // 스냅샷을 먼저 뜨면 스냅샷과 room 참여 사이에 생긴 변경을 놓친다. room에 먼저 들어가면 그 사이 변경은
    // 이벤트로 오고(스냅샷에도 들어 있을 수 있음), 클라이언트는 join ack 전 이벤트를 모았다가 updatedAt으로 맞춘다.
    on('board:join', async ({ boardId }) => {
      if (!(await boards.getRole(boardId, userId))) throw new BoardError('not_found', '보드를 찾을 수 없습니다');
      await socket.join(boardRoom(boardId));
      try {
        return { ok: true, snapshot: await boards.getSnapshot(boardId, userId) };
      } catch (error) {
        await socket.leave(boardRoom(boardId));
        throw error;
      }
    });

    on('board:leave', async ({ boardId }) => {
      await socket.leave(boardRoom(boardId));
      return { ok: true };
    });

    on('card:add', async ({ boardId, clientId, ...input }) => {
      const item = await boards.addItem(boardId, userId, input);
      socket.to(boardRoom(boardId)).emit('card:added', { boardId, item, by: userId });
      return { ok: true, item, clientId };
    });

    // 드래그 중 위치 중계: room에 들어와 있는 사람만, 저장 없이, 늦게 도착하면 버려도 되는 메시지로
    on('card:moving', async ({ boardId, itemId, x, y }) => {
      if (!socket.rooms.has(boardRoom(boardId))) return;
      socket.volatile.to(boardRoom(boardId)).emit('card:moving', { boardId, itemId, x, y, by: userId });
    });

    on('card:move', async ({ boardId, itemId, ...to }) => {
      const item = await boards.moveItem(boardId, userId, itemId, to);
      socket.to(boardRoom(boardId)).emit('card:moved', { boardId, item, by: userId });
      return { ok: true, item };
    });

    on('card:update', async ({ boardId, itemId, content }) => {
      const item = await boards.updateMemo(boardId, userId, itemId, content);
      socket.to(boardRoom(boardId)).emit('card:updated', { boardId, item, by: userId });
      return { ok: true, item };
    });

    on('card:delete', async ({ boardId, itemId }) => {
      const { version } = await boards.deleteItem(boardId, userId, itemId);
      socket.to(boardRoom(boardId)).emit('card:deleted', { boardId, itemId, version, by: userId });
      return { ok: true, version };
    });
  });

  return {
    boardRenamed(boardId, title) {
      io.to(boardRoom(boardId)).emit('board:renamed', { boardId, title });
    },
    async boardDeleted(boardId) {
      io.to(boardRoom(boardId)).emit('board:deleted', { boardId });
      io.in(boardRoom(boardId)).socketsLeave(boardRoom(boardId));
    },
    membersChanged(boardId) {
      io.to(boardRoom(boardId)).emit('board:members-changed', { boardId });
    },
    async memberRemoved(boardId, removedUserId) {
      const sockets = await io.in(boardRoom(boardId)).fetchSockets();
      for (const s of sockets) {
        if (String(s.data.userId) !== removedUserId) continue;
        s.leave(boardRoom(boardId));
        s.emit('board:removed', { boardId });
      }
      io.to(boardRoom(boardId)).emit('board:members-changed', { boardId });
    },
  };
}
