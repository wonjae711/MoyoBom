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

  /** 카카오 로그인 (선택). 없으면 카카오 로그인 버튼이 "준비 중"으로 표시된다 */
  KAKAO_REST_API_KEY: optionalString,
  KAKAO_CLIENT_SECRET: optionalString,

  NAVER_CLIENT_ID: z.string().min(1),
  NAVER_CLIENT_SECRET: z.string().min(1),
  GUARDIAN_API_KEY: z.string().min(1),
  OPENAI_API_KEY: z.string().min(1),
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
