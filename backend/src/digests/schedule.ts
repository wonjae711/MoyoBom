import { schedule } from 'node-cron';
import { DIGEST_RETENTION_DAYS, type DigestService } from './service.js';

/** 5분마다 받을 때가 된 구독을 처리 (F-09 설계: 놓친 실행은 3시간 안에만) */
const DUE_CRON = '*/5 * * * *';
/** 오래된 알림 정리: 매일 새벽 4시 10분(KST) — 기사 정리(4시)와 겹치지 않게 */
const RETENTION_CRON = '10 4 * * *';

/** 서버 시작 시 한 번 바로 확인하고(꺼져 있던 동안 놓친 실행 보완), 이후 주기마다 확인한다 */
export function startDigestSchedule(digests: DigestService): { stop: () => Promise<void> } {
  const options = { timezone: 'Asia/Seoul', noOverlap: true };
  const runDue = async () => {
    try {
      const made = await digests.runDue();
      if (made.length) console.log(`[digests] 다이제스트 ${made.length}건 생성`);
    } catch (error) {
      console.error('[digests] 확인 실패:', error instanceof Error ? error.message : error);
    }
  };
  const tasks = [
    schedule(DUE_CRON, runDue, { ...options, name: 'digests:due' }),
    schedule(
      RETENTION_CRON,
      async () => {
        try {
          const deleted = await digests.deleteOldDigests();
          console.log(`[digests] ${DIGEST_RETENTION_DAYS}일 지난 알림 ${deleted}건 삭제`);
        } catch (error) {
          console.error('[digests] 정리 실패:', error instanceof Error ? error.message : error);
        }
      },
      { ...options, name: 'digests:retention' },
    ),
  ];
  void runDue();
  return {
    stop: async () => {
      await Promise.all(tasks.map((task) => task.stop()));
    },
  };
}
