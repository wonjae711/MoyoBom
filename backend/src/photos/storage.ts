import {
  DeleteObjectsCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  S3Client,
  S3ServiceException,
} from '@aws-sdk/client-s3';
import { createPresignedPost } from '@aws-sdk/s3-presigned-post';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

/** 브라우저가 S3에 바로 올릴 때 쓰는 presigned POST (url에 fields와 파일을 form으로 보낸다) */
export interface UploadTicket {
  url: string;
  fields: Record<string, string>;
}

export interface StoredObject {
  key: string;
  size: number;
  lastModified: Date;
}

/** 사진 저장소 (F-05 사진 카드). 실제로는 S3 비공개 버킷, 테스트에서는 가짜를 주입한다 */
export interface PhotoStorage {
  /** 크기·형식 조건을 건 업로드 허가증. 조건은 S3가 직접 검사한다 */
  createUpload(key: string, contentType: string, maxBytes: number, expiresSeconds: number): Promise<UploadTicket>;
  /** 올라간 객체의 크기·형식 (없으면 null) */
  head(key: string): Promise<{ size: number; contentType: string | null } | null>;
  /** 잠깐 쓸 수 있는 조회 주소 */
  signedGetUrl(key: string, expiresSeconds: number): Promise<string>;
  delete(keys: string[]): Promise<void>;
  list(prefix: string): Promise<StoredObject[]>;
}

/**
 * S3 구현. 자격 증명은 SDK 기본 순서로 찾는다 — 서버(EC2)에서는 인스턴스 역할(moyobom-ec2-ssm)의 임시 자격 증명.
 * 버킷은 공개 차단 상태이고, 사진은 presigned 주소로만 오간다.
 */
export function createS3Storage(options: { bucket: string; region: string }): PhotoStorage {
  const s3 = new S3Client({ region: options.region });
  const Bucket = options.bucket;
  return {
    async createUpload(key, contentType, maxBytes, expiresSeconds) {
      return createPresignedPost(s3, {
        Bucket,
        Key: key,
        Conditions: [
          ['content-length-range', 1, maxBytes],
          ['eq', '$Content-Type', contentType],
        ],
        Fields: { 'Content-Type': contentType },
        Expires: expiresSeconds,
      });
    },
    async head(key) {
      try {
        const out = await s3.send(new HeadObjectCommand({ Bucket, Key: key }));
        return { size: out.ContentLength ?? 0, contentType: out.ContentType ?? null };
      } catch (error) {
        if (error instanceof S3ServiceException && error.$metadata.httpStatusCode === 404) return null;
        throw error;
      }
    },
    async signedGetUrl(key, expiresSeconds) {
      return getSignedUrl(s3, new GetObjectCommand({ Bucket, Key: key }), { expiresIn: expiresSeconds });
    },
    async delete(keys) {
      // 한 번에 최대 1000개
      for (let i = 0; i < keys.length; i += 1000) {
        const chunk = keys.slice(i, i + 1000);
        await s3.send(new DeleteObjectsCommand({ Bucket, Delete: { Objects: chunk.map((Key) => ({ Key })), Quiet: true } }));
      }
    },
    async list(prefix) {
      const objects: StoredObject[] = [];
      let token: string | undefined;
      do {
        const out = await s3.send(new ListObjectsV2Command({ Bucket, Prefix: prefix, ContinuationToken: token }));
        for (const o of out.Contents ?? []) {
          if (o.Key) objects.push({ key: o.Key, size: o.Size ?? 0, lastModified: o.LastModified ?? new Date(0) });
        }
        token = out.IsTruncated ? out.NextContinuationToken : undefined;
      } while (token);
      return objects;
    },
  };
}
