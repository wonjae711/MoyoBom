import { afterEach, describe, expect, it, vi } from 'vitest'
import { MAX_PHOTO_BYTES, PhotoUploadError, checkPhoto, uploadPhoto } from './photoUpload'

const file = (type: string, size = 100) => new File([new Uint8Array(size)], 'photo', { type })

describe('[F-05] 사진 카드 업로드', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('jpg·png·webp, 10MB 이하만 고를 수 있다', () => {
    expect(checkPhoto(file('image/jpeg'))).toBeNull()
    expect(checkPhoto(file('image/webp'))).toBeNull()
    expect(checkPhoto(file('image/gif'))).toMatch('jpg·png·webp')
    expect(checkPhoto(file('image/png', MAX_PHOTO_BYTES + 1))).toMatch('10MB')
  })

  it('허가증을 받아 fields 다음 맨 끝에 파일을 넣어 S3로 보내고 key를 돌려준다', async () => {
    const calls: { url: string; init?: RequestInit }[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        calls.push({ url, init })
        if (url === '/api/boards/7/photos')
          return Response.json({ key: 'boards/7/a.png', url: 'https://s3.test/photos', fields: { key: 'boards/7/a.png', Policy: 'p' } })
        return new Response(null, { status: 204 })
      }),
    )
    const photo = file('image/png', 1234)
    expect(await uploadPhoto('7', photo)).toBe('boards/7/a.png')
    expect(JSON.parse(calls[0]!.init!.body as string)).toEqual({ contentType: 'image/png', size: 1234 })
    const form = calls[1]!.init!.body as FormData
    expect(calls[1]!.url).toBe('https://s3.test/photos')
    expect([...form.keys()]).toEqual(['key', 'Policy', 'file'])
  })

  it('[예외] S3가 거절하면(크기·형식·만료) 다시 시도 안내 에러', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) =>
        url.startsWith('/api') ? Response.json({ key: 'k', url: 'https://s3.test/photos', fields: {} }) : new Response(null, { status: 403 }),
      ),
    )
    await expect(uploadPhoto('7', file('image/png'))).rejects.toBeInstanceOf(PhotoUploadError)
  })
})
