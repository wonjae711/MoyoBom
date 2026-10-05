import { describe, expect, it } from 'vitest'
import { filterParams, hasFilters, matchesFilters, periodStart, toFeedFilters } from './filters'
import type { FeedArticle } from './types'

const article = (over: Partial<FeedArticle> = {}): FeedArticle => ({
  id: '1',
  title: '반도체 수출 규제 확대',
  description: 'AI 칩 장비 통제',
  source: '한겨레',
  category: 'economy',
  originalLink: 'https://e.com/1',
  publishedAt: '2026-10-05T01:00:00.000Z',
  collectedAt: '2026-10-05T01:00:00.000Z',
  ...over,
})

describe('[F-04] 검색·필터 규칙 (서버와 같은 규칙)', () => {
  it('낱말이 모두 제목이나 요약에 있어야 맞는다 (영문 대소문자 무시)', () => {
    expect(matchesFilters(article(), { q: '반도체 장비' })).toBe(true)
    expect(matchesFilters(article(), { q: 'ai 반도체' })).toBe(true)
    expect(matchesFilters(article(), { q: '반도체 야구' })).toBe(false)
  })

  it('카테고리·언론사·기간(한국 시간 시작일 0시 이후)을 함께 본다', () => {
    expect(matchesFilters(article(), { category: 'economy', source: '한겨레', from: '2026-10-05' })).toBe(true)
    expect(matchesFilters(article(), { category: 'sports' })).toBe(false)
    expect(matchesFilters(article(), { source: '조선일보' })).toBe(false)
    expect(matchesFilters(article({ publishedAt: '2026-10-04T14:59:00.000Z' }), { from: '2026-10-05' })).toBe(false)
  })

  it('요청 주소에는 정리된 조건만 붙고, 빈 조건은 조건 없음으로 본다', () => {
    expect(filterParams({ q: '  수출,  규제 ', category: 'economy' })).toEqual({ q: '수출 규제', category: 'economy' })
    expect(hasFilters({ q: '   ' })).toBe(false)
    expect(toFeedFilters({ q: ' ', period: 'all' })).toEqual({})
  })

  it('기간 선택은 오늘을 포함한 시작 날짜로 바뀐다', () => {
    const now = new Date(2026, 9, 5, 15, 0)
    expect(periodStart('today', now)).toBe('2026-10-05')
    expect(periodStart('7d', now)).toBe('2026-09-29')
    expect(periodStart('30d', now)).toBe('2026-09-06')
    expect(periodStart('all', now)).toBeUndefined()
  })
})
