import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import { ApiError } from '../api/client'
import { FeedFilterBar } from '../feed/FeedFilterBar'
import { emptyFilterState, hasFilters, toFeedFilters, type FeedFilters, type FilterState } from '../feed/filters'
import { formatRelativeTime } from '../feed/merge'
import { CATEGORY_LABELS, type FeedArticle } from '../feed/types'
import { useNewsFeed, type ConnectionStatus } from '../feed/useNewsFeed'
import { ARTICLE_DRAG_TYPE } from './BoardCanvas'

/**
 * 보드 왼쪽 실시간 뉴스 피드 (F-02 + F-05). 기사를 오른쪽 보드로 끌어다 놓거나 "+ 보드에" 버튼으로 추가한다.
 * 검색창·카테고리로 서버에서 걸러 받는다 (F-04)
 */
export function FeedPanel({
  onAdd,
  onSubmitLink,
  linkRemaining,
  now,
}: {
  onAdd: (article: FeedArticle) => void
  /** 링크 요약 카드 추가 (F-03). 실패하면 던진다 */
  onSubmitLink: (url: string) => Promise<void>
  /** 오늘 남은 AI 요약 횟수 (모르면 null) */
  linkRemaining: number | null
  now: Date
}) {
  const [filter, setFilter] = useState<FilterState>(emptyFilterState)
  const filters = useMemo(() => toFeedFilters(filter), [filter])
  const onChange = useCallback((next: FilterState) => setFilter(next), [])
  const [status, setStatus] = useState<ConnectionStatus>('connecting')

  return (
    <aside className="feed-panel" aria-label="실시간 뉴스 피드">
      <div className="feed-panel__head">
        <div className="feed-panel__title-row">
          <h2 className="feed-panel__title">실시간 뉴스 피드</h2>
          <span className={`feed-panel__live feed-panel__live--${status}`} title={status === 'connected' ? '실시간 수신 중' : '다시 연결하는 중'}>
            <span className="feed-panel__dot" aria-hidden="true" />
            {status === 'connected' ? 'LIVE' : '연결 중'}
          </span>
        </div>
        <FeedFilterBar value={filter} onChange={onChange} compact />
      </div>

      {/* 조건이 바뀌면 목록을 새로 만든다 — 이전 조건의 늦은 응답이 섞이지 않도록 */}
      <PanelList key={JSON.stringify(filters)} filters={filters} onAdd={onAdd} onStatus={setStatus} now={now} />

      {/* 피드가 길어도 항상 보이도록 목록 아래에 고정 */}
      <div className="feed-panel__link">
        <LinkBox onSubmit={onSubmitLink} remaining={linkRemaining} />
      </div>
      <div className="feed-panel__foot">카드를 오른쪽 보드로 끌어다 놓으세요</div>
    </aside>
  )
}

function PanelList({
  filters,
  onAdd,
  onStatus,
  now,
}: {
  filters: FeedFilters
  onAdd: (article: FeedArticle) => void
  onStatus: (status: ConnectionStatus) => void
  now: Date
}) {
  const { articles, status, loading, error, highlighted, hasMore, loadMore, loadingMore, moreError, retry } = useNewsFeed(filters)
  useEffect(() => onStatus(status), [status, onStatus])

  return (
    <div className="feed-panel__list">
      {error && (
        <div className="feed-panel__error" role="alert">
          <span>{error}</span>
          <button type="button" onClick={() => void retry()}>
            다시 시도
          </button>
        </div>
      )}
      {loading && <p className="feed-panel__empty">기사를 불러오는 중…</p>}
      {!loading && articles.length === 0 && !error && (
        <p className="feed-panel__empty">{hasFilters(filters) ? '조건에 맞는 기사가 없습니다' : '아직 수집된 기사가 없습니다'}</p>
      )}

      {articles.map((article) => (
        <article
          key={article.id}
          className={`feed-item${highlighted.has(article.id) ? ' feed-item--new' : ''}`}
          draggable
          onDragStart={(e) => {
            e.dataTransfer.setData(ARTICLE_DRAG_TYPE, JSON.stringify(article))
            e.dataTransfer.effectAllowed = 'copy'
          }}
        >
          <div className="feed-item__meta-row">
            <span className="feed-item__cat">{CATEGORY_LABELS[article.category] ?? article.category}</span>
            {highlighted.has(article.id) && <span className="feed-item__new">NEW</span>}
            <button type="button" className="feed-item__add" onClick={() => onAdd(article)} title="보드 가운데에 추가">
              + 보드에
            </button>
          </div>
          <a className="feed-item__title" href={article.originalLink} target="_blank" rel="noopener noreferrer" draggable={false}>
            {article.title}
          </a>
          <div className="feed-item__meta">
            {article.source} · {formatRelativeTime(article.publishedAt, now)}
          </div>
        </article>
      ))}

      {moreError && (
        <p className="feed-panel__error" role="alert">
          {moreError}
        </p>
      )}
      {hasMore && articles.length > 0 && (
        <button type="button" className="feed-panel__more" onClick={() => void loadMore()} disabled={loadingMore}>
          {loadingMore ? '불러오는 중…' : moreError ? '다시 시도' : '이전 기사 더 보기'}
        </button>
      )}
    </div>
  )
}

/** 수집되지 않은 기사를 링크로 추가 (F-03, 디자인 목업의 "AI 요약" 상자) */
function LinkBox({ onSubmit, remaining }: { onSubmit: (url: string) => Promise<void>; remaining: number | null }) {
  const [url, setUrl] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (!url.trim() || busy) return
    setBusy(true)
    setError(null)
    try {
      await onSubmit(url.trim())
      setUrl('')
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '링크를 추가하지 못했습니다. 잠시 후 다시 시도해 주세요')
    } finally {
      setBusy(false)
    }
  }

  return (
    <form className="link-box" onSubmit={submit}>
      <div className="link-box__label">수집되지 않은 기사는 링크를 붙여넣으세요</div>
      <div className="link-box__row">
        <input
          type="url"
          inputMode="url"
          placeholder="https://..."
          value={url}
          maxLength={2000}
          onChange={(e) => setUrl(e.target.value)}
          disabled={busy}
          aria-label="기사 주소"
        />
        <button type="submit" disabled={busy || !url.trim()}>
          {busy ? '요약 중…' : 'AI 요약'}
        </button>
      </div>
      {error && (
        <p className="link-box__error" role="alert">
          {error}
        </p>
      )}
      {remaining !== null && <div className="link-box__quota">오늘 남은 AI 요약 {remaining}회</div>}
    </form>
  )
}
