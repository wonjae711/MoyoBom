import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // DB 테스트 파일들이 같은 테스트 DB 테이블을 TRUNCATE하므로 파일을 동시에 돌리지 않는다
    fileParallelism: false,
  },
});
