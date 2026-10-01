import { describe, expect, it } from 'vitest';
import { resolvePress } from './press.js';

describe('resolvePress', () => {
  it('도메인을 언론사명으로 바꾼다', () => {
    expect(resolvePress('https://www.hani.co.kr/arti/economy/1.html')).toBe('한겨레');
  });

  it('하위 도메인은 가장 구체적인 항목을 먼저 찾는다', () => {
    expect(resolvePress('https://biz.chosun.com/a')).toBe('조선비즈');
    expect(resolvePress('https://www.chosun.com/a')).toBe('조선일보');
    expect(resolvePress('https://m.news.chosun.com/a')).toBe('조선일보');
  });

  it('매핑에 없는 도메인은 www를 뗀 도메인을 그대로 쓴다', () => {
    expect(resolvePress('https://www.example-news.kr/a')).toBe('example-news.kr');
  });

  it('URL이 아니면 null', () => {
    expect(resolvePress('not a url')).toBeNull();
  });
});
