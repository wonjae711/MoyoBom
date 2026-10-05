-- Up Migration
-- F-04 기사 검색: 제목+요약에서 낱말을 ILIKE '%낱말%'로 찾는다. 앞뒤가 열린 LIKE는 일반 인덱스를 못 쓰므로 3글자 조각(trigram) 인덱스를 둔다.
-- 조회 식(title || ' ' || description)과 인덱스 식이 같아야 인덱스를 쓴다 (backend/src/news/feed.ts filterConditions)

CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX articles_search_trgm_idx ON articles USING gin ((title || ' ' || description) gin_trgm_ops)
  WHERE source_type = 'api_collected';
CREATE INDEX articles_source_idx ON articles (source) WHERE source_type = 'api_collected';

-- Down Migration
DROP INDEX IF EXISTS articles_source_idx;
DROP INDEX IF EXISTS articles_search_trgm_idx;
