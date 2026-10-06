import { useEffect, useLayoutEffect, useRef, useState, type DragEvent, type KeyboardEvent, type PointerEvent } from 'react'
import type { FeedArticle } from '../feed/types'
import { Icon, Spinner } from '../ui/Icon'
import {
  CLUSTER_WIDTH,
  articleTime,
  authorName,
  cardWidth,
  categoryLabel,
  toBoard,
  zoomAt,
  type View,
} from './cardLayout'
import type { BoardCluster, BoardConnection, BoardMember } from './types'
import type { ViewItem } from './useBoardSync'

/** 피드에서 끌어 온 기사를 담는 드래그 데이터 형식 */
export const ARTICLE_DRAG_TYPE = 'application/x-moyobom-article'
/** 아직 저장하지 않은 새 메모 카드의 id */
export const DRAFT_MEMO_ID = 'draft-memo'

export type ClusterAction = 'arrange' | 'restore' | 'dismiss'
export type Tool = 'select' | 'pan'

/** 카드 안에서 편집 중인 메모 */
export interface MemoEdit {
  id: string
  text: string
  saving: boolean
  error: 'empty' | 'fail' | null
}

interface Props {
  items: ViewItem[]
  members: Map<string, BoardMember>
  view: View
  onViewChange: (view: View) => void
  onSize: (width: number, height: number) => void
  /** 화면에서 잰 카드·클러스터 카드 높이 (화면 맞춤·연결선용) */
  heights: Map<string, number>
  onHeight: (id: string, height: number) => void
  tool: Tool
  /** 연결이 끊겼거나 보드에서 나가게 되어 편집할 수 없음 (B11) */
  locked: boolean
  selectedId: string | null
  onSelect: (id: string | null) => void
  onMoveEnd: (id: string, x: number, y: number) => void
  onDragMove: (id: string, x: number, y: number) => void
  onDropArticle: (article: FeedArticle, x: number, y: number) => void
  onDetail: (id: string) => void
  onEditMemo: (id: string) => void
  onDeleteCard: (id: string) => void
  memoEdit: MemoEdit | null
  onMemoChange: (text: string) => void
  onMemoSave: () => void
  onMemoCancel: () => void
  /** AI 정리 패널에서 고른 그룹의 카드 — 나머지 기사 카드는 흐리게 (B13) */
  highlight: Set<string> | null
  /** AI 이슈 클러스터 카드 (F-08, A4) */
  clusters: BoardCluster[]
  onClusterAction: (clusterId: string, action: ClusterAction) => void
  /** 카드 간 연결선 (F-10, A1) */
  connections: BoardConnection[]
  selectedConnectionId: string | null
  onSelectConnection: (id: string | null) => void
  connectMode: boolean
  connectFrom: string | null
  onPickCard: (id: string) => void
  now: Date
}

/** 드롭된 데이터가 피드 기사 모양인지 확인 (다른 사이트에서 끌어 온 데이터 대비) */
function parseArticle(raw: string): FeedArticle | null {
  try {
    const value = JSON.parse(raw) as Partial<FeedArticle>
    return typeof value.id === 'string' && /^\d+$/.test(value.id) && typeof value.title === 'string' ? (value as FeedArticle) : null
  } catch {
    return null
  }
}

const isControl = (target: EventTarget) => target instanceof Element && Boolean(target.closest('button, a, textarea, input, select, [data-ui]'))

type Gesture =
  | { kind: 'pan'; sx: number; sy: number; ox: number; oy: number; moved: boolean }
  | { kind: 'card'; id: string; sx: number; sy: number; ox: number; oy: number; moved: boolean }

/**
 * 협업 보드 캔버스 (F-05, 보라 테마 프로토타입). 카드는 화면 요소로 그리고 월드 좌표를 확대·이동으로 옮긴다.
 * - 빈 곳 드래그 = 화면 이동, 카드 드래그 = 이동(4px 미만이면 클릭), 카드 안 버튼·링크·입력에서 시작하면 드래그 아님
 * - Ctrl(⌘) + 휠 = 커서 위치 기준 확대·축소, 휠 = 화면 이동
 * - 피드 기사를 끌어다 놓으면 그 자리에 기사 카드 추가
 * - 선택한 카드 위에 카드 메뉴(자세히·수정·삭제), 삭제는 카드 안에서 한 번 더 확인 (B8)
 */
export function BoardCanvas(props: Props) {
  const { items, view, onViewChange, onSize, tool, locked, connectMode } = props
  const viewportRef = useRef<HTMLDivElement>(null)
  const gesture = useRef<Gesture | null>(null)
  const [dragPos, setDragPos] = useState<{ id: string; x: number; y: number } | null>(null)
  const [panning, setPanning] = useState(false)
  const [dropping, setDropping] = useState(false)
  const [confirmId, setConfirmId] = useState<string | null>(null)
  const viewRef = useRef(view)
  useEffect(() => {
    viewRef.current = view
  })

  useLayoutEffect(() => {
    const el = viewportRef.current
    if (!el) return
    const measure = () => onSize(Math.round(el.clientWidth), Math.round(el.clientHeight))
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    return () => observer.disconnect()
  }, [onSize])

  // 휠: 브라우저 기본 스크롤·확대를 막아야 해서 passive가 아닌 리스너로 단다
  useEffect(() => {
    const el = viewportRef.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      if (e.target instanceof Element && e.target.closest('[data-ui]')) return
      e.preventDefault()
      const v = viewRef.current
      if (e.ctrlKey || e.metaKey) {
        const rect = el.getBoundingClientRect()
        onViewChange(zoomAt(v, v.scale * (e.deltaY < 0 ? 1.08 : 1 / 1.08), e.clientX - rect.left, e.clientY - rect.top))
      } else onViewChange({ ...v, x: v.x - e.deltaX, y: v.y - e.deltaY })
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [onViewChange])

  // 선택이 바뀌면 삭제 확인을 닫는다
  const [lastSelected, setLastSelected] = useState(props.selectedId)
  if (lastSelected !== props.selectedId) {
    setLastSelected(props.selectedId)
    setConfirmId(null)
  }

  const startPan = (e: PointerEvent) => {
    gesture.current = { kind: 'pan', sx: e.clientX, sy: e.clientY, ox: view.x, oy: view.y, moved: false }
    setPanning(true)
  }

  const onViewportDown = (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0 || isControl(e.target)) return
    if (e.target instanceof Element && e.target.closest('[data-card], [data-cluster], [data-line]')) return
    viewportRef.current?.setPointerCapture(e.pointerId)
    startPan(e)
  }

  const onCardDown = (e: PointerEvent<HTMLDivElement>, item: ViewItem) => {
    if (e.button !== 0 || isControl(e.target)) return
    e.stopPropagation()
    viewportRef.current?.setPointerCapture(e.pointerId)
    if (tool === 'pan') return startPan(e)
    if (connectMode) {
      if (!item.id.startsWith('tmp-') && item.id !== DRAFT_MEMO_ID) props.onPickCard(item.id)
      return
    }
    props.onSelect(item.id)
    props.onSelectConnection(null)
    const fixed = locked || item.id.startsWith('tmp-') || item.id === DRAFT_MEMO_ID || props.memoEdit?.id === item.id
    if (fixed) return
    gesture.current = { kind: 'card', id: item.id, sx: e.clientX, sy: e.clientY, ox: item.x, oy: item.y, moved: false }
  }

  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const g = gesture.current
    if (!g) return
    const dx = e.clientX - g.sx
    const dy = e.clientY - g.sy
    if (!g.moved && Math.abs(dx) + Math.abs(dy) < 4) return
    g.moved = true
    if (g.kind === 'pan') return onViewChange({ ...view, x: g.ox + dx, y: g.oy + dy })
    const x = Math.round(g.ox + dx / view.scale)
    const y = Math.round(g.oy + dy / view.scale)
    setDragPos({ id: g.id, x, y })
    setConfirmId(null)
    props.onDragMove(g.id, x, y)
  }

  const onPointerUp = () => {
    const g = gesture.current
    gesture.current = null
    setPanning(false)
    if (!g) return
    if (g.kind === 'pan') {
      if (!g.moved) {
        props.onSelect(null)
        props.onSelectConnection(null)
      }
      return
    }
    if (g.moved && dragPos?.id === g.id) props.onMoveEnd(g.id, dragPos.x, dragPos.y)
    setDragPos(null)
  }

  const onCardKey = (e: KeyboardEvent<HTMLDivElement>, item: ViewItem) => {
    if (e.target !== e.currentTarget || locked) return
    const step = e.shiftKey ? 80 : 20
    const moves: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }
    if (moves[e.key] && !item.id.startsWith('tmp-')) {
      e.preventDefault()
      const [dx, dy] = moves[e.key]!
      props.onMoveEnd(item.id, item.x + dx, item.y + dy)
    } else if (e.key === 'Enter') {
      e.preventDefault()
      props.onSelect(item.id)
      if (item.type === 'memo') props.onEditMemo(item.id)
      else if (item.type === 'article') props.onDetail(item.id)
    } else if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault()
      e.stopPropagation()
      props.onSelect(item.id)
      setConfirmId(item.id)
    }
  }

  const onDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    setDropping(false)
    const article = parseArticle(e.dataTransfer.getData(ARTICLE_DRAG_TYPE))
    const rect = viewportRef.current?.getBoundingClientRect()
    if (!article || !rect || locked) return
    const at = toBoard(view, e.clientX - rect.left, e.clientY - rect.top)
    props.onDropArticle(article, at.x, at.y)
  }

  const positioned = items.map((item) => (dragPos?.id === item.id ? { ...item, x: dragPos.x, y: dragPos.y } : item))
  const byId = new Map(positioned.map((i) => [i.id, i]))
  const grid = Math.max(8, 24 * view.scale)
  const cursor = panning ? 'grabbing' : tool === 'pan' ? 'grab' : 'default'

  return (
    <div
      ref={viewportRef}
      className="canvas"
      style={{
        backgroundSize: `${grid}px ${grid}px`,
        backgroundPosition: `${view.x}px ${view.y}px`,
        cursor,
      }}
      onPointerDown={onViewportDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onDragOver={(e) => {
        if (!e.dataTransfer.types.includes(ARTICLE_DRAG_TYPE) || locked) return
        e.preventDefault()
        e.dataTransfer.dropEffect = 'copy'
        if (!dropping) setDropping(true)
      }}
      onDragLeave={(e) => {
        if (viewportRef.current && e.relatedTarget instanceof Node && viewportRef.current.contains(e.relatedTarget)) return
        setDropping(false)
      }}
      onDrop={onDrop}
    >
      <div className="canvas__world" style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})` }}>
        <Lines
          clusters={props.clusters}
          byId={byId}
          heights={props.heights}
          connections={props.connections}
          selectedId={props.selectedConnectionId}
          onSelect={connectMode || locked ? undefined : props.onSelectConnection}
        />
        {positioned.map((item) => (
          <Card
            key={item.id}
            item={item}
            props={props}
            dragging={dragPos?.id === item.id}
            confirming={confirmId === item.id}
            onAskDelete={() => setConfirmId(item.id)}
            onCancelDelete={() => setConfirmId(null)}
            onDown={(e) => onCardDown(e, item)}
            onKey={(e) => onCardKey(e, item)}
          />
        ))}
        {props.clusters.map((cluster) => (
          <ClusterCard key={cluster.id} cluster={cluster} items={positioned} props={props} />
        ))}
      </div>
      {dropping && (
        <div className="canvas__drop" aria-hidden="true">
          <span>여기에 놓으면 보드에 추가돼요</span>
        </div>
      )}
    </div>
  )
}

/** 화면에서 잰 높이를 알린다 (카드 내용이 바뀌면 다시) */
function useMeasure(id: string, onHeight: (id: string, h: number) => void) {
  const ref = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const report = () => onHeight(id, el.offsetHeight)
    report()
    const observer = new ResizeObserver(report)
    observer.observe(el)
    return () => observer.disconnect()
  }, [id, onHeight])
  return ref
}

function Card({
  item,
  props,
  dragging,
  confirming,
  onAskDelete,
  onCancelDelete,
  onDown,
  onKey,
}: {
  item: ViewItem
  props: Props
  dragging: boolean
  confirming: boolean
  onAskDelete: () => void
  onCancelDelete: () => void
  onDown: (e: PointerEvent<HTMLDivElement>) => void
  onKey: (e: KeyboardEvent<HTMLDivElement>) => void
}) {
  const ref = useMeasure(item.id, props.onHeight)
  const temp = item.id.startsWith('tmp-')
  const draft = item.id === DRAFT_MEMO_ID
  const editing = props.memoEdit?.id === item.id ? props.memoEdit : null
  const selected = props.connectMode ? props.connectFrom === item.id : props.selectedId === item.id
  const dimmed = props.highlight !== null && item.type === 'article' && !props.highlight.has(item.id)
  const lit = props.highlight?.has(item.id) ?? false
  const showMenu = selected && !props.connectMode && !props.locked && !editing && !temp && !draft && !confirming && !dragging
  const member = item.movingBy ? props.members.get(item.movingBy)?.nickname : null
  const width = cardWidth(item)
  const kindLabel = item.type === 'article' ? '기사' : item.type === 'memo' ? '메모' : '사진'
  const aria =
    item.type === 'article'
      ? `기사 카드: ${item.article?.title ?? '삭제된 기사'}`
      : item.type === 'memo'
        ? `메모 카드: ${item.content || '내용 없음'}`
        : '사진 카드'

  const classes = [
    'card',
    `card--${item.type}`,
    selected && 'card--selected',
    dragging && 'card--dragging',
    dimmed && 'card--dim',
    lit && 'card--lit',
    (item.pending || temp) && 'card--saving',
    props.connectMode && 'card--connect',
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <div
      ref={ref}
      data-card={item.id}
      tabIndex={0}
      role="group"
      aria-label={aria}
      className={classes}
      style={{ left: item.x, top: item.y, width, zIndex: dragging ? 100000 : item.zIndex }}
      onPointerDown={onDown}
      onKeyDown={onKey}
    >
      {member && <span className="card__tag">{member}님이 옮기는 중</span>}
      {showMenu && (
        <div data-ui role="toolbar" aria-label="카드 메뉴" className="card__menu">
          {item.type === 'article' && (
            <button type="button" onClick={() => props.onDetail(item.id)}>
              자세히
            </button>
          )}
          {item.type === 'memo' && (
            <button type="button" onClick={() => props.onEditMemo(item.id)}>
              <Icon name="edit" size={16} />
              수정
            </button>
          )}
          <div className="card__menu-sep" aria-hidden="true" />
          <button type="button" className="card__menu-danger" onClick={onAskDelete} aria-label={`${kindLabel} 카드 삭제`} title="카드 삭제">
            <Icon name="trash" />
          </button>
        </div>
      )}
      {confirming && (
        <div data-ui role="alertdialog" aria-label="카드 삭제 확인" className="card__confirm">
          <b>이 카드를 삭제할까요?</b>
          <span>팀원 모두의 보드에서 사라지고, 되돌릴 수 없어요.</span>
          <div>
            <button type="button" className="btn btn--ghost btn--xs" onClick={onCancelDelete}>
              취소
            </button>
            <button
              type="button"
              className="btn btn--danger btn--xs"
              autoFocus
              onClick={() => {
                onCancelDelete()
                props.onDeleteCard(item.id)
              }}
            >
              삭제
            </button>
          </div>
        </div>
      )}

      {item.type === 'article' && (
        <div className="card__article">
          <div className="card__label">
            <span>기사 · {categoryLabel(item)}</span>
            {item.article?.submitted && <span className="card__ai">링크 요약</span>}
          </div>
          <span className="card__title">{item.article?.title ?? '삭제된 기사'}</span>
          {item.article?.description && <span className="card__desc">{item.article.description}</span>}
          <div className="card__foot">
            <span className="card__src">
              <b>{item.article?.source}</b> · {articleTime(item, props.now)}
            </span>
            {item.article?.originalLink && (
              <a href={item.article.originalLink} target="_blank" rel="noopener noreferrer" aria-label="원문 보기 (새 탭)">
                원문 <Icon name="ext" size={14} />
              </a>
            )}
          </div>
        </div>
      )}

      {item.type === 'memo' && (
        <>
          <div className="card__strip" aria-hidden="true" />
          <div className="card__memo">
            <span className="card__memo-by">메모 · {authorName(item, props.members)}</span>
            {editing ? (
              <>
                <label htmlFor="memo-input" className="visually-hidden">
                  메모 내용
                </label>
                <textarea
                  id="memo-input"
                  autoFocus
                  rows={4}
                  maxLength={2000}
                  value={editing.text}
                  placeholder="의견, 질문, 관찰을 적어 보세요"
                  onChange={(e) => props.onMemoChange(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Escape') props.onMemoCancel()
                    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) props.onMemoSave()
                  }}
                />
                {editing.error === 'empty' && <span className="card__error">내용을 입력해 주세요.</span>}
                {editing.error === 'fail' && (
                  <span className="card__error" role="alert">
                    변경을 저장하지 못했어요. 다시 시도해 주세요.
                  </span>
                )}
                <div className="card__memo-actions">
                  <button type="button" className="card__memo-cancel" onClick={props.onMemoCancel} disabled={editing.saving}>
                    취소
                  </button>
                  <button type="button" className="btn btn--xs" onClick={props.onMemoSave} disabled={editing.saving}>
                    {editing.saving ? '저장 중…' : '저장'}
                  </button>
                </div>
              </>
            ) : (
              <span className="card__memo-text">{item.content || '내용 없음'}</span>
            )}
          </div>
        </>
      )}

      {item.type === 'photo' && (
        <div className="card__photo">
          <div className="card__photo-img" role="img" aria-label="첨부 사진" />
          <span className="card__memo-by">첨부 사진 · {authorName(item, props.members)}</span>
        </div>
      )}

      {(item.pending || temp) && !editing && (
        <div className="card__status">
          <Spinner size={12} />
          {temp ? '추가하는 중…' : '저장 중…'}
        </div>
      )}
    </div>
  )
}

/** AI 이슈 클러스터 카드 (F-08, A4): 이슈 이름·요약·묶인 기사 수, 자동 정렬/원래대로, 제안 무시 */
function ClusterCard({ cluster, items, props }: { cluster: BoardCluster; items: ViewItem[]; props: Props }) {
  const ref = useMeasure(`cluster-${cluster.id}`, props.onHeight)
  const members = items.filter((i) => cluster.itemIds.includes(i.id))
  const arranged = members.some((i) => i.arranged)
  return (
    <div
      ref={ref}
      data-cluster={cluster.id}
      className="cluster-card"
      style={{ left: cluster.x - CLUSTER_WIDTH / 2, top: cluster.y, width: CLUSTER_WIDTH }}
    >
      <div className="cluster-card__label">
        <span className="badge">AI 이슈</span>
        <span>기사 {members.length}개</span>
      </div>
      <b className="cluster-card__title">{cluster.title}</b>
      {cluster.summary && <p className="cluster-card__summary">{cluster.summary}</p>}
      <div className="cluster-card__actions" data-ui>
        <button
          type="button"
          className={`btn btn--xs${arranged ? ' btn--ghost' : ''}`}
          disabled={props.locked}
          onClick={() => props.onClusterAction(cluster.id, arranged ? 'restore' : 'arrange')}
        >
          {arranged ? '원래대로' : '자동 정렬'}
        </button>
        <button type="button" className="btn btn--ghost btn--xs" disabled={props.locked} onClick={() => props.onClusterAction(cluster.id, 'dismiss')}>
          제안 무시
        </button>
      </div>
    </div>
  )
}

/**
 * 선 (월드 좌표 SVG): 클러스터 카드에서 묶인 카드로 가는 옅은 점선(F-08)과 사용자가 그은 연결선(F-10).
 * 연결선은 가늘어 누르기 어려우므로 투명한 넓은 선을 함께 깔아 누를 수 있게 한다
 */
function Lines({
  clusters,
  byId,
  heights,
  connections,
  selectedId,
  onSelect,
}: {
  clusters: BoardCluster[]
  byId: Map<string, ViewItem>
  heights: Map<string, number>
  connections: BoardConnection[]
  selectedId: string | null
  onSelect?: (id: string) => void
}) {
  return (
    <svg className="canvas__lines" aria-hidden="true">
      {clusters.flatMap((cluster) => {
        const cy = cluster.y + (heights.get(`cluster-${cluster.id}`) ?? 120) / 2
        return cluster.itemIds
          .map((id) => byId.get(id))
          .filter((item): item is ViewItem => Boolean(item))
          .map((item) => (
            <line key={`${cluster.id}-${item.id}`} className="canvas__cluster-link" x1={cluster.x} y1={cy} x2={item.x} y2={item.y} />
          ))
      })}
      {connections.map((c) => {
        const from = byId.get(c.fromId)
        const to = byId.get(c.toId)
        if (!from || !to) return null
        const selected = selectedId === c.id
        return (
          <g key={c.id} data-line={c.id}>
            <line
              className={`canvas__link${selected ? ' canvas__link--selected' : ''}`}
              x1={from.x}
              y1={from.y}
              x2={to.x}
              y2={to.y}
            />
            {onSelect && (
              <line
                className="canvas__link-hit"
                x1={from.x}
                y1={from.y}
                x2={to.x}
                y2={to.y}
                onPointerDown={(e) => {
                  e.stopPropagation()
                  onSelect(c.id)
                }}
              />
            )}
          </g>
        )
      })}
    </svg>
  )
}

