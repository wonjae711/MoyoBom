import { apiFetch } from '../api/client'

/** 서버와 같은 조건 (requirements F-05 처리 로직 7). 최종 검사는 서버·S3가 한다 */
export const PHOTO_TYPES = ['image/jpeg', 'image/png', 'image/webp']
export const PHOTO_ACCEPT = PHOTO_TYPES.join(',')
export const MAX_PHOTO_BYTES = 10 * 1024 * 1024

/** 올리기 전에 고를 수 있는 사진인지 (문제가 있으면 안내 문구) */
export function checkPhoto(file: File): string | null {
  if (!PHOTO_TYPES.includes(file.type)) return 'jpg·png·webp 사진만 올릴 수 있어요.'
  if (file.size > MAX_PHOTO_BYTES) return '사진은 10MB 이하만 올릴 수 있어요.'
  return null
}

export class PhotoUploadError extends Error {}

/**
 * 서버에서 업로드 허가증(presigned POST)을 받아 S3에 바로 올린다. 올라간 사진의 key를 돌려준다.
 * 이 key로 card:add(photo)를 보내야 카드가 된다.
 */
export async function uploadPhoto(boardId: string, file: File): Promise<string> {
  const ticket = await apiFetch<{ key: string; url: string; fields: Record<string, string> }>(`/api/boards/${boardId}/photos`, {
    method: 'POST',
    body: JSON.stringify({ contentType: file.type, size: file.size }),
  })
  const form = new FormData()
  for (const [name, value] of Object.entries(ticket.fields)) form.append(name, value)
  form.append('file', file) // S3는 파일이 맨 마지막 칸이어야 한다
  const res = await fetch(ticket.url, { method: 'POST', body: form }).catch(() => null)
  if (!res?.ok) throw new PhotoUploadError('사진을 올리지 못했어요. 잠시 후 다시 시도해 주세요.')
  return ticket.key
}
