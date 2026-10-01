import { describe, expect, it, vi } from 'vitest';
import { NewsCollector, nextMidnight, type Logger, type ProviderSource } from './collector.js';
import { ProviderAuthError, ProviderRequestError, QuotaExceededError } from './errors.js';
import { NewsEvents } from './events.js';
import type { Article, FetchResult, NormalizedArticle } from './types.js';

function article(link: string, category: NormalizedArticle['category'] = 'economy'): NormalizedArticle {
  return {
    title: `기사 ${link}`,
    description: '',
    source: '한겨레',
    category,
    originalLink: `https://example.com/${link}`,
    publishedAt: new Date('2026-10-01T00:00:00Z'),
  };
}

const ok = (...articles: NormalizedArticle[]) => async (): Promise<FetchResult> => ({ articles, skipped: 0 });
const silent: Logger = { info: () => {}, warn: () => {}, error: () => {} };

/** 저장소 대역: 처음 보는 링크만 "새로 저장"된 것으로 돌려준다 (DB의 UNIQUE와 같은 동작) */
function fakeStore() {
  const links = new Set<string>();
  return vi.fn(async (articles: NormalizedArticle[]): Promise<Article[]> =>
    articles
      .filter((a) => !links.has(a.originalLink) && links.add(a.originalLink))
      .map((a, i) => ({ ...a, id: String(links.size + i), createdAt: new Date() })),
  );
}

function setup(naver: ProviderSource['requests'], guardian: ProviderSource['requests'] = [ok()]) {
  let now = new Date('2026-10-01T03:00:00Z'); // KST 12:00
  const events = new NewsEvents();
  const onNew = vi.fn();
  events.on('articles:new', onNew);
  const save = fakeStore();
  const collector = new NewsCollector({
    providers: {
      naver: { requests: naver, quotaResetAt: (n) => nextMidnight(n, 9) },
      guardian: { requests: guardian, quotaResetAt: (n) => nextMidnight(n, 0) },
    },
    save,
    events,
    now: () => now,
    logger: silent,
  });
  return { collector, save, onNew, setNow: (d: Date) => (now = d) };
}

describe('nextMidnight', () => {
  it('KST 기준 다음 자정을 구한다', () => {
    // KST 2026-10-01 12:00 → KST 2026-10-02 00:00 = UTC 2026-10-01 15:00
    expect(nextMidnight(new Date('2026-10-01T03:00:00Z'), 9)).toEqual(new Date('2026-10-01T15:00:00Z'));
  });

  it('UTC 기준 다음 자정을 구한다', () => {
    expect(nextMidnight(new Date('2026-10-01T23:59:00Z'), 0)).toEqual(new Date('2026-10-02T00:00:00Z'));
  });
});

describe('NewsCollector', () => {
  it('수집한 기사를 저장하고 새 기사만 이벤트로 알린다', async () => {
    const { collector, onNew } = setup([ok(article('a'), article('b'))]);

    const first = await collector.run('naver');
    expect(first).toMatchObject({ status: 'done', fetched: 2, saved: 2 });
    expect(onNew).toHaveBeenCalledTimes(1);
    expect(onNew.mock.calls[0]?.[0]).toHaveLength(2);

    // 같은 기사가 다시 와도 중복 저장·중복 알림이 없다
    const second = await collector.run('naver');
    expect(second).toMatchObject({ status: 'done', fetched: 2, saved: 0 });
    expect(onNew).toHaveBeenCalledTimes(1);
  });

  it('여러 카테고리 검색에 같은 기사가 걸리면 처음 카테고리를 유지한다', async () => {
    const { collector, save } = setup([ok(article('a', 'economy')), ok(article('a', 'society'))]);
    await collector.run('naver');
    expect(save.mock.calls[0]?.[0]).toEqual([article('a', 'economy')]);
  });

  it('[예외] 요청 하나가 실패해도 나머지 요청은 계속하고, 즉시 재시도하지 않는다', async () => {
    const failing = vi.fn(async (): Promise<FetchResult> => {
      throw new ProviderRequestError('naver', 'HTTP 503');
    });
    const { collector } = setup([failing, ok(article('b'))]);

    const result = await collector.run('naver');
    expect(result).toMatchObject({ status: 'done', saved: 1, failedRequests: 1 });
    expect(failing).toHaveBeenCalledTimes(1);
  });

  it('[예외] 인증 실패(키 오류)면 남은 요청을 보내지 않고 이번 주기를 멈춘다', async () => {
    const unauthorized = vi.fn(async (): Promise<FetchResult> => {
      throw new ProviderAuthError('naver', 401);
    });
    const rest = vi.fn(ok(article('b')));
    const { collector } = setup([unauthorized, rest]);

    expect(await collector.run('naver')).toMatchObject({ status: 'done', saved: 0, failedRequests: 1 });
    expect(rest).not.toHaveBeenCalled();
  });

  it('[예외] 실패한 다음 주기에는 정상 복구된다', async () => {
    let fail = true;
    const flaky = async (): Promise<FetchResult> => {
      if (fail) throw new ProviderRequestError('naver', '타임아웃');
      return { articles: [article('a')], skipped: 0 };
    };
    const { collector } = setup([flaky]);

    expect(await collector.run('naver')).toMatchObject({ saved: 0, failedRequests: 1 });
    fail = false;
    expect(await collector.run('naver')).toMatchObject({ saved: 1, failedRequests: 0 });
  });

  it('[예외] 일일 한도 초과 시 해당 API만 자정까지 멈추고 다른 API는 계속 수집한다', async () => {
    const quota = vi.fn(async (): Promise<FetchResult> => {
      throw new QuotaExceededError('naver');
    });
    const afterQuota = vi.fn(ok(article('never')));
    const { collector, setNow } = setup([ok(article('a')), quota, afterQuota], [ok(article('g'))]);

    // 한도 초과 전에 받은 기사는 저장하고, 남은 요청은 보내지 않는다
    expect(await collector.run('naver')).toMatchObject({ saved: 1, quotaExceeded: true });
    expect(afterQuota).not.toHaveBeenCalled();

    // 같은 날에는 네이버 수집을 건너뛴다
    setNow(new Date('2026-10-01T14:59:00Z')); // KST 23:59
    expect(await collector.run('naver')).toEqual({ status: 'skipped', reason: 'quota' });
    expect(quota).toHaveBeenCalledTimes(1);

    // Guardian은 영향 없이 수집된다
    expect(await collector.run('guardian')).toMatchObject({ status: 'done', saved: 1 });

    // KST 자정이 지나면 다시 수집한다
    setNow(new Date('2026-10-01T15:00:00Z')); // KST 10/02 00:00
    expect(await collector.run('naver')).toMatchObject({ status: 'done' });
    expect(quota).toHaveBeenCalledTimes(2);
  });

  it('[예외] 형식 오류로 건너뛴 기사 수를 합산한다', async () => {
    const withSkips = async (): Promise<FetchResult> => ({ articles: [article('a')], skipped: 3 });
    const { collector } = setup([withSkips, withSkips]);
    expect(await collector.run('naver')).toMatchObject({ skipped: 6 });
  });

  it('[예외] DB 저장이 실패해도 예외를 던지지 않고 다음 주기를 기다린다', async () => {
    const { collector, save, onNew } = setup([ok(article('a'))]);
    save.mockRejectedValueOnce(new Error('connection refused'));
    await expect(collector.run('naver')).resolves.toMatchObject({ status: 'done', saved: 0 });
    expect(onNew).not.toHaveBeenCalled();
  });

  it('이전 수집이 끝나기 전에 다시 실행되면 겹쳐 돌지 않는다', async () => {
    let release!: () => void;
    const slow = () =>
      new Promise<FetchResult>((resolve) => {
        release = () => resolve({ articles: [], skipped: 0 });
      });
    const { collector } = setup([slow]);

    const first = collector.run('naver');
    expect(await collector.run('naver')).toEqual({ status: 'skipped', reason: 'running' });
    release();
    await first;
  });
});
