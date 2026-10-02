declare global {
  namespace Express {
    interface Locals {
      /** requireAuth를 통과한 요청의 사용자 id */
      userId?: string;
    }
  }
}

export {};
