import { useCallback, useMemo, useRef, useState } from 'react'
import { useNow } from '../ui/hooks'
import { Icon, Spinner } from '../ui/Icon'
import { ArticlePreview } from './ArticlePreview'
import { BoardPickerDialog } from './BoardPickerDialog'
import { FeedFilterBar } from './FeedFilterBar'
import { emptyFilterState, hasFilters, toFeedFilters, type FeedFilters, type FilterState } from './filters'
import { formatRelativeTime } from './merge'
import { CATEGORY_LABELS, type FeedArticle } from './types'
import { useNewsFeed, type ConnectionStatus } from './useNewsFeed'
import './NewsFeed.css'
import { Thumb } from '../ui/Thumb'

const STATUS: Record<ConnectionStatus, { text: string; tone: string }> = {
  connecting: { text: '연결 중', tone: 'wait' },
  connected: { text: '실시간 수신 중', tone: 'live' },
  disconnected: { text: '연결이 끊겼어요 · 다시 연결 중', tone: 'off' },
}

/** 뉴스 화면 (F-02 실시간 + F-04 검색·필터, 보라 테마 프로토타입) */
export function NewsFeed() {
  const [filter, setFilter] = useState<FilterState>(emptyFilterState)
  const filters = useMemo(() => toFeedFilters(filter), [filter])
  const onChange = useCallback((next: FilterState) => setFilter(next), [])
  const [preview, setPreview] = useState<FeedArticle | null>(null)
  const [picking, setPicking] = useState<FeedArticle | null>(null)
  const closePreview = useCallback(() => setPreview(null), [])
  const scrollRef = useRef<HTMLElement>(null)

  return (
    <main className="news" ref={scrollRef}>
      <div className="news__inner">
        {/* 조건이 바뀌면 목록을 새로 만든다 — 이전 조건의 늦은 응답이 섞이지 않도록 */}
        <FeedResults
          key={JSON.stringify(filters)}
          filters={filters}
          filterBar={<FeedFilterBar value={filter} onChange={onChange} />}
          onReset={() => setFilter(emptyFilterState())}
          onOpen={setPreview}
          onAdd={setPicking}
          scrollTop={() => scrollRef.current?.scrollTo({ top: 0 })}
        />
      </div>
      {preview && (
        <ArticlePreview
          article={preview}
          onClose={closePreview}
          onAdd={() => {
            setPicking(preview)
            setPreview(null)
          }}
        />
      )}
      {picking && <BoardPickerDialog article={picking} onClose={() => setPicking(null)} />}
    </main>
  )
}

function FeedResults({
  filters,
  filterBar,
  onReset,
  onOpen,
  onAdd,
  scrollTop,
}: {
  filters: FeedFilters
  filterBar: React.ReactNode
  onReset: () => void
  onOpen: (article: FeedArticle) => void
  onAdd: (article: FeedArticle) => void
  scrollTop: () => void
}) {
  const feed = useNewsFeed(filters, { holdNew: true })
  const { articles, status, loading, error, highlighted, hasMore, loadMore, loadingMore, moreError, retry, pending, showPending } = feed
  const now = useNow()
  const filtered = hasFilters(filters)
  const conn = STATUS[status]

  return (
    <>
      <div className="news__head">
        <h1>뉴스</h1>
        <span className={`news__status news__status--${conn.tone}`} role="status">
          <span className="status-dot" aria-hidden="true" />
          {conn.text}
        </span>
      </div>
      {filterBar}

      {/* 새 기사는 바로 끼워 넣지 않고 눌렀을 때만 위에 넣는다 — 읽던 위치 유지 (B5) */}
      {pending.length > 0 && !loading && (
        <div className="news__pending">
          <button
            type="button"
            onClick={() => {
              showPending()
              scrollTop()
            }}
          >
            ↑ 새 기사 {pending.length}건
          </button>
        </div>
      )}

      {loading && (
        <div className="news__list" aria-busy="true" aria-label="기사를 불러오는 중">
          {Array.from({ length: 5 }, (_, i) => (
            <div key={i} className="news__item">
              <div className="skeleton" style={{ height: 12, width: '30%' }} />
              <div className="skeleton" style={{ height: 18, width: '80%' }} />
              <div className="skeleton" style={{ height: 12, width: '60%' }} />
            </div>
          ))}
        </div>
      )}

      {error && !loading && articles.length === 0 && (
        <div className="empty-state news__state" role="alert">
          <span className="news__state-icon">
            <Icon name="alert" />
          </span>
          <h2>기사를 불러오지 못했어요.</h2>
          <p>잠시 후 다시 시도해 주세요.</p>
          <button type="button" className="btn btn--ghost" onClick={() => void retry()}>
            다시 시도
          </button>
        </div>
      )}
      {error && articles.length > 0 && (
        <div className="notice notice--err news__inline-error" role="alert">
          <Icon name="alert" />
          <span>새 기사를 받아 오지 못했어요.</span>
          <button type="button" className="btn btn--ghost btn--xs" onClick={() => void retry()}>
            다시 시도
          </button>
        </div>
      )}

      {!loading && !error && articles.length === 0 &&
        (filtered ? (
          <div className="empty-state news__state news__state--solid">
            <h2>조건에 맞는 기사가 없어요.</h2>
            <p>검색어를 바꾸거나 필터를 줄여 보세요.</p>
            <button type="button" className="btn btn--ghost btn--sm" onClick={onReset}>
              필터 초기화
            </button>
          </div>
        ) : (
          <div className="empty-state news__state">
            <h2>아직 표시할 기사가 없어요.</h2>
            <p>기사가 수집되면 이곳에 바로 보여 드릴게요.</p>
          </div>
        ))}

      {articles.length > 0 && (
        <>
          <ol className="news__list" aria-label="기사 목록">
            {articles.map((article) => (
              <li key={article.id} className={`news__item${highlighted.has(article.id) ? ' news__item--new' : ''}`}>
                <div className="news__item-row">
                  <div className="news__item-text">
                    <div className="news__meta">
                      <b>{article.source}</b>
                      <span aria-hidden="true">·</span>
                      <span>{CATEGORY_LABELS[article.category] ?? article.category}</span>
                      <span aria-hidden="true">·</span>
                      <time dateTime={article.publishedAt} title={new Date(article.publishedAt).toLocaleString('ko-KR')}>
                        {formatRelativeTime(article.publishedAt, now)}
                      </time>
                      {highlighted.has(article.id) && <span className="news__new">새 기사</span>}
                    </div>
                    <button type="button" className="news__title" onClick={() => onOpen(article)}>
                      {article.title}
                    </button>
                    {article.description && <p className="news__desc">{article.description}</p>}
                  </div>
                  <Thumb src={article.imageUrl} className="news__thumb" />
                </div>
                <div className="news__actions">
                  <a className="news__origin" href={article.originalLink} target="_blank" rel="noopener noreferrer">
                    원문 보기 <Icon name="ext" size={15} />
                  </a>
                  <button type="button" className="news__add" onClick={() => onAdd(article)}>
                    <Icon name="plus" />
                    보드에 추가
                  </button>
                </div>
              </li>
            ))}
          </ol>
          <div className="news__more">
            {moreError ? (
              <div className="notice notice--err" role="alert">
                <Icon name="alert" />
                <span>이전 기사를 불러오지 못했어요.</span>
                <button type="button" className="btn btn--ghost btn--xs" onClick={() => void loadMore()} disabled={loadingMore}>
                  다시 시도
                </button>
              </div>
            ) : loadingMore ? (
              <span className="news__more-loading" role="status">
                <Spinner />
                이전 기사를 불러오는 중…
              </span>
            ) : hasMore ? (
              <button type="button" className="btn btn--ghost" onClick={() => void loadMore()}>
                이전 기사 더 보기
              </button>
            ) : (
              <span className="news__end">더 불러올 기사가 없어요.</span>
            )}
          </div>
        </>
      )}
    </>
  )
}
