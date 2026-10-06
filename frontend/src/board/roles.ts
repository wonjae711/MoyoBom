import type { BoardRole } from './types'

/** 화면에 보이는 역할 이름 (사용자 결정 2026-10-06: 소유자/참여자) */
export const ROLE_LABEL: Record<BoardRole, string> = { owner: '소유자', editor: '참여자' }
