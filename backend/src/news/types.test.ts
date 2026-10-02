import { describe, expect, it } from 'vitest';
import { CATEGORIES, NAVER_SEARCH_ORDER } from './types.js';

describe('카테고리 설정', () => {
  it('네이버 검색 순서에 모든 카테고리가 한 번씩 들어 있다', () => {
    expect([...NAVER_SEARCH_ORDER].sort()).toEqual(CATEGORIES.map((c) => c.code).sort());
  });

  it('모든 카테고리에 네이버 검색 키워드가 있고 키워드끼리 겹치지 않는다', () => {
    const queries = CATEGORIES.flatMap((c) => c.naverQueries);
    expect(CATEGORIES.every((c) => c.naverQueries.length > 0)).toBe(true);
    expect(new Set(queries).size).toBe(queries.length);
  });
});
