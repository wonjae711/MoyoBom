import { apiFetch } from '../api/client'
import type { FeedArticle } from '../feed/types'
import type { BoardCluster, BoardItem, BoardSnapshot, BoardSummary } from './types'

// 백엔드 backend/src/routes/boards.ts (F-05·F-06·F-07 초대)

export function listBoards(): Promise<BoardSummary[]> {
  return apiFetch<{ boards: BoardSummary[] }>('/api/boards').then((r) => r.boards)
}

export function createBoard(title: string): Promise<BoardSummary> {
  return apiFetch<{ board: BoardSummary }>('/api/boards', { method: 'POST', body: JSON.stringify({ title }) }).then(
    (r) => r.board,
  )
}

export function getBoard(boardId: string): Promise<BoardSnapshot> {
  return apiFetch<BoardSnapshot>(`/api/boards/${boardId}`)
}

export interface Invite {
  token: string
  expiresAt: string
}

/** owner만: 현재 초대 링크 (없으면 서버가 새로 만든다) */
export function getInvite(boardId: string): Promise<Invite> {
  return apiFetch<Invite>(`/api/boards/${boardId}/invite`)
}

/** owner만: 새 링크 발급 — 기존 링크는 더 이상 쓸 수 없다 */
export function reissueInvite(boardId: string): Promise<Invite> {
  return apiFetch<Invite>(`/api/boards/${boardId}/invite`, { method: 'POST' })
}

export interface InvitePreview {
  boardId: string
  title: string
  memberCount: number
}

export function previewInvite(token: string): Promise<InvitePreview> {
  return apiFetch<InvitePreview>(`/api/invites/${encodeURIComponent(token)}`)
}

export function acceptInvite(token: string): Promise<{ boardId: string; joined: boolean }> {
  return apiFetch(`/api/invites/${encodeURIComponent(token)}/accept`, { method: 'POST' })
}

/** owner만: 보드 이름 바꾸기 (접속 중인 사람에게는 board:renamed로 알려짐) */
export function renameBoard(boardId: string, title: string): Promise<void> {
  return apiFetch(`/api/boards/${boardId}`, { method: 'PATCH', body: JSON.stringify({ title }) })
}

/** owner만: 보드 삭제 */
export function deleteBoard(boardId: string): Promise<void> {
  return apiFetch(`/api/boards/${boardId}`, { method: 'DELETE' })
}

/** owner는 편집자를 내보내고, 편집자는 자기 자신을 지정하면 나간다 */
export function removeMember(boardId: string, userId: string): Promise<void> {
  return apiFetch(`/api/boards/${boardId}/members/${userId}`, { method: 'DELETE' })
}

export interface LinkResult {
  item: BoardItem
  /** 이미 저장된 기사를 다시 씀 (AI 호출 없음) */
  reused: boolean
  /** AI로 요약함 (false면 페이지 설명을 그대로 씀) */
  summarized: boolean
  /** 오늘 남은 AI 요약 횟수 */
  remaining: number
}

/** 링크로 기사 카드 추가 (F-03): 서버가 페이지를 가져와 AI로 요약하고 보드에 올린다 */
export function addLink(boardId: string, url: string, x: number, y: number): Promise<LinkResult> {
  return apiFetch<LinkResult>(`/api/boards/${boardId}/links`, { method: 'POST', body: JSON.stringify({ url, x, y }) })
}

export function linkQuota(boardId: string): Promise<number> {
  return apiFetch<{ remaining: number }>(`/api/boards/${boardId}/links/quota`).then((r) => r.remaining)
}

export interface ClusterRunResult {
  seq: number
  clusters: BoardCluster[]
  analyzed: number
  excluded: number
  remaining: number
}

/** AI 이슈 묶기 (F-08): 보드의 기사 카드를 분석해 클러스터를 새로 만든다 */
export function runClusters(boardId: string): Promise<ClusterRunResult> {
  return apiFetch<ClusterRunResult>(`/api/boards/${boardId}/clusters`, { method: 'POST' })
}

export function clusterQuota(boardId: string): Promise<number> {
  return apiFetch<{ remaining: number }>(`/api/boards/${boardId}/clusters/quota`).then((r) => r.remaining)
}

export function dismissCluster(boardId: string, clusterId: string): Promise<void> {
  return apiFetch(`/api/boards/${boardId}/clusters/${clusterId}`, { method: 'DELETE' })
}

/** "자동 정렬" / "원래대로": 옮겨진 카드들을 돌려준다 */
export function moveCluster(boardId: string, clusterId: string, action: 'arrange' | 'restore'): Promise<BoardItem[]> {
  return apiFetch<{ items: BoardItem[] }>(`/api/boards/${boardId}/clusters/${clusterId}/${action}`, { method: 'POST' }).then(
    (r) => r.items,
  )
}

/** 보드 질의응답 (F-12): 답변 근거가 된 보드의 기사 카드 */
export interface AskSource {
  n: number
  itemId: string
  articleId: string
  title: string
  source: string
  originalLink: string
  similarity: number
}

export interface AskResult {
  /** 관련 기사를 찾지 못했으면 false (안내 문구만) */
  found: boolean
  answer: string
  sources: AskSource[]
  /** 답변에 실제로 쓴 출처 번호 */
  citations: number[]
  remaining: number
}

export function askBoard(boardId: string, question: string): Promise<AskResult> {
  return apiFetch<AskResult>(`/api/boards/${boardId}/ask`, { method: 'POST', body: JSON.stringify({ question }) })
}

export function askQuota(boardId: string): Promise<number> {
  return apiFetch<{ remaining: number }>(`/api/boards/${boardId}/ask/quota`).then((r) => r.remaining)
}

/** 반대 관점 추천 (F-13): different = AI가 확신한 "다른 시각", other_source = 같은 이슈의 다른 언론사 기사 */
export interface PerspectiveItem {
  kind: 'different' | 'other_source'
  /** different일 때 보드 기사와 무엇이 다른지 */
  reason: string
  similarity: number
  article: FeedArticle
}

export interface PerspectiveResult {
  /** none = 같은 이슈의 다른 언론사 기사를 찾지 못함 (사용 횟수 차감 없음) */
  status: 'ok' | 'none'
  /** 보드 기사들이 이 이슈를 다루는 방식 (AI 한 문장) */
  boardView: string
  /** AI 비교에 성공했는지 (실패하면 모두 다른 언론사로만) */
  judged: boolean
  items: PerspectiveItem[]
  remaining: number
}

export function findPerspectives(boardId: string, clusterId: string): Promise<PerspectiveResult> {
  return apiFetch<PerspectiveResult>(`/api/boards/${boardId}/clusters/${clusterId}/perspectives`, { method: 'POST' })
}

export function perspectiveQuota(boardId: string): Promise<number> {
  return apiFetch<{ remaining: number }>(`/api/boards/${boardId}/perspectives/quota`).then((r) => r.remaining)
}

export const inviteUrl = (token: string) => `${window.location.origin}/invite/${token}`

/** 뉴스 화면에서 보드를 골라 기사 추가 (B7): 그 보드의 맨 아래 왼쪽에 놓인다 */
export function addArticleToBoard(boardId: string, articleId: string): Promise<BoardItem> {
  return apiFetch<{ item: BoardItem }>(`/api/boards/${boardId}/articles`, {
    method: 'POST',
    body: JSON.stringify({ articleId }),
  }).then((r) => r.item)
}

export interface LinkPreview {
  article: { id: string; title: string; description: string; source: string; publishedAt: string | null }
  /** 이미 저장된 기사를 다시 씀 (AI 호출 없음) */
  reused: boolean
  /** AI로 요약함 (false면 페이지 설명을 그대로 씀) */
  summarized: boolean
  /** 이미 이 보드에 있는 기사 */
  onBoard: boolean
  remaining: number
}

/** 링크 요약 미리보기 (B12): 카드는 만들지 않는다 */
export function previewLink(boardId: string, url: string): Promise<LinkPreview> {
  return apiFetch<LinkPreview>(`/api/boards/${boardId}/links/preview`, { method: 'POST', body: JSON.stringify({ url }) })
}

/** 미리보기 확인 후 "보드에 추가" */
export function confirmLink(boardId: string, url: string, x: number, y: number): Promise<BoardItem> {
  return apiFetch<{ item: BoardItem }>(`/api/boards/${boardId}/links/confirm`, {
    method: 'POST',
    body: JSON.stringify({ url, x, y }),
  }).then((r) => r.item)
}
