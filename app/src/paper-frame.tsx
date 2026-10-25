import { useRef } from 'react'
import type { Engine, Pt } from '@kimetron/core'
import { useT } from './i18n'
import {
	PAPER_SIZES,
	paperDims,
	type PaperCfg,
	type PaperSize,
} from './lib/paper'
import { GRID } from './colors'

/** 用紙枠の操作UI。枠自体（白紙・影）は kimetron の doc.page が描く
 *  .ki-page 要素が担い、ここでは左上のタグ（サイズ・縦横・枠ゴースト・
 *  ドラッグ移動）だけをオーバーレイする。
 *  タグはビューポート座標系に追従してズームされる（react-flow 版と同じ）。 */
export function PaperFrame({
	paper,
	engine,
	toWorld,
	onLive,
	onCommit,
}: {
	paper: PaperCfg
	engine: Engine
	/** クライアント座標 → ワールド座標 */
	toWorld: (clientX: number, clientY: number) => Pt
	/** ドラッグ中のライブ変更（doc.page を patchDoc で追従） */
	onLive: (cfg: PaperCfg) => void
	/** 確定（グリッド吸着＋1 undo コミット） */
	onCommit: (cfg: PaperCfg) => void
}) {
	const t = useT()
	const drag = useRef<{ dx: number; dy: number } | null>(null)
	const { w, h } = paperDims(paper)
	const s = engine.worldToScreen({ x: paper.x, y: paper.y })

	return (
		<div
			className="paper-tag"
			style={{
				left: s.x,
				top: s.y,
				transform: `scale(${engine.viewport.zoom})`,
				transformOrigin: 'top left',
			}}
			title={t('用紙（掴んで移動。印刷はこの枠の範囲）')}
			onPointerDown={(e) => {
				e.stopPropagation()
				e.currentTarget.setPointerCapture(e.pointerId)
				const p = toWorld(e.clientX, e.clientY)
				drag.current = { dx: p.x - paper.x, dy: p.y - paper.y }
			}}
			onPointerMove={(e) => {
				if (!drag.current) return
				const p = toWorld(e.clientX, e.clientY)
				onLive({
					...paper,
					x: p.x - drag.current.dx,
					y: p.y - drag.current.dy,
				})
			}}
			onPointerUp={(e) => {
				if (!drag.current) return
				drag.current = null
				e.currentTarget.releasePointerCapture(e.pointerId)
				onCommit({
					...paper,
					x: Math.round(paper.x / GRID) * GRID,
					y: Math.round(paper.y / GRID) * GRID,
				})
			}}
		>
			<span className="paper-tag-name">{t('用紙')}</span>
			<select
				name="paper-size"
				value={paper.size}
				onPointerDown={(e) => e.stopPropagation()}
				onChange={(e) =>
					onCommit({
						...paper,
						size: e.currentTarget.value as PaperSize,
					})
				}
			>
				{(Object.keys(PAPER_SIZES) as PaperSize[]).map((k) => (
					<option key={k} value={k}>
						{k}
					</option>
				))}
			</select>
			<button
				onPointerDown={(e) => e.stopPropagation()}
				onClick={() =>
					onCommit({ ...paper, landscape: !paper.landscape })
				}
			>
				{paper.landscape ? t('横') : t('縦')}
			</button>
			<button
				className={paper.ghost ? 'active' : ''}
				title={t(
					'用紙の塗りを消して点線枠だけにする（明るさ対策。印刷範囲は変わりません）'
				)}
				onPointerDown={(e) => e.stopPropagation()}
				onClick={() => onCommit({ ...paper, ghost: !paper.ghost })}
			>
				{t('枠')}
			</button>
			<span className="paper-tag-mm">
				{Math.round(w)}×{Math.round(h)}
			</span>
		</div>
	)
}
