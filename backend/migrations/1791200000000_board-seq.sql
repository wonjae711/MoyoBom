-- Up Migration
-- L-02·L-05: 보드별 변경 순번. 카드 변경 트랜잭션은 먼저 boards 행의 seq를 올려(행 잠금) 같은 보드의 변경을 줄 세운다.
-- 잠금을 커밋까지 쥐고 있으므로 seq 순서 = 커밋 순서. 카드의 version은 마지막으로 바뀐 때의 seq다.
-- (updated_at은 트랜잭션 시작 시각이라 커밋 순서와 다를 수 있고 밀리초로 잘리면 같아질 수 있어 순서 비교에 쓰지 않는다)

ALTER TABLE boards ADD COLUMN seq bigint NOT NULL DEFAULT 0;
ALTER TABLE board_items ADD COLUMN version bigint NOT NULL DEFAULT 0;

-- Down Migration
ALTER TABLE board_items DROP COLUMN IF EXISTS version;
ALTER TABLE boards DROP COLUMN IF EXISTS seq;
