import { DeleteObjectsCommand } from '@aws-sdk/client-s3';
import { describe, expect, it, vi } from 'vitest';
import { createS3Storage } from './storage.js';

describe('S3 사진 저장소 삭제 (F-05)', () => {
  it('[예외] 응답이 성공이어도 Errors에 온 객체별 실패 key를 돌려준다 — 1000개씩 나눠 보낸다 (Codex N-02)', async () => {
    const send = vi.fn(async (command: DeleteObjectsCommand) => {
      const keys = command.input.Delete!.Objects!.map((o) => o.Key!);
      return { Errors: keys.filter((k) => k.endsWith('7.png')).map((Key) => ({ Key, Code: 'AccessDenied' })) };
    });
    const storage = createS3Storage({ bucket: 'b', region: 'ap-northeast-2', client: { send } as never });
    const keys = Array.from({ length: 1001 }, (_, i) => `boards/1/${i}.png`);

    const failed = await storage.delete(keys);
    expect(send).toHaveBeenCalledTimes(2);
    expect(failed).toHaveLength(keys.filter((k) => k.endsWith('7.png')).length);
    expect(failed).toContain('boards/1/7.png');
    expect(await storage.delete([])).toEqual([]);
  });
});
