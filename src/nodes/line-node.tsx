import { NodeResizer, useReactFlow, type NodeProps } from '@xyflow/react'
import type { LineNodeType, LineWeight } from './types'

const GRID = 12
const STROKES: Record<LineWeight, { width: number; dash?: string }> = {
	thin: { width: 1.5 },
	bold: { width: 3 },
	xbold: { width: 6 },
	dash: { width: 1.5, dash: '7 4' },
}
const WEIGHTS: [LineWeight, string][] = [
	['thin', '細'],
	['bold', '太'],
	['xbold', '極太'],
	['dash', '点線'],
]

export function LineNode({ id, data, selected, width, height }: NodeProps<LineNodeType>) {
	const { updateNode } = useReactFlow()
	const w = width ?? 0
	const h = height ?? 0
	const horiz = w >= h
	const s = STROKES[data.w] ?? STROKES.thin
	const snap = (v: number) => Math.round(v / GRID) * GRID
	// 線はボックスの上辺(横線)/左辺(縦線)に描く。
	// ボックスがグリッド吸着されるので、線の端点が必ずグリッド点上に来て角が結合できる
	const off = s.width / 2

	return (
		<div className="linenode">
			<svg className="linenode-svg" width={w} height={h}>
				{data.rect ? (
					// 矩形はボックス境界上にストローク中心を置く（外側半分は
					// overflow:visible で描画）。隣接矩形の共有辺が同一グリッド座標に
					// なるため完全に重なり、1本の線に見える
					<rect
						x={0}
						y={0}
						width={w}
						height={h}
						fill="none"
						stroke="#333"
						strokeWidth={s.width}
						strokeDasharray={s.dash}
					/>
				) : horiz ? (
					<line
						x1={0}
						y1={off}
						x2={w}
						y2={off}
						stroke="#333"
						strokeWidth={s.width}
						strokeDasharray={s.dash}
						strokeLinecap="square"
					/>
				) : (
					<line
						x1={off}
						y1={0}
						x2={off}
						y2={h}
						stroke="#333"
						strokeWidth={s.width}
						strokeDasharray={s.dash}
						strokeLinecap="square"
					/>
				)}
			</svg>
			{selected && (
				<div className="linenode-tools nodrag">
					{WEIGHTS.map(([k, t]) => (
						<button
							key={k}
							className={data.w === k ? 'active' : ''}
							onPointerDown={(e) => e.stopPropagation()}
							onClick={() => updateNode(id, { data: { ...data, w: k } })}
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
				isVisible={selected}
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
