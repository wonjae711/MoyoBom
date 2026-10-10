import { resolve } from 'node:path';
import { config } from 'dotenv';
import { z } from 'zod';

// 로컬 개발: 저장소 루트의 .env를 읽는다. 배포(Docker)에서는 컨테이너 환경 변수를 그대로 쓴다.
// 이미 설정된 환경 변수는 덮어쓰지 않는다.
config({ path: resolve(import.meta.dirname, '../../../.env'), quiet: true });

/** 빈 문자열("KEY=")은 값이 없는 것으로 본다 */
const optionalString = z.preprocess((value) => (value === '' ? undefined : value), z.string().min(1).optional());

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),
  DATABASE_URL: z.url(),
  /** 뉴스 자동 수집 on/off. 개발 중 API 호출을 아끼고 싶을 때 false */
  NEWS_COLLECTOR_ENABLED: z
    .enum(['true', 'false'])
    .default('true')
    .transform((value) => value === 'true'),

  /** 로그인 토큰(JWT) 서명 키 */
  JWT_SECRET: z.string().min(32),
  /** 화면 주소. 쿠키 인증 요청·소켓 연결의 Origin 확인에 쓴다 */
  APP_ORIGIN: z.url().default('http://localhost:5173'),
  /** 믿을 프록시 범위(Express 'trust proxy'). 배포(Docker)에서는 uniquelocal — 백엔드 포트는 밖에 열지 않고 Caddy만 연결한다 */
  TRUST_PROXY: z.string().min(1).default('loopback'),

  /** 카카오 로그인 (선택). 없으면 카카오 로그인 버튼이 "준비 중"으로 표시된다 */
  KAKAO_REST_API_KEY: optionalString,
  KAKAO_CLIENT_SECRET: optionalString,
  /** 네이버 로그인 (선택). 뉴스 검색용 NAVER_CLIENT_ID와 다른 앱의 키. 없으면 네이버 로그인 버튼이 "준비 중"으로 표시된다 */
  NAVER_LOGIN_CLIENT_ID: optionalString,
  NAVER_LOGIN_CLIENT_SECRET: optionalString,

  /** 사진 카드(F-05) S3 비공개 버킷 (선택). 없으면 사진 카드를 쓸 수 없다. 자격 증명은 SDK 기본 순서(서버: EC2 인스턴스 역할) */
  PHOTO_BUCKET: optionalString,
  AWS_REGION: z.string().min(1).default('ap-northeast-2'),

  NAVER_CLIENT_ID: z.string().min(1),
  NAVER_CLIENT_SECRET: z.string().min(1),
  GUARDIAN_API_KEY: z.string().min(1),
  OPENAI_API_KEY: z.string().min(1),
  /** 링크 요약(F-03)에 쓰는 OpenAI 모델 */
  OPENAI_SUMMARY_MODEL: z.string().min(1).default('gpt-5.4-mini'),
  /** 링크 요약 하루 한도 (2026-10-04 확정 B: 계정·IP·서비스 전체, 한국 시간 자정에 초기화) */
  AI_SUMMARY_LIMIT_USER: z.coerce.number().int().min(0).default(20),
  AI_SUMMARY_LIMIT_IP: z.coerce.number().int().min(0).default(50),
  AI_SUMMARY_LIMIT_TOTAL: z.coerce.number().int().min(0).default(300),
  /** AI 클러스터링(F-08): 같은 이슈로 묶는 코사인 유사도 기준(2026-10-04 실데이터로 0.32 — 같은 주제 0.34~0.64, 다른 주제 최대 0.33)과 하루 분석 한도 */
  CLUSTER_SIMILARITY_THRESHOLD: z.coerce.number().min(0).max(1).default(0.32),
  AI_CLUSTER_LIMIT_USER: z.coerce.number().int().min(0).default(10),
  AI_CLUSTER_LIMIT_IP: z.coerce.number().int().min(0).default(30),
  AI_CLUSTER_LIMIT_TOTAL: z.coerce.number().int().min(0).default(200),
  /** 보드 질의응답 (F-12): 근거로 쓸 최소 유사도(실제 기사로 조정: 관련 0.25~0.59, 무관 ~0.23), 하루 질문 한도 */
  QA_MIN_SIMILARITY: z.coerce.number().min(0).max(1).default(0.25),
  AI_QA_LIMIT_USER: z.coerce.number().int().min(0).default(30),
  AI_QA_LIMIT_IP: z.coerce.number().int().min(0).default(60),
  AI_QA_LIMIT_TOTAL: z.coerce.number().int().min(0).default(300),
  /** 뉴스 다이제스트 (F-09): 예약 실행 서비스 전체 하루 한도, "지금 받아보기" 하루 한도 */
  AI_DIGEST_LIMIT_TOTAL: z.coerce.number().int().min(0).default(300),
  AI_DIGEST_NOW_LIMIT_USER: z.coerce.number().int().min(0).default(5),
  AI_DIGEST_NOW_LIMIT_IP: z.coerce.number().int().min(0).default(10),
  AI_DIGEST_NOW_LIMIT_TOTAL: z.coerce.number().int().min(0).default(100),
});

export type Env = z.infer<typeof envSchema>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    // 값은 출력하지 않고, 어떤 키가 문제인지만 알려준다.
    const keys = parsed.error.issues.map((issue) => issue.path.join('.')).join(', ');
    throw new Error(`환경 변수가 없거나 형식이 잘못되었습니다: ${keys}`);
  }
  return parsed.data;
}
