import type { PhotoStorage, StoredObject, UploadTicket } from '../photos/storage.js';

/** 테스트용 S3 대신 쓰는 메모리 저장소. put()으로 "브라우저가 올린 사진"을 흉내 낸다 */
export class MemoryPhotoStorage implements PhotoStorage {
  readonly objects = new Map<string, { size: number; contentType: string; lastModified: Date }>();
  readonly uploads: { key: string; contentType: string; maxBytes: number }[] = [];

  put(key: string, options: { size?: number; contentType?: string; lastModified?: Date } = {}): void {
    this.objects.set(key, {
      size: options.size ?? 1000,
      contentType: options.contentType ?? 'image/png',
      lastModified: options.lastModified ?? new Date(),
    });
  }

  async createUpload(key: string, contentType: string, maxBytes: number): Promise<UploadTicket> {
    this.uploads.push({ key, contentType, maxBytes });
    return { url: 'https://s3.test/photos', fields: { key, 'Content-Type': contentType } };
  }

  async head(key: string) {
    const o = this.objects.get(key);
    return o ? { size: o.size, contentType: o.contentType } : null;
  }

  async signedGetUrl(key: string, expiresSeconds: number): Promise<string> {
    return `https://s3.test/photos/${key}?expires=${expiresSeconds}`;
  }

  /** 여기 넣은 key는 지우지 못한 것으로 돌려준다 (S3 객체별 삭제 실패 흉내) */
  readonly failDelete = new Set<string>();

  async delete(keys: string[]): Promise<string[]> {
    const failed = keys.filter((key) => this.failDelete.has(key));
    for (const key of keys) if (!this.failDelete.has(key)) this.objects.delete(key);
    return failed;
  }

  async list(prefix: string): Promise<StoredObject[]> {
    return [...this.objects]
      .filter(([key]) => key.startsWith(prefix))
      .map(([key, o]) => ({ key, size: o.size, lastModified: o.lastModified }));
  }
}
