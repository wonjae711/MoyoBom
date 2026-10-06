/**
 * 수집 카테고리 (기본안 — 디자인 목업의 카테고리 칩 8개와 최종 대조 필요). 배열 순서 = 화면 표시 순서.
 *
 * naverQueries: 네이버 뉴스 검색 API는 카테고리 파라미터가 없어 키워드 검색으로 대신한다.
 * '국제'처럼 넓은 단어는 '국제뉴스'(언론사명)·'국제공항'에도 걸려 오분류가 많았기 때문에(2026-10-02 실수집 확인),
 * 그 분야 기사에만 주로 나오는 구체적인 키워드를 여러 개 쓴다. 키워드는 실제 검색 결과를 보고 조정한다.
 */
export const CATEGORIES = [
  { code: 'politics', label: '정치', naverQueries: ['국회', '대통령실', '여야'] },
  { code: 'economy', label: '경제', naverQueries: ['금리', '코스피', '환율'] },
  { code: 'society', label: '사회', naverQueries: ['경찰', '법원 판결', '교육청'] },
  { code: 'world', label: '국제', naverQueries: ['정상회담', '외교부', '백악관'] },
  // '인공지능'·'반도체'는 경제 기사에 훨씬 많이 나와 IT·과학 분류가 대부분 틀렸다 (2026-10-02 확인)
  { code: 'tech', label: 'IT·과학', naverQueries: ['연구팀 개발', '스마트폰', '과학자'] },
  { code: 'culture', label: '생활·문화', naverQueries: ['전시회', '박물관'] },
  { code: 'sports', label: '스포츠', naverQueries: ['프로야구', 'K리그', '금메달'] },
  { code: 'entertainment', label: '연예', naverQueries: ['아이돌', '드라마 출연', '예능'] },
] as const;

/**
 * 네이버 검색 순서. 같은 기사가 여러 카테고리 검색에 걸리면 먼저 검색한 카테고리로 분류되므로
 * 주제가 뚜렷한 카테고리(연예·스포츠 등)를 먼저, 넓은 카테고리(사회·문화)를 나중에 검색한다.
 */
export const NAVER_SEARCH_ORDER: readonly CategoryCode[] = [
  'entertainment',
  'sports',
  'economy',
  'politics',
  'world',
  'tech', // 경제·정치 기사에도 기술 용어가 자주 나오므로 그 뒤에 검색
  'society',
  'culture',
];

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
  /** 대표 사진 주소 (Guardian은 API가 주고, 네이버는 수집 뒤 원문 페이지의 og:image로 채운다) */
  imageUrl?: string | null;
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
