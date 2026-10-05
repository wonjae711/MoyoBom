import type Konva from 'konva'
import { useEffect, useLayoutEffect, useRef, useState, type DragEvent } from 'react'
import { Group, Layer, Line, Rect, Stage, Text } from 'react-konva'
import type { FeedArticle } from '../feed/types'
import {
  ARTICLE,
  CHIP_FONT,
  CLUSTER,
  CLUSTER_TEXT_FONT,
  CLUSTER_TITLE_FONT,
  COLORS,
  FONT_HAND,
  FONT_SANS,
  MEMO,
  MEMO_FONT,
  META_FONT,
  TITLE_FONT,
  articleMeta,
  cardSize,
  categoryLabel,
  chipHeight,
  clusterLayout,
  displayRotation,
  measureTextHeight,
  memoMeta,
  toBoard,
  type View,
} from './cardLayout'
import type { BoardCluster, BoardConnection, BoardMember } from './types'
import type { ViewItem } from './useBoardSync'

/** 피드에서 끌어 온 기사를 담는 드래그 데이터 형식 */
export const ARTICLE_DRAG_TYPE = 'application/x-moyobom-article'

export type ClusterAction = 'arrange' | 'restore' | 'dismiss'

interface Props {
  items: ViewItem[]
  /** AI 이슈 클러스터 (F-08) */
  clusters: BoardCluster[]
  onClusterAction: (clusterId: string, action: ClusterAction) => void
  /** 카드 간 연결선 (F-10) */
  connections: BoardConnection[]
  selectedConnectionId: string | null
  onSelectConnection: (id: string | null) => void
  /** 연결선 긋기 모드: 카드를 누르면 선택 대신 연결 대상으로 고른다 */
  connectMode: boolean
  /** 연결선 긋기에서 먼저 고른 카드 */
  connectFrom: string | null
  onPickCard: (id: string) => void
  members: Map<string, BoardMember>
  view: View
  onViewChange: (view: View) => void
  onSize: (width: number, height: number) => void
  selectedId: string | null
  onSelect: (id: string | null) => void
  onMoveEnd: (id: string, x: number, y: number) => void
  onDragMove: (id: string, x: number, y: number) => void
  onDropArticle: (article: FeedArticle, x: number, y: number) => void
  onEditMemo: (id: string) => void
  /** 글꼴이 로드되면 바뀌는 값 — 글자 크기를 다시 재서 그린다 */
  fontsVersion: number
  now: Date
}

/** 드롭된 데이터가 피드 기사 모양인지 확인 (다른 사이트에서 끌어 온 데이터 대비) */
function parseArticle(raw: string): FeedArticle | null {
  try {
    const value = JSON.parse(raw) as Partial<FeedArticle>
    return typeof value.id === 'string' && /^\d+$/.test(value.id) && typeof value.title === 'string'
      ? (value as FeedArticle)
      : null
  } catch {
    return null
  }
}

/**
 * 협업 보드 캔버스 (F-05, react-konva). 목업 variant A(여유): 차콜 배경, 흰 기사 카드, 회색 손글씨 메모.
 * - 카드 드래그: 끝나면 저장(onMoveEnd), 드래그 중에는 위치 중계(onDragMove)
 * - 빈 곳 드래그: 캔버스 이동, 휠: 확대·축소
 * - 피드 기사를 끌어다 놓으면 그 자리에 기사 카드 추가
 * - 메모 더블클릭: 편집, 기사 더블클릭: 원문 열기
 */
export function BoardCanvas(props: Props) {
  const { items, view, onViewChange, onSize } = props
  const containerRef = useRef<HTMLDivElement>(null)
  const stageRef = useRef<Konva.Stage>(null)
  const [size, setSize] = useState({ width: 0, height: 0 })
  const [dropping, setDropping] = useState(false)

  useLayoutEffect(() => {
    const el = containerRef.current
    if (!el) return
    const measure = () => {
      const width = Math.round(el.clientWidth)
      const height = Math.round(el.clientHeight)
      setSize((prev) => (prev.width === width && prev.height === height ? prev : { width, height }))
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    if (size.width && size.height) onSize(size.width, size.height)
  }, [size, onSize])

  const onWheel = (e: Konva.KonvaEventObject<WheelEvent>) => {
    e.evt.preventDefault()
    const stage = stageRef.current
    const pointer = stage?.getPointerPosition()
    if (!pointer) return
    const factor = e.evt.deltaY > 0 ? 1 / 1.1 : 1.1
    const scale = Math.min(2, Math.max(0.28, view.scale * factor))
    const focus = toBoard(view, pointer.x, pointer.y)
    onViewChange({ scale, x: pointer.x - focus.x * scale, y: pointer.y - focus.y * scale })
  }

  const onDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    setDropping(false)
    const article = parseArticle(e.dataTransfer.getData(ARTICLE_DRAG_TYPE))
    const rect = containerRef.current?.getBoundingClientRect()
    if (!article || !rect) return
    const at = toBoard(view, e.clientX - rect.left, e.clientY - rect.top)
    props.onDropArticle(article, at.x, at.y)
  }

  return (
    <div
      ref={containerRef}
      className={`board-canvas${dropping ? ' board-canvas--drop' : ''}`}
      onDragOver={(e) => {
        if (!e.dataTransfer.types.includes(ARTICLE_DRAG_TYPE)) return
        e.preventDefault()
        e.dataTransfer.dropEffect = 'copy'
        setDropping(true)
      }}
      onDragLeave={() => setDropping(false)}
      onDrop={onDrop}
    >
      {size.width > 0 && (
        <Stage
          ref={stageRef}
          width={size.width}
          height={size.height}
          x={view.x}
          y={view.y}
          scaleX={view.scale}
          scaleY={view.scale}
          draggable
          onWheel={onWheel}
          onMouseDown={(e) => {
            if (e.target === e.target.getStage()) {
              props.onSelect(null)
              props.onSelectConnection(null)
            }
          }}
          onDragEnd={(e) => {
            if (e.target === e.target.getStage()) onViewChange({ ...view, x: e.target.x(), y: e.target.y() })
          }}
        >
          <Layer key={props.fontsVersion}>
            <ClusterLinks clusters={props.clusters} items={items} />
            <ConnectionLines
              connections={props.connections}
              items={items}
              selectedId={props.selectedConnectionId}
              onSelect={props.connectMode ? undefined : props.onSelectConnection}
            />
            {items.map((item) => (
              <Card key={item.id} item={item} {...props} />
            ))}
            {props.clusters.map((cluster) => (
              <ClusterCard
                key={cluster.id}
                cluster={cluster}
                items={items}
                onAction={(action) => props.onClusterAction(cluster.id, action)}
              />
            ))}
          </Layer>
        </Stage>
      )}
    </div>
  )
}

function Card({
  item,
  members,
  selectedId,
  onSelect,
  onMoveEnd,
  onDragMove,
  onEditMemo,
  now,
  connectMode,
  connectFrom,
  onPickCard,
}: Props & { item: ViewItem }) {
  const ref = useRef<Konva.Group>(null)
  const { width, height } = cardSize(item)
  const temp = item.id.startsWith('tmp-')
  const selected = connectMode ? connectFrom === item.id : selectedId === item.id

  // 서버 결과·다른 사람의 이동이 오면 위치를 맞춘다 (내가 드래그 중일 때는 건드리지 않음)
  useLayoutEffect(() => {
    const node = ref.current
    if (node && !node.isDragging() && (node.x() !== item.x || node.y() !== item.y)) node.position({ x: item.x, y: item.y })
  })

  return (
    <Group
      ref={ref}
      x={item.x}
      y={item.y}
      offsetX={width / 2}
      offsetY={height / 2}
      rotation={displayRotation(item)}
      opacity={item.pending ? 0.88 : 1}
      draggable={!temp && !connectMode}
      onMouseDown={(e) => {
        e.cancelBubble = true
        if (connectMode) {
          if (!temp) onPickCard(item.id)
        } else onSelect(item.id)
      }}
      onDragStart={(e) => {
        e.target.moveToTop()
        onSelect(item.id)
      }}
      onDragMove={(e) => onDragMove(item.id, e.target.x(), e.target.y())}
      onDragEnd={(e) => {
        e.cancelBubble = true
        onMoveEnd(item.id, Math.round(e.target.x()), Math.round(e.target.y()))
      }}
      onDblClick={() => {
        if (item.type === 'memo') onEditMemo(item.id)
        else if (item.article?.originalLink) window.open(item.article.originalLink, '_blank', 'noopener,noreferrer')
      }}
      onMouseEnter={(e) => {
        const container = e.target.getStage()?.container()
        if (container) container.style.cursor = connectMode ? 'crosshair' : 'grab'
      }}
      onMouseLeave={(e) => {
        const container = e.target.getStage()?.container()
        if (container) container.style.cursor = 'default'
      }}
    >
      {selected && (
        <Rect x={-4} y={-4} width={width + 8} height={height + 8} cornerRadius={8} stroke={COLORS.white} strokeWidth={1.5} dash={[5, 4]} />
      )}
      {item.type === 'memo' ? (
        <MemoCard item={item} members={members} now={now} />
      ) : item.type === 'photo' ? (
        <Rect width={width} height={height} fill={COLORS.white} cornerRadius={2} shadowColor="black" shadowOpacity={0.34} shadowBlur={22} shadowOffsetY={10} />
      ) : (
        <ArticleCard item={item} height={height} now={now} />
      )}
    </Group>
  )
}

function ArticleCard({ item, height, now }: { item: ViewItem; height: number; now: Date }) {
  const label = categoryLabel(item)
  const chipH = chipHeight()
  const labelWidth = measureTextWidth(label, CHIP_FONT.size)
  const title = item.article?.title ?? '삭제된 기사'
  const titleWidth = ARTICLE.width - ARTICLE.padX * 2
  const titleH = measureTextHeight(title, titleWidth, { size: TITLE_FONT.size, lineHeight: TITLE_FONT.lineHeight, style: TITLE_FONT.style })
  const titleY = ARTICLE.padTop + chipH + ARTICLE.chipGap
  return (
    <>
      <Rect
        width={ARTICLE.width}
        height={height}
        fill={COLORS.white}
        stroke="rgba(33,33,33,0.1)"
        strokeWidth={1}
        cornerRadius={5}
        shadowColor="black"
        shadowOpacity={0.28}
        shadowBlur={20}
        shadowOffsetY={8}
      />
      <Rect
        x={ARTICLE.padX}
        y={ARTICLE.padTop}
        width={labelWidth + CHIP_FONT.padX * 2}
        height={chipH}
        stroke={COLORS.grayLight}
        strokeWidth={1}
        cornerRadius={3}
      />
      <Text
        x={ARTICLE.padX + CHIP_FONT.padX}
        y={ARTICLE.padTop + CHIP_FONT.padY + 1}
        text={label}
        fontSize={CHIP_FONT.size}
        fontFamily={FONT_SANS}
        fontStyle="600"
        letterSpacing={0.4}
        fill={COLORS.grayDark}
      />
      <Text
        x={ARTICLE.padX}
        y={titleY}
        width={titleWidth}
        text={title}
        fontSize={TITLE_FONT.size}
        fontFamily={FONT_SANS}
        fontStyle={TITLE_FONT.style}
        lineHeight={TITLE_FONT.lineHeight}
        letterSpacing={-0.2}
        wrap="char"
        fill={COLORS.black}
      />
      <Text
        x={ARTICLE.padX}
        y={titleY + titleH + ARTICLE.metaGap}
        width={titleWidth}
        text={articleMeta(item, now)}
        fontSize={META_FONT.size}
        fontFamily={FONT_SANS}
        fill={COLORS.grayMid}
        ellipsis
        wrap="none"
      />
    </>
  )
}

function MemoCard({ item, members, now }: { item: ViewItem; members: Map<string, BoardMember>; now: Date }) {
  const empty = !item.content
  const textWidth = MEMO.width - MEMO.padX * 2
  const metaY = MEMO.height - MEMO.padY - META_FONT.size * 1.2
  return (
    <>
      <Rect
        width={MEMO.width}
        height={MEMO.height}
        fill={COLORS.grayLight}
        cornerRadius={3}
        shadowColor="black"
        shadowOpacity={0.3}
        shadowBlur={18}
        shadowOffsetY={8}
      />
      <Text
        x={MEMO.padX}
        y={MEMO.padY}
        width={textWidth}
        height={metaY - MEMO.padY - 4}
        text={empty ? '더블클릭해서 메모 입력' : (item.content ?? '')}
        fontSize={empty ? 14 : MEMO_FONT.size}
        fontFamily={FONT_HAND}
        lineHeight={MEMO_FONT.lineHeight}
        fill={empty ? COLORS.grayMid : COLORS.black}
        wrap="char"
        ellipsis
      />
      <Text
        x={MEMO.padX}
        y={metaY}
        width={textWidth}
        text={memoMeta(item, members, now)}
        fontSize={META_FONT.size}
        fontFamily={FONT_SANS}
        fill={COLORS.grayDark}
        wrap="none"
        ellipsis
      />
    </>
  )
}

/** 클러스터 카드에서 묶인 카드들로 이어지는 가는 선 (목업의 클러스터 연결선 — 사용자가 긋는 연결선 F-10과는 별개) */
function ClusterLinks({ clusters, items }: { clusters: BoardCluster[]; items: ViewItem[] }) {
  const byId = new Map(items.map((i) => [i.id, i]))
  return (
    <>
      {clusters.flatMap((cluster) => {
        const { height } = clusterLayout(cluster.title, cluster.summary)
        const cy = cluster.y + height / 2
        return cluster.itemIds
          .map((id) => byId.get(id))
          .filter((item): item is ViewItem => Boolean(item))
          .map((item) => (
            <Line
              key={`${cluster.id}-${item.id}`}
              points={[cluster.x, cy, item.x, item.y]}
              stroke="rgba(255,255,255,0.4)"
              strokeWidth={1}
              listening={false}
            />
          ))
      })}
    </>
  )
}

/**
 * 사용자가 그은 카드 간 연결선 (F-10). 카드 가운데끼리 잇는 실선, 카드 아래에 그린다.
 * 선이 가늘어 누르기 어려우므로 누를 수 있는 폭을 넓게 둔다
 */
function ConnectionLines({
  connections,
  items,
  selectedId,
  onSelect,
}: {
  connections: BoardConnection[]
  items: ViewItem[]
  selectedId: string | null
  onSelect?: (id: string) => void
}) {
  const byId = new Map(items.map((i) => [i.id, i]))
  return (
    <>
      {connections.map((c) => {
        const from = byId.get(c.fromId)
        const to = byId.get(c.toId)
        if (!from || !to) return null
        const selected = selectedId === c.id
        return (
          <Line
            key={c.id}
            points={[from.x, from.y, to.x, to.y]}
            stroke={selected ? COLORS.white : 'rgba(255,255,255,0.75)'}
            strokeWidth={selected ? 3 : 2}
            dash={selected ? [8, 5] : undefined}
            hitStrokeWidth={14}
            listening={Boolean(onSelect)}
            onMouseDown={(e) => {
              e.cancelBubble = true
              onSelect?.(c.id)
            }}
            onMouseEnter={(e) => {
              const container = e.target.getStage()?.container()
              if (container && onSelect) container.style.cursor = 'pointer'
            }}
            onMouseLeave={(e) => {
              const container = e.target.getStage()?.container()
              if (container) container.style.cursor = 'default'
            }}
          />
        )
      })}
    </>
  )
}

/** 클러스터 카드 안의 버튼 (Konva에는 버튼이 없어 사각형+글자로 만든다) */
function CanvasButton({
  x,
  y,
  label,
  primary,
  onClick,
}: {
  x: number
  y: number
  label: string
  primary?: boolean
  onClick: () => void
}) {
  const width = measureTextWidth(label, 10.5) + 18
  return (
    <Group
      x={x}
      y={y}
      onClick={(e) => {
        e.cancelBubble = true
        onClick()
      }}
      onTap={(e) => {
        e.cancelBubble = true
        onClick()
      }}
      onMouseDown={(e) => {
        e.cancelBubble = true
      }}
      onMouseEnter={(e) => {
        const container = e.target.getStage()?.container()
        if (container) container.style.cursor = 'pointer'
      }}
      onMouseLeave={(e) => {
        const container = e.target.getStage()?.container()
        if (container) container.style.cursor = 'default'
      }}
    >
      <Rect
        width={width}
        height={CLUSTER.buttonH}
        cornerRadius={4}
        fill={primary ? COLORS.white : 'transparent'}
        stroke={primary ? undefined : 'rgba(255,255,255,0.3)'}
        strokeWidth={1}
      />
      <Text
        x={9}
        y={(CLUSTER.buttonH - 10.5 * 1.2) / 2 + 1}
        text={label}
        fontSize={10.5}
        fontFamily={FONT_SANS}
        fontStyle={primary ? '600' : 'normal'}
        fill={primary ? COLORS.black : 'rgba(255,255,255,0.7)'}
      />
    </Group>
  )
}

/** AI 클러스터 카드 (F-08): 이슈 이름·요약·묶인 수, 자동 정렬/원래대로, 제안 무시 */
function ClusterCard({
  cluster,
  items,
  onAction,
}: {
  cluster: BoardCluster
  items: ViewItem[]
  onAction: (action: ClusterAction) => void
}) {
  const layout = clusterLayout(cluster.title, cluster.summary)
  const members = items.filter((i) => cluster.itemIds.includes(i.id))
  const arranged = members.some((i) => i.arranged)
  const label = 'AI 클러스터'
  const labelWidth = measureTextWidth(label, CHIP_FONT.size) + 2
  const primary = arranged ? '원래대로' : '자동 정렬'
  return (
    <Group x={cluster.x - CLUSTER.width / 2} y={cluster.y}>
      <Rect
        width={CLUSTER.width}
        height={layout.height}
        fill={COLORS.black}
        stroke="rgba(255,255,255,0.14)"
        strokeWidth={1}
        cornerRadius={7}
        shadowColor="black"
        shadowOpacity={0.4}
        shadowBlur={28}
        shadowOffsetY={12}
      />
      <Rect
        x={CLUSTER.padX}
        y={CLUSTER.padTop}
        width={labelWidth + CHIP_FONT.padX * 2 + 2}
        height={chipHeight() + 1}
        stroke="rgba(255,255,255,0.35)"
        strokeWidth={1}
        cornerRadius={3}
      />
      <Text
        x={CLUSTER.padX + CHIP_FONT.padX + 1}
        y={CLUSTER.padTop + CHIP_FONT.padY + 1.5}
        text={label}
        fontSize={CHIP_FONT.size}
        fontFamily={FONT_SANS}
        fontStyle="600"
        letterSpacing={0.6}
        fill="rgba(255,255,255,0.85)"
      />
      <Text
        x={CLUSTER.padX + labelWidth + CHIP_FONT.padX * 2 + 9}
        y={CLUSTER.padTop + CHIP_FONT.padY + 1.5}
        text={`기사 ${members.length}`}
        fontSize={9.5}
        fontFamily={FONT_SANS}
        fill="rgba(255,255,255,0.55)"
      />
      <Text
        x={CLUSTER.padX}
        y={layout.titleY}
        width={layout.width}
        text={cluster.title}
        fontSize={CLUSTER_TITLE_FONT.size}
        fontFamily={CLUSTER_TITLE_FONT.family}
        fontStyle={CLUSTER_TITLE_FONT.style}
        lineHeight={CLUSTER_TITLE_FONT.lineHeight}
        wrap="char"
        fill={COLORS.white}
      />
      {cluster.summary && (
        <Text
          x={CLUSTER.padX}
          y={layout.summaryY}
          width={layout.width}
          text={cluster.summary}
          fontSize={CLUSTER_TEXT_FONT.size}
          fontFamily={FONT_SANS}
          lineHeight={CLUSTER_TEXT_FONT.lineHeight}
          wrap="char"
          fill="rgba(255,255,255,0.72)"
        />
      )}
      <CanvasButton x={CLUSTER.padX} y={layout.buttonY} label={primary} primary onClick={() => onAction(arranged ? 'restore' : 'arrange')} />
      <CanvasButton
        x={CLUSTER.padX + measureTextWidth(primary, 10.5) + 18 + 6}
        y={layout.buttonY}
        label="제안 무시"
        onClick={() => onAction('dismiss')}
      />
    </Group>
  )
}

let measureCanvas: CanvasRenderingContext2D | null = null
function measureTextWidth(text: string, size: number): number {
  measureCanvas ??= document.createElement('canvas').getContext('2d')
  if (!measureCanvas) return text.length * size
  measureCanvas.font = `600 ${size}px ${FONT_SANS}`
  return measureCanvas.measureText(text).width + text.length * 0.4
}
