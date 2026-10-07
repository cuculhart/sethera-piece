import { useRef } from 'react'
import { ViewportPortal, useReactFlow } from '@xyflow/react'

const MM = 96 / 25.4
const GRID = 12

export type PaperSize = 'A4' | 'B5' | 'A3'

export const PAPER_SIZES: Record<PaperSize, { w: number; h: number }> = {
	A4: { w: 210 * MM, h: 297 * MM },
	B5: { w: 182 * MM, h: 257 * MM },
	A3: { w: 297 * MM, h: 420 * MM },
}

export type PaperCfg = {
	on: boolean
	x: number
	y: number
	size: PaperSize
	landscape: boolean
	placed?: boolean
}

export const DEFAULT_PAPER: PaperCfg = {
	on: false,
	x: 0,
	y: 0,
	size: 'A4',
	landscape: false,
}

export function paperDims(cfg: PaperCfg): { w: number; h: number } {
	const s = PAPER_SIZES[cfg.size] ?? PAPER_SIZES.A4
	return cfg.landscape ? { w: s.h, h: s.w } : { w: s.w, h: s.h }
}

export function PaperFrame({
	cfg,
	onChange,
}: {
	cfg: PaperCfg
	onChange: (next: PaperCfg) => void
}) {
	const rf = useReactFlow()
	const drag = useRef<{ dx: number; dy: number } | null>(null)
	const { w, h } = paperDims(cfg)

	return (
		<ViewportPortal>
			<div
				className="paper"
				style={{ left: cfg.x, top: cfg.y, width: w, height: h }}
			>
				<div
					className="paper-tag"
					title="用紙（掴んで移動。印刷はこの枠の範囲）"
					onPointerDown={(e) => {
						e.stopPropagation()
						e.currentTarget.setPointerCapture(e.pointerId)
						const p = rf.screenToFlowPosition({
							x: e.clientX,
							y: e.clientY,
						})
						drag.current = { dx: p.x - cfg.x, dy: p.y - cfg.y }
					}}
					onPointerMove={(e) => {
						if (!drag.current) return
						const p = rf.screenToFlowPosition({
							x: e.clientX,
							y: e.clientY,
						})
						onChange({
							...cfg,
							x: p.x - drag.current.dx,
							y: p.y - drag.current.dy,
						})
					}}
					onPointerUp={(e) => {
						if (!drag.current) return
						drag.current = null
						e.currentTarget.releasePointerCapture(e.pointerId)
						onChange({
							...cfg,
							x: Math.round(cfg.x / GRID) * GRID,
							y: Math.round(cfg.y / GRID) * GRID,
						})
					}}
				>
					<span className="paper-tag-name">用紙</span>
					<select
						value={cfg.size}
						onPointerDown={(e) => e.stopPropagation()}
						onChange={(e) =>
							onChange({ ...cfg, size: e.currentTarget.value as PaperSize })
						}
					>
						{(Object.keys(PAPER_SIZES) as PaperSize[]).map((s) => (
							<option key={s} value={s}>
								{s}
							</option>
						))}
					</select>
					<button
						onPointerDown={(e) => e.stopPropagation()}
						onClick={() => onChange({ ...cfg, landscape: !cfg.landscape })}
					>
						{cfg.landscape ? '横' : '縦'}
					</button>
				</div>
			</div>
		</ViewportPortal>
	)
}
