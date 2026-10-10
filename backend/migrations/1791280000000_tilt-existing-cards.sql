-- Up Migration
-- 탐정 보드 느낌 (2026-10-10): 새 카드는 -4°~+4°로 기울어져 붙는다. 이미 있던(기울기 0) 카드도 같은 범위로 한 번 기울인다
UPDATE board_items SET rotation = round((random() * 8 - 4) * 2) / 2 WHERE rotation = 0;

-- Down Migration
-- 원래 각도를 남기지 않으므로 되돌리지 않는다 (모양만 바뀌는 값)
