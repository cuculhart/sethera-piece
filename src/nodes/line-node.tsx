import { useContext } from 'react'
import { NodeResizer, useReactFlow, type NodeProps } from '@xyflow/react'
import { PIECE_COLORS } from './vobject-node'
import { HintContext } from '../hint-context'
import type { LineCap, LineNodeType, LineWeight } from './types'

const GRID = 12
const STROKE_COLOR = '#333'
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
 *  矢印は基部を線の描き終わりに接し、先端を元の端点に置く。
 *  p0/p1 の2点で方向を定義するため水平・垂直・斜線で共用できる */
function Caps({
	p0,
	p1,
	ah,
	sw,
	capStart,
	capEnd,
}: {
	/** 始端・終端の位置（キャップ先端が置かれる点＝線の端点） */
	p0: [number, number]
	p1: [number, number]
	/** 矢印の長さ（線はこの分だけ端から短く描かれている） */
	ah: number
	sw: number
	capStart?: LineCap
	capEnd?: LineCap
}) {
	const dr = 1.8 + sw * 0.8 // 丸の半径
	const render = (end: 's' | 'e', cap?: LineCap) => {
		if (!cap || cap === 'none') return null
		const [tx, ty] = end === 's' ? p0 : p1 // 先端（線の端点）
		const [ox, oy] = end === 's' ? p1 : p0 // 反対端（矢印の向き基準）
		if (cap === 'dot') {
			return (
				<circle
					key={end}
					cx={tx}
					cy={ty}
					r={dr}
					fill={STROKE_COLOR}
				/>
			)
		}
		// 矢印: 先端を線の端点に、羽根を線の内側に伸ばす
		const len = Math.hypot(ox - tx, oy - ty) || 1
		const ux = (ox - tx) / len
		const uy = (oy - ty) / len
		const bx = tx + ux * ah
		const by = ty + uy * ah
		return (
			<polygon
				key={end}
				points={`${tx},${ty} ${bx - uy * ah * 0.45},${by + ux * ah * 0.45} ${bx + uy * ah * 0.45},${by - ux * ah * 0.45}`}
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
	// グリッド上の値だけ丸める。グリッド外の値はオブジェクトスナップ等で
	// 意図的に置かれた位置とみなし尊重する（丸めると接合が崩れる）
	const snapOrKeep = (v: number) => {
		const g = snap(v)
		return Math.abs(v - g) < 2 ? g : Math.round(v)
	}
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

	// 円弧パス: bbox 内接楕円の一部。角度は度（0=3時方向）。
	// ccw=true なら反時計回りが正（CAD/数学式）、false なら時計回り（SVG式）
	// pie=true なら中心へ閉じた扇形（塗り用）
	const arcD = (
		rx: number,
		ry: number,
		a0: number,
		a1: number,
		pie: boolean,
		ccw: boolean
	) => {
		const cx = w / 2
		const cy = h / 2
		const sy = ccw ? -1 : 1 // 反時計回りは sin を反転（y軸が下向きのため）
		const sw = ccw ? 0 : 1 // SVG sweep: 反時計回り=0
		const pt = (deg: number) => {
			const a = (deg * Math.PI) / 180
			return { x: cx + rx * Math.cos(a), y: cy + ry * Math.sin(a) * sy }
		}
		const delta = (((a1 - a0) % 360) + 360) % 360
		if (delta === 0) {
			// 全周（a0==a1）は半円×2で描く
			const p0 = pt(a0)
			const pm = pt(a0 + 180)
			const seg = `A ${rx} ${ry} 0 0 ${sw} ${pm.x} ${pm.y} A ${rx} ${ry} 0 0 ${sw} ${p0.x} ${p0.y}`
			return pie
				? `M ${cx} ${cy} L ${p0.x} ${p0.y} ${seg} Z`
				: `M ${p0.x} ${p0.y} ${seg}`
		}
		const p0 = pt(a0)
		const p1 = pt(a1)
		const seg = `A ${rx} ${ry} 0 ${delta > 180 ? 1 : 0} ${sw} ${p1.x} ${p1.y}`
		return pie
			? `M ${cx} ${cy} L ${p0.x} ${p0.y} ${seg} Z`
			: `M ${p0.x} ${p0.y} ${seg}`
	}
	const a0 = data.arcStart ?? 0
	const a1 = data.arcEnd ?? 270
	const aCcw = data.arcCcw !== false // 省略=CAD式（反時計回り）
	const arcFill = data.fill
		? (PIECE_COLORS[data.fill]?.fill ?? 'none')
		: 'none'

	const body = data.arc ? (
		// 円弧は外接楕円の切り取り（線種・塗り=扇形・二重を共有）
		isDouble ? (
			<>
				<path
					d={arcD(w / 2, h / 2, a0, a1, !!data.fill, aCcw)}
					fill={arcFill}
					stroke={STROKE_COLOR}
					strokeWidth={s.width}
				/>
				<path
					d={arcD(
						Math.max(1, w / 2 - DOUBLE_GAP),
						Math.max(1, h / 2 - DOUBLE_GAP),
						a0,
						a1,
						false,
						aCcw
					)}
					fill="none"
					stroke={STROKE_COLOR}
					strokeWidth={s.width}
				/>
			</>
		) : (
			<path
				d={arcD(w / 2, h / 2, a0, a1, !!data.fill, aCcw)}
				fill={arcFill}
				stroke={STROKE_COLOR}
				strokeWidth={s.width}
				strokeDasharray={s.dash}
				strokeLinecap={s.cap}
			/>
		)
	) : data.ellipse ? (
		// 楕円は rect と同じ外接ボックス意味論（塗り・線種を共有）。
		// 二重線は外側＋ inset の2重楕円
		isDouble ? (
			<>
				<ellipse
					cx={w / 2}
					cy={h / 2}
					rx={w / 2}
					ry={h / 2}
					fill={
						data.fill
							? (PIECE_COLORS[data.fill]?.fill ?? 'none')
							: 'none'
					}
					stroke={STROKE_COLOR}
					strokeWidth={s.width}
				/>
				<ellipse
					cx={w / 2}
					cy={h / 2}
					rx={Math.max(0, w / 2 - DOUBLE_GAP)}
					ry={Math.max(0, h / 2 - DOUBLE_GAP)}
					fill="none"
					stroke={STROKE_COLOR}
					strokeWidth={s.width}
				/>
			</>
		) : (
			<ellipse
				cx={w / 2}
				cy={h / 2}
				rx={w / 2}
				ry={h / 2}
				fill={
					data.fill ? (PIECE_COLORS[data.fill]?.fill ?? 'none') : 'none'
				}
				stroke={STROKE_COLOR}
				strokeWidth={s.width}
				strokeDasharray={s.dash}
				strokeLinecap={s.cap}
			/>
		)
	) : data.rect ? (
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
	) : data.diag ? (
		// 斜線は枠の対角線（端点=箱の角）。二重は中心線に垂直方向 ±GAP/2
		(() => {
			const [sx, sy, ex, ey] =
				data.diag === 'down'
					? ([0, 0, w, h] as const)
					: ([0, h, w, 0] as const)
			const len = Math.hypot(ex - sx, ey - sy) || 1
			const ux = (ex - sx) / len
			const uy = (ey - sy) / len
			const seg = (o: number, key?: string) =>
				line(
					sx + ux * cutS - uy * o,
					sy + uy * cutS + ux * o,
					ex - ux * cutE - uy * o,
					ey - uy * cutE + ux * o,
					key
				)
			return isDouble ? (
				<>
					{seg(-DOUBLE_GAP / 2, 'a')}
					{seg(DOUBLE_GAP / 2, 'b')}
				</>
			) : (
				seg(0)
			)
		})()
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
				{!data.rect && !data.ellipse && !data.arc && (
					<Caps
						p0={
							data.diag === 'down'
								? [0, 0]
								: data.diag === 'up'
									? [0, h]
									: horiz
										? [0, axis]
										: [axis, 0]
						}
						p1={
							data.diag === 'down'
								? [w, h]
								: data.diag === 'up'
									? [w, 0]
									: horiz
										? [w, axis]
										: [axis, h]
						}
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
						position: { x: snapOrKeep(p.x), y: snapOrKeep(p.y) },
						width: Math.max(GRID, snapOrKeep(p.width)),
						height: Math.max(GRID, snapOrKeep(p.height)),
					})
				}}
			/>
		</div>
	)
}
