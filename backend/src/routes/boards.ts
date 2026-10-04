import { Router, type Response } from 'express';
import { z } from 'zod';
import type { BoardService } from '../boards/service.js';
import { BoardError, type BoardErrorCode } from '../boards/types.js';
import { LinkError, type LinkErrorCode } from '../links/safeFetch.js';
import { QuotaError, UnreadableError, type LinkService } from '../links/service.js';
import { SummaryError } from '../ai/summarizer.js';
import type { BoardNotifier } from '../realtime/boardSync.js';

const titleSchema = z.object({ title: z.string().trim().min(1, '보드 이름을 입력해 주세요').max(50) });
const isId = (value: string) => /^\d+$/.test(value);

const STATUS: Record<BoardErrorCode, number> = { not_found: 404, forbidden: 403, invalid: 400, invite_invalid: 404 };

export interface BoardRouteDeps {
  boards: BoardService;
  notifier: BoardNotifier;
  /** 링크 요약(F-03). 없으면 해당 API는 503 */
  links?: LinkService;
}

const coord = z.number().finite().min(-1_000_000).max(1_000_000);
const linkSchema = z.object({ url: z.string().trim().min(1).max(2000), x: coord.default(0), y: coord.default(0) });

const LINK_STATUS: Record<LinkErrorCode, number> = {
  invalid_url: 400,
  blocked: 400,
  not_html: 422,
  too_large: 422,
  too_many_redirects: 422,
  fetch_failed: 502,
  timeout: 504,
};

/** BoardError는 정해진 상태 코드로, 그 밖의 에러는 공통 에러 처리(500)로 넘긴다 */
function sendError(res: Response, error: unknown): void {
  if (!(error instanceof BoardError)) throw error;
  res.status(STATUS[error.code]).json({ error: error.message, code: error.code });
}

function badTitle(res: Response, error: z.ZodError): void {
  res.status(400).json({ error: error.issues[0]?.message ?? '입력값을 확인해 주세요', fields: ['title'] });
}

/** /api/boards — 보드 목록·생성·조회·수정·삭제(F-05·F-06), 초대 링크·멤버 관리(F-07). 모두 로그인 필요 */
export function createBoardsRouter({ boards, notifier, links }: BoardRouteDeps): Router {
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

  /** 오늘 남은 링크 요약 횟수 (F-03) */
  router.get('/:boardId/links/quota', async (_req, res) => {
    if (!links) return void res.status(503).json({ error: '링크 요약을 사용할 수 없습니다' });
    res.json({ remaining: await links.remaining(res.locals.userId!) });
  });

  /**
   * 링크로 기사 카드 추가 (F-03): 페이지를 가져와 AI로 요약하고 보드에 카드로 올린다.
   * 실패 이유는 정해진 문구로만 알린다 (내부 주소·원본 에러는 응답에 넣지 않음)
   */
  router.post('/:boardId/links', async (req, res) => {
    if (!links) return void res.status(503).json({ error: '링크 요약을 사용할 수 없습니다' });
    const parsed = linkSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: '기사 주소를 입력해 주세요', fields: parsed.error.issues.map((i) => i.path.join('.')) });
      return;
    }
    try {
      const result = await links.addLink({
        boardId: req.params.boardId,
        userId: res.locals.userId!,
        ip: req.ip ?? 'unknown',
        ...parsed.data,
      });
      notifier.cardAdded(req.params.boardId, result.item, res.locals.userId!);
      res.status(201).json(result);
    } catch (error) {
      if (error instanceof LinkError) return void res.status(LINK_STATUS[error.code]).json({ error: error.message, code: error.code });
      if (error instanceof QuotaError) return void res.status(429).json({ error: error.message, code: 'quota', scope: error.scope });
      if (error instanceof UnreadableError) return void res.status(422).json({ error: error.message, code: 'unreadable' });
      if (error instanceof SummaryError) {
        console.error('[links] 요약 실패:', error.message);
        return void res.status(502).json({ error: 'AI 요약에 실패했습니다. 잠시 후 다시 시도해 주세요', code: 'summary_failed' });
      }
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
