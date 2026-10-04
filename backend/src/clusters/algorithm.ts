/** 코사인 유사도 (-1~1). 길이가 0인 벡터는 0 */
export function cosine(a: number[], b: number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i]! * b[i]!;
    na += a[i]! * a[i]!;
    nb += b[i]! * b[i]!;
  }
  return na === 0 || nb === 0 ? 0 : dot / Math.sqrt(na * nb);
}

/**
 * 평균 연결(average linkage) 계층적 군집화 (requirements.md F-08 처리 로직 3).
 * 처음엔 기사 하나가 한 그룹이고, 그룹 사이 "모든 쌍의 평균 유사도"가 가장 높은 두 그룹을 합치는 일을
 * 그 평균이 threshold 아래로 떨어질 때까지 반복한다. A–B, B–C만 비슷하고 A–C가 다르면 평균이 낮아져 억지로 묶이지 않는다.
 * 결과는 2개 이상 묶인 그룹만, 각 그룹 안은 원래 순서, 그룹은 첫 원소 순서로 정렬 (같은 입력이면 항상 같은 결과).
 */
export function averageLinkage(vectors: number[][], threshold: number): number[][] {
  const n = vectors.length;
  const sim: number[][] = Array.from({ length: n }, () => new Array<number>(n).fill(0));
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      sim[i]![j] = sim[j]![i] = cosine(vectors[i]!, vectors[j]!);
    }
  }

  let groups: number[][] = vectors.map((_, i) => [i]);
  const linkage = (a: number[], b: number[]) => {
    let total = 0;
    for (const i of a) for (const j of b) total += sim[i]![j]!;
    return total / (a.length * b.length);
  };

  for (;;) {
    let best = -Infinity;
    let pair: [number, number] | null = null;
    for (let x = 0; x < groups.length; x++) {
      for (let y = x + 1; y < groups.length; y++) {
        const value = linkage(groups[x]!, groups[y]!);
        if (value > best) {
          best = value;
          pair = [x, y];
        }
      }
    }
    if (!pair || best < threshold) break;
    const [x, y] = pair;
    const merged = [...groups[x]!, ...groups[y]!].sort((p, q) => p - q);
    groups = groups.filter((_, i) => i !== x && i !== y);
    groups.push(merged);
  }

  return groups.filter((g) => g.length >= 2).sort((a, b) => a[0]! - b[0]!);
}

/** 클러스터 카드를 놓을 곳: 묶인 카드들의 가운데, 가장 위 카드보다 위쪽 */
export function clusterPosition(points: { x: number; y: number }[]): { x: number; y: number } {
  const cx = points.reduce((sum, p) => sum + p.x, 0) / points.length;
  const top = Math.min(...points.map((p) => p.y));
  return { x: Math.round(cx), y: Math.round(top - 190) };
}
