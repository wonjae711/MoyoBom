const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  middot: '·',
  hellip: '…',
  lsquo: '‘',
  rsquo: '’',
  ldquo: '“',
  rdquo: '”',
  ndash: '–',
  mdash: '—',
};

function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, entity: string) => {
    if (entity[0] === '#') {
      const code =
        entity[1] === 'x' || entity[1] === 'X'
          ? Number.parseInt(entity.slice(2), 16)
          : Number.parseInt(entity.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : match;
    }
    return NAMED_ENTITIES[entity.toLowerCase()] ?? match;
  });
}

/**
 * API 응답의 제목·요약을 화면에 쓸 수 있는 평문으로 바꾼다.
 * 네이버는 검색어를 <b>로 감싸고 &quot; 같은 엔티티를 섞어 보내며, Guardian trailText에도 HTML이 들어 있다.
 * 태그를 먼저 지운 뒤 엔티티를 풀어야 &lt;b&gt; 같은 본문 글자가 태그로 오인되어 사라지지 않는다.
 */
export function cleanText(input: string): string {
  const withoutTags = input.replace(/<[^>]*>/g, ' ');
  return decodeEntities(withoutTags).replace(/\s+/g, ' ').trim();
}
