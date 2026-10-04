-- Up Migration
-- C-10: 재연결 시 "마지막으로 받은 위치 뒤에 수집된 기사"를 수집 순서로 찾는 조회(GET /api/articles?collectedAfter=)용

CREATE INDEX articles_collected_idx ON articles (created_at, id) WHERE source_type = 'api_collected';

-- Down Migration
DROP INDEX IF EXISTS articles_collected_idx;
