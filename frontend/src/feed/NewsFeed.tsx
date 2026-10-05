import { useCallback, useEffect, useMemo, useState } from 'react'
import { FeedFilterBar } from './FeedFilterBar'
import { emptyFilterState, hasFilters, toFeedFilters, type FeedFilters, type FilterState } from './filters'
import { formatRelativeTime } from './merge'
import { CATEGORY_LABELS } from './types'
import { useNewsFeed, type ConnectionStatus } from './useNewsFeed'
import './NewsFeed.css'

const STATUS_TEXT: Record<ConnectionStatus, string> = {
  connecting: '연결 중',
  connected: '실시간 수신 중',
  disconnected: '연결 끊김 — 다시 연결하는 중',
}

/** 상대 시각("5분 전")이 저절로 갱신되도록 1분마다 다시 그린다 */
function useNow(intervalMs = 60_000): Date {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), intervalMs)
    return () => clearInterval(timer)
  }, [intervalMs])
  return now
}

/** 뉴스 탐색 화면 (F-02 + F-04 검색·필터) */
export function NewsFeed() {
  const [filter, setFilter] = useState<FilterState>(emptyFilterState)
  const filters = useMemo(() => toFeedFilters(filter), [filter])
  const onChange = useCallback((next: FilterState) => setFilter(next), [])

  return (
    <section className="feed" aria-label="실시간 뉴스 피드">
      <h2 className="feed__title">실시간 뉴스</h2>
      <FeedFilterBar value={filter} onChange={onChange} />
      {/* 조건이 바뀌면 목록을 새로 만든다 — 이전 조건의 늦은 응답이 섞이지 않도록 */}
      <FeedResults key={JSON.stringify(filters)} filters={filters} onReset={() => setFilter(emptyFilterState())} />
    </section>
  )
}

function FeedResults({ filters, onReset }: { filters: FeedFilters; onReset: () => void }) {
  const { articles, status, loading, error, highlighted, hasMore, loadMore, loadingMore, moreError, retry } = useNewsFeed(filters)
  const now = useNow()
  const filtered = hasFilters(filters)

  return (
    <>
      <div className="feed__header">
        <span className="feed__count">{filtered ? '검색 결과' : '최신 기사'}</span>
        <span className={`feed__status feed__status--${status}`} role="status">
          <span className="feed__dot" aria-hidden="true" />
          {STATUS_TEXT[status]}
        </span>
      </div>

      {error && (
        <div className="feed__error" role="alert">
          <span>{error}</span>
          <button type="button" className="feed__retry" onClick={() => void retry()}>
            다시 시도
          </button>
        </div>
      )}
      {loading && <p className="feed__empty">기사를 불러오는 중…</p>}
      {!loading && articles.length === 0 && !error && (
        <p className="feed__empty">
          {filtered ? (
            <>
              조건에 맞는 기사가 없습니다.{' '}
              <button type="button" className="feed__reset" onClick={onReset}>
                조건 지우기
              </button>
            </>
          ) : (
            '아직 수집된 기사가 없습니다. 잠시 후 자동으로 표시됩니다.'
          )}
        </p>
      )}

      <ul className="feed__list">
        {articles.map((article) => (
          <li key={article.id} className={`card${highlighted.has(article.id) ? ' card--new' : ''}`}>
            <div className="card__meta">
              <span className="card__category">{CATEGORY_LABELS[article.category] ?? article.category}</span>
              <span>{article.source}</span>
              <time dateTime={article.publishedAt} title={new Date(article.publishedAt).toLocaleString('ko-KR')}>
                {formatRelativeTime(article.publishedAt, now)}
              </time>
            </div>
            <a className="card__title" href={article.originalLink} target="_blank" rel="noopener noreferrer">
              {article.title}
            </a>
            {article.description && <p className="card__description">{article.description}</p>}
          </li>
        ))}
      </ul>

      {moreError && (
        <p className="feed__error" role="alert">
          {moreError}
        </p>
      )}
      {hasMore && articles.length > 0 && (
        <button type="button" className="feed__more" onClick={() => void loadMore()} disabled={loadingMore}>
          {loadingMore ? '불러오는 중…' : moreError ? '다시 시도' : '이전 기사 더 보기'}
        </button>
      )}
    </>
  )
}
