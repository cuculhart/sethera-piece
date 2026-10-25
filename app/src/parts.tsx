// renderObject 実装 — react-flow 版の各ノードコンポーネントを
// kimetron オブジェクト描画に移植（class名・見た目・操作性は元のまま）。

import {
	useContext,
	useEffect,
	useMemo,
	useRef,
	useState,
	type CSSProperties,
	type FocusEvent,
	type PointerEvent as RPointerEvent,
	type ReactNode,
} from 'react'
import type { WorldObject } from '@kimetron/core'
import { HintContext } from './hint-context'
import { BoardContext, type BoardApi } from './board-context'
import { useT } from './i18n'
import {
	AGG_FNS,
	aggregate,
	onDarkCanvas,
	type AggFn,
} from './lib/aggregate'
import {
	CALC_OPS,
	CALC_OP_LABEL,
	ROUND_LABEL,
	ROUND_MODES,
	dataOf,
	formatDisplay,
	memberMatch,
	numCls,
	numFmtOf,
	objectBounds,
	objectValue,
	operandSource,
	zoneMembers,
} from './lib/calc'
import { fontStack } from './lib/fonts'
import {
	GRID,
	LINE_COLORS,
	PIECE_COLORS,
	STROKES,
	STROKE_COLOR,
	TEXT_COLORS,
	DOUBLE_GAP,
	DOUBLE_W,
	WEIGHTS,
} from './colors'
import type {
	AggLabelPos,
	CalcData,
	CalcOp,
	CurveData,
	LineCap,
	LineData,
	LineWeight,
	RoundMode,
	VObjectData,
	ZoneData,
} from './types'

export const LABEL_POS_CYCLE: AggLabelPos[] = ['bottom', 'free']
export const LABEL_POS_LABEL: Record<AggLabelPos, string> = {
	br: '右下',
	top: '上',
	right: '右',
	bottom: '下',
	left: '左',
	free: '自由',
}

/** 部品はすべてワールド単位（o.w×o.h）で描き、ZoomBox が zoom 倍率を掛ける。
 *  .ki-obj 自体はスクリーンサイズ（w×zoom）で配置されるため、包まないと
 *  ズーム時に中身が枠とずれる。React Flow の transform 方式と同じ効果。 */
function ZoomBox({ o, children }: { o: WorldObject; children: ReactNode }) {
	const api = useBoard()
	const z = api.engine.viewport.zoom
	return (
		<div
			className="kiz"
			style={{
				width: o.w,
				height: o.h,
				transform: `scale(${z})`,
				transformOrigin: 'top left',
				position: 'relative',
			}}
		>
			{children}
		</div>
	)
}

export function renderObject(o: WorldObject): ReactNode {
	switch (o.kind) {
		case 'piece':
			return (
				<ZoomBox o={o}>
					<PieceView o={o} />
				</ZoomBox>
			)
		case 'zone':
			return (
				<ZoomBox o={o}>
					<ZoneView o={o} />
				</ZoomBox>
			)
		case 'calc':
			return (
				<ZoomBox o={o}>
					<CalcView o={o} />
				</ZoomBox>
			)
		case 'stroke':
			return (
				<ZoomBox o={o}>
					<StrokeView o={o} />
				</ZoomBox>
			)
		case 'spline':
			return (
				<ZoomBox o={o}>
					<SplineView o={o} />
				</ZoomBox>
			)
		default:
			return null
	}
}

const useBoard = () => useContext(BoardContext)!

// ─── ピース（テキスト/数値/ペア） ────────────────────────────

function PieceView({ o }: { o: WorldObject }) {
	const api = useBoard()
	const hint = useContext(HintContext)
	const hinted = hint.ids.has(o.id)
	const zpart = hint.partial.has(o.id)
	const gmem = hint.group.has(o.id)
	const [editing, setEditing] = useState(false)
	const data = dataOf<VObjectData>(o)
	const { kind, label, value, color } = data
	const theme = PIECE_COLORS[color] ?? PIECE_COLORS.yellow
	let textColor = TEXT_COLORS[data.textColor ?? 'auto'] || theme.text
	// ダーク盤面: 塗りなしピースの自動文字色は用紙外だと読めないため明色化
	if (
		color === 'none' &&
		(!data.textColor || data.textColor === 'auto') &&
		onDarkCanvas(api.dark, api.paperRect, objectBounds(o))
	) {
		textColor = '#e6e3da'
	}
	const showLabel = kind !== 'number'
	const showValue = kind !== 'text'
	const align = data.align ?? 'c'
	const size = data.size ?? 'm'

	return (
		<div
			className={`vobject align-${align} size-${size}${data.bold ? ' bold' : ''}${editing ? ' nodrag editing' : ''}${hinted ? ' hinted' : ''}${zpart ? ' zpart' : ''}${gmem ? ' gmember' : ''}${color === 'none' ? ' plain' : ''}${o.locked ? ' locked' : ''}`}
			style={{
				backgroundColor: theme.fill,
				borderColor: theme.border,
				color: textColor,
				fontFamily: fontStack(data.font, api.docFont),
			}}
			onDoubleClick={() => !o.locked && setEditing(true)}
		>
			{editing ? (
				<PieceEditor
					api={api}
					o={o}
					data={data}
					showLabel={showLabel}
					showValue={showValue}
					stopEdit={() => setEditing(false)}
				/>
			) : (
				<>
					{showLabel && <div className="vobject-label">{label}</div>}
					{showValue &&
						value !== null &&
						!(data.hideZero && value === 0) && (
							<div className={`vobject-value${numCls(data, value)}`}>
								{formatDisplay(value, data)}
							</div>
						)}
				</>
			)}
		</div>
	)
}

function PieceEditor({
	api,
	o,
	data,
	showLabel,
	showValue,
	stopEdit,
}: {
	api: BoardApi
	o: WorldObject
	data: VObjectData
	showLabel: boolean
	showValue: boolean
	stopEdit: () => void
}) {
	const t = useT()
	const [draftLabel, setDraftLabel] = useState(data.label)
	const [draftValue, setDraftValue] = useState(
		data.value === null ? '' : String(data.value)
	)
	// 確定経路が複数あるので最新ドラフトは ref で共有（stale closure 防止）
	const labelRef = useRef(data.label)
	const valueRef = useRef(data.value === null ? '' : String(data.value))

	const commitAll = () => {
		const v = valueRef.current.trim()
		const n = parseFloat(v)
		api.updateData(o.id, {
			label: labelRef.current,
			value: v === '' || isNaN(n) ? null : n,
		})
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

	// カード外への pointerdown でも確定して閉じる
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
					name="vobject-label"
					value={draftLabel}
					autoFocus
					placeholder={t('テキスト（Enter=改行 / Ctrl+Enter=確定）')}
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
					name="vobject-value"
					value={draftValue}
					autoFocus={!showLabel}
					placeholder={t('数値')}
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
					).map(([k, sz]) => (
						<button
							key={k}
							className={`vobject-align-btn${(data.size ?? 'm') === k ? ' active' : ''}`}
							title={t('文字サイズ {s}', { s: sz })}
							onPointerDown={(e) => e.stopPropagation()}
							onClick={() => api.updateData(o.id, { size: k })}
						>
							{sz}
						</button>
					))}
					<button
						className={`vobject-align-btn bold-btn${data.bold ? ' active' : ''}`}
						title={t('太字')}
						onPointerDown={(e) => e.stopPropagation()}
						onClick={() => api.updateData(o.id, { bold: !data.bold })}
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
					).map(([k, al]) => (
						<button
							key={k}
							className={`vobject-align-btn${(data.align ?? 'c') === k ? ' active' : ''}`}
							title={t('{a}揃え', { a: t(al) })}
							onPointerDown={(e) => e.stopPropagation()}
							onClick={() => api.updateData(o.id, { align: k })}
						>
							{t(al)}
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
							title={t(name === 'none' ? '枠なし' : name)}
							onPointerDown={(e) => e.stopPropagation()}
							onClick={() => api.updateData(o.id, { color: name })}
						/>
					))}
				</div>
			</div>
		</>
	)
}

// ─── 集計ゾーン ──────────────────────────────────────────────

function ZoneView({ o }: { o: WorldObject }) {
	const api = useBoard()
	const t = useT()
	const hint = useContext(HintContext)
	const data = dataOf<ZoneData>(o)
	const { fn, labelPos } = data
	const pos = labelPos ?? 'bottom'
	const isFree = pos === 'free'
	const sel = api.selIds.has(o.id)
	const isHinted = api.doc.objects.some(
		(n) => n.kind === 'piece' && hint.ids.has(n.id)
	)

	const zoneBounds = objectBounds(o)
	const members = zoneMembers(zoneBounds, api.doc.objects)
	const matched = members.filter((m) => memberMatch(m, data.filter))
	const values = matched
		.map((m) => objectValue(m.id, api.doc.objects, api.doc.edges, new Set([o.id])))
		.filter((v): v is number => v !== null)
	const result = fn === 'count' ? matched.length : aggregate(fn, values)

	const toggleHint = () => {
		if (hint.ids.size > 0) {
			hint.clear()
		} else {
			hint.set(matched.map((m) => m.id))
		}
	}

	const cycleLabelPos = () => {
		const cur = LABEL_POS_CYCLE.indexOf(pos)
		api.updateData(o.id, {
			labelPos: LABEL_POS_CYCLE[(cur + 1) % LABEL_POS_CYCLE.length],
		})
	}

	// 「自由」位置: チップをドラッグして配置。
	// ゾーン外にもはみ出せる（帳票のセル位置に数値を合わせるため）
	const zw = o.w
	const zh = o.h
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
	// ダーク盤面: 枠なしゾーンのチップ文字は用紙外だと読めないため明色化
	const chipBox = isFree
		? {
				minX: o.x + chipX,
				minY: o.y + chipY,
				maxX: o.x + chipX + 60,
				maxY: o.y + chipY + 24,
			}
		: zoneBounds
	const chipStyle: CSSProperties = {
		fontFamily: fontStack(undefined, api.docFont),
		...(isFree ? { left: chipX, top: chipY } : {}),
		...(data.textColor
			? { color: TEXT_COLORS[data.textColor] }
			: data.plain && onDarkCanvas(api.dark, api.paperRect, chipBox)
				? { color: '#e6e3da' }
				: {}),
	}
	const chipDrag = useRef<{
		px: number
		py: number
		ox: number
		oy: number
	} | null>(null)
	const chipHandlers = isFree
		? {
				onPointerDown: (e: RPointerEvent<HTMLElement>) => {
					if (
						(e.target as HTMLElement).closest(
							'button,select,input,.aggzone-grip'
						)
					)
						return
					e.stopPropagation()
					e.currentTarget.setPointerCapture(e.pointerId)
					chipDrag.current = {
						px: e.clientX,
						py: e.clientY,
						ox: chipX,
						oy: chipY,
					}
				},
				onPointerMove: (e: RPointerEvent<HTMLElement>) => {
					const d = chipDrag.current
					if (!d) return
					const z = api.engine.viewport.zoom
					api.liveData(o.id, {
						chipPos: {
							x: Math.max(
								-OVERX,
								Math.min(d.ox + (e.clientX - d.px) / z, zw - 24 + OVERX)
							),
							y: Math.max(
								-OVERY,
								Math.min(d.oy + (e.clientY - d.py) / z, zh - 8 + OVERY)
							),
						},
					})
				},
				onPointerUp: () => {
					if (chipDrag.current) api.commitDoc()
					chipDrag.current = null
				},
			}
		: {}

	const resultSpan = (
		<span className={`aggzone-result${numCls(data, result)}`}>
			{result === null
				? '—'
				: data.hideZero && result === 0
					? ''
					: formatDisplay(result, data)}
		</span>
	)

	const grip = (
		<svg
			className="aggzone-grip"
			viewBox="0 0 12 12"
			width={data.mini ? 10 : 11}
			height={data.mini ? 10 : 11}
			aria-hidden="true"
		>
			<path
				d="M6 1v10M1 6h10M6 1 4.5 2.5M6 1l1.5 1.5M6 11l-1.5-1.5M6 11l1.5 1.5M1 6l1.5-1.5M1 6l1.5 1.5M11 6l-1.5-1.5M11 6l-1.5 1.5"
				fill="none"
				stroke="currentColor"
				strokeWidth="1.1"
				strokeLinecap="round"
				strokeLinejoin="round"
			/>
		</svg>
	)

	const fdot = data.filter?.color && (
		<span
			className="aggzone-fdot"
			style={{ background: PIECE_COLORS[data.filter.color]?.fill }}
			title={t('色で絞り込み中')}
		/>
	)

	return (
		<div
			className={`aggzone size-${data.size ?? 'm'}${data.plain ? ' plain' : ''}`}
		>
			{data.mini ? (
				<div
					className={`aggzone-header pos-${pos} mini${isFree ? ' free' : ''}`}
					style={chipStyle}
					{...chipHandlers}
				>
					{grip}
					{fdot}
					{resultSpan}
					<button
						className="aggzone-plain nodrag"
						title={t('操作パネルを表示')}
						onPointerDown={(e) => e.stopPropagation()}
						onClick={() => api.updateData(o.id, { mini: false })}
					>
						Σ
					</button>
				</div>
			) : (
				<div
					className={`aggzone-header pos-${pos}${isFree ? ' free' : ''}`}
					style={chipStyle}
					{...chipHandlers}
				>
					{grip}
					{fdot}
					<select
						className="aggzone-fn nodrag"
						name="aggzone-fn"
						value={fn}
						onPointerDown={(e) => e.stopPropagation()}
						onChange={(e) =>
							api.updateData(o.id, {
								fn: e.currentTarget.value as AggFn,
							})
						}
					>
						{AGG_FNS.map((f) => (
							<option key={f} value={f}>
								{f.toUpperCase()}
							</option>
						))}
					</select>
					{resultSpan}
					{(fn !== 'count' || data.filter?.color) && (
						<span className="aggzone-count">
							n=
							{data.filter?.color
								? `${matched.length}/${members.length}`
								: members.length}
						</span>
					)}
					<button
						className="aggzone-pos nodrag"
						title={t('式と結果の表示位置（下→自由）')}
						onPointerDown={(e) => e.stopPropagation()}
						onClick={cycleLabelPos}
					>
						{t(LABEL_POS_LABEL[pos])}
					</button>
					<button
						className={`aggzone-plain nodrag${data.plain ? ' active' : ''}`}
						title={t('枠と背景を消す（集計は続く）')}
						onPointerDown={(e) => e.stopPropagation()}
						onClick={() => api.updateData(o.id, { plain: !data.plain })}
					>
						{t('枠')}
					</button>
					<button
						className={`aggzone-src nodrag${isHinted ? ' active' : ''}`}
						title={t('集計対象を点線で表示')}
						onPointerDown={(e) => e.stopPropagation()}
						onClick={toggleHint}
					>
						◎
					</button>
					<button
						className="aggzone-plain nodrag"
						title={t('結果だけ表示（コンパクト）')}
						onPointerDown={(e) => e.stopPropagation()}
						onClick={() => api.updateData(o.id, { mini: true })}
					>
						−
					</button>
				</div>
			)}
			{sel && (
				<div className="calc-tools nodrag">
					{(
						[
							['s', 'S'],
							['m', 'M'],
							['l', 'L'],
							['xl', 'LL'],
						] as const
					).map(([k, sz]) => (
						<button
							key={k}
							className={(data.size ?? 'm') === k ? 'active' : ''}
							title={t('文字サイズ {s}', { s: sz })}
							onPointerDown={(e) => e.stopPropagation()}
							onClick={() => api.updateData(o.id, { size: k })}
						>
							{sz}
						</button>
					))}
				</div>
			)}
		</div>
	)
}

// ─── 計算ピース ──────────────────────────────────────────────

function CalcView({ o }: { o: WorldObject }) {
	const api = useBoard()
	const hint = useContext(HintContext)
	const t = useT()
	const data = dataOf<CalcData>(o)
	const hinted = hint.ids.has(o.id)
	const zpart = hint.partial.has(o.id)
	const gmem = hint.group.has(o.id)
	const sel = api.selIds.has(o.id)
	const { objects, edges } = api.doc
	const value = objectValue(o.id, objects, edges)
	const aSrc = operandSource(edges, o.id, 'a')
	const bSrc = operandSource(edges, o.id, 'b')
	const cls = `calcnode align-${data.align ?? 'c'} size-${data.size ?? 'm'}${data.plain ? ' plain' : ''}${hinted ? ' hinted' : ''}${zpart ? ' zpart' : ''}${gmem ? ' gmember' : ''}${o.locked ? ' locked' : ''}`
	const style = {
		fontFamily: fontStack(undefined, api.docFont),
		...(data.textColor
			? { color: TEXT_COLORS[data.textColor] }
			: data.plain && onDarkCanvas(api.dark, api.paperRect, objectBounds(o))
				? { color: '#e6e3da' }
				: {}),
	}

	// calc カードはコンテンツが自然サイズを決める（react-flow の
	// measured と同じ効果）。実測が保存サイズを上回るときだけ
	// o.w/h へ履歴なしで同期し、ポート位置・選択枠・ヒットを一致させる
	const cardRef = useRef<HTMLDivElement>(null)
	useEffect(() => {
		const el = cardRef.current
		if (!el) return
		const sync = () => {
			const w = el.offsetWidth
			const h = el.offsetHeight
			if (w - o.w > 1 || h - o.h > 1) {
				api.liveSize(o.id, {
					w: Math.max(w, o.w),
					h: Math.max(h, o.h),
				})
			}
		}
		sync()
		const ro = new ResizeObserver(sync)
		ro.observe(el)
		return () => ro.disconnect()
	}, [o.id, o.w, o.h, api])

	const tools = sel && !o.locked && (
		<div className="calc-tools nodrag">
			{(
				[
					['l', '左'],
					['c', '中'],
					['r', '右'],
				] as const
			).map(([k, al]) => (
				<button
					key={k}
					className={(data.align ?? 'c') === k ? 'active' : ''}
					title={t('結果を{a}揃え', { a: t(al) })}
					onPointerDown={(e) => e.stopPropagation()}
					onClick={() => api.updateData(o.id, { align: k })}
				>
					{t(al)}
				</button>
			))}
			<button
				className={data.plain ? 'active' : ''}
				title={t('枠・背景を消す')}
				onPointerDown={(e) => e.stopPropagation()}
				onClick={() => api.updateData(o.id, { plain: !data.plain })}
			>
				{t('枠なし')}
			</button>
		</div>
	)

	const resultSpan = (
		<span className={`calc-result${numCls(data, value)}`}>
			{value === null
				? '—'
				: data.hideZero && value === 0
					? ''
					: formatDisplay(value, data)}
		</span>
	)

	if (data.mini) {
		return (
			<div ref={cardRef} className={`${cls} mini`} style={style}>
				{resultSpan}
				<button
					className="calc-mini-btn nodrag"
					title={t('式を表示')}
					onPointerDown={(e) => e.stopPropagation()}
					onClick={() => api.updateData(o.id, { mini: false })}
				>
					ƒx
				</button>
				{tools}
			</div>
		)
	}

	return (
		<div ref={cardRef} className={cls} style={style}>
			<div className="calc-row">
				<Operand
					api={api}
					tag="A"
					srcId={aSrc}
					constVal={data.constA}
					onConst={(v) => api.updateData(o.id, { constA: v })}
				/>
				<select
					className="calc-op nodrag"
					name="calc-op"
					value={data.op}
					onPointerDown={(e) => e.stopPropagation()}
					onChange={(e) =>
						api.updateData(o.id, {
							op: e.currentTarget.value as CalcOp,
						})
					}
				>
					{CALC_OPS.map((op) => (
						<option key={op} value={op}>
							{CALC_OP_LABEL[op]}
						</option>
					))}
				</select>
				<Operand
					api={api}
					tag="B"
					srcId={bSrc}
					constVal={data.constB}
					onConst={(v) => api.updateData(o.id, { constB: v })}
				/>
			</div>
			<div className="calc-row calc-result-row">
				<span className="calc-eq">=</span>
				{resultSpan}
				<button
					className={`calc-mini-btn nodrag${data.pct ? ' active' : ''}`}
					title={t('結果を％表示')}
					onPointerDown={(e) => e.stopPropagation()}
					onClick={() => api.updateData(o.id, { pct: !data.pct })}
				>
					%
				</button>
				<button
					className="calc-mini-btn nodrag"
					title={t('結果だけ表示（コンパクト）')}
					onPointerDown={(e) => e.stopPropagation()}
					onClick={() => api.updateData(o.id, { mini: true })}
				>
					−
				</button>
				<select
					className="calc-round nodrag"
					name="calc-round"
					title={t('丸め')}
					value={data.round}
					onPointerDown={(e) => e.stopPropagation()}
					onChange={(e) =>
						api.updateData(o.id, {
							round: e.currentTarget.value as RoundMode,
						})
					}
				>
					{ROUND_MODES.map((r) => (
						<option key={r} value={r}>
							{t(ROUND_LABEL[r])}
						</option>
					))}
				</select>
			</div>
			{tools}
		</div>
	)
}

function Operand({
	api,
	tag,
	srcId,
	constVal,
	onConst,
}: {
	api: BoardApi
	tag: string
	srcId: string | null
	constVal: number | null
	onConst: (v: number | null) => void
}) {
	const t = useT()
	if (srcId === null) {
		return <ConstInput tag={tag} value={constVal} onCommit={onConst} />
	}
	const { objects, edges } = api.doc
	const src = objects.find((x) => x.id === srcId)
	const v = objectValue(srcId, objects, edges)
	const fmt = numFmtOf(src)
	const disp =
		v === null
			? '—'
			: fmt.hideZero && v === 0
				? ''
				: formatDisplay(v, fmt)
	const name =
		src?.kind === 'piece'
			? dataOf<VObjectData>(src).label || t('値')
			: src?.kind === 'zone'
				? t('Σゾーン')
				: t('計算')
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
	const t = useT()
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
				name="calc-const"
				value={draft}
				placeholder={t('定数')}
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

// ─── 罫線・図形（stroke オブジェクト） ───────────────────────

/** 端点装飾（矢印・丸）。SVG marker でなく polygon/circle で自前描画する
 *  （html-to-image による印刷・画像化で確実に写すため）。
 *  矢印は基部を線の描き終わりに接し、先端を元の端点に置く。 */
function Caps({
	p0,
	p1,
	ah,
	sw,
	color,
	capStart,
	capEnd,
}: {
	p0: [number, number]
	p1: [number, number]
	ah: number
	sw: number
	color: string
	capStart?: LineCap
	capEnd?: LineCap
}) {
	const dr = 1.8 + sw * 0.8
	const render = (end: 's' | 'e', cap?: LineCap) => {
		if (!cap || cap === 'none') return null
		const [tx, ty] = end === 's' ? p0 : p1
		const [ox, oy] = end === 's' ? p1 : p0
		if (cap === 'dot') {
			return <circle key={end} cx={tx} cy={ty} r={dr} fill={color} />
		}
		const len = Math.hypot(ox - tx, oy - ty) || 1
		const ux = (ox - tx) / len
		const uy = (oy - ty) / len
		const bx = tx + ux * ah
		const by = ty + uy * ah
		return (
			<polygon
				key={end}
				points={`${tx},${ty} ${bx - uy * ah * 0.45},${by + ux * ah * 0.45} ${bx + uy * ah * 0.45},${by - ux * ah * 0.45}`}
				fill={color}
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

function StrokeView({ o }: { o: WorldObject }) {
	const api = useBoard()
	const t = useT()
	const gmem = useContext(HintContext).group.has(o.id)
	const data = dataOf<LineData>(o)
	const sel = api.selIds.has(o.id)
	const w = o.w
	const h = o.h
	const horiz = w >= h
	const isDouble = data.w === 'double'
	const s = isDouble
		? { width: DOUBLE_W }
		: (STROKES[data.w as Exclude<LineWeight, 'double'>] ?? STROKES.thin)
	const sc = LINE_COLORS[data.color ?? 'default'] ?? STROKE_COLOR
	// 線はボックスの上辺(横線)/左辺(縦線)に描く
	const off = s.width / 2
	const axis = isDouble ? off + DOUBLE_GAP / 2 : off
	const ah = 5 + s.width * 2
	const cutS = data.capStart === 'arrow' ? ah : 0
	const cutE = data.capEnd === 'arrow' ? ah : 0

	const line = (x1: number, y1: number, x2: number, y2: number, key?: string) => (
		<line
			key={key}
			x1={x1}
			y1={y1}
			x2={x2}
			y2={y2}
			stroke={sc}
			strokeWidth={s.width}
			strokeDasharray={'dash' in s ? s.dash : undefined}
			strokeLinecap={'cap' in s ? s.cap : 'square'}
		/>
	)

	// 円弧パス: bbox 内接楕円の一部。角度は度（0=3時方向）。
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
		const sy = ccw ? -1 : 1
		const sw = ccw ? 0 : 1
		const pt = (deg: number) => {
			const a = (deg * Math.PI) / 180
			return { x: cx + rx * Math.cos(a), y: cy + ry * Math.sin(a) * sy }
		}
		const delta = (((a1 - a0) % 360) + 360) % 360
		if (delta === 0) {
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
	const aCcw = data.arcCcw !== false
	const arcFill = data.fill ? (PIECE_COLORS[data.fill]?.fill ?? 'none') : 'none'
	const shapeFill = data.fill
		? (PIECE_COLORS[data.fill]?.fill ?? 'none')
		: 'none'

	const body = data.arc ? (
		isDouble ? (
			<>
				<path
					d={arcD(w / 2, h / 2, a0, a1, !!data.fill, aCcw)}
					fill={arcFill}
					stroke={sc}
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
					stroke={sc}
					strokeWidth={s.width}
				/>
			</>
		) : (
			<path
				d={arcD(w / 2, h / 2, a0, a1, !!data.fill, aCcw)}
				fill={arcFill}
				stroke={sc}
				strokeWidth={s.width}
				strokeDasharray={s.dash}
				strokeLinecap={s.cap}
			/>
		)
	) : data.ellipse ? (
		isDouble ? (
			<>
				<ellipse
					cx={w / 2}
					cy={h / 2}
					rx={w / 2}
					ry={h / 2}
					fill={shapeFill}
					stroke={sc}
					strokeWidth={s.width}
				/>
				<ellipse
					cx={w / 2}
					cy={h / 2}
					rx={Math.max(0, w / 2 - DOUBLE_GAP)}
					ry={Math.max(0, h / 2 - DOUBLE_GAP)}
					fill="none"
					stroke={sc}
					strokeWidth={s.width}
				/>
			</>
		) : (
			<ellipse
				cx={w / 2}
				cy={h / 2}
				rx={w / 2}
				ry={h / 2}
				fill={shapeFill}
				stroke={sc}
				strokeWidth={s.width}
				strokeDasharray={s.dash}
				strokeLinecap={s.cap}
			/>
		)
	) : data.rect ? (
		isDouble ? (
			<>
				<rect
					x={0}
					y={0}
					width={w}
					height={h}
					fill={shapeFill}
					stroke={sc}
					strokeWidth={s.width}
				/>
				<rect
					x={DOUBLE_GAP}
					y={DOUBLE_GAP}
					width={Math.max(0, w - DOUBLE_GAP * 2)}
					height={Math.max(0, h - DOUBLE_GAP * 2)}
					fill="none"
					stroke={sc}
					strokeWidth={s.width}
				/>
			</>
		) : (
			<rect
				x={0}
				y={0}
				width={w}
				height={h}
				fill={shapeFill}
				stroke={sc}
				strokeWidth={s.width}
				strokeDasharray={s.dash}
				strokeLinecap={s.cap}
			/>
		)
	) : data.diag ? (
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
		<div className={`linenode${gmem ? ' gmember' : ''}${o.locked ? ' locked' : ''}`}>
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
						color={sc}
						capStart={data.capStart}
						capEnd={data.capEnd}
					/>
				)}
			</svg>
			{sel && !o.locked && (
				<div className="linenode-tools nodrag">
					{WEIGHTS.map(([k, lbl]) => (
						<button
							key={k}
							className={data.w === k ? 'active' : ''}
							onPointerDown={(e) => e.stopPropagation()}
							onClick={() => api.updateData(o.id, { w: k })}
						>
							{t(lbl)}
						</button>
					))}
					<button
						className={data.front ? 'active' : ''}
						title={t('前面に表示（ピースの上に線を描く）')}
						onPointerDown={(e) => e.stopPropagation()}
						onClick={() =>
							api.updateObject(o.id, {
								data: { ...data, front: !data.front },
								layer: data.front ? 0 : 10,
							})
						}
					>
						{t('前面')}
					</button>
				</div>
			)}
		</div>
	)
}

// ─── 曲線（spline オブジェクト、正規化頂点） ─────────────────

const SEG = 16 // Catmull-Rom 1区間あたりのサンプル数

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

function SplineView({ o }: { o: WorldObject }) {
	const api = useBoard()
	const hint = useContext(HintContext)
	const gmem = hint.group.has(o.id)
	const data = dataOf<CurveData>(o)
	const sel = api.selIds.has(o.id)
	const w = o.w
	const h = o.h
	const s =
		STROKES[(data.w as Exclude<LineWeight, 'double'>) ?? 'thin'] ??
		STROKES.thin
	const sc = LINE_COLORS[data.color ?? 'default'] ?? STROKE_COLOR
	const ah = 5 + s.width * 2
	const dr = 1.8 + s.width * 0.8
	const snapOn = hint.snapOn
	// 吸着ONならグリッド、OFFなら1px単位で頂点を置ける
	const snapV = (v: number) =>
		snapOn ? Math.round(v / GRID) * GRID : Math.round(v)

	// 正規化頂点 → ノード座標系 px
	const pts = useMemo(
		() => data.pts.map((p) => ({ x: p.fx * w, y: p.fy * h })),
		[data.pts, w, h]
	)
	const samples = useMemo(() => catmull(pts), [pts])
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

	const capEl = (end: 's' | 'e', cap?: LineCap) => {
		if (!cap || cap === 'none' || samples.length < 2) return null
		const tip = end === 's' ? pts[0] : pts[pts.length - 1]
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
	// セグメントダブルクリック=頂点挿入。pts は正規化座標で書き戻す
	const applyPts = (next: { fx: number; fy: number }[], commit: boolean) => {
		if (commit) api.updateData(o.id, { pts: next })
		else api.liveData(o.id, { pts: next })
	}
	const dragVtx = useRef(false)
	const onVertexDown = (e: RPointerEvent) => {
		e.stopPropagation()
		e.currentTarget.setPointerCapture(e.pointerId)
		dragVtx.current = true
	}
	const onVertexMove = (i: number) => (e: RPointerEvent) => {
		if (!e.currentTarget.hasPointerCapture(e.pointerId)) return
		const wp = api.worldPt(e.clientX, e.clientY)
		const nx = snapV(wp.x - o.x)
		const ny = snapV(wp.y - o.y)
		applyPts(
			data.pts.map((p, k) =>
				k === i ? { fx: nx / w, fy: ny / h } : p
			),
			false
		)
	}
	const onVertexUp = (e: RPointerEvent) => {
		if (e.currentTarget.hasPointerCapture(e.pointerId))
			e.currentTarget.releasePointerCapture(e.pointerId)
		if (dragVtx.current) {
			dragVtx.current = false
			api.commitDoc()
		}
	}
	const insertAt = (i: number) => {
		const mid = samples[i * SEG + Math.floor(SEG / 2)] ?? {
			x: (pts[i].x + pts[i + 1].x) / 2,
			y: (pts[i].y + pts[i + 1].y) / 2,
		}
		const np = [...pts.slice(0, i + 1), mid, ...pts.slice(i + 1)]
		applyPts(
			np.map((p) => ({ fx: p.x / w, fy: p.y / h })),
			true
		)
	}

	return (
		<div className={`curvenode${gmem ? ' gmember' : ''}${o.locked ? ' locked' : ''}`}>
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
				{sel && !o.locked && (
					<>
						{pts.slice(0, -1).map((p, i) => (
							<line
								key={`seg${i}`}
								className="nodrag curve-seghit"
								x1={p.x}
								y1={p.y}
								x2={pts[i + 1].x}
								y2={pts[i + 1].y}
								onDoubleClick={() => insertAt(i)}
							/>
						))}
						{pts.map((p, i) => (
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
									if (pts.length > 2)
										applyPts(
											pts
												.filter((_, k) => k !== i)
												.map((p) => ({ fx: p.x / w, fy: p.y / h })),
											true
										)
								}}
							/>
						))}
					</>
				)}
			</svg>
		</div>
	)
}
