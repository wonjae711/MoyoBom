import { useEffect, useState } from 'react'
import { apiFetch } from '../api/client'
import { PERIOD_LABELS, type FilterState, type Period } from './filters'
import { CATEGORY_LABELS, type CategoryCode } from './types'
import './FeedFilterBar.css'

const CATEGORY_CODES = Object.keys(CATEGORY_LABELS) as CategoryCode[]
/** 입력을 멈추고 이만큼 지나면 검색한다 */
const SEARCH_DELAY_MS = 400

/**
 * 기사 검색·필터 (F-04). 디자인 목업 "뉴스 피드"의 검색창·카테고리 칩.
 * compact(보드 왼쪽 패널)에서는 검색창과 카테고리만, 뉴스 탐색 화면에서는 언론사·기간도 고른다
 */
export function FeedFilterBar({
  value,
  onChange,
  compact = false,
}: {
  value: FilterState
  onChange: (next: FilterState) => void
  compact?: boolean
}) {
  const [text, setText] = useState(value.q)
  const [sources, setSources] = useState<{ source: string; count: number }[]>([])

  // 입력이 멈추면 검색 (글자마다 서버에 묻지 않도록)
  useEffect(() => {
    if (text === value.q) return
    const timer = setTimeout(() => onChange({ ...value, q: text }), SEARCH_DELAY_MS)
    return () => clearTimeout(timer)
  }, [text, value, onChange])

  useEffect(() => {
    if (compact) return
    apiFetch<{ sources: { source: string; count: number }[] }>('/api/articles/sources')
      .then((r) => setSources(r.sources))
      .catch(() => setSources([]))
  }, [compact])

  return (
    <div className={`filter-bar${compact ? ' filter-bar--compact' : ''}`}>
      <input
        type="search"
        className="filter-bar__search"
        placeholder="키워드로 검색 (예: 수출 규제, 호르무즈)"
        value={text}
        maxLength={100}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') onChange({ ...value, q: text })
        }}
        aria-label="기사 검색"
      />
      <div className="filter-bar__chips" role="tablist" aria-label="카테고리">
        <button
          type="button"
          role="tab"
          aria-selected={!value.category}
          className={`chip${!value.category ? ' chip--on' : ''}`}
          onClick={() => onChange({ ...value, category: undefined })}
        >
          전체
        </button>
        {CATEGORY_CODES.map((code) => (
          <button
            key={code}
            type="button"
            role="tab"
            aria-selected={value.category === code}
            className={`chip${value.category === code ? ' chip--on' : ''}`}
            onClick={() => onChange({ ...value, category: code })}
          >
            {CATEGORY_LABELS[code]}
          </button>
        ))}
      </div>
      {!compact && (
        <div className="filter-bar__selects">
          <select
            value={value.source ?? ''}
            onChange={(e) => onChange({ ...value, source: e.target.value || undefined })}
            aria-label="언론사"
          >
            <option value="">모든 언론사</option>
            {value.source && !sources.some((s) => s.source === value.source) && (
              <option value={value.source}>{value.source}</option>
            )}
            {sources.map((s) => (
              <option key={s.source} value={s.source}>
                {s.source} ({s.count})
              </option>
            ))}
          </select>
          <select value={value.period} onChange={(e) => onChange({ ...value, period: e.target.value as Period })} aria-label="기간">
            {(Object.keys(PERIOD_LABELS) as Period[]).map((p) => (
              <option key={p} value={p}>
                {PERIOD_LABELS[p]}
              </option>
            ))}
          </select>
        </div>
      )}
    </div>
  )
}
