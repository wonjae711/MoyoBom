import { describe, expect, it } from 'vitest'
import type { Digest } from './api'
import { mergeDigests } from './merge'

const digest = (id: string, readAt: string | null = null): Digest => ({
  id,
  subscriptionId: '1',
  kind: 'scheduled',
  slot: null,
  status: 'ok',
  title: `브리핑 ${id}`,
  summary: '요약',
  articles: [],
  windowStart: '',
  windowEnd: '',
  readAt,
  createdAt: '',
})

describe('[F-09] 재연결 뒤 알림함 목록 합치기 (Codex 068152f 리뷰 1)', () => {
  it('끊긴 동안 도착한 다이제스트를 위에 넣고, 더 불러온 이전 항목은 남기며, 서버의 읽음 상태로 맞춘다', () => {
    const current = [digest('5'), digest('3'), digest('1')]
    const fresh = [digest('7'), digest('5', '2026-10-06T00:00:00Z'), digest('3')]
    const merged = mergeDigests(current, fresh)
    expect(merged.map((d) => d.id)).toEqual(['7', '5', '3', '1'])
    expect(merged[1]!.readAt).not.toBeNull()
  })
})
