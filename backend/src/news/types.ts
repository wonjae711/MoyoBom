/**
 * 수집 카테고리 (기본안 — 디자인 목업의 카테고리 칩 8개와 최종 대조 필요).
 * naverQuery: 네이버 뉴스 검색 API는 카테고리 파라미터가 없어서 이 키워드로 검색한다.
 */
export const CATEGORIES = [
  { code: 'politics', label: '정치', naverQuery: '정치' },
  { code: 'economy', label: '경제', naverQuery: '경제' },
  { code: 'society', label: '사회', naverQuery: '사회' },
  { code: 'world', label: '국제', naverQuery: '국제' },
  { code: 'tech', label: 'IT·과학', naverQuery: 'IT 과학' },
  { code: 'culture', label: '생활·문화', naverQuery: '문화' },
  { code: 'sports', label: '스포츠', naverQuery: '스포츠' },
  { code: 'entertainment', label: '연예', naverQuery: '연예' },
] as const;

export type Category = (typeof CATEGORIES)[number];
export type CategoryCode = Category['code'];

export type ProviderName = 'naver' | 'guardian';

/** 공통 포맷으로 정규화된 기사 (requirements.md F-01 처리 로직 3) */
export interface NormalizedArticle {
  title: string;
  description: string;
  source: string;
  category: CategoryCode;
  originalLink: string;
  publishedAt: Date;
}

/** 한 번의 API 요청 결과. skipped = 형식 오류로 건너뛴 기사 수 */
export interface FetchResult {
  articles: NormalizedArticle[];
  skipped: number;
}

/** DB에 저장된 기사 */
export interface Article extends NormalizedArticle {
  id: string;
  createdAt: Date;
}
