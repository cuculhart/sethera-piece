import { useContext, useMemo, useRef } from 'react'
import { NodeResizer, useReactFlow, type NodeProps } from '@xyflow/react'
import { HintContext } from '../hint-context'
import { LINE_COLORS } from './vobject-node'
import type { CurveNodeType, LineCap, LineWeight } from './types'

const GRID = 12
const PAD = 8 // 頂点ボックスの内側マージン（ストローク・矢印が切れないよう）
const SEG = 16 // Catmull-Rom 1区間あたりのサンプル数
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

type Pt = { x: number; y: number }

/** Catmull-Rom（全点通過）をポリラインにサンプリング */
export function catmull(pts: Pt[], seg = SEG): Pt[] {
	if (pts.length < 2) return pts.slice()
	if (pts.length === 2) return [pts[0], pts[1]]
	const out: Pt[] = [pts[0]]
	for (let i = 0; i < pts.length - 1; i++) {
		const p0 = pts[Math.max(0, i - 1)]
		const p1 = pts[i]
		const p2 = pts[i + 1]
		const p3 = pts[Math.min(pts.length - 1, i + 2)]
		for (let j = 1; j <= seg; j++) {
			const t = j / seg
			const t2 = t * t
			const t3 = t2 * t
			out.push({
				x:
					0.5 *
					(2 * p1.x +
						(-p0.x + p2.x) * t +
						(2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 +
						(-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3),
				y:
					0.5 *
					(2 * p1.y +
						(-p0.y + p2.y) * t +
						(2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t2 +
						(-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * t3),
			})
		}
	}
	return out
}

function cumLens(pts: Pt[]) {
	const c = [0]
	for (let i = 1; i < pts.length; i++)
		c.push(c[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y))
	return c
}

/** サンプル列の先頭/末尾から弧長で cut 分だけ縮める（矢印の突き抜け防止） */
function trimSamples(pts: Pt[], cutStart: number, cutEnd: number): Pt[] {
	if (cutStart <= 0 && cutEnd <= 0) return pts
	const cum = cumLens(pts)
	const total = cum[cum.length - 1]
	const s = Math.min(cutStart, total - 1)
	const e = Math.max(total - cutEnd, s + 1)
	const at = (v: number): Pt => {
		for (let i = 1; i < cum.length; i++) {
			if (cum[i] >= v) {
				const r = (v - cum[i - 1]) / (cum[i] - cum[i - 1] || 1)
				return {
					x: pts[i - 1].x + (pts[i].x - pts[i - 1].x) * r,
					y: pts[i - 1].y + (pts[i].y - pts[i - 1].y) * r,
				}
			}
		}
		return pts[pts.length - 1]
	}
	const out: Pt[] = [at(s)]
	for (let i = 0; i < pts.length; i++)
		if (cum[i] > s && cum[i] < e) out.push(pts[i])
	out.push(at(e))
	return out
}

/** 頂点配列を外接ボックスに正規化（PAD込み）。node 座標系の pts を受け、
 *  position/width/height/data.pts をまとめて返す */
export function normalizeCurvePts(
	posAbs: { x: number; y: number },
	pts: Pt[]
) {
	const minX = Math.min(...pts.map((p) => p.x))
	const minY = Math.min(...pts.map((p) => p.y))
	const maxX = Math.max(...pts.map((p) => p.x))
	const maxY = Math.max(...pts.map((p) => p.y))
	return {
		position: {
			x: posAbs.x + minX - PAD,
			y: posAbs.y + minY - PAD,
		},
		width: Math.max(GRID, Math.round(maxX - minX + PAD * 2)),
		height: Math.max(GRID, Math.round(maxY - minY + PAD * 2)),
		pts: pts.map((p) => ({ x: p.x - minX + PAD, y: p.y - minY + PAD })),
	}
}

export function CurveNode({
	id,
	data,
	selected,
	width,
	height,
	positionAbsoluteX,
	positionAbsoluteY,
}: NodeProps<CurveNodeType>) {
	const { updateNode, screenToFlowPosition } = useReactFlow()
	const gmem = useContext(HintContext).group.has(id)
	const w = width ?? 0
	const h = height ?? 0
	const posAbs = { x: positionAbsoluteX ?? 0, y: positionAbsoluteY ?? 0 }
	// リサイズ中は開始時の pts を基準にライブスケール（箱と絵がずれないよう）
	const resizeBase = useRef<{ pts: Pt[]; w: number; h: number } | null>(null)
	const s = STROKES[(data.w as Exclude<LineWeight, 'double'>) ?? 'thin'] ?? STROKES.thin
	// 線色（省略・未定義キーは既定色）
	const sc = LINE_COLORS[data.color ?? 'default'] ?? STROKE_COLOR
	const ah = 5 + s.width * 2
	const dr = 1.8 + s.width * 0.8
	const snapOn = useContext(HintContext).snapOn
	// 吸着ONならグリッド、OFFなら1px単位で頂点を置ける
	const snapV = (v: number) =>
		snapOn ? Math.round(v / GRID) * GRID : Math.round(v)
	// グリッド上の値だけ丸める。グリッド外の値はオブジェクトスナップ等で
	// 意図的に置かれた位置とみなし尊重する（丸めると接合が崩れる）
	const snapOrKeep = (v: number) => {
		const g = Math.round(v / GRID) * GRID
		return Math.abs(v - g) < 2 ? g : Math.round(v)
	}

	const samples = useMemo(() => catmull(data.pts), [data.pts])
	const stroke = useMemo(
		() =>
			trimSamples(
				samples,
				data.capStart === 'arrow' ? ah : 0,
				data.capEnd === 'arrow' ? ah : 0
			),
		[samples, data.capStart, data.capEnd, ah]
	)
	const d =
		stroke.length > 0
			? 'M' +
				stroke
					.map((p) => `${Math.round(p.x * 10) / 10} ${Math.round(p.y * 10) / 10}`)
					.join(' L')
			: ''

	// 端点装飾: 先端を元の端点に、向きは端部の接線（直近サンプル間）で決める
	const capEl = (end: 's' | 'e', cap?: LineCap) => {
		if (!cap || cap === 'none' || samples.length < 2) return null
		const tip = end === 's' ? data.pts[0] : data.pts[data.pts.length - 1]
		const near =
			end === 's'
				? samples[Math.min(3, samples.length - 1)]
				: samples[Math.max(0, samples.length - 4)]
		const ux = (tip.x - near.x) / (Math.hypot(tip.x - near.x, tip.y - near.y) || 1)
		const uy = (tip.y - near.y) / (Math.hypot(tip.x - near.x, tip.y - near.y) || 1)
		if (cap === 'dot')
			return <circle key={end} cx={tip.x} cy={tip.y} r={dr} fill={sc} />
		const bx = tip.x - ux * ah
		const by = tip.y - uy * ah
		const px = -uy * ah * 0.45
		const py = ux * ah * 0.45
		return (
			<polygon
				key={end}
				points={`${tip.x},${tip.y} ${bx + px},${by + py} ${bx - px},${by - py}`}
				fill={sc}
			/>
		)
	}

	// 頂点編集（選択中のみ）。ドラッグ=移動、頂点ダブルクリック=削除、
	// セグメントダブルクリック=頂点挿入
	const applyPts = (pts: Pt[]) => {
		const nz = normalizeCurvePts(posAbs, pts)
		updateNode(id, {
			position: nz.position,
			width: nz.width,
			height: nz.height,
			data: { ...data, pts: nz.pts },
		})
	}
	const onVertexDown = (e: React.PointerEvent) => {
		e.stopPropagation()
		e.currentTarget.setPointerCapture(e.pointerId)
	}
	const onVertexMove = (i: number) => (e: React.PointerEvent) => {
		if (!e.currentTarget.hasPointerCapture(e.pointerId)) return
		const fp = screenToFlowPosition({ x: e.clientX, y: e.clientY })
		const nx = snapV(fp.x - posAbs.x)
		const ny = snapV(fp.y - posAbs.y)
		applyPts(data.pts.map((p, k) => (k === i ? { x: nx, y: ny } : p)))
	}
	const onVertexUp = (e: React.PointerEvent) => {
		if (e.currentTarget.hasPointerCapture(e.pointerId))
			e.currentTarget.releasePointerCapture(e.pointerId)
	}
	const insertAt = (i: number) => {
		// span i の中点（サンプル列の i*SEG + SEG/2 番）を頂点として挿入
		const mid = samples[i * SEG + Math.floor(SEG / 2)] ?? {
			x: (data.pts[i].x + data.pts[i + 1].x) / 2,
			y: (data.pts[i].y + data.pts[i + 1].y) / 2,
		}
		applyPts([...data.pts.slice(0, i + 1), { ...mid }, ...data.pts.slice(i + 1)])
	}

	return (
		<div
			className={`curvenode${gmem ? ' gmember' : ''}${data.locked ? ' locked' : ''}`}
		>
			<svg className="curvenode-svg" width={w} height={h}>
				{d && (
					<path
						d={d}
						fill="none"
						stroke={sc}
						strokeWidth={s.width}
						strokeDasharray={s.dash}
						strokeLinecap={s.cap ?? 'round'}
						strokeLinejoin="round"
					/>
				)}
				{capEl('s', data.capStart)}
				{capEl('e', data.capEnd)}
				{selected && !data.locked && (
					<>
						{/* セグメント挿入用の太い透明ヒット線 */}
						{data.pts.slice(0, -1).map((p, i) => (
							<line
								key={`seg${i}`}
								className="nodrag curve-seghit"
								x1={p.x}
								y1={p.y}
								x2={data.pts[i + 1].x}
								y2={data.pts[i + 1].y}
								onDoubleClick={() => insertAt(i)}
							/>
						))}
						{data.pts.map((p, i) => (
							<circle
								key={i}
								className="nodrag curve-vtx"
								cx={p.x}
								cy={p.y}
								r={5}
								onPointerDown={onVertexDown}
								onPointerMove={onVertexMove(i)}
								onPointerUp={onVertexUp}
								onDoubleClick={() => {
									if (data.pts.length > 2)
										applyPts(data.pts.filter((_, k) => k !== i))
								}}
							/>
						))}
					</>
				)}
			</svg>
			<NodeResizer
				isVisible={selected && !data.locked}
				minWidth={GRID * 2}
				minHeight={GRID * 2}
				onResizeStart={() => {
					resizeBase.current = { pts: data.pts, w, h }
				}}
				onResize={(_e, p) => {
					const base = resizeBase.current
					if (!base || base.w <= 0 || base.h <= 0) return
					updateNode(id, {
						data: {
							...data,
							pts: base.pts.map((pt) => ({
								x: (pt.x * p.width) / base.w,
								y: (pt.y * p.height) / base.h,
							})),
						},
					})
				}}
				onResizeEnd={(_e, p) => {
					// onResize でライブスケール済みなら開始時の pts から確定値へ
					const base = resizeBase.current
					resizeBase.current = null
					const nw = Math.max(GRID * 2, snapOrKeep(p.width))
					const nh = Math.max(GRID * 2, snapOrKeep(p.height))
					const ref = base ?? { pts: data.pts, w, h }
					const sx = ref.w > 0 ? nw / ref.w : 1
					const sy = ref.h > 0 ? nh / ref.h : 1
					updateNode(id, {
						position: { x: snapOrKeep(p.x), y: snapOrKeep(p.y) },
						width: nw,
						height: nh,
						data: {
							...data,
							pts: ref.pts.map((pt) => ({
								x: pt.x * sx,
								y: pt.y * sy,
							})),
						},
					})
				}}
			/>
		</div>
	)
}
