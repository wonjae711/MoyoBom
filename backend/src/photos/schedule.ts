import { schedule } from 'node-cron';
import type { PhotoService } from './service.js';

/** 매일 04:30(한국 시간) 카드가 없는 사진 정리 — 04:00 기사 정리와 겹치지 않게 */
const SWEEP_CRON = '30 4 * * *';

export function startPhotoSweep(photos: PhotoService): { stop: () => Promise<void> } {
  const task = schedule(
    SWEEP_CRON,
    async () => {
      try {
        const deleted = await photos.sweepOrphans();
        console.log(`[photos] 카드가 없는 사진 ${deleted}개 정리`);
      } catch (error) {
        console.error('[photos] 정리 실패:', error instanceof Error ? error.message : error);
      }
    },
    { timezone: 'Asia/Seoul', noOverlap: true, name: 'photos:sweep' },
  );
  return { stop: async () => void (await task.stop()) };
}
