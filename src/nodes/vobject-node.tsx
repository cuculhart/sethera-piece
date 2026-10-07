import {
	useContext,
	useEffect,
	useRef,
	useState,
	type FocusEvent,
} from 'react'
import {
	Handle,
	NodeResizer,
	Position,
	useReactFlow,
	type NodeProps,
} from '@xyflow/react'
import { HintContext } from '../hint-context'
import type { VObjectData, VObjectNodeType } from './types'

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

export function VObjectNode({ id, data, selected }: NodeProps<VObjectNodeType>) {
	const hinted = useContext(HintContext).ids.has(id)
	const [editing, setEditing] = useState(false)
	const { kind, label, value, color } = data
	const theme = PIECE_COLORS[color] ?? PIECE_COLORS.yellow
	const showLabel = kind !== 'number'
	const showValue = kind !== 'text'
	const align = data.align ?? 'c'
	const size = data.size ?? 'm'

	return (
		<div
			className={`vobject align-${align} size-${size}${data.bold ? ' bold' : ''}${editing ? ' nodrag editing' : ''}${hinted ? ' hinted' : ''}${color === 'none' ? ' plain' : ''}`}
			style={{
				backgroundColor: theme.fill,
				borderColor: theme.border,
				color: theme.text,
			}}
			onDoubleClick={() => setEditing(true)}
		>
			{editing ? (
				<VObjectEditor
					id={id}
					data={data}
					showLabel={showLabel}
					showValue={showValue}
					stopEdit={() => setEditing(false)}
				/>
			) : (
				<>
					{showLabel && <div className="vobject-label">{label}</div>}
					{showValue && value !== null && (
						<div className="vobject-value">{value}</div>
					)}
				</>
			)}
			<NodeResizer isVisible={selected} minWidth={64} minHeight={28} />
			<Handle type="source" id="out" position={Position.Right} />
		</div>
	)
}

function VObjectEditor({
	id,
	data,
	showLabel,
	showValue,
	stopEdit,
}: {
	id: string
	data: VObjectData
	showLabel: boolean
	showValue: boolean
	stopEdit: () => void
}) {
	const { updateNodeData } = useReactFlow()
	const [draftLabel, setDraftLabel] = useState(data.label)
	const [draftValue, setDraftValue] = useState(
		data.value === null ? '' : String(data.value)
	)
	// 確定経路が複数あるので最新ドラフトは ref で共有（stale closure 防止）
	const labelRef = useRef(data.label)
	const valueRef = useRef(data.value === null ? '' : String(data.value))

	const commitAll = () => {
		updateNodeData(id, { label: labelRef.current })
		const t = valueRef.current.trim()
		const n = parseFloat(t)
		updateNodeData(id, { value: t === '' || isNaN(n) ? null : n })
	}
	// フォーカスがカードの外に出たら確定して編集終了（カード内のツール操作では閉じない）
	const onBlurOut = (e: FocusEvent<HTMLElement>) => {
		const card = e.currentTarget.closest('.vobject')
		if (
			card &&
			e.relatedTarget instanceof Node &&
			card.contains(e.relatedTarget)
		) {
			return
		}
		commitAll()
		stopEdit()
	}

	// キャンバスのパン/選択は pointerdown を preventDefault するため blur が
	// 発火しないことがある。カード外への pointerdown でも確定して閉じる。
	const cardEl = useRef<HTMLElement | null>(null)
	useEffect(() => {
		cardEl.current =
			(document.activeElement as HTMLElement | null)?.closest(
				'.vobject'
			) ?? null
		const onDown = (e: PointerEvent) => {
			const card = cardEl.current
			if (card && e.target instanceof Node && !card.contains(e.target)) {
				commitAll()
				stopEdit()
			}
		}
		document.addEventListener('pointerdown', onDown, true)
		return () => document.removeEventListener('pointerdown', onDown, true)
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [])

	return (
		<>
			{showLabel && (
				<textarea
					className="vobject-label-input"
					value={draftLabel}
					autoFocus
					placeholder="テキスト（Enter=改行 / Ctrl+Enter=確定）"
					rows={Math.min(8, Math.max(1, draftLabel.split('\n').length))}
					onPointerDown={(e) => e.stopPropagation()}
					onChange={(e) => {
						setDraftLabel(e.currentTarget.value)
						labelRef.current = e.currentTarget.value
					}}
					onBlur={onBlurOut}
					onKeyDown={(e) => {
						if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
							commitAll()
							stopEdit()
						} else if (e.key === 'Escape') {
							stopEdit()
						}
					}}
				/>
			)}
			{showValue && (
				<input
					className="vobject-value-input"
					value={draftValue}
					autoFocus={!showLabel}
					placeholder="数値"
					onPointerDown={(e) => e.stopPropagation()}
					onChange={(e) => {
						setDraftValue(e.currentTarget.value)
						valueRef.current = e.currentTarget.value
					}}
					onBlur={onBlurOut}
					onKeyDown={(e) => {
						if (e.key === 'Enter') {
							commitAll()
							stopEdit()
						} else if (e.key === 'Escape') {
							stopEdit()
						}
					}}
				/>
			)}
			<div className="vobject-edtools">
				<div className="vobject-align">
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
							className={`vobject-align-btn${(data.size ?? 'm') === k ? ' active' : ''}`}
							title={`文字サイズ ${t}`}
							onPointerDown={(e) => e.stopPropagation()}
							onClick={() => updateNodeData(id, { size: k })}
						>
							{t}
						</button>
					))}
					<button
						className={`vobject-align-btn bold-btn${data.bold ? ' active' : ''}`}
						title="太字"
						onPointerDown={(e) => e.stopPropagation()}
						onClick={() => updateNodeData(id, { bold: !data.bold })}
					>
						B
					</button>
				</div>
				<div className="vobject-align">
					{(
						[
							['l', '左'],
							['c', '中'],
							['r', '右'],
						] as const
					).map(([k, t]) => (
						<button
							key={k}
							className={`vobject-align-btn${(data.align ?? 'c') === k ? ' active' : ''}`}
							title={`${t}揃え`}
							onPointerDown={(e) => e.stopPropagation()}
							onClick={() => updateNodeData(id, { align: k })}
						>
							{t}
						</button>
					))}
				</div>
				<div className="vobject-colors">
					{Object.entries(PIECE_COLORS).map(([name, c]) => (
						<button
							key={name}
							className={`vobject-swatch${name === data.color ? ' active' : ''}`}
							style={
								name === 'none'
									? {
											backgroundColor: 'transparent',
											border: '1px dashed #999',
										}
									: { backgroundColor: c.fill, borderColor: c.border }
							}
							title={name === 'none' ? '枠なし' : name}
							onPointerDown={(e) => e.stopPropagation()}
							onClick={() => updateNodeData(id, { color: name })}
						/>
					))}
				</div>
			</div>
		</>
	)
}
