import type { Digest } from './api'

/**
 * 알림함 목록 합치기: 서버에서 다시 받은 첫 페이지(fresh)를 기준으로 하고, 이미 더 불러온 이전 항목은 남긴다.
 * 같은 다이제스트는 서버 값(읽음 상태 포함)으로 바꾸고, 최신(id 큰) 순으로 정렬한다
 */
export function mergeDigests(current: Digest[], fresh: Digest[]): Digest[] {
  const byId = new Map(current.map((d) => [d.id, d]))
  for (const d of fresh) byId.set(d.id, d)
  return [...byId.values()].sort((a, b) => Number(b.id) - Number(a.id))
}
