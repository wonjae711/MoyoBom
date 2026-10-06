import { formatDateTime } from '../feed/merge'
import { Icon, Spinner } from '../ui/Icon'
import type { BoardCluster } from './types'
import type { ViewItem } from './useBoardSync'

/** 오른쪽 패널 틀: 제목 + 닫기, 본문은 children */
export function SidePanel({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <aside className="side" aria-label={title}>
      <div className="side__head">
        <h2>{title}</h2>
        <button type="button" className="icon-btn" onClick={onClose} aria-label="패널 닫기" title="패널 닫기">
          <Icon name="close" />
        </button>
      </div>
      {children}
    </aside>
  )
}

/** 미리보기에 보여 줄 기사 (보드 카드든 왼쪽 뉴스 기사든) */
export interface DetailArticle {
  title: string
  source: string
  category: string
  publishedAt: string | null
  collectedAt: string
  description: string
  originalLink: string
  /** 링크로 추가한 기사 (자동 요약) */
  submitted: boolean
}

/**
 * 기사 미리보기 (B8): 출처·발행·수집 시각과 설명. 링크로 추가한 기사는 자동 요약임을 밝힌다.
 * 왼쪽 뉴스에서 연 기사는 "이 보드에 추가"
 */
export function ArticleDetail({ article: a, onAdd, locked }: { article: DetailArticle; onAdd?: () => void; locked?: boolean }) {
  return (
    <div className="side__body">
      <span className="detail__category">기사 · {a.category}</span>
      <h3 className="detail__title">{a.title}</h3>
      <dl className="detail__meta">
        <dt>출처</dt>
        <dd>
          <b>{a.source}</b>
        </dd>
        <dt>발행</dt>
        <dd>{a.publishedAt ? formatDateTime(a.publishedAt) : '확인 불가'}</dd>
        <dt>수집</dt>
        <dd>{formatDateTime(a.collectedAt)}</dd>
      </dl>
      <div className="detail__desc">
        <span>
          {a.submitted ? '링크 요약' : '기사 설명'}
          {a.submitted && <span className="card__ai">자동 생성</span>}
        </span>
        <p>{a.description || '제공된 설명이 없어요.'}</p>
      </div>
      {a.submitted && <p className="detail__note">자동 요약은 틀릴 수 있어요. 중요한 내용은 원문에서 확인해 주세요.</p>}
      <div className="detail__actions">
        <a className="btn btn--ghost" href={a.originalLink} target="_blank" rel="noopener noreferrer">
          원문 보기 (새 탭) <Icon name="ext" size={15} />
        </a>
        {onAdd && (
          <button type="button" className="btn" onClick={onAdd} disabled={locked}>
            이 보드에 추가
          </button>
        )}
      </div>
    </div>
  )
}

export type AiState = 'idle' | 'analyzing' | 'fail'

/**
 * AI로 정리 (F-08, B13): 이슈 그룹 목록·묶이지 않은 기사·분석 뒤 바뀜 안내.
 * 결과가 나와도 카드 위치는 그대로이고, "자동 정렬"을 눌러야 바뀐다. 그룹을 누르면 그 카드만 강조한다
 */
export function AiPanel({
  state,
  clusters,
  articles,
  analyzedIds,
  highlightId,
  onToggle,
  onAnalyze,
  onArrangeAll,
  onRestoreAll,
  onDismissAll,
  busy,
  locked,
  remaining,
}: {
  state: AiState
  clusters: BoardCluster[]
  /** 분석 대상 카드 (기사·메모·사진) */
  articles: ViewItem[]
  /** 이 화면에서 분석했을 때의 기사 카드 (바뀌었는지 비교용, 모르면 null) */
  analyzedIds: Set<string> | null
  highlightId: string | null
  onToggle: (clusterId: string) => void
  onAnalyze: () => void
  onArrangeAll: () => void
  onRestoreAll: () => void
  onDismissAll: () => void
  busy: boolean
  locked: boolean
  remaining: number | null
}) {
  const byId = new Map(articles.map((a) => [a.id, a]))
  const grouped = new Set(clusters.flatMap((c) => c.itemIds))
  const solo = articles.filter((a) => !grouped.has(a.id))
  const anyArranged = clusters.some((c) => c.itemIds.some((id) => byId.get(id)?.arranged))
  const anyUnarranged = clusters.some((c) => c.itemIds.some((id) => byId.get(id) && !byId.get(id)!.arranged))
  const stale =
    analyzedIds !== null &&
    (articles.length !== analyzedIds.size || articles.some((a) => !analyzedIds.has(a.id)))
  const line = (item: ViewItem | undefined) =>
    item &&
    (item.article ? (
      <span key={item.id} className="ai__item">
        · {item.article.title} <span>({item.article.source})</span>
      </span>
    ) : (
      <span key={item.id} className="ai__item">
        · {item.content} <span>({item.type === 'memo' ? '메모' : '사진'})</span>
      </span>
    ))

  let body: React.ReactNode
  if (state === 'analyzing')
    body = (
      <div className="ai__state" role="status">
        <b className="ai__busy">
          <Spinner />
          기사를 읽고 있어요
        </b>
        <span>카드 {articles.length}개를 같은 이슈끼리 묶는 중이에요. 10~20초쯤 걸려요.</span>
        <div className="skeleton ai__skeleton" />
        <div className="skeleton ai__skeleton" />
      </div>
    )
  else if (state === 'fail')
    body = (
      <div className="ai__state" role="alert">
        <b className="ai__fail">정리하지 못했어요.</b>
        <span>잠시 후 다시 시도해 주세요. 카드 위치는 바뀌지 않았어요.</span>
        <button type="button" className="btn btn--ghost btn--sm" onClick={onAnalyze} disabled={locked}>
          다시 시도
        </button>
      </div>
    )
  else if (articles.length === 0)
    body = (
      <div className="ai__state">
        <b>정리할 카드가 없어요.</b>
        <span>왼쪽 뉴스에서 기사를 추가하거나 메모를 남기면 정리를 도와드릴게요.</span>
      </div>
    )
  else if (clusters.length === 0 && analyzedIds === null)
    body = (
      <div className="ai__state">
        <b>{articles.length < 2 ? '관련 카드를 조금 더 모아 주세요.' : '모은 카드를 이슈별로 묶어 볼까요?'}</b>
        <span>
          {articles.length < 2
            ? '기사·메모 카드가 2개 이상 있어야 분석할 수 있어요.'
            : `카드 ${articles.length}개(기사·메모)를 분석해 같은 이슈끼리 묶고 요약해요. 카드 위치는 바꾸지 않아요.`}
        </span>
        {articles.length >= 2 && (
          <button type="button" className="btn btn--sm ai__start" onClick={onAnalyze} disabled={locked}>
            <Icon name="group" />
            분석하기
          </button>
        )}
      </div>
    )
  else if (clusters.length === 0)
    body = (
      <div className="ai__state">
        <b>뚜렷하게 묶이는 주제를 찾지 못했어요.</b>
        <span>비슷한 주제의 기사를 더 모은 뒤 다시 분석해 보세요.</span>
      </div>
    )
  else
    body = (
      <>
        <div className="ai__head">
          <b>모은 기사에서 찾은 쟁점</b>
          <span>
            이슈 {clusters.length}개 · 카드 {grouped.size}개
          </span>
        </div>
        {stale && <div className="notice notice--warn ai__notice">분석 이후 보드의 기사가 바뀌었어요. 다시 분석하면 반영돼요.</div>}
        <ul className="ai__groups">
          {clusters.map((c) => {
            const on = highlightId === c.id
            const members = c.itemIds.map((id) => byId.get(id)).filter(Boolean)
            return (
              <li key={c.id}>
                <button type="button" className={`ai__group${on ? ' ai__group--on' : ''}`} aria-pressed={on} onClick={() => onToggle(c.id)}>
                  <span className="ai__group-head">
                    <b>{c.title}</b>
                    <span>카드 {members.length}개</span>
                  </span>
                  {c.summary && <span className="ai__group-sum">{c.summary}</span>}
                  <span className="ai__group-items">{members.map(line)}</span>
                </button>
              </li>
            )
          })}
        </ul>
        {solo.length > 0 && (
          <div className="ai__solo">
            <b>묶이지 않은 카드</b>
            {solo.map(line)}
          </div>
        )}
        <p className="ai__disclaimer">AI가 만든 제안이에요. 기사와 메모(4자 이상)를 함께 분석해요. 사진은 설명이 있을 때만 포함해요.</p>
      </>
    )

  return (
    <>
      <div className="side__body ai">{body}</div>
      {clusters.length > 0 && state === 'idle' && (
        <div className="side__foot">
          {anyUnarranged && (
            <>
              <span className="ai__hint">지금은 카드 위치를 바꾸지 않았어요. 자동 정렬을 누르면 그룹별로 배치해요.</span>
              <button type="button" className="btn" onClick={onArrangeAll} disabled={locked || busy}>
                {busy ? '정렬하는 중…' : '자동 정렬'}
              </button>
            </>
          )}
          {anyArranged && (
            <>
              <span className="ai__hint">정렬한 뒤 직접 옮긴 카드는 그 자리에 그대로 둬요.</span>
              <button type="button" className="btn btn--ghost" onClick={onRestoreAll} disabled={locked || busy}>
                정렬 전 위치로 복원
              </button>
            </>
          )}
          <div className="ai__foot-row">
            <button type="button" className="btn btn--ghost btn--sm" onClick={onAnalyze} disabled={locked || busy}>
              다시 분석
            </button>
            <button type="button" className="btn btn--ghost btn--sm" onClick={onDismissAll} disabled={locked || busy}>
              제안 무시
            </button>
          </div>
          {remaining !== null && <span className="ai__remaining">오늘 남은 분석 {remaining}회</span>}
        </div>
      )}
    </>
  )
}
