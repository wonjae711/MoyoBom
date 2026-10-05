import { describe, expect, it } from 'vitest'
import { hourLabel, topicName } from './api'

describe('[F-09] 다이제스트 표시', () => {
  it('받는 시각을 오전·낮·오후로 읽는다', () => {
    expect([0, 8, 12, 13, 23].map(hourLabel)).toEqual(['오전 0시', '오전 8시', '낮 12시', '오후 1시', '오후 11시'])
  })

  it('구독 주제 이름은 서버와 같은 형식', () => {
    expect(topicName({ categories: ['economy', 'tech'], keywords: ['반도체'] })).toBe('경제·IT·과학 + 반도체')
    expect(topicName({ categories: [], keywords: ['금리', '환율'] })).toBe('금리, 환율')
  })
})
