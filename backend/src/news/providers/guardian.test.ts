import { describe, expect, it, vi } from 'vitest';
import { ProviderRequestError, QuotaExceededError } from '../errors.js';
import { fetchGuardianNews } from './guardian.js';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

function guardianItem(overrides: Record<string, unknown> = {}) {
  return {
    type: 'article',
    sectionId: 'business',
    webTitle: 'Markets rally as inflation eases',
    webUrl: 'https://www.theguardian.com/business/2026/oct/01/markets',
    webPublicationDate: '2026-10-01T12:09:34Z',
    fields: { trailText: '<strong>Shares</strong> rose &amp; bonds fell' },
    ...overrides,
  };
}

function okBody(results: unknown[]) {
  return { response: { status: 'ok', results } };
}

describe('fetchGuardianNews', () => {
  it('최신순 요청에 API 키와 trailText 필드를 붙인다', async () => {
    const fetchFn = vi.fn(async () => jsonResponse(okBody([])));
    await fetchGuardianNews({ apiKey: 'key', fetchFn });

    const [url] = fetchFn.mock.calls[0] as unknown as [URL];
    expect(url.searchParams.get('api-key')).toBe('key');
    expect(url.searchParams.get('order-by')).toBe('newest');
    expect(url.searchParams.get('show-fields')).toBe('trailText');
  });

  it('응답을 공통 포맷으로 정규화하고 섹션을 카테고리로 바꾼다', async () => {
    const fetchFn = vi.fn(async () => jsonResponse(okBody([guardianItem()])));
    const { articles } = await fetchGuardianNews({ apiKey: 'key', fetchFn });

    expect(articles).toEqual([
      {
        title: 'Markets rally as inflation eases',
        description: 'Shares rose & bonds fell',
        source: 'The Guardian',
        category: 'economy',
        originalLink: 'https://www.theguardian.com/business/2026/oct/01/markets',
        publishedAt: new Date('2026-10-01T12:09:34Z'),
      },
    ]);
  });

  it('매핑에 없는 섹션은 world로, trailText가 없으면 빈 요약으로 저장한다', async () => {
    const fetchFn = vi.fn(async () =>
      jsonResponse(okBody([guardianItem({ sectionId: 'commentisfree', fields: undefined })])),
    );
    const { articles } = await fetchGuardianNews({ apiKey: 'key', fetchFn });
    expect(articles[0]?.category).toBe('world');
    expect(articles[0]?.description).toBe('');
  });

  it('텍스트 기사가 아닌 콘텐츠(gallery 등)는 형식 오류로 세지 않고 제외한다', async () => {
    const fetchFn = vi.fn(async () => jsonResponse(okBody([guardianItem({ type: 'gallery' }), guardianItem()])));
    const { articles, skipped } = await fetchGuardianNews({ apiKey: 'key', fetchFn });
    expect(articles).toHaveLength(1);
    expect(skipped).toBe(0);
  });

  it('[예외] 형식이 잘못된 기사는 건너뛰고 개수를 센다', async () => {
    const fetchFn = vi.fn(async () =>
      jsonResponse(
        okBody([
          guardianItem(),
          guardianItem({ webUrl: undefined }),
          guardianItem({ webPublicationDate: 'yesterday' }),
          null,
        ]),
      ),
    );
    const { articles, skipped } = await fetchGuardianNews({ apiKey: 'key', fetchFn });
    expect(articles).toHaveLength(1);
    expect(skipped).toBe(3);
  });

  it('[예외] 429 응답은 일일 한도 초과로 처리한다', async () => {
    const fetchFn = vi.fn(async () => jsonResponse({ message: 'API rate limit exceeded' }, 429));
    await expect(fetchGuardianNews({ apiKey: 'key', fetchFn })).rejects.toBeInstanceOf(QuotaExceededError);
  });

  it('[예외] status가 ok가 아니면 요청 실패로 처리한다', async () => {
    const fetchFn = vi.fn(async () => jsonResponse({ response: { status: 'error', message: 'Invalid key' } }));
    await expect(fetchGuardianNews({ apiKey: 'key', fetchFn })).rejects.toBeInstanceOf(ProviderRequestError);
  });

  it('[보안] 요청 실패 에러 메시지에 API 키가 들어가지 않는다', async () => {
    const fetchFn = vi.fn(async () => {
      throw new TypeError('fetch failed https://content.guardianapis.com/search?api-key=secret-key');
    });
    const error = await fetchGuardianNews({ apiKey: 'secret-key', fetchFn }).catch((e: Error) => e);
    expect(error).toBeInstanceOf(ProviderRequestError);
    expect((error as Error).message).not.toContain('secret-key');
  });
});
