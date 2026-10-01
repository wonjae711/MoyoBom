-- Up Migration
-- pgvector: ARTICLES.embedding(vector(1536))에 사용 (docs/erd.md)
CREATE EXTENSION IF NOT EXISTS vector;

-- Down Migration
DROP EXTENSION IF EXISTS vector;
