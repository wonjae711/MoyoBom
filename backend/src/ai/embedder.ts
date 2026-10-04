/** 텍스트 → 벡터 (F-08). OpenAI text-embedding-3-small, 1536차원 (docs/erd.md ARTICLES.embedding) */
export interface Embedder {
  /** texts와 같은 순서의 벡터. 전체 실패면 EmbeddingError */
  embed(texts: string[]): Promise<number[][]>;
}

export class EmbeddingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EmbeddingError';
  }
}

export const EMBEDDING_MODEL = 'text-embedding-3-small';
export const EMBEDDING_DIMENSIONS = 1536;

/** 응답 에러 메시지에 키·요청 내용을 넣지 않는다 */
export function createOpenAiEmbedder(apiKey: string, fetchImpl: typeof fetch = fetch): Embedder {
  return {
    async embed(texts) {
      if (texts.length === 0) return [];
      let res: Response;
      try {
        res = await fetchImpl('https://api.openai.com/v1/embeddings', {
          method: 'POST',
          headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
          signal: AbortSignal.timeout(30_000),
          body: JSON.stringify({ model: EMBEDDING_MODEL, input: texts.map((t) => t.slice(0, 4000)) }),
        });
      } catch {
        throw new EmbeddingError('임베딩 서비스에 연결하지 못했습니다');
      }
      if (!res.ok) throw new EmbeddingError(`임베딩 서비스 오류 (HTTP ${res.status})`);
      const body = (await res.json().catch(() => null)) as { data?: { index: number; embedding: number[] }[] } | null;
      const data = body?.data;
      if (!data || data.length !== texts.length) throw new EmbeddingError('임베딩 결과가 올바르지 않습니다');
      const vectors = new Array<number[]>(texts.length);
      for (const row of data) vectors[row.index] = row.embedding;
      if (vectors.some((v) => !Array.isArray(v) || v.length !== EMBEDDING_DIMENSIONS)) {
        throw new EmbeddingError('임베딩 결과가 올바르지 않습니다');
      }
      return vectors;
    },
  };
}
