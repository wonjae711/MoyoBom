import { describe, expect, it } from 'vitest'
import { arrangeOutcome } from './arrangeOutcome'

describe('[F-08] AI 정리 전체 정렬·복원 결과 안내 (Codex 281c5f2 리뷰 3)', () => {
  it('두 이슈 중 하나가 실패하면 성공처럼 알리지 않고 부분 실패를 알린다', () => {
    const out = arrangeOutcome(
      [
        { ok: true, moved: 3 },
        { ok: false, moved: 0 },
      ],
      'arrange',
    )
    expect(out?.tone).toBe('err')
    expect(out?.text).toContain('2개 중 1개는 정렬하지 못했어요')
  })

  it('전부 실패한 복원은 "되돌릴 카드 없음"과 다르게 알린다', () => {
    expect(arrangeOutcome([{ ok: false, moved: 0 }], 'restore')).toEqual({
      tone: 'err',
      text: '정렬 전 위치로 되돌리지 못했어요. 다시 시도해 주세요.',
    })
    expect(arrangeOutcome([{ ok: true, moved: 0 }], 'restore')?.tone).toBe('info')
  })

  it('모두 성공하면 성공, 할 일이 없으면 알리지 않는다', () => {
    expect(arrangeOutcome([{ ok: true, moved: 2 }], 'arrange')).toEqual({ tone: 'ok', text: '이슈별로 카드를 정렬했어요.' })
    expect(arrangeOutcome([], 'arrange')).toBeNull()
  })
})
