import { describe, expect, it } from 'vitest';
import { averageLinkage, clusterPosition, cosine } from './algorithm.js';

describe('코사인 유사도', () => {
  it('같은 방향 1, 직각 0, 반대 -1, 영벡터 0', () => {
    expect(cosine([1, 0], [2, 0])).toBeCloseTo(1);
    expect(cosine([1, 0], [0, 3])).toBeCloseTo(0);
    expect(cosine([1, 0], [-1, 0])).toBeCloseTo(-1);
    expect(cosine([0, 0], [1, 0])).toBe(0);
  });
});

describe('[F-08] 평균 연결 계층적 군집화', () => {
  // 0·1·2는 x축 근처(반도체), 3·4는 y축 근처(중동), 5는 홀로 z축
  const vectors = [
    [1, 0.1, 0],
    [0.95, 0.15, 0],
    [0.9, 0.05, 0.1],
    [0.1, 1, 0],
    [0.05, 0.9, 0.1],
    [0, 0, 1],
  ];

  it('비슷한 기사끼리 묶고, 혼자인 기사는 클러스터로 만들지 않는다', () => {
    expect(averageLinkage(vectors, 0.8)).toEqual([
      [0, 1, 2],
      [3, 4],
    ]);
  });

  it('A–B, B–C만 비슷하고 A–C가 다르면 평균이 낮아 셋을 억지로 묶지 않는다', () => {
    const a = [1, 0];
    const b = [Math.SQRT1_2, Math.SQRT1_2]; // A·C와 각각 0.71
    const c = [0, 1]; // A와 0
    const groups = averageLinkage([a, b, c], 0.6);
    expect(groups).toHaveLength(1);
    expect(groups[0]).toHaveLength(2); // 셋이 한 묶음이 되지는 않는다
  });

  it('기준값으로 묶는 정도를 조절한다 — 너무 낮으면 전부 한 그룹, 너무 높으면 전부 따로 (F-08 예외 처리)', () => {
    expect(averageLinkage(vectors, -1)).toEqual([[0, 1, 2, 3, 4, 5]]);
    expect(averageLinkage(vectors, 0.9999)).toEqual([]);
  });

  it('같은 입력이면 항상 같은 결과', () => {
    expect(averageLinkage(vectors, 0.8)).toEqual(averageLinkage(vectors, 0.8));
  });

  it('클러스터 카드는 묶인 카드들의 가운데 위쪽에 놓는다', () => {
    expect(
      clusterPosition([
        { x: 100, y: 300 },
        { x: 300, y: 200 },
      ]),
    ).toEqual({ x: 200, y: 10 });
  });
});
