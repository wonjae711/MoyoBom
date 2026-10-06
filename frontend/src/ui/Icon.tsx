import type { ReactNode } from 'react'

/** 프로토타입 아이콘 (24 그리드, 선 1.7px). 장식용이라 aria-hidden — 아이콘만 있는 버튼은 aria-label을 따로 단다 */
const PATHS = {
  back: ['M15 18l-6-6 6-6'],
  plus: ['M12 5v14', 'M5 12h14'],
  minus: ['M5 12h14'],
  search: [<circle key="c" cx={11} cy={11} r={7} />, 'M20 20l-3.5-3.5'],
  cursor: ['M5 3l14 7-6 2-2 6z'],
  hand: ['M5 9l-3 3 3 3', 'M9 5l3-3 3 3', 'M15 19l-3 3-3-3', 'M19 9l3 3-3 3', 'M2 12h20', 'M12 2v20'],
  memo: ['M5 4h14v11l-5 5H5z', 'M14 20v-5h5'],
  link: [
    'M10 14a4 4 0 0 0 5.66 0l3-3a4 4 0 0 0-5.66-5.66l-1 1',
    'M14 10a4 4 0 0 0-5.66 0l-3 3a4 4 0 0 0 5.66 5.66l1-1',
  ],
  image: [<rect key="r" x={3} y={4} width={18} height={16} rx={2} />, <circle key="c" cx={9} cy={10} r={2} />, 'M21 16l-5-5-9 9'],
  group: [
    <rect key="a" x={3} y={4} width={8} height={7} rx={1.5} />,
    <rect key="b" x={13} y={4} width={8} height={7} rx={1.5} />,
    <rect key="c" x={3} y={13} width={18} height={7} rx={1.5} />,
  ],
  ext: ['M14 4h6v6', 'M20 4l-9 9', 'M18 14v5H5V6h5'],
  more: [<circle key="a" cx={5} cy={12} r={1} />, <circle key="b" cx={12} cy={12} r={1} />, <circle key="c" cx={19} cy={12} r={1} />],
  fit: ['M4 9V4h5', 'M20 9V4h-5', 'M4 15v5h5', 'M20 15v5h-5'],
  users: [<circle key="c" cx={9} cy={8} r={3.5} />, 'M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6', 'M16 4.6a3.5 3.5 0 0 1 0 6.8', 'M21 20c0-2.6-1.7-4.8-4-5.6'],
  bars: ['M4 6h12', 'M4 12h16', 'M4 18h8'],
  panel: [<rect key="r" x={3} y={4} width={18} height={16} rx={2} />, 'M9 4v16'],
  close: ['M6 6l12 12', 'M18 6L6 18'],
  check: ['M5 12l5 5 9-10'],
  alert: [<circle key="c" cx={12} cy={12} r={9} />, 'M12 8v5', 'M12 16h.01'],
  refresh: ['M20 11a8 8 0 1 0-2.3 5.7', 'M20 4v7h-7'],
  copy: [<rect key="r" x={8} y={8} width={12} height={12} rx={2} />, 'M16 8V4H4v12h4'],
  filter: ['M4 6h16', 'M7 12h10', 'M10 18h4'],
  trash: ['M4 7h16', 'M10 11v6', 'M14 11v6', 'M6 7l1 13h10l1-13', 'M9 7V4h6v3'],
  edit: ['M4 20h4L19 9l-4-4L4 16z'],
  info: [<circle key="c" cx={12} cy={12} r={9} />, 'M12 11v5', 'M12 8h.01'],
  upload: ['M12 16V4', 'M7 9l5-5 5 5', 'M4 16v4h16v-4'],
  drag: [
    <circle key="a" cx={9} cy={6} r={1} />,
    <circle key="b" cx={15} cy={6} r={1} />,
    <circle key="c" cx={9} cy={12} r={1} />,
    <circle key="d" cx={15} cy={12} r={1} />,
    <circle key="e" cx={9} cy={18} r={1} />,
    <circle key="f" cx={15} cy={18} r={1} />,
  ],
  // 앱에만 있는 기능의 아이콘 (같은 선 규칙)
  connect: [<circle key="a" cx={6} cy={6} r={2.5} />, <circle key="b" cx={18} cy={18} r={2.5} />, 'M8 8l8 8'],
  ask: [<circle key="c" cx={12} cy={12} r={9} />, 'M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.6v.6', 'M12 17h.01'],
  bell: ['M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15z', 'M10 20a2 2 0 0 0 4 0'],
} satisfies Record<string, (string | ReactNode)[]>

export type IconName = keyof typeof PATHS

export function Icon({ name, size = 18 }: { name: IconName; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      style={{ flex: 'none' }}
    >
      {PATHS[name].map((d, i) => (typeof d === 'string' ? <path key={i} d={d} /> : d))}
    </svg>
  )
}

/** 처리 중 표시 (글자 색을 따른다) */
export function Spinner({ size = 14 }: { size?: number }) {
  return <span className="spinner" aria-hidden="true" style={{ width: size, height: size }} />
}
