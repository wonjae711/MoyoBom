import type { BoardItem } from './types'

/** 이보다 기사 카드가 적으면 표시하지 않는다 (requirements.md F-11 예외 처리: 1~2개면 의미 없음) */
export const MIN_ARTICLES_FOR_DIVERSITY = 3
/** 한 언론사가 이 비율 이상이면 편중으로 알린다 */
export const SKEW_RATIO = 0.5

export interface SourceShare {
  source: string
  count: number
  ratio: number
}

export interface Diversity {
  total: number
  /** 많은 순 (같으면 이름 순) */
  sources: SourceShare[]
  /** 가장 많은 언론사가 절반 이상이면 그 언론사 */
  skewedTo: string | null
}

/**
 * 출처 다양성 (F-11): 보드의 기사 카드를 언론사별로 센다.
 * 보드에 있는 카드만 세므로 실시간 변경이 바로 반영된다. 같은 기사를 두 번 올리면 한 번만 센다.
 */
export function sourceDiversity(items: BoardItem[]): Diversity | null {
  const seen = new Set<string>()
  const counts = new Map<string, number>()
  for (const item of items) {
    if (item.type !== 'article' || !item.article || !item.articleId || seen.has(item.articleId)) continue
    seen.add(item.articleId)
    const source = item.article.source || '알 수 없음'
    counts.set(source, (counts.get(source) ?? 0) + 1)
  }
  const total = seen.size
  if (total < MIN_ARTICLES_FOR_DIVERSITY) return null
  const sources = [...counts]
    .map(([source, count]) => ({ source, count, ratio: count / total }))
    .sort((a, b) => b.count - a.count || a.source.localeCompare(b.source, 'ko'))
  const top = sources[0]!
  return { total, sources, skewedTo: top.ratio >= SKEW_RATIO ? top.source : null }
}
