import type { LineWeight } from './types'

// vobject-node.tsx / line-node.tsx / curve-node.tsx から共通定数を集約。

export const GRID = 12

export const PIECE_COLORS: Record<
	string,
	{ fill: string; border: string; text: string }
> = {
	yellow: { fill: '#fef3c7', border: '#e0d77a', text: '#1c1917' },
	orange: { fill: '#ffd8a8', border: '#e8b06a', text: '#1c1917' },
	red: { fill: '#ffc9c9', border: '#e09393', text: '#1c1917' },
	green: { fill: '#b2f2bb', border: '#8fd694', text: '#1c1917' },
	blue: { fill: '#a5d8ff', border: '#7fb8e8', text: '#1c1917' },
	violet: { fill: '#d0bfff', border: '#a98fe8', text: '#1c1917' },
	grey: { fill: '#e9ecef', border: '#c0c6cc', text: '#1c1917' },
	white: { fill: '#ffffff', border: '#cccccc', text: '#1c1917' },
	none: { fill: 'transparent', border: 'transparent', text: '#1c1917' },
}

// 文字色パレット（'auto' は空=テーマ既定色を使う）
export const TEXT_COLORS: Record<string, string> = {
	auto: '',
	white: '#f5f2ea',
	black: '#1c1917',
	gray: '#6b7280',
	red: '#c92a2a',
	blue: '#1864c8',
	green: '#2b8a3e',
}

// 線・図形・曲線の線色パレット（'default' = 従来の #333）
export const LINE_COLORS: Record<string, string> = {
	default: '#333',
	black: '#1c1917',
	gray: '#adb5bd',
	red: '#c92a2a',
	blue: '#1864c8',
	green: '#2b8a3e',
	brown: '#a0653f',
}

export const STROKE_COLOR = '#333'

export const STROKES: Record<
	Exclude<LineWeight, 'double'>,
	{ width: number; dash?: string; cap?: 'butt' | 'round' | 'square' }
> = {
	thin: { width: 1.5 },
	bold: { width: 3 },
	xbold: { width: 6 },
	dash: { width: 1.5, dash: '7 4' },
	dot: { width: 1.5, dash: '1.5 4.5', cap: 'round' },
	chain: { width: 1.5, dash: '14 3 2 3' },
}
// 二重線は dasharray では表現できないため 2 本の平行線で描く
export const DOUBLE_W = 1.5
export const DOUBLE_GAP = 4

export const WEIGHTS: [LineWeight, string][] = [
	['thin', '細'],
	['bold', '太'],
	['xbold', '極太'],
	['dash', '破線'],
	['dot', '点線'],
	['chain', '一鎖'],
	['double', '二重'],
]

export const CAP_OPTS = [
	['none', 'なし'],
	['arrow', '→'],
	['dot', '●'],
] as const

export const SIZE_OPTS = [
	['s', 'S'],
	['m', 'M'],
	['l', 'L'],
	['xl', 'LL'],
] as const

export const ALIGN_OPTS = [
	['l', '左'],
	['c', '中'],
	['r', '右'],
] as const
