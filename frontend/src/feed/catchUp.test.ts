import { describe, expect, it, vi } from 'vitest'
import { catchUp, catchUpStart, cursorOf, laterCursor } from './catchUp'
import type { FeedArticle, FeedPage } from './types'

function article(id: string, collectedAt = '2026-10-04T07:00:00.000Z'): FeedArticle {
  return {
    id,
    title: id,
    description: '',
    source: 's',
    category: 'economy',
    originalLink: `https://e.com/${id}`,
    publishedAt: '2026-09-30T00:00:00.000Z',
    collectedAt,
  }
}

describe('수집 위치 커서', () => {
  it('기사의 수집 시각을 마이크로초 커서로 바꾼다', () => {
    expect(cursorOf(article('7', '1970-01-01T00:00:01.500Z'))).toBe('1500000_7')
  })

  it('더 뒤의 위치를 고른다 (시각이 같으면 id가 큰 쪽, 없는 쪽은 무시)', () => {
    expect(laterCursor('100_9', '200_1')).toBe('200_1')
    expect(laterCursor('200_3', '200_5')).toBe('200_5')
    expect(laterCursor(null, '1_1')).toBe('1_1')
    expect(laterCursor('1_1', null)).toBe('1_1')
    expect(laterCursor(null, null)).toBeNull()
  })

  it('시작 위치를 겹침 시간만큼 앞당기고, 위치가 없으면 처음부터', () => {
    expect(catchUpStart('90000000_5', 60_000)).toBe('30000000_0')
    expect(catchUpStart('10_5', 60_000)).toBe('0_0')
    expect(catchUpStart(null)).toBe('0_0')
  })
})

describe('[C-10] 재연결 누락분 보완', () => {
  function pages(...list: FeedPage[]) {
    const fn = vi.fn(async (cursor: string) => {
      void cursor
      return list.shift()!
    })
    return fn
  }

  it('남은 페이지가 없을 때까지 이어 받고, 다 받은 위치를 돌려준다', async () => {
    const fetchAfter = pages(
      { articles: [article('1'), article('2')], nextCursor: 'c2', collectedCursor: 'c2' },
      { articles: [article('3')], nextCursor: null, collectedCursor: 'c3' },
    )
    const result = await catchUp(fetchAfter, 'start')
    expect(result).toEqual({ complete: true, articles: [article('1'), article('2'), article('3')], reached: 'c3' })
    expect(fetchAfter.mock.calls.map(([c]) => c)).toEqual(['start', 'c2'])
  })

  it('너무 많이 놓쳤으면(최대 페이지 초과) 끝까지 받지 않고 새로 시작하라고 알린다', async () => {
    const full: FeedPage = { articles: [article('x')], nextCursor: 'more', collectedCursor: 'more' }
    const fetchAfter = pages(full, full, full)
    expect(await catchUp(fetchAfter, 'start', 2)).toEqual({ complete: false })
    expect(fetchAfter).toHaveBeenCalledTimes(2)
  })

  it('놓친 기사가 없으면 시작 위치를 그대로 돌려준다', async () => {
    const result = await catchUp(pages({ articles: [], nextCursor: null, collectedCursor: null }), 'start')
    expect(result).toEqual({ complete: true, articles: [], reached: 'start' })
  })
})
