/** 클러스터 하나의 자동 정렬·복원 결과 */
export interface ArrangeResult {
  ok: boolean
  /** 옮겨진 카드 수 */
  moved: number
}

/**
 * 여러 클러스터에 차례로 "자동 정렬"/"복원"한 결과를 알림 문구로 (Codex 281c5f2 리뷰 3).
 * 성공·실패·바뀐 것 없음을 나눠, 일부만 실패하면 성공처럼 보이지 않게 한다
 */
export function arrangeOutcome(
  results: ArrangeResult[],
  action: 'arrange' | 'restore',
): { tone: 'ok' | 'info' | 'err'; text: string } | null {
  if (results.length === 0) return null
  const failed = results.filter((r) => !r.ok).length
  const moved = results.reduce((sum, r) => sum + (r.ok ? r.moved : 0), 0)
  const verb = action === 'arrange' ? '정렬' : '복원'
  if (failed === results.length)
    return { tone: 'err', text: action === 'arrange' ? '자동 정렬하지 못했어요. 다시 시도해 주세요.' : '정렬 전 위치로 되돌리지 못했어요. 다시 시도해 주세요.' }
  if (failed > 0)
    return {
      tone: 'err',
      text: `이슈 ${results.length}개 중 ${failed}개는 ${verb}하지 못했어요. 나머지는 ${verb}했어요. 다시 누르면 남은 이슈만 다시 시도해요.`,
    }
  if (moved === 0)
    return action === 'arrange'
      ? { tone: 'info', text: '이미 정렬된 위치예요.' }
      : { tone: 'info', text: '되돌릴 카드가 없어요. 정렬 뒤 직접 옮긴 카드는 그대로 둬요.' }
  return { tone: 'ok', text: action === 'arrange' ? '이슈별로 카드를 정렬했어요.' : '자동 정렬 전 위치로 되돌렸어요.' }
}
