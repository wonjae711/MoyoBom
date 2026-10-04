import { schedule } from 'node-cron';
import type pg from 'pg';
import type { Env } from '../config/env.js';
import { NewsCollector, nextMidnight } from './collector.js';
import { NewsEvents } from './events.js';
import { fetchGuardianNews } from './providers/guardian.js';
import { fetchNaverNews } from './providers/naver.js';
import { insertCollectedArticles } from './repository.js';
import { RETENTION_DAYS, deleteStaleArticles } from './retention.js';
import { CATEGORIES, NAVER_SEARCH_ORDER } from './types.js';

/** 수집 주기 (requirements.md F-01): 네이버 10분, Guardian 30분 */
const NAVER_CRON = '*/10 * * * *';
const GUARDIAN_CRON = '*/30 * * * *';
/** 미사용 기사 정리: 매일 새벽 4시(KST) */
const RETENTION_CRON = '0 4 * * *';

export function createNewsCollector(env: Env, pool: pg.Pool, events: NewsEvents): NewsCollector {
  const naver = { clientId: env.NAVER_CLIENT_ID, clientSecret: env.NAVER_CLIENT_SECRET };
  return new NewsCollector({
    providers: {
      naver: {
        requests: NAVER_SEARCH_ORDER.flatMap((code) => {
          const category = CATEGORIES.find((c) => c.code === code)!;
          return category.naverQueries.map((query) => () => fetchNaverNews(category, query, naver));
        }),
        quotaResetAt: (now) => nextMidnight(now, 9),
      },
      guardian: {
        requests: [() => fetchGuardianNews({ apiKey: env.GUARDIAN_API_KEY })],
        quotaResetAt: (now) => nextMidnight(now, 0),
      },
    },
    save: (articles) => insertCollectedArticles(pool, articles),
    events,
  });
}

/** 서버 시작 시 한 번 바로 수집하고, 이후 주기마다 수집한다. */
export function startNewsSchedule(collector: NewsCollector, pool: pg.Pool): { stop: () => Promise<void> } {
  const options = { timezone: 'Asia/Seoul', noOverlap: true };
  const tasks = [
    schedule(NAVER_CRON, () => collector.run('naver'), { ...options, name: 'news:naver' }),
    schedule(GUARDIAN_CRON, () => collector.run('guardian'), { ...options, name: 'news:guardian' }),
    schedule(
      RETENTION_CRON,
      async () => {
        try {
          const deleted = await deleteStaleArticles(pool);
          console.log(`[news:retention] 보드에 쓰이지 않은 ${RETENTION_DAYS}일 지난 기사 ${deleted}건 삭제`);
        } catch (error) {
          console.error('[news:retention] 정리 실패:', error instanceof Error ? error.message : error);
        }
      },
      { ...options, name: 'news:retention' },
    ),
  ];
  void collector.run('naver');
  void collector.run('guardian');

  return {
    stop: async () => {
      await Promise.all(tasks.map((task) => task.stop()));
    },
  };
}

export { NewsEvents };
