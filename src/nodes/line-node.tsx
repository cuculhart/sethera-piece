import { useContext } from 'react'
import { NodeResizer, useReactFlow, type NodeProps } from '@xyflow/react'
import { PIECE_COLORS } from './vobject-node'
import { HintContext } from '../hint-context'
import type { LineCap, LineNodeType, LineWeight } from './types'

const GRID = 12
const STROKE_COLOR = '#333'
const STROKES: Record<
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
const DOUBLE_W = 1.5
const DOUBLE_GAP = 4

const WEIGHTS: [LineWeight, string][] = [
	['thin', '細'],
	['bold', '太'],
	['xbold', '極太'],
	['dash', '破線'],
	['dot', '点線'],
	['chain', '一鎖'],
	['double', '二重'],
]

/** 端点装飾（矢印・丸）。SVG marker でなく polygon/circle で自前描画する
 *  （html-to-image による印刷・画像化で確実に写すため）。
 *  矢印は基部を線の描き終わりに接し、先端を元の端点に置く */
function Caps({
	horiz,
	x,
	y,
	w,
	h,
	ah,
	sw,
	capStart,
	capEnd,
}: {
	horiz: boolean
	/** 線の中心軸座標（横線の y / 縦線の x） */
	x: number
	y: number
	w: number
	h: number
	/** 矢印の長さ（線はこの分だけ端から短く描かれている） */
	ah: number
	sw: number
	capStart?: LineCap
	capEnd?: LineCap
}) {
	const dr = 1.8 + sw * 0.8 // 丸の半径
	const render = (end: 's' | 'e', cap?: LineCap) => {
		if (!cap || cap === 'none') return null
		if (cap === 'dot') {
			return horiz ? (
				<circle
					key={end}
					cx={end === 's' ? 0 : w}
					cy={y}
					r={dr}
					fill={STROKE_COLOR}
				/>
			) : (
				<circle
					key={end}
					cx={x}
					cy={end === 's' ? 0 : h}
					r={dr}
					fill={STROKE_COLOR}
				/>
			)
		}
		// 矢印: 先端を線の端点に、羽根を線の内側に伸ばす
		if (horiz) {
			const cx = end === 's' ? 0 : w
			const dir = end === 's' ? -1 : 1
			return (
				<polygon
					key={end}
					points={`${cx},${y} ${cx - dir * ah},${y - ah * 0.45} ${cx - dir * ah},${y + ah * 0.45}`}
					fill={STROKE_COLOR}
				/>
			)
		}
		const cy = end === 's' ? 0 : h
		const dir = end === 's' ? -1 : 1
		return (
			<polygon
				key={end}
				points={`${x},${cy} ${x - ah * 0.45},${cy - dir * ah} ${x + ah * 0.45},${cy - dir * ah}`}
				fill={STROKE_COLOR}
			/>
		)
	}
	return (
		<>
			{render('s', capStart)}
			{render('e', capEnd)}
		</>
	)
}

export function LineNode({ id, data, selected, width, height }: NodeProps<LineNodeType>) {
	const { updateNode } = useReactFlow()
	const gmem = useContext(HintContext).group.has(id)
	const w = width ?? 0
	const h = height ?? 0
	const horiz = w >= h
	const isDouble = data.w === 'double'
	const s = isDouble
		? { width: DOUBLE_W }
		: (STROKES[data.w as Exclude<LineWeight, 'double'>] ?? STROKES.thin)
	const snap = (v: number) => Math.round(v / GRID) * GRID
	// 線はボックスの上辺(横線)/左辺(縦線)に描く。
	// ボックスがグリッド吸着されるので、線の端点が必ずグリッド点上に来て角が結合できる
	const off = s.width / 2
	// 端点装飾の中心軸（二重線は2本の間）
	const axis = isDouble ? off + DOUBLE_GAP / 2 : off
	// 矢印のある端は線の描画を ah 分早めに止め、
	// 矢印の基部が線端に接して先端が元の端点に来るようにする
	const ah = 5 + s.width * 2
	const cutS = data.capStart === 'arrow' ? ah : 0
	const cutE = data.capEnd === 'arrow' ? ah : 0

	const line = (
		x1: number,
		y1: number,
		x2: number,
		y2: number,
		key?: string
	) => (
		<line
			key={key}
			x1={x1}
			y1={y1}
			x2={x2}
			y2={y2}
			stroke={STROKE_COLOR}
			strokeWidth={s.width}
			strokeDasharray={'dash' in s ? s.dash : undefined}
			strokeLinecap={'cap' in s ? s.cap : 'square'}
		/>
	)

	const body = data.rect ? (
		// 矩形はボックス境界上にストローク中心を置く（外側半分は
		// overflow:visible で描画）。隣接矩形の共有辺が同一グリッド座標に
		// なるため完全に重なり、1本の線に見える
		isDouble ? (
			<>
				<rect
					x={0}
					y={0}
					width={w}
					height={h}
					fill={
						data.fill
							? (PIECE_COLORS[data.fill]?.fill ?? 'none')
							: 'none'
					}
					stroke={STROKE_COLOR}
					strokeWidth={s.width}
				/>
				<rect
					x={DOUBLE_GAP}
					y={DOUBLE_GAP}
					width={Math.max(0, w - DOUBLE_GAP * 2)}
					height={Math.max(0, h - DOUBLE_GAP * 2)}
					fill="none"
					stroke={STROKE_COLOR}
					strokeWidth={s.width}
				/>
			</>
		) : (
			<rect
				x={0}
				y={0}
				width={w}
				height={h}
				fill={
					data.fill ? (PIECE_COLORS[data.fill]?.fill ?? 'none') : 'none'
				}
				stroke={STROKE_COLOR}
				strokeWidth={s.width}
				strokeDasharray={s.dash}
				strokeLinecap={s.cap}
			/>
		)
	) : isDouble ? (
		horiz ? (
			<>
				{line(cutS, off, w - cutE, off, 'a')}
				{line(cutS, off + DOUBLE_GAP, w - cutE, off + DOUBLE_GAP, 'b')}
			</>
		) : (
			<>
				{line(off, cutS, off, h - cutE, 'a')}
				{line(off + DOUBLE_GAP, cutS, off + DOUBLE_GAP, h - cutE, 'b')}
			</>
		)
	) : horiz ? (
		line(cutS, off, w - cutE, off)
	) : (
		line(off, cutS, off, h - cutE)
	)

	return (
		<div
			className={`linenode${gmem ? ' gmember' : ''}${data.locked ? ' locked' : ''}`}
		>
			<svg className="linenode-svg" width={w} height={h}>
				{body}
				{!data.rect && (
					<Caps
						horiz={horiz}
						x={horiz ? 0 : axis}
						y={horiz ? axis : 0}
						w={w}
						h={h}
						ah={ah}
						sw={s.width}
						capStart={data.capStart}
						capEnd={data.capEnd}
					/>
				)}
			</svg>
			{selected && !data.locked && (
				<div className="linenode-tools nodrag">
					{WEIGHTS.map(([k, t]) => (
						<button
							key={k}
							className={data.w === k ? 'active' : ''}
							onPointerDown={(e) => e.stopPropagation()}
							onClick={() =>
								updateNode(id, { data: { ...data, w: k } })
							}
						>
							{t}
						</button>
					))}
					<button
						className={data.front ? 'active' : ''}
						title="前面に表示（ピースの上に線を描く）"
						onPointerDown={(e) => e.stopPropagation()}
						onClick={() =>
							updateNode(id, {
								data: { ...data, front: !data.front },
								zIndex: data.front ? 0 : 10,
							})
						}
					>
						前面
					</button>
				</div>
			)}
			<NodeResizer
				isVisible={selected && !data.locked}
				minWidth={GRID}
				minHeight={GRID}
				onResizeEnd={(_e, p) => {
					updateNode(id, {
						position: { x: snap(p.x), y: snap(p.y) },
						width: Math.max(GRID, snap(p.width)),
						height: Math.max(GRID, snap(p.height)),
					})
				}}
			/>
		</div>
	)
}
