import { useState } from 'react'

/**
 * 기사 대표 사진 (언론사가 밝힌 og:image 주소를 그대로 보여 준다 — 사진 파일은 저장하지 않음).
 * https 주소만 쓰고, 언론사에 우리 화면 주소가 전달되지 않게 referrer를 보내지 않는다. 불러오지 못하면 아예 숨긴다
 */
export function Thumb({ src, className }: { src: string | null | undefined; className?: string }) {
  const [failed, setFailed] = useState(false)
  if (!src || failed || !src.startsWith('https://')) return null
  return (
    <img
      className={className}
      src={src}
      alt=""
      loading="lazy"
      decoding="async"
      referrerPolicy="no-referrer"
      draggable={false}
      onError={() => setFailed(true)}
    />
  )
}
