import { useState } from 'react'
import { ApiError } from '../api/client'
import type { FeedArticle } from '../feed/types'
import { Icon, Spinner } from '../ui/Icon'
import { Thumb } from '../ui/Thumb'
import { findPerspectives, type PerspectiveResult } from './api'

interface Props {
  boardId: string
  clusterId: string
  /** 이슈에 기사 카드가 있는지 (메모만 있으면 찾을 수 없다) */
  hasArticles: boolean
  onAdd: (article: FeedArticle) => void
  locked: boolean
}

/**
 * 반대 관점 추천 (F-13): AI 정리 패널의 이슈마다 "다른 시각 찾기".
 * 같은 이슈의 다른 언론사 기사를 보여 주고, AI가 확신한 것만 "다른 시각"으로 이유와 함께 표시한다. 결과는 나에게만 보이고 저장하지 않는다
 */
export function Perspectives({ boardId, clusterId, hasArticles, onAdd, locked }: Props) {
  const [result, setResult] = useState<PerspectiveResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [open, setOpen] = useState(false)
  const [added, setAdded] = useState<Set<string>>(() => new Set())

  const run = async () => {
    if (loading) return
    setOpen(true)
    setLoading(true)
    setError(null)
    try {
      setResult(await findPerspectives(boardId, clusterId))
    } catch (e) {
      setError(e instanceof ApiError ? e.message : '다른 시각을 찾지 못했어요. 잠시 후 다시 시도해 주세요.')
    } finally {
      setLoading(false)
    }
  }

  if (!open)
    return (
      <div className="pv">
        <button
          type="button"
          className="btn btn--ghost btn--xs pv__start"
          onClick={() => void run()}
          disabled={!hasArticles}
          title={hasArticles ? undefined : '기사 카드가 있는 이슈에서만 찾을 수 있어요'}
        >
          <Icon name="search" size={15} />
          다른 시각 찾기
        </button>
      </div>
    )

  return (
    <div className="pv pv--open" aria-live="polite">
      <div className="pv__head">
        <b>다른 시각</b>
        <button type="button" className="icon-btn pv__close" onClick={() => setOpen(false)} aria-label="다른 시각 접기" title="접기">
          <Icon name="close" size={16} />
        </button>
      </div>

      {loading && (
        <span className="pv__state" role="status">
          <Spinner /> 같은 이슈의 다른 언론사 기사를 찾고 비교하는 중이에요…
        </span>
      )}
      {!loading && error && (
        <div className="pv__state" role="alert">
          <span className="field__error">{error}</span>
          <button type="button" className="btn btn--ghost btn--xs" onClick={() => void run()}>
            다시 시도
          </button>
        </div>
      )}
      {!loading && !error && result?.status === 'none' && (
        <span className="pv__state">
          최근 7일 동안 수집한 기사에서 같은 이슈의 다른 언론사 기사를 찾지 못했어요. 사용 횟수는 차감하지 않았어요.
        </span>
      )}
      {!loading && !error && result?.status === 'ok' && (
        <>
          {result.boardView && (
            <p className="pv__view">
              <span>보드 기사</span>
              {result.boardView}
            </p>
          )}
          {!result.judged && (
            <span className="notice notice--warn pv__notice">
              AI 비교에 실패해 같은 이슈의 다른 언론사 기사만 보여 드려요. 사용 횟수는 차감하지 않았어요.
            </span>
          )}
          {result.judged && !result.items.some((i) => i.kind === 'different') && (
            <span className="pv__state">뚜렷하게 다른 시각의 기사는 없었어요. 같은 이슈를 다룬 다른 언론사 기사예요.</span>
          )}
          <ul className="pv__list">
            {result.items.map(({ kind, reason, article }) => (
              <li key={article.id} className={`pv__item${kind === 'different' ? ' pv__item--diff' : ''}`}>
                <div className="pv__body">
                  <span className={`badge${kind === 'different' ? '' : ' badge--neutral'}`}>{kind === 'different' ? '다른 시각' : '다른 언론사'}</span>
                  <a className="pv__title" href={article.originalLink} target="_blank" rel="noopener noreferrer">
                    {article.title}
                  </a>
                  <span className="pv__meta">{article.source}</span>
                  {reason && <span className="pv__reason">{reason}</span>}
                </div>
                <Thumb src={article.imageUrl} className="pv__thumb" />
                <button
                  type="button"
                  className="btn btn--ghost btn--xs pv__add"
                  disabled={locked || added.has(article.id)}
                  onClick={() => {
                    onAdd(article)
                    setAdded((s) => new Set(s).add(article.id))
                  }}
                  aria-label={`${article.title} 보드에 추가`}
                >
                  {added.has(article.id) ? (
                    '추가함'
                  ) : (
                    <>
                      <Icon name="plus" size={14} />
                      추가
                    </>
                  )}
                </button>
              </li>
            ))}
          </ul>
          <p className="pv__disclaimer">
            AI가 기사 제목과 요약을 비교해 추정한 결과예요. 언론사 성향이나 기사의 사실 여부는 판단하지 않아요. 오늘 남은 횟수 {result.remaining}회
          </p>
          <button type="button" className="btn btn--ghost btn--xs" onClick={() => void run()} disabled={loading}>
            <Icon name="refresh" size={14} />
            다시 찾기
          </button>
        </>
      )}
    </div>
  )
}
