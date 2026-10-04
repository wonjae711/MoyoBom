import { Router, type Response } from 'express';
import { z } from 'zod';
import type { BoardService } from '../boards/service.js';
import { BoardError, type BoardErrorCode } from '../boards/types.js';
import type { BoardNotifier } from '../realtime/boardSync.js';

const titleSchema = z.object({ title: z.string().trim().min(1, '보드 이름을 입력해 주세요').max(50) });
const isId = (value: string) => /^\d+$/.test(value);

const STATUS: Record<BoardErrorCode, number> = { not_found: 404, forbidden: 403, invalid: 400, invite_invalid: 404 };

export interface BoardRouteDeps {
  boards: BoardService;
  notifier: BoardNotifier;
}

/** BoardError는 정해진 상태 코드로, 그 밖의 에러는 공통 에러 처리(500)로 넘긴다 */
function sendError(res: Response, error: unknown): void {
  if (!(error instanceof BoardError)) throw error;
  res.status(STATUS[error.code]).json({ error: error.message, code: error.code });
}

function badTitle(res: Response, error: z.ZodError): void {
  res.status(400).json({ error: error.issues[0]?.message ?? '입력값을 확인해 주세요', fields: ['title'] });
}

/** /api/boards — 보드 목록·생성·조회·수정·삭제(F-05·F-06), 초대 링크·멤버 관리(F-07). 모두 로그인 필요 */
export function createBoardsRouter({ boards, notifier }: BoardRouteDeps): Router {
  const router = Router();

  router.param('boardId', (_req, res, next, value: string) => {
    if (isId(value)) next();
    else res.status(404).json({ error: '보드를 찾을 수 없습니다', code: 'not_found' });
  });

  router.get('/', async (_req, res) => {
    res.json({ boards: await boards.listBoards(res.locals.userId!) });
  });

  router.post('/', async (req, res) => {
    const parsed = titleSchema.safeParse(req.body);
    if (!parsed.success) return badTitle(res, parsed.error);
    res.status(201).json({ board: await boards.createBoard(res.locals.userId!, parsed.data.title) });
  });

  router.get('/:boardId', async (req, res) => {
    try {
      res.json(await boards.getSnapshot(req.params.boardId, res.locals.userId!));
    } catch (error) {
      sendError(res, error);
    }
  });

  router.patch('/:boardId', async (req, res) => {
    const parsed = titleSchema.safeParse(req.body);
    if (!parsed.success) return badTitle(res, parsed.error);
    try {
      await boards.renameBoard(req.params.boardId, res.locals.userId!, parsed.data.title);
      notifier.boardRenamed(req.params.boardId, parsed.data.title);
      res.status(204).end();
    } catch (error) {
      sendError(res, error);
    }
  });

  router.delete('/:boardId', async (req, res) => {
    try {
      await boards.deleteBoard(req.params.boardId, res.locals.userId!);
      await notifier.boardDeleted(req.params.boardId);
      res.status(204).end();
    } catch (error) {
      sendError(res, error);
    }
  });

  /** owner만: 현재 초대 링크 (없으면 새로 만듦) */
  router.get('/:boardId/invite', async (req, res) => {
    try {
      res.json(await boards.getInvite(req.params.boardId, res.locals.userId!));
    } catch (error) {
      sendError(res, error);
    }
  });

  /** owner만: 초대 링크 재발급 (기존 링크 무효화) */
  router.post('/:boardId/invite', async (req, res) => {
    try {
      res.status(201).json(await boards.reissueInvite(req.params.boardId, res.locals.userId!));
    } catch (error) {
      sendError(res, error);
    }
  });

  /** owner가 멤버를 내보내거나, editor가 스스로 나간다 */
  router.delete('/:boardId/members/:userId', async (req, res) => {
    if (!isId(req.params.userId)) {
      res.status(404).json({ error: '보드 멤버가 아닙니다', code: 'not_found' });
      return;
    }
    try {
      await boards.removeMember(req.params.boardId, res.locals.userId!, req.params.userId);
      await notifier.memberRemoved(req.params.boardId, req.params.userId);
      res.status(204).end();
    } catch (error) {
      sendError(res, error);
    }
  });

  return router;
}

/** /api/invites/:token — 초대 링크 열기·수락 (로그인 필요, 비로그인은 화면에서 로그인 후 복귀) */
export function createInvitesRouter({ boards, notifier }: BoardRouteDeps): Router {
  const router = Router();
  const tokenOk = (token: string) => /^[A-Za-z0-9_-]{16,64}$/.test(token);

  router.get('/:token', async (req, res) => {
    if (!tokenOk(req.params.token)) return sendError(res, new BoardError('invite_invalid', '올바르지 않은 초대 링크입니다'));
    try {
      res.json(await boards.previewInvite(req.params.token));
    } catch (error) {
      sendError(res, error);
    }
  });

  router.post('/:token/accept', async (req, res) => {
    if (!tokenOk(req.params.token)) return sendError(res, new BoardError('invite_invalid', '올바르지 않은 초대 링크입니다'));
    try {
      const result = await boards.acceptInvite(req.params.token, res.locals.userId!);
      if (result.joined) notifier.membersChanged(result.boardId);
      res.json(result);
    } catch (error) {
      sendError(res, error);
    }
  });

  return router;
}
