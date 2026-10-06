import { useCallback, useMemo, useState } from 'react'
import { FeedFilterBar } from '../feed/FeedFilterBar'
import { emptyFilterState, hasFilters, toFeedFilters, type FeedFilters, type FilterState } from '../feed/filters'
import { formatRelativeTime } from '../feed/merge'
import type { FeedArticle } from '../feed/types'
import { useNewsFeed } from '../feed/useNewsFeed'
import { Icon, Spinner } from '../ui/Icon'
import { ARTICLE_DRAG_TYPE } from './BoardCanvas'

/**
 * 보드 왼쪽 "뉴스에서 찾기" (F-02·F-05, 보라 테마 프로토타입). 기사를 보드로 끌어 놓거나 "추가" 버튼(키보드 가능)으로 추가한다.
 * 제목을 누르면 오른쪽에 기사 미리보기. 검색창·카테고리로 서버에서 걸러 받는다 (F-04). 접을 수 있다
 */
export function FeedPanel({
  onAdd,
  onOpen,
  onCollapse,
  locked,
  now,
}: {
  onAdd: (article: FeedArticle) => void
  onOpen: (article: FeedArticle) => void
  onCollapse: () => void
  locked: boolean
  now: Date
}) {
  const [filter, setFilter] = useState<FilterState>(emptyFilterState)
  const filters = useMemo(() => toFeedFilters(filter), [filter])
  const onChange = useCallback((next: FilterState) => setFilter(next), [])

  return (
    <aside className="news-panel" aria-label="뉴스에서 찾기">
      <div className="news-panel__head">
        <h2>뉴스에서 찾기</h2>
        <button type="button" className="icon-btn" onClick={onCollapse} aria-label="뉴스 패널 접기" title="뉴스 패널 접기">
          <Icon name="panel" />
        </button>
      </div>
      <div className="news-panel__filters">
        <FeedFilterBar value={filter} onChange={onChange} compact />
        <span className="news-panel__hint">기사를 보드로 끌어 놓거나 추가 버튼을 눌러요.</span>
      </div>
      {/* 조건이 바뀌면 목록을 새로 만든다 — 이전 조건의 늦은 응답이 섞이지 않도록 */}
      <PanelList key={JSON.stringify(filters)} filters={filters} onAdd={onAdd} onOpen={onOpen} locked={locked} now={now} />
    </aside>
  )
}

function PanelList({
  filters,
  onAdd,
  onOpen,
  locked,
  now,
}: {
  filters: FeedFilters
  onAdd: (article: FeedArticle) => void
  onOpen: (article: FeedArticle) => void
  locked: boolean
  now: Date
}) {
  const { articles, loading, error, highlighted, hasMore, loadMore, loadingMore, moreError, retry } = useNewsFeed(filters)

  return (
    <ul className="news-panel__list">
      {error && (
        <li className="news-panel__state" role="alert">
          <span>기사를 불러오지 못했어요.</span>
          <button type="button" className="btn btn--ghost btn--xs" onClick={() => void retry()}>
            다시 시도
          </button>
        </li>
      )}
      {loading && (
        <li className="news-panel__state" role="status">
          <Spinner /> 기사를 불러오는 중…
        </li>
      )}
      {!loading && articles.length === 0 && !error && (
        <li className="news-panel__state">{hasFilters(filters) ? '조건에 맞는 기사가 없어요.' : '아직 수집된 기사가 없어요.'}</li>
      )}

      {articles.map((article) => (
        <li
          key={article.id}
          className={`news-panel__item${highlighted.has(article.id) ? ' news-panel__item--new' : ''}`}
          draggable={!locked}
          onDragStart={(e) => {
            e.dataTransfer.setData(ARTICLE_DRAG_TYPE, JSON.stringify(article))
            e.dataTransfer.effectAllowed = 'copy'
          }}
        >
          <span className="news-panel__grip" aria-hidden="true">
            <Icon name="drag" size={16} />
          </span>
          <div className="news-panel__body">
            <span className="news-panel__meta">
              <b>{article.source}</b> · {formatRelativeTime(article.publishedAt, now)}
            </span>
            <button type="button" className="news-panel__title" onClick={() => onOpen(article)}>
              {article.title}
            </button>
          </div>
          <button
            type="button"
            className="news-panel__add"
            onClick={() => onAdd(article)}
            disabled={locked}
            aria-label={`${article.title} 보드에 추가`}
          >
            <Icon name="plus" size={16} />
            추가
          </button>
        </li>
      ))}

      {articles.length > 0 && (moreError || hasMore) && (
        <li className="news-panel__more">
          {moreError && <span className="field__error">이전 기사를 불러오지 못했어요.</span>}
          <button type="button" className="btn btn--ghost btn--xs" onClick={() => void loadMore()} disabled={loadingMore}>
            {loadingMore ? '불러오는 중…' : moreError ? '다시 시도' : '이전 기사 더 보기'}
          </button>
        </li>
      )}
    </ul>
  )
}
