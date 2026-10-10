import { useContext, useEffect, useState } from 'react'
import {
	Handle,
	NodeResizer,
	Position,
	useEdges,
	useNodes,
	useReactFlow,
	type NodeProps,
} from '@xyflow/react'
import { formatNumber } from '../lib/aggregate'
import {
	CALC_OPS,
	CALC_OP_LABEL,
	ROUND_LABEL,
	ROUND_MODES,
	nodeValue,
	numCls,
	numFmtOf,
	operandSource,
} from '../lib/calc'
import { HintContext } from '../hint-context'
import { TEXT_COLORS } from './vobject-node'
import type { BoardNode, CalcNodeType, CalcOp, RoundMode } from './types'

export function CalcNode({ id, data, selected }: NodeProps<CalcNodeType>) {
	const { updateNodeData } = useReactFlow()
	const hint = useContext(HintContext)
	const hinted = hint.ids.has(id)
	const zpart = hint.partial.has(id)
	const gmem = hint.group.has(id)
	const nodes = useNodes<BoardNode>()
	const edges = useEdges()
	const value = nodeValue(id, nodes, edges)
	const aSrc = operandSource(edges, id, 'a')
	const bSrc = operandSource(edges, id, 'b')
	const cls = `calcnode align-${data.align ?? 'c'} size-${data.size ?? 'm'}${data.plain ? ' plain' : ''}${hinted ? ' hinted' : ''}${zpart ? ' zpart' : ''}${gmem ? ' gmember' : ''}`
	const style = data.textColor
		? { color: TEXT_COLORS[data.textColor] }
		: undefined

	const tools = selected ? (
		<div className="calc-tools nodrag">
			{(
				[
					['l', '左'],
					['c', '中'],
					['r', '右'],
				] as const
			).map(([k, t]) => (
				<button
					key={k}
					className={(data.align ?? 'c') === k ? 'active' : ''}
					title={`結果を${t}揃え`}
					onPointerDown={(e) => e.stopPropagation()}
					onClick={() => updateNodeData(id, { align: k })}
				>
					{t}
				</button>
			))}
			<button
				className={data.plain ? 'active' : ''}
				title="枠・背景を消す"
				onPointerDown={(e) => e.stopPropagation()}
				onClick={() => updateNodeData(id, { plain: !data.plain })}
			>
				枠なし
			</button>
		</div>
	) : null

	if (data.mini) {
		return (
			<div className={`${cls} mini`} style={style}>
				<Handle
					type="target"
					id="a"
					position={Position.Left}
					style={{ top: '30%' }}
				/>
				<Handle
					type="target"
					id="b"
					position={Position.Left}
					style={{ top: '72%' }}
				/>
				<Handle type="source" id="out" position={Position.Right} />
				<span className={`calc-result${numCls(data, value)}`}>
					{value === null
						? '—'
						: data.hideZero && value === 0
							? ''
							: formatNumber(value, data.digits, data.comma, data.neg)}
				</span>
				<button
					className="calc-mini-btn nodrag"
					title="式を表示"
					onPointerDown={(e) => e.stopPropagation()}
					onClick={() => updateNodeData(id, { mini: false })}
				>
					ƒx
				</button>
				<NodeResizer isVisible={selected} minWidth={64} minHeight={32} />
				{tools}
			</div>
		)
	}

	return (
		<div className={cls} style={style}>
			<Handle
				type="target"
				id="a"
				position={Position.Left}
				style={{ top: '30%' }}
			/>
			<Handle
				type="target"
				id="b"
				position={Position.Left}
				style={{ top: '72%' }}
			/>
			<Handle type="source" id="out" position={Position.Right} />
			<div className="calc-row">
				<Operand
					tag="A"
					srcId={aSrc}
					constVal={data.constA}
					nodes={nodes}
					edges={edges}
					onConst={(v) => updateNodeData(id, { constA: v })}
				/>
				<select
					className="calc-op nodrag"
					value={data.op}
					onPointerDown={(e) => e.stopPropagation()}
					onChange={(e) =>
						updateNodeData(id, { op: e.currentTarget.value as CalcOp })
					}
				>
					{CALC_OPS.map((o) => (
						<option key={o} value={o}>
							{CALC_OP_LABEL[o]}
						</option>
					))}
				</select>
				<Operand
					tag="B"
					srcId={bSrc}
					constVal={data.constB}
					nodes={nodes}
					edges={edges}
					onConst={(v) => updateNodeData(id, { constB: v })}
				/>
			</div>
			<div className="calc-row calc-result-row">
				<span className="calc-eq">=</span>
				<span className={`calc-result${numCls(data, value)}`}>
					{value === null
						? '—'
						: data.hideZero && value === 0
							? ''
							: formatNumber(value, data.digits, data.comma, data.neg)}
				</span>
				<button
					className="calc-mini-btn nodrag"
					title="結果だけ表示（コンパクト）"
					onPointerDown={(e) => e.stopPropagation()}
					onClick={() => updateNodeData(id, { mini: true })}
				>
					−
				</button>
				<select
					className="calc-round nodrag"
					title="丸め"
					value={data.round}
					onPointerDown={(e) => e.stopPropagation()}
					onChange={(e) =>
						updateNodeData(id, { round: e.currentTarget.value as RoundMode })
					}
				>
					{ROUND_MODES.map((r) => (
						<option key={r} value={r}>
							{ROUND_LABEL[r]}
						</option>
					))}
				</select>
			</div>
			{tools}
		</div>
	)
}

function Operand({
	tag,
	srcId,
	constVal,
	nodes,
	edges,
	onConst,
}: {
	tag: string
	srcId: string | null
	constVal: number | null
	nodes: BoardNode[]
	edges: ReturnType<typeof useEdges>
	onConst: (v: number | null) => void
}) {
	if (srcId === null) {
		return <ConstInput tag={tag} value={constVal} onCommit={onConst} />
	}
	const src = nodes.find((n) => n.id === srcId)
	const v = nodeValue(srcId, nodes, edges)
	const fmt = numFmtOf(src)
	const disp =
		v === null
			? '—'
			: fmt.hideZero && v === 0
				? ''
				: formatNumber(v, fmt.digits, fmt.comma, fmt.neg)
	const name =
		src?.type === 'vobject'
			? src.data.label || '値'
			: src?.type === 'zone'
				? 'Σゾーン'
				: '計算'
	return (
		<span className="calc-operand" title={`${name}: ${disp}`}>
			<span className="calc-operand-tag">{tag}</span>
			<span className="calc-operand-name">{name}</span>
			<span className={`calc-operand-val${numCls(fmt, v)}`}>{disp}</span>
		</span>
	)
}

function ConstInput({
	tag,
	value,
	onCommit,
}: {
	tag: string
	value: number | null
	onCommit: (v: number | null) => void
}) {
	const [draft, setDraft] = useState(value === null ? '' : String(value))
	useEffect(() => {
		setDraft(value === null ? '' : String(value))
	}, [value])
	const commit = () => {
		const t = draft.trim()
		const n = parseFloat(t)
		onCommit(t === '' || isNaN(n) ? null : n)
	}
	return (
		<label className="calc-operand calc-const">
			<span className="calc-operand-tag">{tag}</span>
			<input
				className="nodrag"
				value={draft}
				placeholder="定数"
				onPointerDown={(e) => e.stopPropagation()}
				onChange={(e) => setDraft(e.currentTarget.value)}
				onBlur={commit}
				onKeyDown={(e) => {
					if (e.key === 'Enter') commit()
					else if (e.key === 'Escape') {
						setDraft(value === null ? '' : String(value))
						e.currentTarget.blur()
					}
				}}
			/>
		</label>
	)
}
