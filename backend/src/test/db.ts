import { resolve } from 'node:path';
import { config } from 'dotenv';
import pg from 'pg';

config({ path: resolve(import.meta.dirname, '../../../.env'), quiet: true });

/** DB 테스트용 연결 주소. 없으면 DB 테스트는 건너뛴다. */
export const testDatabaseUrl = process.env.TEST_DATABASE_URL;

/**
 * 테스트는 테이블을 비우므로 개발 DB를 가리키면 안 된다.
 * DB 이름이 `_test`로 끝나지 않으면 실행을 막는다.
 */
export function createTestPool(): pg.Pool {
  if (!testDatabaseUrl) throw new Error('TEST_DATABASE_URL이 없습니다');
  const dbName = new URL(testDatabaseUrl).pathname.slice(1);
  if (!dbName.endsWith('_test')) {
    throw new Error(`테스트 DB 이름은 _test로 끝나야 합니다 (현재: ${dbName})`);
  }
  return new pg.Pool({ connectionString: testDatabaseUrl, max: 2 });
}
