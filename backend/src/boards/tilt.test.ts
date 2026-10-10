import type pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestPool, testDatabaseUrl } from '../test/db.js';
import { createUser, resetDb } from '../test/fixtures.js';
import { BoardService, MAX_AUTO_TILT } from './service.js';

describe.skipIf(!testDatabaseUrl)('카드 기울기 (탐정 보드, DB)', () => {
  let pool: pg.Pool;
  let owner: string;

  beforeAll(() => {
    pool = createTestPool();
  });
  beforeEach(async () => {
    await resetDb(pool);
    owner = await createUser(pool, '주인');
  });
  afterAll(async () => {
    await pool.end();
  });

  it('새 카드는 -4°~+4° 사이(0.5° 단위)로 기울어져 붙는다', async () => {
    const boards = new BoardService(pool);
    const boardId = (await boards.createBoard(owner, '보드')).id;
    for (let i = 0; i < 20; i += 1) {
      const { rotation } = await boards.addItem(boardId, owner, { type: 'memo', content: `메모 ${i}`, x: 0, y: 0 });
      expect(Math.abs(rotation)).toBeLessThanOrEqual(MAX_AUTO_TILT);
      expect(rotation * 2).toBe(Math.round(rotation * 2));
    }
  });

  it('직접 돌린 각도는 그대로 저장되고 옮겨도 유지된다', async () => {
    const boards = new BoardService(pool, { tilt: () => 2.5 });
    const boardId = (await boards.createBoard(owner, '보드')).id;
    const card = await boards.addItem(boardId, owner, { type: 'memo', content: '메모', x: 0, y: 0 });
    expect(card.rotation).toBe(2.5);
    expect((await boards.moveItem(boardId, owner, card.id, { x: 0, y: 0, rotation: -17 })).rotation).toBe(-17);
    expect((await boards.moveItem(boardId, owner, card.id, { x: 50, y: 50 })).rotation).toBe(-17);
  });
});
