import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type DragEvent, type KeyboardEvent, type PointerEvent } from 'react'
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
import { clampScale, wrapTilt, yarn } from './detective'
import { Thumb } from '../ui/Thumb'
import { ErrorBoundary } from '../ui/ErrorBoundary'

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
  /** 편집 세션 번호 (늦게 온 저장 결과를 다른 편집에 적용하지 않기 위해) */
  session: number
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
  /** 회전 핸들·[ ] 키로 기울기, 크기 핸들·- = 키로 배율을 바꿈 (탐정 보드) */
  onShapeEnd: (id: string, shape: { rotation?: number; scale?: number }) => void
  onDragMove: (id: string, x: number, y: number) => void
  onDropArticle: (article: FeedArticle, x: number, y: number) => void
  /** 사진 파일을 보드에 끌어다 놓음 (F-05 사진 카드) */
  onDropPhoto: (file: File, x: number, y: number) => void
  /** 저장된 사진 카드의 사진 주소 */
  photoSrc: (item: ViewItem) => string
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
  /** 잘못 이은 연결선 지우기 (선을 누르면 가운데에 삭제 버튼) */
  onDeleteConnection: (id: string) => void
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
      // 메모 입력처럼 스스로 스크롤하는 곳의 휠은 그 요소에 맡긴다 (Codex 281c5f2 리뷰 2)
      if (e.target instanceof Element && e.target.closest('[data-ui], textarea, input, select, [data-scroll]')) return
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
    } else if ((e.key === '[' || e.key === ']') && !item.id.startsWith('tmp-')) {
      e.preventDefault()
      props.onShapeEnd(item.id, { rotation: wrapTilt(item.rotation + (e.key === '[' ? -5 : 5)) })
    } else if ((e.key === '-' || e.key === '=' || e.key === '+') && !item.id.startsWith('tmp-')) {
      e.preventDefault()
      props.onShapeEnd(item.id, { scale: clampScale(item.scale + (e.key === '-' ? -0.1 : 0.1)) })
    } else if (e.key === 'Enter') {
      e.preventDefault()
      props.onSelect(item.id)
      if (item.type === 'memo' || item.type === 'photo') props.onEditMemo(item.id)
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
    const rect = viewportRef.current?.getBoundingClientRect()
    if (!rect || locked) return
    const at = toBoard(view, e.clientX - rect.left, e.clientY - rect.top)
    // 내 컴퓨터의 사진 파일 (한 번에 한 장)
    const file = e.dataTransfer.files[0]
    if (file) return props.onDropPhoto(file, at.x, at.y)
    const article = parseArticle(e.dataTransfer.getData(ARTICLE_DRAG_TYPE))
    if (article) props.onDropArticle(article, at.x, at.y)
  }

  /** 마우스를 올린 연결선 (클릭 판정은 카드 아래, 보이는 선은 카드 위라서 따로 기억) */
  const [hoverLine, setHoverLine] = useState<string | null>(null)
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
        const accepts = e.dataTransfer.types.includes(ARTICLE_DRAG_TYPE) || e.dataTransfer.types.includes('Files')
        if (!accepts || locked) return
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
          onSelect={connectMode || locked ? undefined : props.onSelectConnection}
          onHover={setHoverLine}
        />
        {positioned.map((item) => (
          <ErrorBoundary key={item.id} resetKey={item} fallback={(retry) => <BrokenCard item={item} onRetry={retry} />}>
            <Card
              item={item}
              props={props}
              dragging={dragPos?.id === item.id}
              confirming={confirmId === item.id}
              onAskDelete={() => setConfirmId(item.id)}
              onCancelDelete={() => setConfirmId(null)}
              onDown={(e) => onCardDown(e, item)}
              onKey={(e) => onCardKey(e, item)}
            />
          </ErrorBoundary>
        ))}
        {props.clusters.map((cluster) => (
          <ErrorBoundary key={cluster.id} resetKey={cluster} fallback={() => null}>
            <ClusterCard cluster={cluster} items={positioned} props={props} />
          </ErrorBoundary>
        ))}
        <LinksOver
          byId={byId}
          heights={props.heights}
          connections={props.connections}
          selectedId={props.selectedConnectionId}
          hoverId={hoverLine}
        />
        {props.selectedConnectionId && !connectMode && !locked && (
          <ConnectionMenu
            key={props.selectedConnectionId}
            connection={props.connections.find((c) => c.id === props.selectedConnectionId)}
            byId={byId}
            heights={props.heights}
            onDelete={props.onDeleteConnection}
            onClose={() => props.onSelectConnection(null)}
          />
        )}
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

/** 그리다 오류가 난 카드 자리 — 보드의 나머지는 그대로 쓸 수 있다 */
function BrokenCard({ item, onRetry }: { item: ViewItem; onRetry: () => void }) {
  return (
    <div
      data-card={item.id}
      role="alert"
      className="card card--broken"
      style={{ left: item.x, top: item.y, width: cardWidth(item), zIndex: item.zIndex }}
    >
      <span>이 카드를 표시하지 못했어요.</span>
      <button type="button" data-ui className="btn btn--ghost btn--xs" onClick={onRetry}>
        다시 시도
      </button>
    </div>
  )
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
  /** 회전 핸들로 돌리는 중인 각도, 크기 핸들로 바꾸는 중인 배율 (놓으면 저장) */
  const [rotating, setRotating] = useState<number | null>(null)
  const [resizing, setResizing] = useState<number | null>(null)
  const temp = item.id.startsWith('tmp-')
  const draft = item.id === DRAFT_MEMO_ID
  const editing = props.memoEdit?.id === item.id ? props.memoEdit : null
  const selected = props.connectMode ? props.connectFrom === item.id : props.selectedId === item.id
  const dimmed = props.highlight !== null && !props.highlight.has(item.id)
  const lit = props.highlight?.has(item.id) ?? false
  const showMenu = selected && !props.connectMode && !props.locked && !editing && !temp && !draft && !confirming && !dragging
  const member = item.movingBy ? props.members.get(item.movingBy)?.nickname : null
  const width = cardWidth(item)
  const kindLabel = item.type === 'article' ? '기사' : item.type === 'memo' ? '메모' : '사진'
  // 글을 고치는 동안에는 읽기 쉽게 똑바로 세운다
  const tilt = editing ? 0 : (rotating ?? item.rotation)

  /** 카드 가운데를 축으로, 누른 곳에서 돌린 만큼 기울인다. Shift를 누르면 15° 단위 */
  const startRotate = (e: PointerEvent<HTMLDivElement>) => {
    const card = ref.current
    if (!card || e.button !== 0) return
    e.stopPropagation()
    e.preventDefault()
    const box = card.getBoundingClientRect()
    const cx = box.left + box.width / 2
    const cy = box.top + box.height / 2
    const angle = (x: number, y: number) => (Math.atan2(y - cy, x - cx) * 180) / Math.PI
    const start = angle(e.clientX, e.clientY)
    const base = item.rotation
    let last = base
    const handle = e.currentTarget
    handle.setPointerCapture(e.pointerId)
    const move = (ev: globalThis.PointerEvent) => {
      let delta = angle(ev.clientX, ev.clientY) - start
      if (delta > 180) delta -= 360
      if (delta < -180) delta += 360
      const next = base + delta
      last = wrapTilt(ev.shiftKey ? Math.round(next / 15) * 15 : next)
      setRotating(last)
    }
    const end = () => {
      handle.removeEventListener('pointermove', move)
      handle.removeEventListener('pointerup', end)
      handle.removeEventListener('pointercancel', end)
      if (last !== base) props.onShapeEnd(item.id, { rotation: last })
      setRotating(null)
    }
    handle.addEventListener('pointermove', move)
    handle.addEventListener('pointerup', end)
    handle.addEventListener('pointercancel', end)
  }

  /** 카드 가운데에서 멀어진 만큼 키우고, 가까워진 만큼 줄인다 (5% 단위, 60%~250%) */
  const startResize = (e: PointerEvent<HTMLDivElement>) => {
    const card = ref.current
    if (!card || e.button !== 0) return
    e.stopPropagation()
    e.preventDefault()
    const box = card.getBoundingClientRect()
    const cx = box.left + box.width / 2
    const cy = box.top + box.height / 2
    const start = Math.max(1, Math.hypot(e.clientX - cx, e.clientY - cy))
    const base = item.scale
    let last = base
    const handle = e.currentTarget
    handle.setPointerCapture(e.pointerId)
    const move = (ev: globalThis.PointerEvent) => {
      last = clampScale((base * Math.hypot(ev.clientX - cx, ev.clientY - cy)) / start)
      setResizing(last)
    }
    const end = () => {
      handle.removeEventListener('pointermove', move)
      handle.removeEventListener('pointerup', end)
      handle.removeEventListener('pointercancel', end)
      if (last !== base) props.onShapeEnd(item.id, { scale: last })
      setResizing(null)
    }
    handle.addEventListener('pointermove', move)
    handle.addEventListener('pointerup', end)
    handle.addEventListener('pointercancel', end)
  }
  const aria =
    item.type === 'article'
      ? `기사 카드: ${item.article?.title ?? '삭제된 기사'}`
      : item.type === 'memo'
        ? `메모 카드: ${item.content || '내용 없음'}`
        : `사진 카드${item.content ? `: ${item.content}` : ''}`

  const classes = [
    'card',
    `card--${item.type}`,
    selected && 'card--selected',
    dragging && 'card--dragging',
    dimmed && 'card--dim',
    lit && 'card--lit',
    (item.pending || temp) && 'card--saving',
    (rotating !== null || resizing !== null) && 'card--rotating',
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
      style={
        {
          left: item.x,
          top: item.y,
          width,
          zIndex: dragging ? 100000 : selected || editing || confirming ? ABOVE_LINKS : item.zIndex,
          '--tilt': `${tilt}deg`,
          '--scale': resizing ?? item.scale,
        } as CSSProperties
      }
      onPointerDown={onDown}
      onKeyDown={onKey}
    >
      <span className="pin" aria-hidden="true" />
      {member && <span className="card__tag">{member}님이 옮기는 중</span>}
      {showMenu && (
        <div
          data-ui
          className={`card__rotate${rotating !== null ? ' card__rotate--on' : ''}`}
          onPointerDown={startRotate}
          title="돌려서 기울기 바꾸기 (Shift: 15° 단위, 키보드 [ ])"
          aria-hidden="true"
        >
          <Icon name="rotate" size={14} />
          {rotating !== null && <span className="card__rotate-deg">{rotating}°</span>}
        </div>
      )}
      {showMenu && (
        <div
          data-ui
          className={`card__resize${resizing !== null ? ' card__resize--on' : ''}`}
          onPointerDown={startResize}
          title="끌어서 크기 바꾸기 (60%~250%, 키보드 - =)"
          aria-hidden="true"
        >
          <Icon name="resize" size={14} />
          {resizing !== null && <span className="card__rotate-deg">{Math.round(resizing * 100)}%</span>}
        </div>
      )}
      {showMenu && (
        <div data-ui role="toolbar" aria-label="카드 메뉴" className="card__menu">
          {item.type === 'article' && (
            <button type="button" onClick={() => props.onDetail(item.id)}>
              자세히
            </button>
          )}
          {(item.type === 'memo' || item.type === 'photo') && (
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

      {item.type === 'article' && <Thumb src={item.article?.imageUrl} className="card__image" />}
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
              <TextEditor editing={editing} props={props} label="메모 내용" placeholder="의견, 질문, 관찰을 적어 보세요" />
            ) : (
              <span className="card__memo-text">{item.content || '내용 없음'}</span>
            )}
          </div>
        </>
      )}

      {item.type === 'photo' && (
        <div className="card__photo">
          <PhotoImage src={item.preview ?? (temp ? null : props.photoSrc(item))} alt={item.content || '첨부 사진'} />
          {editing ? (
            <TextEditor editing={editing} props={props} label="사진 설명" placeholder="사진 설명을 적어 보세요 (비워 둬도 돼요)" />
          ) : (
            item.content && <span className="card__memo-text">{item.content}</span>
          )}
          <span className="card__memo-by">사진 · {authorName(item, props.members)}</span>
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

/** 카드 안 글 편집 (메모 내용·사진 설명). Ctrl+Enter 저장, Esc 취소 */
function TextEditor({ editing, props, label, placeholder }: { editing: MemoEdit; props: Props; label: string; placeholder: string }) {
  return (
    <>
      <label htmlFor="memo-input" className="visually-hidden">
        {label}
      </label>
      <textarea
        id="memo-input"
        autoFocus
        rows={4}
        maxLength={2000}
        readOnly={editing.saving}
        aria-busy={editing.saving}
        value={editing.text}
        placeholder={placeholder}
        onChange={(e) => props.onMemoChange(e.target.value)}
        onKeyDown={(e) => {
          if (editing.saving) return
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
  )
}

/** 사진 카드의 사진. 불러오지 못하면(주소 만료·삭제 등) 안내와 다시 불러오기 */
function PhotoImage({ src, alt }: { src: string | null; alt: string }) {
  const [failed, setFailed] = useState(false)
  const [attempt, setAttempt] = useState(0)
  if (!src) return <div className="card__photo-img card__photo-img--empty" aria-hidden="true" />
  if (failed)
    return (
      <div className="card__photo-img card__photo-img--empty" data-ui>
        <span>사진을 불러오지 못했어요.</span>
        <button
          type="button"
          className="card__memo-cancel"
          onClick={() => {
            setFailed(false)
            setAttempt((n) => n + 1)
          }}
        >
          다시 불러오기
        </button>
      </div>
    )
  return (
    <img
      key={attempt}
      className="card__photo-img"
      src={attempt ? `${src}${src.includes('?') ? '&' : '?'}retry=${attempt}` : src}
      alt={alt}
      draggable={false}
      loading="lazy"
      onError={() => setFailed(true)}
    />
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
      <span className="pin" aria-hidden="true" />
      <div className="cluster-card__label">
        <span className="badge">AI 이슈</span>
        <span>카드 {members.length}개</span>
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

/** 선택한 연결선 가운데에 뜨는 삭제 메뉴 — 한 번 더 확인하고 지운다 (Delete 키로도 지울 수 있음) */
function ConnectionMenu({
  connection,
  byId,
  heights,
  onDelete,
  onClose,
}: {
  connection: BoardConnection | undefined
  byId: Map<string, ViewItem>
  heights: Map<string, number>
  onDelete: (id: string) => void
  onClose: () => void
}) {
  const [confirming, setConfirming] = useState(false)
  const from = connection && byId.get(connection.fromId)
  const to = connection && byId.get(connection.toId)
  if (!connection || !from || !to) return null
  const { mid } = yarn(from, to, heights)
  return (
    <div data-ui className="link-menu" style={{ left: mid.x, top: mid.y }}>
      {confirming ? (
        <div role="alertdialog" aria-label="연결선 삭제 확인" className="link-menu__confirm">
          <span>이 연결선을 지울까요?</span>
          <div>
            <button type="button" className="btn btn--ghost btn--xs" onClick={() => setConfirming(false)}>
              취소
            </button>
            <button type="button" className="btn btn--danger btn--xs" autoFocus onClick={() => onDelete(connection.id)}>
              삭제
            </button>
          </div>
        </div>
      ) : (
        <div role="toolbar" aria-label="연결선 메뉴" className="link-menu__bar">
          <button type="button" className="link-menu__delete" onClick={() => setConfirming(true)}>
            <Icon name="trash" size={16} />
            연결선 삭제
          </button>
          <button type="button" className="link-menu__close" onClick={onClose} aria-label="연결선 선택 해제" title="선택 해제">
            <Icon name="close" size={16} />
          </button>
        </div>
      )}
    </div>
  )
}

/**
 * 선 (월드 좌표 SVG): 클러스터 카드에서 묶인 카드로 가는 옅은 점선(F-08)과 사용자가 그은 연결선(F-10).
 * 연결선은 가늘어 누르기 어려우므로 투명한 넓은 선을 함께 깔아 누를 수 있게 한다
 */
/** 카드보다 위 — 연결선 층보다도 위에 올라오는 카드(선택·편집·삭제 확인 중) */
const ABOVE_LINKS = 99995

/**
 * 연결선을 카드 위에 그린다 (2026-10-10 사용자 요청). 이 층은 클릭을 받지 않는다 — 카드 위를 지나는 선을 눌러도 카드가 잡히고,
 * 빈 곳의 선은 카드 아래 Lines의 판정 선이 받는다. 선 끝에는 압정을 다시 그려 실이 압정에 묶인 것처럼 보이게 한다.
 */
function LinksOver({
  byId,
  heights,
  connections,
  selectedId,
  hoverId,
}: {
  byId: Map<string, ViewItem>
  heights: Map<string, number>
  connections: BoardConnection[]
  selectedId: string | null
  hoverId: string | null
}) {
  return (
    <svg className="canvas__lines canvas__lines--over" aria-hidden="true">
      <defs>
        <radialGradient id="pin-gradient" cx="35%" cy="30%" r="75%">
          <stop offset="0%" style={{ stopColor: 'var(--bg-pin-light)' }} />
          <stop offset="55%" style={{ stopColor: 'var(--bg-pin)' }} />
          <stop offset="100%" style={{ stopColor: 'var(--bg-pin-dark)' }} />
        </radialGradient>
      </defs>
      {connections.map((c) => {
        const from = byId.get(c.fromId)
        const to = byId.get(c.toId)
        if (!from || !to) return null
        const line = yarn(from, to, heights)
        const classes = ['canvas__link', selectedId === c.id && 'canvas__link--selected', hoverId === c.id && 'canvas__link--hover']
        return (
          <g key={c.id}>
            <path className={classes.filter(Boolean).join(' ')} d={line.d} />
            {[
              { p: line.from, s: from.scale },
              { p: line.to, s: to.scale },
            ].map(({ p, s }, i) => (
              <g key={i} className="canvas__pin">
                <circle cx={p.x} cy={p.y} r={7 * s} fill="url(#pin-gradient)" />
                <circle cx={p.x - 2.4 * s} cy={p.y - 2.9 * s} r={1.5 * s} fill="rgba(255, 255, 255, 0.9)" />
              </g>
            ))}
          </g>
        )
      })}
    </svg>
  )
}

function Lines({
  clusters,
  byId,
  heights,
  connections,
  onSelect,
  onHover,
}: {
  clusters: BoardCluster[]
  byId: Map<string, ViewItem>
  heights: Map<string, number>
  connections: BoardConnection[]
  onSelect?: (id: string) => void
  onHover: (id: string | null) => void
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
        if (!onSelect) return null
        // 보이는 선은 카드 위(LinksOver)에 그리고, 여기는 빈 곳에서 선을 누르는 판정만 맡는다
        const { d } = yarn(from, to, heights)
        return (
          <g key={c.id} data-line={c.id}>
            {onSelect && (
              <path
                className="canvas__link-hit"
                d={d}
                onPointerEnter={() => onHover(c.id)}
                onPointerLeave={() => onHover(null)}
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

