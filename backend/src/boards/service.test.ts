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

  describe('[L-06] 내보내기와 동시에 들어온 카드 변경', () => {
    /**
     * 주인이 편집자를 내보내는 트랜잭션이 보드 잠금을 잡고 멤버를 지운 뒤 아직 커밋하지 않은 순간에,
     * 그 편집자의 카드 변경이 들어오는 상황을 그대로 만든다.
     */
    async function whileRemoving(boardId: string, change: () => Promise<unknown>) {
      const removal = await pool.connect();
      try {
        await removal.query('BEGIN');
        await removal.query('UPDATE boards SET seq = seq + 1 WHERE id = $1', [boardId]);
        await removal.query('DELETE FROM board_members WHERE board_id = $1 AND user_id = $2', [boardId, editor]);
        const pending = change().then(
          () => 'saved',
          (e: unknown) => (e instanceof BoardError ? e.code : 'error'),
        );
        await new Promise((r) => setTimeout(r, 100)); // 편집자 요청이 보드 잠금을 기다리는 중
        await removal.query('COMMIT');
        return await pending;
      } finally {
        removal.release();
      }
    }

    it('내보내진 뒤에 저장되려던 추가·이동·메모 수정·삭제는 모두 거절되고 아무것도 바뀌지 않는다', async () => {
      const results: Record<string, string> = {};
      for (const action of ['add', 'move', 'update', 'delete'] as const) {
        await resetDb(pool);
        owner = await createUser(pool, '주인');
        editor = await createUser(pool, '편집자');
        const boardId = await boardWithEditor();
        const memo = await boards.addItem(boardId, owner, { type: 'memo', content: '원래', x: 0, y: 0 });
        results[action] = await whileRemoving(boardId, () =>
          action === 'add'
            ? boards.addItem(boardId, editor, { type: 'memo', content: '몰래', x: 1, y: 1 })
            : action === 'move'
              ? boards.moveItem(boardId, editor, memo.id, { x: 99, y: 99 })
              : action === 'update'
                ? boards.updateMemo(boardId, editor, memo.id, '몰래 수정')
                : boards.deleteItem(boardId, editor, memo.id),
        );
        const { items } = await boards.getSnapshot(boardId, owner);
        expect(items).toEqual([expect.objectContaining({ id: memo.id, content: '원래', x: 0, y: 0 })]);
      }
      expect(results).toEqual({ add: 'not_found', move: 'not_found', update: 'not_found', delete: 'not_found' });
    });
  });

  describe('변경 순번 (L-02·L-05)', () => {
    async function memo(boardId: string, content: string) {
      return boards.addItem(boardId, owner, { type: 'memo', content, x: 0, y: 0 });
    }

    it('카드가 바뀔 때마다 보드 순번이 하나씩 올라가고, 스냅샷은 같은 시점의 순번을 준다', async () => {
      const boardId = await boardWithEditor();
      const start = (await boards.getSnapshot(boardId, owner)).board.seq;
      const a = await memo(boardId, 'a');
      const moved = await boards.moveItem(boardId, editor, a.id, { x: 5, y: 5 });
      const edited = await boards.updateMemo(boardId, owner, a.id, 'a2');
      const removed = await boards.deleteItem(boardId, owner, a.id);

      expect([a.version, moved.version, edited.version, removed.version]).toEqual([start + 1, start + 2, start + 3, start + 4]);
      expect((await boards.getSnapshot(boardId, owner)).board.seq).toBe(start + 4);
    });

    it('[L-05] 여러 카드를 동시에 옮겨도 z_index가 겹치지 않고, 적층 순서가 변경 순번과 같다', async () => {
      const boardId = await boardWithEditor();
      const cards = [];
      for (let i = 0; i < 8; i++) cards.push(await memo(boardId, `m${i}`));

      // 서로 다른 카드 이동 + 새 카드 추가를 동시에
      const results = await Promise.all([
        ...cards.map((card, i) => boards.moveItem(boardId, i % 2 ? owner : editor, card.id, { x: i, y: i })),
        memo(boardId, 'new-1'),
        memo(boardId, 'new-2'),
      ]);

      const { items } = await boards.getSnapshot(boardId, owner);
      expect(new Set(items.map((i) => i.zIndex)).size).toBe(items.length);
      expect(new Set(results.map((r) => r.version)).size).toBe(results.length);
      // 스냅샷은 z_index 순 — 나중에 커밋된(순번이 큰) 변경일수록 위에 있다
      const versions = items.map((i) => i.version);
      expect(versions).toEqual([...versions].sort((x, y) => x - y));
    });

    it('[L-02] 같은 카드를 동시에 여러 번 옮기면 DB에 남는 값은 순번이 가장 큰 변경이다', async () => {
      const boardId = await boardWithEditor();
      const card = await memo(boardId, 'x');
      const results = await Promise.all(
        Array.from({ length: 10 }, (_, i) => boards.moveItem(boardId, i % 2 ? owner : editor, card.id, { x: i * 10, y: 0 })),
      );

      const last = results.reduce((a, b) => (a.version > b.version ? a : b));
      const [stored] = (await boards.getSnapshot(boardId, owner)).items;
      expect(stored).toMatchObject({ x: last.x, version: last.version });
    });

    it('[L-02] 삭제 순번은 그 카드의 어떤 변경보다 크다 (삭제 후 늦게 도착한 이동으로 되살리지 않는 기준)', async () => {
      const boardId = await boardWithEditor();
      const card = await memo(boardId, 'x');
      const moves = await Promise.all([1, 2, 3].map((x) => boards.moveItem(boardId, editor, card.id, { x, y: 0 })));
      const { version } = await boards.deleteItem(boardId, owner, card.id);
      expect(version).toBeGreaterThan(Math.max(...moves.map((m) => m.version)));
      await expectBoardError(boards.moveItem(boardId, editor, card.id, { x: 9, y: 9 }), 'not_found');
    });
  });
});
