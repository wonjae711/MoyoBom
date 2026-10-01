import { schedule } from 'node-cron';
import type pg from 'pg';
import type { Env } from '../config/env.js';
import { NewsCollector, nextMidnight } from './collector.js';
import { NewsEvents } from './events.js';
import { fetchGuardianNews } from './providers/guardian.js';
import { fetchNaverNews } from './providers/naver.js';
import { insertCollectedArticles } from './repository.js';
import { CATEGORIES } from './types.js';

/** 수집 주기 (requirements.md F-01): 네이버 10분, Guardian 30분 */
const NAVER_CRON = '*/10 * * * *';
const GUARDIAN_CRON = '*/30 * * * *';

export function createNewsCollector(env: Env, pool: pg.Pool, events: NewsEvents): NewsCollector {
  const naver = { clientId: env.NAVER_CLIENT_ID, clientSecret: env.NAVER_CLIENT_SECRET };
  return new NewsCollector({
    providers: {
      naver: {
        requests: CATEGORIES.map((category) => () => fetchNaverNews(category, naver)),
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
export function startNewsSchedule(collector: NewsCollector): { stop: () => Promise<void> } {
  const options = { timezone: 'Asia/Seoul', noOverlap: true };
  const tasks = [
    schedule(NAVER_CRON, () => collector.run('naver'), { ...options, name: 'news:naver' }),
    schedule(GUARDIAN_CRON, () => collector.run('guardian'), { ...options, name: 'news:guardian' }),
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
