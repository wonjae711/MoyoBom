/**
 * press.ts 매핑이 늘어났을 때, 이미 도메인으로 저장된 기사의 source를 언론사명으로 갱신한다.
 * 실행: npx tsx --env-file-if-exists=../.env scripts/backfill-press.ts
 */
import pg from 'pg';
import { resolvePress } from '../src/news/press.js';

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const { rows } = await pool.query<{ id: string; source: string; original_link: string }>(
  `SELECT id, source, original_link FROM articles WHERE source_type = 'api_collected' AND source LIKE '%.%'`,
);
let updated = 0;
for (const row of rows) {
  const press = resolvePress(row.original_link);
  if (press && press !== row.source) {
    await pool.query('UPDATE articles SET source = $1 WHERE id = $2', [press, row.id]);
    updated++;
  }
}
console.log(`도메인으로 저장된 기사 ${rows.length}건 중 ${updated}건을 언론사명으로 갱신`);
await pool.end();
