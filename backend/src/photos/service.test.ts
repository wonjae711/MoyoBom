import type pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { BoardService } from '../boards/service.js';
import { BoardError } from '../boards/types.js';
import { createTestPool, testDatabaseUrl } from '../test/db.js';
import { createUser, resetDb } from '../test/fixtures.js';
import { MemoryPhotoStorage } from '../test/photos.js';
import { MAX_PHOTO_BYTES, PhotoError, PhotoService } from './service.js';

const UUID = '0b6f1c5e-1f7a-4c1e-9a55-2f1d6c3b7a10';

async function errorOf(promise: Promise<unknown>) {
  return promise.catch((e: unknown) => e);
}

describe.skipIf(!testDatabaseUrl)('사진 카드 PhotoService (F-05, DB)', () => {
  let pool: pg.Pool;
  let boards: BoardService;
  let storage: MemoryPhotoStorage;
  let photos: PhotoService;
  let owner: string;
  let outsider: string;
  let boardId: string;

  beforeAll(() => {
    pool = createTestPool();
    boards = new BoardService(pool);
  });
  beforeEach(async () => {
    await resetDb(pool);
    storage = new MemoryPhotoStorage();
    photos = new PhotoService({ pool, boards, storage, newId: () => UUID });
    owner = await createUser(pool, '주인');
    outsider = await createUser(pool, '외부인');
    boardId = (await boards.createBoard(owner, '사진 보드')).id;
  });
  afterAll(async () => {
    await pool.end();
  });

  describe('업로드 허가증', () => {
    it('멤버는 이 보드 아래 key와 10MB·형식 조건이 걸린 허가증을 받는다', async () => {
      const ticket = await photos.createUpload(boardId, owner, { contentType: 'image/webp', size: 2_000_000 });
      expect(ticket.key).toBe(`boards/${boardId}/${UUID}.webp`);
      expect(ticket.url).toBeTruthy();
      expect(storage.uploads).toEqual([{ key: ticket.key, contentType: 'image/webp', maxBytes: MAX_PHOTO_BYTES }]);
    });

    it('[예외] 멤버가 아니면 not_found, jpg·png·webp가 아니면 invalid_type, 10MB 넘으면 too_large', async () => {
      expect(await errorOf(photos.createUpload(boardId, outsider, { contentType: 'image/png', size: 10 }))).toMatchObject({
        code: 'not_found',
      });
      expect(await errorOf(photos.createUpload(boardId, owner, { contentType: 'image/gif', size: 10 }))).toMatchObject({
        code: 'invalid_type',
      });
      const big = await errorOf(photos.createUpload(boardId, owner, { contentType: 'image/jpeg', size: MAX_PHOTO_BYTES + 1 }));
      expect(big).toBeInstanceOf(PhotoError);
      expect(big).toMatchObject({ code: 'too_large' });
      expect(storage.uploads).toEqual([]);
    });
  });

  describe('카드 만들기 전 확인', () => {
    it('이 보드에 실제로 올라간 사진만 통과한다', async () => {
      const key = `boards/${boardId}/${UUID}.png`;
      expect(await errorOf(photos.verifyUpload(boardId, key))).toMatchObject({ code: 'not_uploaded' });
      storage.put(key);
      await expect(photos.verifyUpload(boardId, key)).resolves.toBeUndefined();
    });

    it('[예외] 다른 보드의 key·엉뚱한 모양은 invalid', async () => {
      const other = `boards/999/${UUID}.png`;
      storage.put(other);
      for (const key of [other, '../secret', `boards/${boardId}/x.png`, `boards/${boardId}/${UUID}.gif`]) {
        const error = await errorOf(photos.verifyUpload(boardId, key));
        expect(error).toBeInstanceOf(BoardError);
        expect(error).toMatchObject({ code: 'invalid' });
      }
    });

    it('[예외] 조건에 안 맞는 파일이 올라가 있으면 거절하고 지운다', async () => {
      const key = `boards/${boardId}/${UUID}.png`;
      storage.put(key, { contentType: 'text/html' });
      expect(await errorOf(photos.verifyUpload(boardId, key))).toMatchObject({ code: 'invalid_type' });
      expect(storage.objects.has(key)).toBe(false);
    });
  });

  describe('보기', () => {
    it('멤버는 사진 카드의 잠깐 쓰는 주소를 받는다. 멤버가 아니거나 사진 카드가 아니면 not_found', async () => {
      const key = `boards/${boardId}/${UUID}.png`;
      const photo = await boards.addItem(boardId, owner, { type: 'photo', imageKey: key, content: null, x: 0, y: 0 });
      const memo = await boards.addItem(boardId, owner, { type: 'memo', content: '메모', x: 0, y: 0 });
      expect(await photos.viewUrl(boardId, owner, photo.id)).toBe(`https://s3.test/photos/${key}?expires=300`);
      expect(await errorOf(photos.viewUrl(boardId, outsider, photo.id))).toMatchObject({ code: 'not_found' });
      expect(await errorOf(photos.viewUrl(boardId, owner, memo.id))).toMatchObject({ code: 'not_found' });
    });
  });

  describe('정리', () => {
    it('보드를 지우면 그 보드의 사진만 지운다', async () => {
      storage.put(`boards/${boardId}/a.png`);
      storage.put(`boards/${boardId}0/b.png`); // 접두어가 비슷한 다른 보드
      await photos.removeBoard(boardId);
      expect([...storage.objects.keys()]).toEqual([`boards/${boardId}0/b.png`]);
    });

    it('하루 넘게 카드가 없는 사진만 정리한다 (카드에 쓰인 사진·막 올린 사진은 둔다)', async () => {
      const now = new Date('2026-10-10T00:00:00Z');
      const old = new Date(now.getTime() - 25 * 60 * 60 * 1000);
      const used = `boards/${boardId}/${UUID}.png`;
      await boards.addItem(boardId, owner, { type: 'photo', imageKey: used, content: null, x: 0, y: 0 });
      storage.put(used, { lastModified: old });
      storage.put(`boards/${boardId}/orphan.png`, { lastModified: old });
      storage.put(`boards/${boardId}/fresh.png`, { lastModified: new Date(now.getTime() - 60_000) });

      expect(await photos.sweepOrphans(now)).toBe(1);
      expect([...storage.objects.keys()].sort()).toEqual([`boards/${boardId}/${UUID}.png`, `boards/${boardId}/fresh.png`]);
    });
  });
});
