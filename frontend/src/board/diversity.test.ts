import { describe, expect, it } from 'vitest'
import { sourceDiversity } from './diversity'
import type { BoardItem } from './types'

function article(id: string, source: string, articleId = id): BoardItem {
  return {
    id,
    type: 'article',
    articleId,
    article: { title: id, description: '', source, category: 'economy', originalLink: '', publishedAt: null, collectedAt: '', submitted: false },
    content: null,
    imageKey: null,
    x: 0,
    y: 0,
    rotation: 0,
    scale: 1,
    zIndex: 1,
    createdBy: null,
    updatedAt: '',
    version: 1,
    arranged: false,
  }
}

describe('[F-11] 출처 다양성', () => {
  it('언론사별 개수와 비율을 많은 순으로 센다', () => {
    const result = sourceDiversity([
      article('1', '한겨레'),
      article('2', '조선일보'),
      article('3', '한겨레'),
      article('4', 'Guardian'),
    ])
    expect(result?.total).toBe(4)
    expect(result?.sources).toEqual([
      { source: '한겨레', count: 2, ratio: 0.5 },
      { source: '조선일보', count: 1, ratio: 0.25 }, // 개수가 같으면 한국어 정렬 순 (한글 먼저)
      { source: 'Guardian', count: 1, ratio: 0.25 },
    ])
  })

  it('한 언론사가 절반 이상이면 편중으로 알린다', () => {
    expect(sourceDiversity([article('1', 'A'), article('2', 'A'), article('3', 'B')])?.skewedTo).toBe('A')
    expect(sourceDiversity([article('1', 'A'), article('2', 'B'), article('3', 'C')])?.skewedTo).toBeNull()
  })

  it('[예외] 기사가 1~2개면 표시하지 않고, 메모 카드와 같은 기사의 중복 카드는 세지 않는다', () => {
    expect(sourceDiversity([article('1', 'A'), article('2', 'B')])).toBeNull()
    const memo = { ...article('m', 'A'), type: 'memo' as const, article: null, articleId: null }
    expect(sourceDiversity([article('1', 'A'), article('2', 'A', '1'), memo, article('3', 'B')])).toBeNull()
  })
})
