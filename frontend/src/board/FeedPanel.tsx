import { useState } from 'react'
import { formatRelativeTime } from '../feed/merge'
import { CATEGORY_LABELS, type CategoryCode, type FeedArticle } from '../feed/types'
import { useNewsFeed } from '../feed/useNewsFeed'
import { ARTICLE_DRAG_TYPE } from './BoardCanvas'

const TABS: ('all' | CategoryCode)[] = ['all', ...(Object.keys(CATEGORY_LABELS) as CategoryCode[])]

/**
 * 보드 왼쪽 실시간 뉴스 피드 (F-02 + F-05). 기사를 오른쪽 보드로 끌어다 놓거나 "+ 보드에" 버튼으로 추가한다.
 * 카테고리 탭은 받아 둔 기사 안에서 거른다.
 */
export function FeedPanel({ onAdd, now }: { onAdd: (article: FeedArticle) => void; now: Date }) {
  const { articles, status, loading, error, highlighted, hasMore, loadMore, retry } = useNewsFeed()
  const [tab, setTab] = useState<'all' | CategoryCode>('all')
  const visible = tab === 'all' ? articles : articles.filter((a) => a.category === tab)

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
        <div className="feed-panel__tabs" role="tablist">
          {TABS.map((t) => (
            <button
              key={t}
              type="button"
              role="tab"
              aria-selected={tab === t}
              className={`chip${tab === t ? ' chip--on' : ''}`}
              onClick={() => setTab(t)}
            >
              {t === 'all' ? '전체' : CATEGORY_LABELS[t]}
            </button>
          ))}
        </div>
      </div>

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
        {!loading && visible.length === 0 && !error && <p className="feed-panel__empty">이 카테고리의 기사가 아직 없습니다</p>}

        {visible.map((article) => (
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

        {hasMore && tab === 'all' && visible.length > 0 && (
          <button type="button" className="feed-panel__more" onClick={() => void loadMore()}>
            이전 기사 더 보기
          </button>
        )}
      </div>

      <div className="feed-panel__foot">카드를 오른쪽 보드로 끌어다 놓으세요</div>
    </aside>
  )
}
