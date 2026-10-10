import type { CategoryCode } from '../news/types.js';

export type BoardRole = 'owner' | 'editor';
export type ItemType = 'article' | 'memo' | 'photo';

/** 보드 목록 한 줄 (F-06) */
export interface BoardSummary {
  id: string;
  title: string;
  role: BoardRole;
  memberCount: number;
  itemCount: number;
  updatedAt: string;
  /** 보드 목록 미리보기용 카드 배치 (위에 있는 카드부터 최대 10장, 좌표만) */
  thumb: BoardThumbItem[];
}

export interface BoardThumbItem {
  x: number;
  y: number;
  type: ItemType;
}

export interface BoardMember {
  userId: string;
  nickname: string;
  role: BoardRole;
}

/** 기사 카드에 함께 내려주는 기사 정보 */
export interface ItemArticle {
  title: string;
  description: string;
  source: string;
  category: CategoryCode | null;
  originalLink: string;
  publishedAt: string | null;
  /** 저장(수집)된 시각 */
  collectedAt: string;
  /** 사용자가 링크로 추가한 기사 (카드에 "링크 요약" 표시) */
  submitted: boolean;
  /** 대표 사진 주소 (없으면 null) */
  imageUrl: string | null;
}

export interface BoardItem {
  id: string;
  type: ItemType;
  articleId: string | null;
  article: ItemArticle | null;
  content: string | null;
  imageKey: string | null;
  x: number;
  y: number;
  rotation: number;
  /** 카드 배율 (0.6~2.5, 1 = 기본 크기) — 카드를 통째로 확대·축소 */
  scale: number;
  zIndex: number;
  createdBy: string | null;
  updatedAt: string;
  /** 마지막으로 바뀐 때의 보드 변경 순번 (L-02). 클라이언트는 더 큰 version만 적용한다 */
  version: number;
  /** AI 자동 정렬로 옮겨져 "원래대로" 되돌릴 수 있는 상태 (F-08) */
  arranged: boolean;
}

/** 카드 간 수동 연결선 (F-10). 두 카드 id는 항상 작은 쪽이 fromId */
export interface BoardConnection {
  id: string;
  fromId: string;
  toId: string;
  createdBy: string | null;
  /** 연결을 만든 때의 보드 변경 순번 */
  version: number;
}

/** AI 이슈 클러스터 (F-08). 카드 묶음과 AI 요약, 보드 위 클러스터 카드 위치 */
export interface BoardCluster {
  id: string;
  title: string;
  summary: string;
  x: number;
  y: number;
  itemIds: string[];
}

/** 보드에 들어오거나 다시 연결했을 때 받는 전체 상태 */
export interface BoardSnapshot {
  /** seq: 이 스냅샷에 반영된 마지막 변경 순번. 이보다 큰 version의 이벤트만 스냅샷 위에 적용한다 */
  board: { id: string; title: string; ownerId: string; updatedAt: string; seq: number };
  role: BoardRole;
  members: BoardMember[];
  items: BoardItem[];
  clusters: BoardCluster[];
  connections: BoardConnection[];
}

export type BoardErrorCode = 'not_found' | 'forbidden' | 'invalid' | 'invite_invalid';

/** 보드 작업 실패. code로 HTTP 상태·소켓 ack 에러를 정한다 */
export class BoardError extends Error {
  constructor(
    readonly code: BoardErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'BoardError';
  }
}
