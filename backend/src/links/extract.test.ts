import { describe, expect, it } from 'vitest';
import { extractPage, normalizeUrl } from './extract.js';

describe('주소 정규화 (같은 기사는 한 주소로)', () => {
  it.each([
    ['https://www.hani.co.kr/arti/123.html?utm_source=x&utm_medium=y#comment', 'https://www.hani.co.kr/arti/123.html'],
    ['https://m.hani.co.kr/arti/123.html', 'https://hani.co.kr/arti/123.html'],
    ['https://MOBILE.Example.COM/a/?fbclid=1&id=7', 'https://example.com/a?id=7'],
    ['http://news.test/a?b=2&a=1', 'http://news.test/a?a=1&b=2'],
  ])('%s → %s', (input, expected) => {
    expect(normalizeUrl(input)?.toString()).toBe(expected);
  });

  it('m.만 있는 짧은 도메인(m.com)은 바꾸지 않고, http/https가 아니면 거절한다', () => {
    expect(normalizeUrl('https://m.com/a')?.hostname).toBe('m.com');
    expect(normalizeUrl('ftp://news.test/a')).toBeNull();
    expect(normalizeUrl('아무 글자')).toBeNull();
  });
});

const body = '반도체 수출 규제가 장비와 정비 인력까지 넓어졌다. '.repeat(20);

describe('페이지에서 기사 정보 추출', () => {
  it('제목·설명·본문·언론사·발행 시각을 뽑는다', async () => {
    const html = `<!doctype html><html><head>
      <title>사이트 제목 | 한겨레</title>
      <meta property="og:title" content="美, 첨단 AI 칩 수출 통제 3차 확대">
      <meta property="og:description" content="통제 대상이 장비로 넓어졌다 &amp; 국내 영향">
      <meta property="article:published_time" content="2026-10-04T08:12:00+09:00">
      </head><body><nav>메뉴</nav><article><h1>美, 첨단 AI 칩 수출 통제 3차 확대</h1>
      <p>${body}</p><p>${body}</p><script>alert(1)</script></article></body></html>`;
    const page = await extractPage(html, new URL('https://www.hani.co.kr/arti/1.html'));
    expect(page.title).toContain('수출 통제 3차 확대');
    expect(page.metaDescription).toBe('통제 대상이 장비로 넓어졌다 & 국내 영향');
    expect(page.bodyText).toContain('반도체 수출 규제');
    expect(page.bodyText).not.toContain('alert');
    expect(page.source).toBe('한겨레');
    expect(page.publishedAt?.toISOString()).toBe('2026-10-03T23:12:00.000Z');
  });

  it('[예외] 본문을 못 찾아도 og 태그는 읽어 대체 정보로 쓴다', async () => {
    const html = `<html><head><meta property="og:title" content="짧은 페이지"><meta name="description" content="페이지 설명"></head><body><div>로그인</div></body></html>`;
    const page = await extractPage(html, new URL('https://unknown-news.example/a'));
    expect(page).toMatchObject({ title: '짧은 페이지', metaDescription: '페이지 설명', bodyText: '', source: 'unknown-news.example', publishedAt: null });
  });
});
