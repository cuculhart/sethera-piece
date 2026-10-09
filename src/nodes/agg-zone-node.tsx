import {
	useContext,
	useEffect,
	useRef,
	type CSSProperties,
	type PointerEvent,
} from 'react'
import {
	Handle,
	NodeResizer,
	Position,
	useEdges,
	useNodes,
	useReactFlow,
	type NodeProps,
} from '@xyflow/react'
import { AGG_FNS, aggregate, formatNumber, type AggFn } from '../lib/aggregate'
import { nodeValue, numCls, zoneMembers } from '../lib/calc'
import { HintContext } from '../hint-context'
import { TEXT_COLORS } from './vobject-node'
import type { AggLabelPos, BoardNode, ZoneNodeType } from './types'

// 様子見: プリセットは「下」と「自由」の2択に絞る（他は必要になれば戻す）
export const LABEL_POS_CYCLE: AggLabelPos[] = [
	// 'br',
	// 'top',
	// 'right',
	'bottom',
	// 'left',
	'free',
]
export const LABEL_POS_LABEL: Record<AggLabelPos, string> = {
	br: '右下',
	top: '上',
	right: '右',
	bottom: '下',
	left: '左',
	free: '自由',
}

export function AggZoneNode({
	id,
	data,
	selected,
	positionAbsoluteX,
	positionAbsoluteY,
	width,
	height,
}: NodeProps<ZoneNodeType>) {
	const rf = useReactFlow()
	const { updateNodeData } = rf
	const hint = useContext(HintContext)
	const nodes = useNodes<BoardNode>()
	const edges = useEdges()
	const { fn, labelPos } = data
	const pos = labelPos ?? 'bottom'
	const isFree = pos === 'free'

	// 「自由」位置のときはチップ自体がドラッグされるので、
	// ゾーン移動は ✥ グリップだけに切り替える
	useEffect(() => {
		rf.updateNode(id, {
			dragHandle: isFree ? '.aggzone-grip' : '.aggzone-header',
		})
	}, [id, isFree, rf])
	const isHinted = nodes.some((n) => n.type === 'vobject' && hint.ids.has(n.id))

	const zoneBounds = {
		minX: positionAbsoluteX,
		minY: positionAbsoluteY,
		maxX: positionAbsoluteX + (width ?? 0),
		maxY: positionAbsoluteY + (height ?? 0),
	}

	const members = zoneMembers(zoneBounds, nodes)
	const values = members
		.map((m) => nodeValue(m.id, nodes, edges, new Set([id])))
		.filter((v): v is number => v !== null)
	const result = fn === 'count' ? members.length : aggregate(fn, values)

	const toggleHint = () => {
		if (hint.ids.size > 0) {
			hint.clear()
		} else {
			hint.set(members.map((m) => m.id))
		}
	}

	const cycleLabelPos = () => {
		const cur = LABEL_POS_CYCLE.indexOf(pos)
		updateNodeData(id, {
			labelPos: LABEL_POS_CYCLE[(cur + 1) % LABEL_POS_CYCLE.length],
		})
	}

	// 「自由」位置: チップをドラッグして配置。
	// ゾーン外にもはみ出せる（帳票のセル位置に数値を合わせるため）
	const zw = width ?? 160
	const zh = height ?? 100
	const OVERX = 160
	const OVERY = 48
	const chipX = Math.max(
		-OVERX,
		Math.min(data.chipPos?.x ?? zw - 110, zw - 24 + OVERX)
	)
	const chipY = Math.max(
		-OVERY,
		Math.min(data.chipPos?.y ?? zh - 30, zh - 8 + OVERY)
	)
	const chipStyle: CSSProperties = {
		...(isFree ? { left: chipX, top: chipY } : {}),
		...(data.textColor ? { color: TEXT_COLORS[data.textColor] } : {}),
	}
	const chipDrag = useRef<{
		px: number
		py: number
		ox: number
		oy: number
	} | null>(null)
	const chipHandlers = isFree
		? {
				onPointerDown: (e: PointerEvent<HTMLElement>) => {
					if (
						(e.target as HTMLElement).closest(
							'button,select,input,.aggzone-grip'
						)
					)
						return
					e.currentTarget.setPointerCapture(e.pointerId)
					chipDrag.current = {
						px: e.clientX,
						py: e.clientY,
						ox: chipX,
						oy: chipY,
					}
				},
				onPointerMove: (e: PointerEvent<HTMLElement>) => {
					const d = chipDrag.current
					if (!d) return
					const z = rf.getViewport().zoom
					updateNodeData(id, {
						chipPos: {
							x: Math.max(
								-OVERX,
								Math.min(
									d.ox + (e.clientX - d.px) / z,
									zw - 24 + OVERX
								)
							),
							y: Math.max(
								-OVERY,
								Math.min(
									d.oy + (e.clientY - d.py) / z,
									zh - 8 + OVERY
								)
							),
						},
					})
				},
				onPointerUp: () => {
					chipDrag.current = null
				},
			}
		: {}

	return (
		<div
			className={`aggzone size-${data.size ?? 'm'}${data.plain ? ' plain' : ''}`}
		>
			{data.mini ? (
				<div
					className={`aggzone-header pos-${pos} mini`}
					style={chipStyle}
					{...chipHandlers}
				>
					<svg
						className="aggzone-grip"
						viewBox="0 0 12 12"
						width="10"
						height="10"
						aria-hidden="true"
					>
						<path
							d="M6 1v10M1 6h10M6 1 4.5 2.5M6 1l1.5 1.5M6 11l-1.5-1.5M6 11l1.5-1.5M1 6l1.5-1.5M1 6l1.5 1.5M11 6l-1.5-1.5M11 6l-1.5 1.5"
							fill="none"
							stroke="currentColor"
							strokeWidth="1.1"
							strokeLinecap="round"
							strokeLinejoin="round"
						/>
					</svg>
					<span className={`aggzone-result${numCls(data, result)}`}>
						{result === null
							? '—'
							: data.hideZero && result === 0
								? ''
								: formatNumber(result, data.digits, data.comma, data.neg)}
					</span>
					<button
						className="aggzone-plain nodrag"
						title="操作パネルを表示"
						onPointerDown={(e) => e.stopPropagation()}
						onClick={() => updateNodeData(id, { mini: false })}
					>
						Σ
					</button>
				</div>
			) : (
			<div
				className={`aggzone-header pos-${pos}`}
				style={chipStyle}
				{...chipHandlers}
			>
				<svg
					className="aggzone-grip"
					viewBox="0 0 12 12"
					width="11"
					height="11"
					aria-hidden="true"
				>
					<path
						d="M6 1v10M1 6h10M6 1 4.5 2.5M6 1l1.5 1.5M6 11l-1.5-1.5M6 11l1.5-1.5M1 6l1.5-1.5M1 6l1.5 1.5M11 6l-1.5-1.5M11 6l-1.5 1.5"
						fill="none"
						stroke="currentColor"
						strokeWidth="1.1"
						strokeLinecap="round"
						strokeLinejoin="round"
					/>
				</svg>
				<select
					className="aggzone-fn nodrag"
					value={fn}
					onPointerDown={(e) => e.stopPropagation()}
					onChange={(e) =>
						updateNodeData(id, { fn: e.currentTarget.value as AggFn })
					}
				>
					{AGG_FNS.map((f) => (
						<option key={f} value={f}>
							{f.toUpperCase()}
						</option>
					))}
				</select>
				<span className={`aggzone-result${numCls(data, result)}`}>
					{result === null
						? '—'
						: data.hideZero && result === 0
							? ''
							: formatNumber(result, data.digits, data.comma, data.neg)}
				</span>
				{fn !== 'count' && (
					<span className="aggzone-count">n={members.length}</span>
				)}
				<button
					className="aggzone-pos nodrag"
					title="式と結果の表示位置（下→自由）"
					onPointerDown={(e) => e.stopPropagation()}
					onClick={cycleLabelPos}
				>
					{LABEL_POS_LABEL[pos]}
				</button>
				<button
					className={`aggzone-plain nodrag${data.plain ? ' active' : ''}`}
					title="枠と背景を消す（集計は続く）"
					onPointerDown={(e) => e.stopPropagation()}
					onClick={() => updateNodeData(id, { plain: !data.plain })}
				>
					枠
				</button>
				<button
					className={`aggzone-src nodrag${isHinted ? ' active' : ''}`}
					title="集計対象を点線で表示"
					onPointerDown={(e) => e.stopPropagation()}
					onClick={toggleHint}
				>
					◎
				</button>
				<button
					className="aggzone-plain nodrag"
					title="結果だけ表示（コンパクト）"
					onPointerDown={(e) => e.stopPropagation()}
					onClick={() => updateNodeData(id, { mini: true })}
				>
					−
				</button>
			</div>
			)}
			<NodeResizer isVisible={selected} minWidth={72} minHeight={48} />
			{selected && (
				<div className="calc-tools nodrag">
					{(
						[
							['s', 'S'],
							['m', 'M'],
							['l', 'L'],
							['xl', 'LL'],
						] as const
					).map(([k, t]) => (
						<button
							key={k}
							className={(data.size ?? 'm') === k ? 'active' : ''}
							title={`文字サイズ ${t}`}
							onPointerDown={(e) => e.stopPropagation()}
							onClick={() => updateNodeData(id, { size: k })}
						>
							{t}
						</button>
					))}
				</div>
			)}
			<Handle
				type="source"
				id="out"
				position={Position.Right}
				className="zone-out"
			/>
		</div>
	)
}
