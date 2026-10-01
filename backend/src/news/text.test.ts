import { describe, expect, it } from 'vitest';
import { cleanText } from './text.js';

describe('cleanText', () => {
  it('네이버 검색 강조 태그(<b>)를 지운다', () => {
    expect(cleanText('<b>경제</b> 성장률 발표')).toBe('경제 성장률 발표');
  });

  it('HTML 엔티티를 문자로 바꾼다', () => {
    expect(cleanText('&quot;금리 인하&quot; &amp; 환율 &lt;전망&gt; &#39;주목&#39; &#x2014;')).toBe(
      '"금리 인하" & 환율 <전망> \'주목\' —',
    );
  });

  it('엔티티로 적힌 태그 모양 글자는 지우지 않는다', () => {
    expect(cleanText('&lt;b&gt;는 굵은 글씨 태그')).toBe('<b>는 굵은 글씨 태그');
  });

  it('공백을 하나로 줄이고 앞뒤 공백을 없앤다', () => {
    expect(cleanText('  <p>첫 줄</p>\n\n<p>둘째 줄</p>  ')).toBe('첫 줄 둘째 줄');
  });

  it('모르는 엔티티는 그대로 둔다', () => {
    expect(cleanText('A &unknown; B')).toBe('A &unknown; B');
  });
});
