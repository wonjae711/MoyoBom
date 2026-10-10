import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import type { BoardService } from '../boards/service.js';
import { BoardError } from '../boards/types.js';
import type { PhotoStorage, UploadTicket } from './storage.js';

/** 받는 형식과 저장할 확장자 (requirements F-05 처리 로직 7: jpg/png/webp, 최대 10MB) */
export const PHOTO_TYPES: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };
export const MAX_PHOTO_BYTES = 10 * 1024 * 1024;
/** 업로드 허가증·조회 주소 유효 시간 */
const UPLOAD_EXPIRES_SECONDS = 300;
export const VIEW_EXPIRES_SECONDS = 300;
/** 올리고 나서 이만큼 지나도 카드가 없는 사진은 정리한다 (업로드 후 카드 추가 전에 창을 닫은 경우 등) */
const ORPHAN_AGE_MS = 24 * 60 * 60 * 1000;

export type PhotoErrorCode = 'invalid_type' | 'too_large' | 'not_uploaded';

export class PhotoError extends Error {
  constructor(
    readonly code: PhotoErrorCode,
    message: string,
  ) {
    super(message);
  }
}

const boardPrefix = (boardId: string) => `boards/${boardId}/`;

/**
 * 사진 카드 (F-05). 사진은 S3 비공개 버킷에 `boards/{보드}/{uuid}.{확장자}`로 저장한다.
 * 1. 멤버가 업로드 허가증(presigned POST)을 받아 브라우저에서 S3로 바로 올린다 — 크기·형식은 S3가 검사
 * 2. card:add(photo) 때 그 key가 이 보드의 것인지, 실제로 올라갔는지 다시 확인한다
 * 3. 볼 때는 멤버 확인 후 잠깐 쓰는 조회 주소로 넘겨준다
 * 4. 카드·보드를 지우면 사진도 지우고, 카드가 되지 못한 사진은 매일 정리한다
 */
export class PhotoService {
  private readonly pool: pg.Pool;
  private readonly boards: BoardService;
  private readonly storage: PhotoStorage;
  private readonly newId: () => string;

  constructor(deps: { pool: pg.Pool; boards: BoardService; storage: PhotoStorage; newId?: () => string }) {
    this.pool = deps.pool;
    this.boards = deps.boards;
    this.storage = deps.storage;
    this.newId = deps.newId ?? randomUUID;
  }

  private async requireMember(boardId: string, userId: string): Promise<void> {
    if (!(await this.boards.getRole(boardId, userId))) throw new BoardError('not_found', '보드를 찾을 수 없습니다');
  }

  async createUpload(
    boardId: string,
    userId: string,
    file: { contentType: string; size: number },
  ): Promise<UploadTicket & { key: string }> {
    await this.requireMember(boardId, userId);
    const ext = PHOTO_TYPES[file.contentType];
    if (!ext) throw new PhotoError('invalid_type', 'jpg·png·webp 사진만 올릴 수 있습니다');
    if (file.size > MAX_PHOTO_BYTES) throw new PhotoError('too_large', '사진은 10MB 이하만 올릴 수 있습니다');
    const key = `${boardPrefix(boardId)}${this.newId()}.${ext}`;
    const ticket = await this.storage.createUpload(key, file.contentType, MAX_PHOTO_BYTES, UPLOAD_EXPIRES_SECONDS);
    return { key, ...ticket };
  }

  /** card:add(photo) 전에: 이 보드의 key 모양인지, 실제로 올라갔고 조건에 맞는지 */
  async verifyUpload(boardId: string, key: string): Promise<void> {
    const shape = new RegExp(`^boards/${boardId}/[0-9a-f-]{36}\\.(jpg|png|webp)$`);
    if (!shape.test(key)) throw new BoardError('invalid', '잘못된 사진입니다');
    const head = await this.storage.head(key);
    if (!head) throw new PhotoError('not_uploaded', '사진이 아직 올라가지 않았습니다');
    if (head.size > MAX_PHOTO_BYTES || !head.contentType || !PHOTO_TYPES[head.contentType]) {
      await this.remove([key]);
      throw new PhotoError('invalid_type', '올릴 수 없는 사진입니다');
    }
  }

  /** 멤버만: 사진 카드의 잠깐 쓰는 조회 주소 */
  async viewUrl(boardId: string, userId: string, itemId: string): Promise<string> {
    await this.requireMember(boardId, userId);
    const { rows } = await this.pool.query<{ image_key: string }>(
      `SELECT image_key FROM board_items WHERE board_id = $1 AND id = $2 AND item_type = 'photo'`,
      [boardId, itemId],
    );
    if (!rows[0]) throw new BoardError('not_found', '사진을 찾을 수 없습니다');
    return this.storage.signedGetUrl(rows[0].image_key, VIEW_EXPIRES_SECONDS);
  }

  /** 카드를 지운 뒤 사진도 지운다. 실패해도 카드 삭제는 그대로 두고(이미 커밋됨) 매일 정리에 맡긴다 */
  async remove(keys: string[]): Promise<void> {
    if (keys.length === 0) return;
    try {
      await this.storage.delete(keys);
    } catch (error) {
      console.error('[photos] 삭제 실패:', error instanceof Error ? error.message : error);
    }
  }

  /** 보드를 지운 뒤 그 보드의 사진을 모두 지운다 */
  async removeBoard(boardId: string): Promise<void> {
    try {
      const objects = await this.storage.list(boardPrefix(boardId));
      await this.remove(objects.map((o) => o.key));
    } catch (error) {
      console.error('[photos] 보드 사진 삭제 실패:', error instanceof Error ? error.message : error);
    }
  }

  /** 하루 넘게 카드가 없는 사진을 지운다 (카드가 되지 못한 업로드, 삭제 실패로 남은 사진). 지운 개수 */
  async sweepOrphans(now = new Date()): Promise<number> {
    const old = (await this.storage.list('boards/')).filter((o) => now.getTime() - o.lastModified.getTime() > ORPHAN_AGE_MS);
    if (old.length === 0) return 0;
    const { rows } = await this.pool.query<{ image_key: string }>(
      'SELECT image_key FROM board_items WHERE image_key = ANY($1::text[])',
      [old.map((o) => o.key)],
    );
    const used = new Set(rows.map((r) => r.image_key));
    const orphans = old.map((o) => o.key).filter((key) => !used.has(key));
    if (orphans.length > 0) await this.storage.delete(orphans);
    return orphans.length;
  }
}
