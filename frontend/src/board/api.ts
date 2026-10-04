import { apiFetch } from '../api/client'
import type { BoardSnapshot, BoardSummary } from './types'

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

export const inviteUrl = (token: string) => `${window.location.origin}/invite/${token}`
