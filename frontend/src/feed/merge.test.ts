import { describe, expect, it } from 'vitest'
import { formatRelativeTime, mergeArticles } from './merge'
import type { FeedArticle } from './types'

function article(id: string, publishedAt: string, title = id): FeedArticle {
  return {
    id,
    title,
    description: '',
    source: '한겨레',
    category: 'economy',
    originalLink: `https://e.com/${id}`,
    publishedAt,
    collectedAt: publishedAt,
  }
}

describe('mergeArticles', () => {
  it('새 기사를 합쳐 최신순으로 정렬한다', () => {
    const current = [article('1', '2026-10-01T10:00:00.000Z')]
    const incoming = [article('3', '2026-10-01T12:00:00.000Z'), article('2', '2026-10-01T11:00:00.000Z')]
    expect(mergeArticles(current, incoming).map((a) => a.id)).toEqual(['3', '2', '1'])
  })

  it('재연결 후 다시 받은 기사는 중복되지 않는다', () => {
    const current = [article('1', '2026-10-01T10:00:00.000Z'), article('2', '2026-10-01T11:00:00.000Z')]
    const refetched = [article('2', '2026-10-01T11:00:00.000Z'), article('3', '2026-10-01T12:00:00.000Z')]
    expect(mergeArticles(current, refetched).map((a) => a.id)).toEqual(['3', '2', '1'])
  })

  it('최대 개수를 넘으면 오래된 기사부터 버린다', () => {
    const many = Array.from({ length: 5 }, (_, i) => article(String(i + 1), `2026-10-01T1${i}:00:00.000Z`))
    expect(mergeArticles([], many, 3).map((a) => a.id)).toEqual(['5', '4', '3'])
  })
})

describe('formatRelativeTime', () => {
  const now = new Date('2026-10-02T12:00:00.000Z')

  it.each([
    ['2026-10-02T11:59:40.000Z', '방금 전'],
    ['2026-10-02T11:55:00.000Z', '5분 전'],
    ['2026-10-02T09:00:00.000Z', '3시간 전'],
  ])('%s → %s', (iso, expected) => {
    expect(formatRelativeTime(iso, now)).toBe(expected)
  })

  it('하루가 넘으면 날짜로 표시한다', () => {
    expect(formatRelativeTime('2026-09-29T12:00:00.000Z', now)).toMatch(/^9월 29일$/)
  })
})
