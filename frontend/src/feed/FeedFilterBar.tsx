import { useEffect, useRef, useState } from 'react'
import { apiFetch } from '../api/client'
import { Icon } from '../ui/Icon'
import { PERIOD_LABELS, emptyFilterState, type FilterState, type Period } from './filters'
import { CATEGORY_LABELS, type CategoryCode } from './types'
import './FeedFilterBar.css'

const CATEGORY_CODES = Object.keys(CATEGORY_LABELS) as CategoryCode[]
/** 입력을 멈추고 이만큼 지나면 검색한다 */
const SEARCH_DELAY_MS = 400

/**
 * 기사 검색·필터 (F-04, 보라 테마 프로토타입).
 * 뉴스 화면: 검색창 + "언론사·기간" 팝업(언론사 여러 곳 체크, 기간 하나) + 카테고리 칩 + 적용된 조건 칩·필터 초기화.
 * compact(보드 왼쪽 뉴스 패널): 검색창과 카테고리만
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
  const [open, setOpen] = useState(false)
  const popRef = useRef<HTMLDivElement>(null)

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

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => popRef.current && !popRef.current.contains(e.target as Node) && setOpen(false)
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    window.addEventListener('mousedown', onDown)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('mousedown', onDown)
      window.removeEventListener('keydown', onKey)
    }
  }, [open])

  const search = (
    <div className="search filter-bar__search">
      <Icon name="search" />
      <input
        type="search"
        className={`input${compact ? ' input--sm' : ''}`}
        placeholder={compact ? '기사 검색' : '제목·요약에서 검색'}
        value={text}
        maxLength={100}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') onChange({ ...value, q: text })
        }}
        aria-label="뉴스 검색"
      />
    </div>
  )

  const categories = (
    <div className="filter-bar__chips" role={compact ? 'group' : 'tablist'} aria-label="카테고리">
      {([undefined, ...CATEGORY_CODES] as (CategoryCode | undefined)[]).map((code) => {
        const on = value.category === code
        return (
          <button
            key={code ?? 'all'}
            type="button"
            role={compact ? undefined : 'tab'}
            aria-selected={compact ? undefined : on}
            aria-pressed={compact ? on : undefined}
            className={`chip${compact ? ' chip--sm' : ''}${on ? ' chip--on' : ''}`}
            onClick={() => onChange({ ...value, category: code })}
          >
            {code ? CATEGORY_LABELS[code] : '전체'}
          </button>
        )
      })}
    </div>
  )

  if (compact)
    return (
      <div className="filter-bar filter-bar--compact">
        {search}
        {categories}
      </div>
    )

  const filterCount = value.sources.length + (value.period !== 'all' ? 1 : 0)
  // 목록에 없는 언론사(이전에 고른 것)도 체크를 풀 수 있게 보여 준다
  const sourceNames = [...new Set([...sources.map((s) => s.source), ...value.sources])]
  const active: { label: string; aria: string; remove: () => void }[] = []
  if (value.q.trim())
    active.push({
      label: `검색: ${value.q.trim()}`,
      aria: '검색어 지우기',
      remove: () => {
        setText('')
        onChange({ ...value, q: '' })
      },
    })
  if (value.category)
    active.push({
      label: CATEGORY_LABELS[value.category],
      aria: `${CATEGORY_LABELS[value.category]} 조건 지우기`,
      remove: () => onChange({ ...value, category: undefined }),
    })
  for (const source of value.sources)
    active.push({
      label: source,
      aria: `${source} 조건 지우기`,
      remove: () => onChange({ ...value, sources: value.sources.filter((s) => s !== source) }),
    })
  if (value.period !== 'all')
    active.push({ label: PERIOD_LABELS[value.period], aria: '기간 조건 지우기', remove: () => onChange({ ...value, period: 'all' }) })

  return (
    <div className="filter-bar">
      <div className="filter-bar__row">
        {search}
        <div className="filter-bar__pop" ref={popRef}>
          <button
            type="button"
            className={`btn btn--ghost filter-bar__toggle${filterCount ? ' filter-bar__toggle--on' : ''}`}
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
          >
            <Icon name="filter" />
            {filterCount ? `필터 ${filterCount}` : '언론사·기간'}
          </button>
          {open && (
            <div className="filter-bar__panel" role="dialog" aria-label="언론사·기간 필터">
              <fieldset>
                <legend>언론사</legend>
                {sourceNames.length === 0 && <span className="filter-bar__none">아직 언론사 목록이 없어요.</span>}
                <div className="filter-bar__options">
                  {sourceNames.map((name) => (
                    <label key={name}>
                      <input
                        type="checkbox"
                        checked={value.sources.includes(name)}
                        onChange={() =>
                          onChange({
                            ...value,
                            sources: value.sources.includes(name) ? value.sources.filter((s) => s !== name) : [...value.sources, name],
                          })
                        }
                      />
                      {name}
                    </label>
                  ))}
                </div>
              </fieldset>
              <fieldset>
                <legend>발행 기간</legend>
                {(Object.keys(PERIOD_LABELS) as Period[]).map((p) => (
                  <label key={p}>
                    <input type="radio" name="feed-period" checked={value.period === p} onChange={() => onChange({ ...value, period: p })} />
                    {PERIOD_LABELS[p]}
                  </label>
                ))}
              </fieldset>
            </div>
          )}
        </div>
      </div>
      {categories}
      {active.length > 0 && (
        <div className="filter-bar__active">
          <span>적용된 조건</span>
          {active.map((a) => (
            <button key={a.label} type="button" className="filter-bar__active-chip" onClick={a.remove} aria-label={a.aria}>
              {a.label}
              <Icon name="close" size={14} />
            </button>
          ))}
          <button
            type="button"
            className="text-btn filter-bar__reset"
            onClick={() => {
              setText('')
              onChange(emptyFilterState())
            }}
          >
            필터 초기화
          </button>
        </div>
      )}
    </div>
  )
}
