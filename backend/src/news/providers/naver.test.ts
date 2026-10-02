import { describe, expect, it, vi } from 'vitest';
import { ProviderAuthError, ProviderRequestError, QuotaExceededError } from '../errors.js';
import { CATEGORIES } from '../types.js';
import { fetchNaverNews } from './naver.js';

const economy = CATEGORIES.find((c) => c.code === 'economy')!;

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

function naverItem(overrides: Record<string, unknown> = {}) {
  return {
    title: '<b>경제</b> 성장률 &quot;둔화&quot;',
    originallink: 'https://www.hani.co.kr/arti/1.html',
    link: 'https://n.news.naver.com/mnews/article/028/1',
    description: '한국은행이 <b>경제</b> 전망을 발표했다',
    pubDate: 'Wed, 01 Oct 2026 21:00:00 +0900',
    ...overrides,
  };
}

const config = (fetchFn: typeof fetch) => ({ clientId: 'id', clientSecret: 'secret', fetchFn });

describe('fetchNaverNews', () => {
  it('키워드로 최신순 검색하고 인증 헤더를 보낸다', async () => {
    const fetchFn = vi.fn(async () => jsonResponse({ items: [] }));
    await fetchNaverNews(economy, '금리', config(fetchFn));

    const [url, init] = fetchFn.mock.calls[0] as unknown as [URL, RequestInit];
    expect(url.searchParams.get('query')).toBe('금리');
    expect(url.searchParams.get('sort')).toBe('date');
    expect(url.searchParams.get('display')).toBe('100');
    expect(url.origin + url.pathname).toBe('https://naverapihub.apigw.ntruss.com/search/v1/news');
    expect(init.headers).toMatchObject({ 'X-NCP-APIGW-API-KEY-ID': 'id', 'X-NCP-APIGW-API-KEY': 'secret' });
  });

  it('응답을 공통 포맷으로 정규화한다 (태그·엔티티 제거, 언론사명, KST 시각)', async () => {
    const fetchFn = vi.fn(async () => jsonResponse({ items: [naverItem()] }));
    const { articles, skipped } = await fetchNaverNews(economy, '금리', config(fetchFn));

    expect(skipped).toBe(0);
    expect(articles).toEqual([
      {
        title: '경제 성장률 "둔화"',
        description: '한국은행이 경제 전망을 발표했다',
        source: '한겨레',
        category: 'economy',
        originalLink: 'https://www.hani.co.kr/arti/1.html',
        publishedAt: new Date('2026-10-01T12:00:00Z'),
      },
    ]);
  });

  it('originallink가 비어 있으면 네이버 뉴스 link를 쓴다', async () => {
    const fetchFn = vi.fn(async () => jsonResponse({ items: [naverItem({ originallink: '' })] }));
    const { articles } = await fetchNaverNews(economy, '금리', config(fetchFn));
    expect(articles[0]?.originalLink).toBe('https://n.news.naver.com/mnews/article/028/1');
    expect(articles[0]?.source).toBe('네이버뉴스');
  });

  it('[예외] 형식이 잘못된 기사는 건너뛰고 개수를 센다', async () => {
    const fetchFn = vi.fn(async () =>
      jsonResponse({
        items: [
          naverItem(),
          naverItem({ title: undefined }), // 제목 없음
          naverItem({ pubDate: '날짜 아님' }), // 날짜 형식 오류
          naverItem({ originallink: 'javascript:alert(1)', link: '' }), // http(s) 아님
          'not an object',
        ],
      }),
    );
    const { articles, skipped } = await fetchNaverNews(economy, '금리', config(fetchFn));
    expect(articles).toHaveLength(1);
    expect(skipped).toBe(4);
  });

  it('[예외] 429 응답은 일일 한도 초과로 처리한다', async () => {
    const fetchFn = vi.fn(async () => jsonResponse({ errorCode: '012' }, 429));
    await expect(fetchNaverNews(economy, '금리', config(fetchFn))).rejects.toBeInstanceOf(QuotaExceededError);
  });

  it('[예외] 401 응답은 인증 실패로 처리한다', async () => {
    const fetchFn = vi.fn(async () =>
      jsonResponse({ error: { errorCode: '200', message: 'Authentication Failed' } }, 401),
    );
    await expect(fetchNaverNews(economy, '금리', config(fetchFn))).rejects.toBeInstanceOf(ProviderAuthError);
  });

  it('[예외] 5xx 응답은 요청 실패로 처리한다', async () => {
    const fetchFn = vi.fn(async () => jsonResponse({}, 503));
    await expect(fetchNaverNews(economy, '금리', config(fetchFn))).rejects.toThrow(new ProviderRequestError('naver', 'HTTP 503'));
  });

  it('[예외] 타임아웃은 요청 실패로 처리한다', async () => {
    const fetchFn = vi.fn(async () => {
      throw new DOMException('The operation was aborted due to timeout', 'TimeoutError');
    });
    await expect(fetchNaverNews(economy, '금리', config(fetchFn))).rejects.toThrow(/타임아웃/);
  });

  it('[예외] items가 없는 응답은 요청 실패로 처리한다', async () => {
    const fetchFn = vi.fn(async () => jsonResponse({ unexpected: true }));
    await expect(fetchNaverNews(economy, '금리', config(fetchFn))).rejects.toBeInstanceOf(ProviderRequestError);
  });
});
