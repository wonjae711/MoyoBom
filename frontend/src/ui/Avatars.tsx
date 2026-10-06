import './common.css'

/** 참여자 동그라미 (닉네임 첫 글자). 최대 max명, 나머지는 +N */
export function Avatars({ names, size = 30, max = 4 }: { names: string[]; size?: number; max?: number }) {
  const shown = names.slice(0, max)
  const rest = names.length - shown.length
  return (
    <div className="avatars" aria-label={`참여자 ${names.length}명: ${names.join(', ')}`}>
      {shown.map((name, i) => (
        <span
          key={`${name}-${i}`}
          className="avatar"
          title={name}
          style={{ width: size, height: size, fontSize: size * 0.4 }}
        >
          {Array.from(name)[0] ?? '?'}
        </span>
      ))}
      {rest > 0 && (
        <span className="avatar avatar--rest" style={{ width: size, height: size, fontSize: size * 0.34 }}>
          +{rest}
        </span>
      )}
    </div>
  )
}
