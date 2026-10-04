import type pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestPool, testDatabaseUrl } from '../test/db.js';
import { createArticle, createUser, resetDb } from '../test/fixtures.js';
import { BoardService, INVITE_TTL_MS } from './service.js';
import { BoardError } from './types.js';

async function expectBoardError(promise: Promise<unknown>, code: BoardError['code']) {
  const error = await promise.catch((e: unknown) => e);
  expect(error).toBeInstanceOf(BoardError);
  expect((error as BoardError).code).toBe(code);
}

describe.skipIf(!testDatabaseUrl)('BoardService (DB)', () => {
  let pool: pg.Pool;
  let boards: BoardService;
  let owner: string;
  let editor: string;
  let outsider: string;

  beforeAll(() => {
    pool = createTestPool();
    boards = new BoardService(pool);
  });
  beforeEach(async () => {
    await resetDb(pool);
    owner = await createUser(pool, '주인');
    editor = await createUser(pool, '편집자');
    outsider = await createUser(pool, '외부인');
  });
  afterAll(async () => {
    await pool.end();
  });

  async function boardWithEditor() {
    const board = await boards.createBoard(owner, '반도체 이슈');
    const { token } = await boards.getInvite(board.id, owner);
    await boards.acceptInvite(token, editor);
    return board.id;
  }

  describe('보드 (F-06)', () => {
    it('[수용 기준] 새 보드를 만들면 만든 사람이 owner가 되고 목록에 바로 보인다', async () => {
      const created = await boards.createBoard(owner, '반도체 이슈');
      expect(created).toMatchObject({ title: '반도체 이슈', role: 'owner', memberCount: 1, itemCount: 0 });
      expect(await boards.listBoards(owner)).toEqual([created]);
    });

    it('[수용 기준] 만든 보드와 초대받은 보드가 모두 목록에 보이고, 최근 수정 순으로 정렬된다', async () => {
      const mine = await boards.createBoard(editor, '내 보드');
      const invited = await boardWithEditor();
      await boards.addItem(mine.id, editor, { type: 'memo', content: '방금 수정', x: 0, y: 0 });

      const list = await boards.listBoards(editor);
      expect(list.map((b) => [b.id, b.role])).toEqual([
        [mine.id, 'owner'],
        [invited, 'editor'],
      ]);
      expect(list[0]?.itemCount).toBe(1);
    });

    it('멤버가 아니면 보드가 있어도 없는 것처럼 답한다 (not_found)', async () => {
      const boardId = await boardWithEditor();
      await expectBoardError(boards.getSnapshot(boardId, outsider), 'not_found');
    });

    it('이름 변경·삭제는 owner만 할 수 있다', async () => {
      const boardId = await boardWithEditor();
      await expectBoardError(boards.renameBoard(boardId, editor, '바꿈'), 'forbidden');
      await expectBoardError(boards.deleteBoard(boardId, editor), 'forbidden');

      await boards.renameBoard(boardId, owner, '바꾼 이름');
      expect((await boards.getSnapshot(boardId, owner)).board.title).toBe('바꾼 이름');
      await boards.deleteBoard(boardId, owner);
      expect(await boards.listBoards(editor)).toEqual([]);
    });
  });

  describe('초대 링크 (F-07)', () => {
    it('[수용 기준] 초대 링크로 새 참여자가 editor로 추가된다', async () => {
      const board = await boards.createBoard(owner, '보드');
      const { token, expiresAt } = await boards.getInvite(board.id, owner);
      expect(new Date(expiresAt).getTime() - Date.now()).toBeGreaterThan(INVITE_TTL_MS - 60_000);

      expect(await boards.previewInvite(token)).toEqual({ boardId: board.id, title: '보드', memberCount: 1 });
      expect(await boards.acceptInvite(token, editor)).toEqual({ boardId: board.id, joined: true });
      const { members } = await boards.getSnapshot(board.id, editor);
      expect(members.map((m) => [m.nickname, m.role])).toEqual([
        ['주인', 'owner'],
        ['편집자', 'editor'],
      ]);
    });

    it('같은 링크는 만료 전까지 여러 명이 쓸 수 있고, 이미 멤버면 중복 추가하지 않는다', async () => {
      const board = await boards.createBoard(owner, '보드');
      const { token } = await boards.getInvite(board.id, owner);
      await boards.acceptInvite(token, editor);
      expect(await boards.acceptInvite(token, editor)).toEqual({ boardId: board.id, joined: false });
      expect(await boards.acceptInvite(token, outsider)).toEqual({ boardId: board.id, joined: true });
      expect((await boards.getSnapshot(board.id, owner)).members).toHaveLength(3);
    });

    it('owner가 다시 조회하면 같은 링크를, 재발급하면 새 링크를 주고 기존 링크는 쓸 수 없다', async () => {
      const board = await boards.createBoard(owner, '보드');
      const first = await boards.getInvite(board.id, owner);
      expect((await boards.getInvite(board.id, owner)).token).toBe(first.token);

      const second = await boards.reissueInvite(board.id, owner);
      expect(second.token).not.toBe(first.token);
      await expectBoardError(boards.acceptInvite(first.token, editor), 'invite_invalid');
      await boards.acceptInvite(second.token, editor);
    });

    it('[예외] 만료된 초대 링크는 쓸 수 없다', async () => {
      const board = await boards.createBoard(owner, '보드');
      const issuedAt = new Date(Date.now() - INVITE_TTL_MS - 1000);
      const { token } = await boards.reissueInvite(board.id, owner, issuedAt);
      await expectBoardError(boards.previewInvite(token), 'invite_invalid');
      await expectBoardError(boards.acceptInvite(token, editor), 'invite_invalid');
    });

    it('초대 링크 조회·재발급은 owner만 할 수 있다', async () => {
      const boardId = await boardWithEditor();
      await expectBoardError(boards.getInvite(boardId, editor), 'forbidden');
      await expectBoardError(boards.reissueInvite(boardId, outsider), 'not_found');
    });

    it('owner는 editor를 내보낼 수 있고, editor는 스스로 나갈 수 있지만 owner는 나갈 수 없다', async () => {
      const boardId = await boardWithEditor();
      await expectBoardError(boards.removeMember(boardId, editor, owner), 'forbidden');
      await expectBoardError(boards.removeMember(boardId, owner, owner), 'invalid');

      await boards.removeMember(boardId, owner, editor);
      await expectBoardError(boards.getSnapshot(boardId, editor), 'not_found');

      const { token } = await boards.getInvite(boardId, owner);
      await boards.acceptInvite(token, editor);
      await boards.removeMember(boardId, editor, editor);
      expect((await boards.getSnapshot(boardId, owner)).members).toHaveLength(1);
    });
  });

  describe('카드 (F-05)', () => {
    it('[수용 기준] 기사·메모 카드를 추가·이동·삭제할 수 있다', async () => {
      const boardId = await boardWithEditor();
      const articleId = await createArticle(pool, '반도체 수출 급증');

      const articleCard = await boards.addItem(boardId, owner, { type: 'article', articleId, x: 10, y: 20 });
      expect(articleCard).toMatchObject({ type: 'article', articleId, x: 10, y: 20, createdBy: owner });
      expect(articleCard.article).toMatchObject({ title: '반도체 수출 급증', source: '한겨레' });

      const memo = await boards.addItem(boardId, editor, { type: 'memo', content: '확인 필요', x: 0, y: 0 });
      expect(memo).toMatchObject({ type: 'memo', content: '확인 필요', article: null });

      const moved = await boards.moveItem(boardId, editor, articleCard.id, { x: 300, y: 400, rotation: -4 });
      expect(moved).toMatchObject({ x: 300, y: 400, rotation: -4 });

      await boards.deleteItem(boardId, owner, memo.id);
      const { items } = await boards.getSnapshot(boardId, owner);
      expect(items.map((i) => i.id)).toEqual([articleCard.id]);
    });

    it('새로 추가하거나 옮긴 카드가 맨 위(z_index 최대)로 온다', async () => {
      const boardId = await boardWithEditor();
      const a = await boards.addItem(boardId, owner, { type: 'memo', content: 'A', x: 0, y: 0 });
      const b = await boards.addItem(boardId, owner, { type: 'memo', content: 'B', x: 0, y: 0 });
      expect(b.zIndex).toBeGreaterThan(a.zIndex);

      const movedA = await boards.moveItem(boardId, owner, a.id, { x: 1, y: 1 });
      expect(movedA.zIndex).toBeGreaterThan(b.zIndex);
      expect((await boards.getSnapshot(boardId, owner)).items.map((i) => i.content)).toEqual(['B', 'A']);
    });

    it('메모 내용을 고칠 수 있다', async () => {
      const boardId = await boardWithEditor();
      const memo = await boards.addItem(boardId, owner, { type: 'memo', content: '초안', x: 0, y: 0 });
      expect((await boards.updateMemo(boardId, editor, memo.id, '수정본')).content).toBe('수정본');
    });

    it('카드를 바꿀 때마다 변경 기록이 남고 보드의 마지막 수정 시각이 바뀐다', async () => {
      const boardId = await boardWithEditor();
      const before = (await boards.getSnapshot(boardId, owner)).board.updatedAt;
      await new Promise((r) => setTimeout(r, 5));
      const memo = await boards.addItem(boardId, editor, { type: 'memo', content: 'x', x: 0, y: 0 });
      await boards.moveItem(boardId, editor, memo.id, { x: 5, y: 5 });
      await boards.deleteItem(boardId, owner, memo.id);

      const { rows } = await pool.query<{ action_type: string; user_id: string }>(
        `SELECT action_type, user_id FROM board_events WHERE board_id = $1 AND action_type LIKE 'card:%' ORDER BY id`,
        [boardId],
      );
      expect(rows).toEqual([
        { action_type: 'card:add', user_id: editor },
        { action_type: 'card:move', user_id: editor },
        { action_type: 'card:delete', user_id: owner },
      ]);
      expect((await boards.getSnapshot(boardId, owner)).board.updatedAt > before).toBe(true);
    });

    it('[예외] 이미 삭제된 카드를 옮기거나 지우면 not_found로 무시한다', async () => {
      const boardId = await boardWithEditor();
      const memo = await boards.addItem(boardId, owner, { type: 'memo', content: 'x', x: 0, y: 0 });
      await boards.deleteItem(boardId, owner, memo.id);
      await expectBoardError(boards.moveItem(boardId, editor, memo.id, { x: 1, y: 1 }), 'not_found');
      await expectBoardError(boards.deleteItem(boardId, editor, memo.id), 'not_found');
    });

    it('[보안] 멤버가 아니면 카드를 건드릴 수 없고, 다른 보드의 카드 id로도 바꿀 수 없다', async () => {
      const boardId = await boardWithEditor();
      const other = await boards.createBoard(outsider, '남의 보드');
      const theirs = await boards.addItem(other.id, outsider, { type: 'memo', content: '비밀', x: 0, y: 0 });

      await expectBoardError(boards.addItem(boardId, outsider, { type: 'memo', content: 'x', x: 0, y: 0 }), 'not_found');
      // 내 보드 id + 남의 카드 id 조합으로 요청해도 남의 카드는 바뀌지 않는다
      await expectBoardError(boards.deleteItem(boardId, owner, theirs.id), 'not_found');
      expect((await boards.getSnapshot(other.id, outsider)).items).toHaveLength(1);
    });

    it('없는 기사로는 기사 카드를 만들 수 없다', async () => {
      const boardId = await boardWithEditor();
      await expectBoardError(boards.addItem(boardId, owner, { type: 'article', articleId: '999999', x: 0, y: 0 }), 'invalid');
    });
  });
});
