import { useEffect, useState } from 'react'
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

export function NewsFeed() {
  const { articles, status, loading, error, highlighted, hasMore, loadMore } = useNewsFeed()
  const now = useNow()

  return (
    <section className="feed" aria-label="실시간 뉴스 피드">
      <header className="feed__header">
        <h2 className="feed__title">실시간 뉴스</h2>
        <span className={`feed__status feed__status--${status}`} role="status">
          <span className="feed__dot" aria-hidden="true" />
          {STATUS_TEXT[status]}
        </span>
      </header>

      {error && <p className="feed__error">{error}</p>}
      {loading && <p className="feed__empty">기사를 불러오는 중…</p>}
      {!loading && articles.length === 0 && !error && (
        <p className="feed__empty">아직 수집된 기사가 없습니다. 잠시 후 자동으로 표시됩니다.</p>
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

      {hasMore && articles.length > 0 && (
        <button type="button" className="feed__more" onClick={() => void loadMore()}>
          이전 기사 더 보기
        </button>
      )}
    </section>
  )
}
