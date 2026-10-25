import {
	useEffect,
	useState,
	type KeyboardEvent,
	type ReactNode,
} from 'react'
import type { Edge, WorldObject } from '@kimetron/core'
import { AGG_FNS, contains, type AggFn } from './lib/aggregate'
import {
	CALC_OPS,
	CALC_OP_LABEL,
	ROUND_LABEL,
	ROUND_MODES,
	dataOf,
	operandSource,
} from './lib/calc'
import { LABEL_POS_CYCLE, LABEL_POS_LABEL } from './parts'
import { LINE_COLORS, PIECE_COLORS, TEXT_COLORS } from './colors'
import { FontSelect } from './font-select'
import { useT } from './i18n'
import type {
	AggLabelPos,
	CalcData,
	CalcOp,
	CurveData,
	LineData,
	LineWeight,
	NumFmt,
	RoundMode,
	VObjectData,
	ZoneData,
} from './types'

// 選択オブジェクトへの属性適用。data マージ版と、layer 等の
// オブジェクト属性も触れる版の2種を App から受け取る
export type ApplyData = (ids: string[], patch: Record<string, unknown>) => void
export type ApplyNode = (
	ids: string[],
	mk: (
		o: WorldObject
	) => Omit<Partial<WorldObject>, 'data'> & {
		data?: Record<string, unknown>
	}
) => void

const SIZE_OPTS = [
	['s', 'S'],
	['m', 'M'],
	['l', 'L'],
	['xl', 'LL'],
] as const
const ALIGN_OPTS = [
	['l', '左'],
	['c', '中'],
	['r', '右'],
] as const
const WEIGHT_OPTS: readonly (readonly [LineWeight, string])[] = [
	['thin', '細'],
	['bold', '太'],
	['xbold', '極太'],
	['dash', '破線'],
	['dot', '点線'],
	['chain', '一鎖'],
	['double', '二重'],
]
// 曲線は二重線非対応（平行オフセット曲線が未実装のため）
const CURVE_WEIGHT_OPTS = WEIGHT_OPTS.filter(
	([k]) => k !== 'double'
) as readonly (readonly [Exclude<LineWeight, 'double'>, string])[]
const CAP_OPTS = [
	['none', 'なし'],
	['arrow', '→'],
	['dot', '●'],
] as const
const AGG_LABEL: Record<AggFn, string> = {
	sum: 'SUM',
	avg: 'AVG',
	count: 'COUNT',
	max: 'MAX',
	min: 'MIN',
}
const DIGIT_OPTS = ['auto', '0', '1', '2', '3'] as const
const DIGIT_LABEL: Record<(typeof DIGIT_OPTS)[number], string> = {
	auto: '自動',
	'0': '0',
	'1': '1',
	'2': '2',
	'3': '3',
}
const NUM_WEIGHT_OPTS = [
	['thin', '細'],
	['normal', '標準'],
	['bold', '太'],
] as const
const NEG_OPTS = [
	['minus', 'ー'],
	['paren', '（）'],
	['tri', '▲'],
	['red', '赤'],
	['redminus', '赤ー'],
] as const
const TEXT_COLOR_LABEL: Record<string, string> = {
	auto: '自動',
	white: '白',
	black: '黒',
	gray: 'グレー',
	red: '赤',
	blue: '青',
	green: '緑',
}
// サイズステッパーの刻みと各種オブジェクトの最小サイズ
const SIZE_STEP = 12
const MIN_SIZE: Record<string, [number, number]> = {
	piece: [36, 24],
	stroke: [12, 12],
	calc: [64, 32],
	zone: [72, 48],
}
const minOf = (o: WorldObject, axis: 0 | 1) =>
	(MIN_SIZE[o.kind] ?? [SIZE_STEP, SIZE_STEP])[axis]

// 全件同一値ならそれを返す。混在または空なら null（「未決定」表示用）
function common<T, V>(arr: T[], get: (t: T) => V): V | null {
	if (arr.length === 0) return null
	const v = get(arr[0])
	return arr.every((t) => get(t) === v) ? v : null
}

// calc 入力に接続しているソースの表示名
function srcName(
	objects: WorldObject[],
	id: string,
	t: (k: string) => string
): string {
	const o = objects.find((x) => x.id === id)
	if (!o) return '?'
	if (o.kind === 'piece') return dataOf<VObjectData>(o).label || t('値')
	if (o.kind === 'zone') return t('Σゾーン')
	return t('計算')
}

type NumericObj = WorldObject

// 数値書式（カンマ・小数桁数・0非表示）+ 表記（太さ・負数）の編集行
function FmtRow({
	nodes,
	ids,
	applyData,
}: {
	nodes: NumericObj[]
	ids: string[]
	applyData: ApplyData
}) {
	const d = common(nodes, (o) => (o.data as VObjectData).digits)
	return (
		<>
			<Row label="書式">
				<Toggle
					label="カンマ"
					on={common(nodes, (o) => !!(o.data as VObjectData).comma) === true}
					onFlip={(v) => applyData(ids, { comma: v })}
				/>
				<Toggle
					label="0非表示"
					on={
						common(nodes, (o) => !!(o.data as VObjectData).hideZero) ===
						true
					}
					onFlip={(v) => applyData(ids, { hideZero: v })}
				/>
			</Row>
			<Row label="桁数">
				<Sel<string>
					options={DIGIT_OPTS}
					label={DIGIT_LABEL}
					current={d === null ? null : d === undefined ? 'auto' : String(d)}
					onPick={(v) =>
						applyData(ids, {
							digits: v === 'auto' ? undefined : parseInt(v, 10),
						})
					}
				/>
				<Sel<RoundMode>
					options={ROUND_MODES}
					label={ROUND_LABEL}
					current={
						common(
							nodes,
							(o) =>
								(o.data as NumFmt).dispRound ?? 'none'
						) as RoundMode | null
					}
					onPick={(v) => applyData(ids, { dispRound: v })}
				/>
			</Row>
			<Row label="表記">
				<Btns
					options={NUM_WEIGHT_OPTS}
					current={
						common(
							nodes,
							(o) => (o.data as VObjectData).numWeight ?? 'bold'
						) as 'thin' | 'normal' | 'bold' | null
					}
					onPick={(v) => applyData(ids, { numWeight: v })}
				/>
				<Btns
					options={NEG_OPTS}
					current={
						common(
							nodes,
							(o) => (o.data as VObjectData).neg ?? 'minus'
						) as
							| 'minus'
							| 'paren'
							| 'tri'
							| 'red'
							| 'redminus'
							| null
					}
					onPick={(v) => applyData(ids, { neg: v })}
				/>
			</Row>
		</>
	)
}

// 文字色スウォッチ行。'auto' はテーマ既定色（textColor を消す）
function TextColorRow({
	nodes,
	ids,
	applyData,
}: {
	nodes: NumericObj[]
	ids: string[]
	applyData: ApplyData
}) {
	const t = useT()
	const cur = common(nodes, (o) => (o.data as VObjectData).textColor ?? 'auto')
	return (
		<Row label="文字色">
			<div className="vobject-colors">
				{Object.keys(TEXT_COLORS).map((name) => (
					<button
						key={name}
						className={`vobject-swatch${cur === name ? ' active' : ''}`}
						style={
							name === 'auto'
								? {
										backgroundColor: '#fff',
										border: '1px dashed #999',
									}
								: name === 'white'
									? {
											backgroundColor: TEXT_COLORS[name],
											borderColor: '#bbb',
										}
									: {
											backgroundColor: TEXT_COLORS[name],
											borderColor: TEXT_COLORS[name],
										}
						}
						title={t(TEXT_COLOR_LABEL[name] ?? name)}
						onClick={() =>
							applyData(ids, {
								textColor: name === 'auto' ? undefined : name,
							})
						}
					/>
				))}
			</div>
		</Row>
	)
}

function Row({
	label,
	children,
}: {
	label: string
	children: ReactNode
}) {
	const t = useT()
	return (
		<div className="insp-row">
			<span className="insp-label">{t(label)}</span>
			{children}
		</div>
	)
}

// 値ボタン群。current=null（混在）のときはどれも active にしない
function Btns<T extends string>({
	options,
	current,
	onPick,
}: {
	options: readonly (readonly [T, string])[]
	current: T | null
	onPick: (v: T) => void
}) {
	const t = useT()
	return (
		<div className="vobject-align">
			{options.map(([k, lbl]) => (
				<button
					key={k}
					className={`vobject-align-btn${current === k ? ' active' : ''}`}
					onClick={() => onPick(k)}
				>
					{t(lbl)}
				</button>
			))}
		</div>
	)
}

// トグル。on=全件true。混在/全false のときクリックで全件true、全trueで全件false
function Toggle({
	label,
	on,
	onFlip,
}: {
	label: string
	on: boolean
	onFlip: (v: boolean) => void
}) {
	const t = useT()
	return (
		<button
			className={`vobject-align-btn${on ? ' active' : ''}`}
			onClick={() => onFlip(!on)}
		>
			{t(label)}
		</button>
	)
}

// 混在対応セレクト。current=null のとき「（混在）」を表示
function Sel<T extends string>({
	options,
	label,
	current,
	onPick,
}: {
	options: readonly T[]
	label: Record<T, string>
	current: T | null
	onPick: (v: T) => void
}) {
	const t = useT()
	return (
		<select
			className="insp-select"
			name="insp-select"
			value={current ?? '__mixed'}
			onChange={(e) => onPick(e.currentTarget.value as T)}
		>
			{current === null && (
				<option value="__mixed" disabled>
					{t('（混在）')}
				</option>
			)}
			{options.map((o) => (
				<option key={o} value={o}>
					{t(label[o])}
				</option>
			))}
		</select>
	)
}

// blur 確定のテキストフィールド（PieceEditor と同じ作法）
function TextField({
	value,
	multiline,
	placeholder,
	onCommit,
}: {
	value: string
	multiline?: boolean
	placeholder?: string
	onCommit: (v: string) => void
}) {
	const t = useT()
	const [draft, setDraft] = useState(value)
	useEffect(() => setDraft(value), [value])
	const commit = () => {
		if (draft !== value) onCommit(draft)
	}
	const onKey = (e: KeyboardEvent<HTMLElement>) => {
		const single = !multiline
		if (
			(single && e.key === 'Enter') ||
			(!single && e.key === 'Enter' && (e.ctrlKey || e.metaKey))
		) {
			commit()
			e.currentTarget.blur()
		} else if (e.key === 'Escape') {
			setDraft(value)
			e.currentTarget.blur()
		}
	}
	return multiline ? (
		<textarea
			className="insp-text"
			name="insp-text"
			value={draft}
			placeholder={placeholder && t(placeholder)}
			rows={Math.min(8, Math.max(2, draft.split('\n').length))}
			onChange={(e) => setDraft(e.currentTarget.value)}
			onBlur={commit}
			onKeyDown={onKey}
		/>
	) : (
		<input
			className="insp-text"
			name="insp-text"
			value={draft}
			placeholder={placeholder && t(placeholder)}
			onChange={(e) => setDraft(e.currentTarget.value)}
			onBlur={commit}
			onKeyDown={onKey}
		/>
	)
}

// サイズ調整（−/＋ ボタン＋直接入力）。エッジ掴みが難しい代替操作。
// value=null は混在表示。＋/− は各ノードの現サイズから相対増減、
// 直接入力は全選択に絶対値を適用する
function SizeCtl({
	value,
	onStep,
	onSet,
}: {
	value: number | null
	onStep: (d: number) => void
	onSet: (v: number) => void
}) {
	const t = useT()
	const [draft, setDraft] = useState(value === null ? '' : String(Math.round(value)))
	useEffect(() => {
		setDraft(value === null ? '' : String(Math.round(value)))
	}, [value])
	const commit = () => {
		const n = parseFloat(draft)
		if (!isNaN(n) && n > 0) onSet(n)
	}
	return (
		<>
			<button
				className="vobject-align-btn"
				title="−12"
				onClick={() => onStep(-SIZE_STEP)}
			>
				−
			</button>
			<input
				className="insp-text insp-num insp-size"
				name="insp-size"
				value={draft}
				placeholder={t('混在')}
				onChange={(e) => setDraft(e.currentTarget.value)}
				onBlur={commit}
				onKeyDown={(e) => {
					if (e.key === 'Enter') {
						commit()
						e.currentTarget.blur()
					} else if (e.key === 'Escape') {
						setDraft(value === null ? '' : String(Math.round(value)))
						e.currentTarget.blur()
					}
				}}
			/>
			<button
				className="vobject-align-btn"
				title="+12"
				onClick={() => onStep(SIZE_STEP)}
			>
				＋
			</button>
		</>
	)
}

function NumField({
	value,
	onCommit,
}: {
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
		const v = t === '' || isNaN(n) ? null : n
		if (v !== value) onCommit(v)
	}
	return (
		<input
			className="insp-text insp-num"
			name="insp-num"
			value={draft}
			placeholder="—"
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
	)
}

// 配列複製: 個数 N と間隔 dx,dy を指定して一括複製（明細行の縦並び等）
function ArrayDup({
	defDy,
	onRun,
}: {
	defDy: number
	onRun: (count: number, dx: number, dy: number) => void
}) {
	const t = useT()
	const [n, setN] = useState('5')
	const [dx, setDx] = useState('0')
	const [dy, setDy] = useState(String(defDy))
	useEffect(() => setDy(String(defDy)), [defDy])
	const num = (s: string) => {
		const v = parseFloat(s)
		return isNaN(v) ? 0 : v
	}
	const cnt = Math.round(num(n))
	const inp = (
		v: string,
		set: (s: string) => void,
		title: string
	) => (
		<input
			className="insp-text insp-num insp-size"
			name="insp-arr"
			value={v}
			title={title}
			onChange={(e) => set(e.currentTarget.value)}
		/>
	)
	return (
		<Row label="個数/間隔">
			{inp(n, setN, t('個数（最大50）'))}
			{inp(dx, setDx, t('間隔 dx（px）'))}
			{inp(dy, setDy, t('間隔 dy（px）'))}
			<button
				className="vobject-align-btn"
				disabled={cnt < 1}
				title={t('選択物を 個数×間隔(dx,dy) で一括複製（グループは別IDで独立）')}
				onClick={() => onRun(cnt, num(dx), num(dy))}
			>
				{t('複製')}
			</button>
		</Row>
	)
}

export function Inspector({
	sel,
	objects,
	edges,
	applyData,
	applyNode,
	onArray,
}: {
	sel: WorldObject[]
	objects: WorldObject[]
	edges: Edge[]
	applyData: ApplyData
	applyNode: ApplyNode
	onArray: (count: number, dx: number, dy: number) => void
}) {
	const t = useT()
	const vos = sel.filter((o) => o.kind === 'piece')
	const lines = sel.filter((o) => o.kind === 'stroke')
	const curves = sel.filter((o) => o.kind === 'spline')
	const calcs = sel.filter((o) => o.kind === 'calc')
	const zones = sel.filter((o) => o.kind === 'zone')
	const voIds = vos.map((o) => o.id)
	// 書式/表記は数値を持つピース（number・pair）のみに出す
	const numVos = vos.filter((o) => dataOf<VObjectData>(o).kind !== 'text')
	const numVoIds = numVos.map((o) => o.id)
	const lnIds = lines.map((o) => o.id)
	const cvIds = curves.map((o) => o.id)
	const caIds = calcs.map((o) => o.id)
	const zoIds = zones.map((o) => o.id)

	const head = [
		vos.length > 0 && `${t('ピース')}×${vos.length}`,
		lines.length > 0 && `${t('罫線')}×${lines.length}`,
		curves.length > 0 && `${t('曲線')}×${curves.length}`,
		calcs.length > 0 && `${t('計算')}×${calcs.length}`,
		zones.length > 0 && `Σ×${zones.length}`,
	]
		.filter(Boolean)
		.join('　')

	const wOf = (o: WorldObject) => o.w
	const hOf = (o: WorldObject) => o.h
	const allIds = sel.map((o) => o.id)
	// 図形罫線（矩形・楕円・円弧）は塗りつぶし対象。形状は相互変換できる
	const boxLines = lines.filter((o) => {
		const d = dataOf<LineData>(o)
		return d.rect || d.ellipse || d.arc
	})
	// 端点装飾（通常線のみ。図形は不可）
	const plainLines = lines.filter((o) => {
		const d = dataOf<LineData>(o)
		return !d.rect && !d.ellipse && !d.arc
	})
	const fillCur = common(boxLines, (o) => dataOf<LineData>(o).fill ?? '')
	const lineColorCur = common(lines, (o) => dataOf<LineData>(o).color ?? 'default')
	const boxIds = boxLines.map((o) => o.id)
	const boxShape = common(boxLines, (o) => {
		const d = dataOf<LineData>(o)
		return d.arc ? 'arc' : d.ellipse ? 'ellipse' : 'rect'
	})
	// 円弧の始角・終角（度、0=3時方向）
	const arcs = boxLines.filter((o) => dataOf<LineData>(o).arc)
	const arcIds = arcs.map((o) => o.id)
	const wCom = sel.length > 0 ? common(sel, wOf) : null
	const hCom = sel.length > 0 ? common(sel, hOf) : null
	// 「フィット」: ピースをほぼ包含する矩形罫線がちょうど1つのとき、
	// その矩形に位置・サイズを合わせる。許容6px
	const FILL_TOL = 6
	const allRects = objects.filter(
		(o) => o.kind === 'stroke' && !!dataOf<LineData>(o).rect
	)
	const containerOf = (o: WorldObject) => {
		const hits = allRects.filter((r) =>
			contains(
				{ minX: r.x, minY: r.y, maxX: r.x + r.w, maxY: r.y + r.h },
				{
					minX: o.x,
					minY: o.y,
					maxX: o.x + wOf(o),
					maxY: o.y + hOf(o),
				},
				FILL_TOL
			)
		)
		return hits.length === 1 ? hits[0] : null
	}
	const fillTargets = [...vos, ...calcs]
	const fillable = fillTargets.filter((o) => containerOf(o) !== null)
	// グループ。対象は piece/calc/stroke/spline（zone 不可）
	const GROUPABLE = new Set(['piece', 'calc', 'stroke', 'spline'])
	const gid = (o: WorldObject) => o.group
	const selGids = new Set(sel.map(gid).filter((g): g is string => !!g))
	const selIds = new Set(sel.map((o) => o.id))
	const groupTargets = objects.filter(
		(o) =>
			GROUPABLE.has(o.kind) &&
			(selIds.has(o.id) || (!!gid(o) && selGids.has(gid(o)!)))
	)
	const canGroup = groupTargets.length >= 2
	const canUngroup = selGids.size > 0
	// ロック（対象はグループ可と同じ。zone は対象外）
	const lockables = sel.filter((o) => GROUPABLE.has(o.kind))
	const lockIds = lockables.map((o) => o.id)
	const allLocked =
		lockables.length > 0 && lockables.every((o) => !!o.locked)
	// 配列複製の既定間隔（選択の外接高をグリッド吸着）
	const arrDefDy = sel.length
		? Math.max(
				12,
				Math.round(
					(Math.max(...sel.map((o) => o.y + hOf(o))) -
						Math.min(...sel.map((o) => o.y))) /
						12
				) * 12
			)
		: 48
	const align =
		sel.length >= 2
			? {
					left: Math.min(...sel.map((o) => o.x)),
					right: Math.max(...sel.map((o) => o.x + wOf(o))),
					top: Math.min(...sel.map((o) => o.y)),
					bottom: Math.max(...sel.map((o) => o.y + hOf(o))),
					maxW: Math.max(...sel.map(wOf)),
					maxH: Math.max(...sel.map(hOf)),
				}
			: null

	return (
		<div className="inspector">
			<div className="insp-head">{head}</div>
			{align && (
				<section className="insp-sec">
					<div className="insp-title">{t('整列')}</div>
					<div className="insp-row">
						<div className="vobject-align">
							<button
								className="vobject-align-btn"
								title={t('左揃え')}
								onClick={() =>
									applyNode(allIds, (o) => ({ x: align.left }))
								}
							>
								{t('左')}
							</button>
							<button
								className="vobject-align-btn"
								title={t('右揃え（右端を揃える）')}
								onClick={() =>
									applyNode(allIds, (o) => ({
										x: align.right - wOf(o),
									}))
								}
							>
								{t('右')}
							</button>
							<button
								className="vobject-align-btn"
								title={t('上揃え')}
								onClick={() =>
									applyNode(allIds, (o) => ({ y: align.top }))
								}
							>
								{t('上')}
							</button>
							<button
								className="vobject-align-btn"
								title={t('下揃え')}
								onClick={() =>
									applyNode(allIds, (o) => ({
										y: align.bottom - hOf(o),
									}))
								}
							>
								{t('下')}
							</button>
							<button
								className="vobject-align-btn"
								title={t('幅を揃える（最も広いものに合わせる）')}
								onClick={() =>
									applyNode(allIds, () => ({ w: align.maxW }))
								}
							>
								{t('幅')}
							</button>
							<button
								className="vobject-align-btn"
								title={t('高さを揃える（最も高いものに合わせる）')}
								onClick={() =>
									applyNode(allIds, () => ({ h: align.maxH }))
								}
							>
								{t('高')}
							</button>
						</div>
					</div>
				</section>
			)}
			{(canGroup || canUngroup) && (
				<section className="insp-sec">
					<div className="insp-title">{t('グループ')}</div>
					<Row label={`${t('対象')} ${groupTargets.length}`}>
						<button
							className="vobject-align-btn"
							disabled={!canGroup}
							title={t('選択をまとめて1つのカスタムピースに（どのメンバーを動かしても連動。Alt+ドラッグで個別移動）')}
							onClick={() =>
								applyData(
									groupTargets.map((o) => o.id),
									{ groupId: crypto.randomUUID() }
								)
							}
						>
							{t('まとめる')}
						</button>
						<button
							className="vobject-align-btn"
							disabled={!canUngroup}
							title={t('グループを解除')}
							onClick={() =>
								applyData(
									groupTargets.map((o) => o.id),
									{ groupId: undefined }
								)
							}
						>
							{t('解除')}
						</button>
					</Row>
				</section>
			)}
			{lockables.length > 0 && (
				<section className="insp-sec">
					<div className="insp-title">{t('ロック')}</div>
					<Row label={`${t('対象')} ${lockables.length}`}>
						<Toggle
							label={allLocked ? t('解除') : t('ロック')}
							on={allLocked}
							onFlip={(v) =>
								applyNode(lockIds, () => ({
									locked: v ? true : undefined,
								}))
							}
						/>
						<span className="insp-hint">
							{t('移動・リサイズ・削除・編集を抑止')}
						</span>
					</Row>
				</section>
			)}
			{sel.length > 0 && (
				<section className="insp-sec">
					<div className="insp-title">{t('配列複製')}</div>
					<ArrayDup defDy={arrDefDy} onRun={onArray} />
				</section>
			)}
			{sel.length > 0 && (
				<section className="insp-sec">
					<div className="insp-title">{t('サイズ')}</div>
					<Row label="幅">
						<SizeCtl
							value={wCom}
							onStep={(d) =>
								applyNode(allIds, (o) => ({
									w: Math.max(minOf(o, 0), wOf(o) + d),
								}))
							}
							onSet={(v) =>
								applyNode(allIds, (o) => ({
									w: Math.max(minOf(o, 0), v),
								}))
							}
						/>
					</Row>
					<Row label="高さ">
						<SizeCtl
							value={hCom}
							onStep={(d) =>
								applyNode(allIds, (o) => ({
									h: Math.max(minOf(o, 1), hOf(o) + d),
								}))
							}
							onSet={(v) =>
								applyNode(allIds, (o) => ({
									h: Math.max(minOf(o, 1), v),
								}))
							}
						/>
					</Row>
					{fillTargets.length > 0 && (
						<Row label="矩形">
							<button
								className="vobject-align-btn"
								disabled={fillable.length === 0}
								title={t(
									'内側の矩形罫線に位置・サイズを合わせる（複数矩形に跨る場合は不可。約6pxの誤差は吸収）'
								)}
								onClick={() =>
									applyNode(
										fillable.map((o) => o.id),
										(o) => {
											const r = containerOf(o)
											if (!r) return {}
											return { x: r.x, y: r.y, w: r.w, h: r.h }
										}
									)
								}
							>
								{t('フィット')}
							</button>
						</Row>
					)}
				</section>
			)}
			{vos.length > 0 && (
				<section className="insp-sec">
					<div className="insp-title">
						{t('ピース')}
						{vos.length > 1 ? ` ×${vos.length}` : ''}
					</div>
					{vos.length === 1 && (
						<>
							{dataOf<VObjectData>(vos[0]).kind !== 'number' && (
								<div className="insp-row">
									<TextField
										key={`l-${vos[0].id}`}
										multiline
										value={dataOf<VObjectData>(vos[0]).label}
										placeholder="テキスト"
										onCommit={(v) => applyData(voIds, { label: v })}
									/>
								</div>
							)}
							{dataOf<VObjectData>(vos[0]).kind !== 'text' && (
								<Row label="値">
									<NumField
										key={`v-${vos[0].id}`}
										value={dataOf<VObjectData>(vos[0]).value}
										onCommit={(v) => applyData(voIds, { value: v })}
									/>
								</Row>
							)}
						</>
					)}
					<Row label="色">
						<div className="vobject-colors">
							{Object.entries(PIECE_COLORS).map(([name, c]) => (
								<button
									key={name}
									className={`vobject-swatch${common(vos, (o) => dataOf<VObjectData>(o).color) === name ? ' active' : ''}`}
									style={
										name === 'none'
											? {
													backgroundColor: 'transparent',
													border: '1px dashed #999',
												}
											: {
													backgroundColor: c.fill,
													borderColor: c.border,
												}
									}
									title={t(name === 'none' ? '枠なし' : name)}
									onClick={() => applyData(voIds, { color: name })}
								/>
							))}
						</div>
					</Row>
					<TextColorRow nodes={vos} ids={voIds} applyData={applyData} />
					<Row label="フォント">
						<FontSelect
							value={
								common(vos, (o) => dataOf<VObjectData>(o).font ?? '') ??
								''
							}
							onPick={(f) =>
								applyData(voIds, { font: f === '' ? undefined : f })
							}
							allowInherit
						/>
					</Row>
					<Row label="文字">
						<Btns
							options={SIZE_OPTS}
							current={
								common(
									vos,
									(o) => dataOf<VObjectData>(o).size ?? 'm'
								) as 's' | 'm' | 'l' | 'xl' | null
							}
							onPick={(v) => applyData(voIds, { size: v })}
						/>
						<Toggle
							label="B"
							on={
								common(vos, (o) => !!dataOf<VObjectData>(o).bold) ===
								true
							}
							onFlip={(v) => applyData(voIds, { bold: v })}
						/>
					</Row>
					<Row label="揃え">
						<Btns
							options={ALIGN_OPTS}
							current={
								common(
									vos,
									(o) => dataOf<VObjectData>(o).align ?? 'c'
								) as 'l' | 'c' | 'r' | null
							}
							onPick={(v) => applyData(voIds, { align: v })}
						/>
					</Row>
					{numVos.length > 0 && (
						<FmtRow nodes={numVos} ids={numVoIds} applyData={applyData} />
					)}
				</section>
			)}
			{lines.length > 0 && (
				<section className="insp-sec">
					<div className="insp-title">
						{t('罫線')}
						{lines.length > 1 ? ` ×${lines.length}` : ''}
					</div>
					<Row label="線種">
						<Btns
							options={WEIGHT_OPTS}
							current={common(lines, (o) => dataOf<LineData>(o).w)}
							onPick={(v) => applyData(lnIds, { w: v })}
						/>
					</Row>
					<Row label="線色">
						<div className="vobject-colors">
							{Object.entries(LINE_COLORS).map(([name, hex]) => (
								<button
									key={name}
									className={`vobject-swatch${lineColorCur === name ? ' active' : ''}`}
									style={{ backgroundColor: hex }}
									title={t(name === 'default' ? '既定' : name)}
									onClick={() =>
										applyData(lnIds, {
											color:
												name === 'default' ? undefined : name,
										})
									}
								/>
							))}
						</div>
					</Row>
					<Row label="表示">
						<Toggle
							label="前面"
							on={common(lines, (o) => !!dataOf<LineData>(o).front) === true}
							onFlip={(v) =>
								applyNode(lnIds, (o) => ({
									layer: v ? 10 : 0,
									data: { front: v },
								}))
							}
						/>
					</Row>
					{plainLines.length > 0 && (
						<>
							<Row label="斜線">
								<Btns
									options={
										[
											['none', 'なし'],
											['down', '╲'],
											['up', '╱'],
										] as const
									}
									current={
										common(
											plainLines,
											(o) => dataOf<LineData>(o).diag ?? 'none'
										) as 'none' | 'down' | 'up' | null
									}
									onPick={(v) =>
										applyData(
											plainLines.map((o) => o.id),
											{ diag: v === 'none' ? undefined : v }
										)
									}
								/>
							</Row>
							<Row label="始端">
								<Btns
									options={CAP_OPTS}
									current={
										common(
											plainLines,
											(o) =>
												dataOf<LineData>(o).capStart ??
												'none'
										) as 'none' | 'arrow' | 'dot' | null
									}
									onPick={(v) =>
										applyData(
											plainLines.map((o) => o.id),
											{
												capStart:
													v === 'none' ? undefined : v,
											}
										)
									}
								/>
							</Row>
							<Row label="終端">
								<Btns
									options={CAP_OPTS}
									current={
										common(
											plainLines,
											(o) =>
												dataOf<LineData>(o).capEnd ?? 'none'
										) as 'none' | 'arrow' | 'dot' | null
									}
									onPick={(v) =>
										applyData(
											plainLines.map((o) => o.id),
											{
												capEnd:
													v === 'none' ? undefined : v,
											}
										)
									}
								/>
							</Row>
						</>
					)}
					{boxLines.length > 0 && (
						<Row label="形状">
							<Btns
								options={
									[
										['rect', '四角'],
										['ellipse', '楕円'],
										['arc', '円弧'],
									] as const
								}
								current={boxShape}
								onPick={(v) =>
									applyData(boxIds, {
										rect: v === 'rect' ? true : undefined,
										ellipse:
											v === 'ellipse' ? true : undefined,
										arc: v === 'arc' ? true : undefined,
										// 円弧へ変換した直後は 0°→270° の3/4弧
										...(v === 'arc'
											? { arcStart: 0, arcEnd: 270 }
											: {}),
									})
								}
							/>
						</Row>
					)}
					{arcs.length > 0 && (
						<Row label="角度">
							<NumField
								value={common(arcs, (o) => dataOf<LineData>(o).arcStart ?? 0)}
								onCommit={(v) =>
									applyData(arcIds, { arcStart: v ?? 0 })
								}
							/>
							<span className="insp-hint">→</span>
							<NumField
								value={common(arcs, (o) => dataOf<LineData>(o).arcEnd ?? 270)}
								onCommit={(v) =>
									applyData(arcIds, { arcEnd: v ?? 0 })
								}
							/>
							<span className="insp-hint">°</span>
							<Toggle
								label="反時計回り"
								on={
									common(
										arcs,
										(o) => dataOf<LineData>(o).arcCcw !== false
									) === true
								}
								onFlip={(v) =>
									applyData(arcIds, { arcCcw: v })
								}
							/>
						</Row>
					)}
					{boxLines.length > 0 && (
						<Row label="塗り">
							<div className="vobject-colors">
								<button
									className={`vobject-swatch${fillCur === '' ? ' active' : ''}`}
									style={{
										backgroundColor: 'transparent',
										border: '1px dashed #999',
									}}
									title={t('なし')}
									onClick={() =>
										applyData(lnIds, { fill: undefined })
									}
								/>
								{Object.entries(PIECE_COLORS)
									.filter(([name]) => name !== 'none')
									.map(([name, c]) => (
										<button
											key={name}
											className={`vobject-swatch${fillCur === name ? ' active' : ''}`}
											style={{
												backgroundColor: c.fill,
												borderColor: c.border,
											}}
											title={t(name)}
											onClick={() =>
												applyData(lnIds, { fill: name })
											}
										/>
									))}
							</div>
						</Row>
					)}
				</section>
			)}
			{curves.length > 0 && (
				<section className="insp-sec">
					<div className="insp-title">
						{t('曲線')}
						{curves.length > 1 ? ` ×${curves.length}` : ''}
					</div>
					<Row label="線種">
						<Btns
							options={CURVE_WEIGHT_OPTS}
							current={
								common(
									curves,
									(o) =>
										dataOf<CurveData>(o).w ?? 'thin'
								) as Exclude<LineWeight, 'double'> | null
							}
							onPick={(v) => applyData(cvIds, { w: v })}
						/>
					</Row>
					<Row label="線色">
						<div className="vobject-colors">
							{Object.entries(LINE_COLORS).map(([name, hex]) => (
								<button
									key={name}
									className={`vobject-swatch${common(curves, (o) => dataOf<CurveData>(o).color ?? 'default') === name ? ' active' : ''}`}
									style={{ backgroundColor: hex }}
									title={t(name === 'default' ? '既定' : name)}
									onClick={() =>
										applyData(cvIds, {
											color:
												name === 'default' ? undefined : name,
										})
									}
								/>
							))}
						</div>
					</Row>
					<Row label="表示">
						<Toggle
							label="前面"
							on={common(curves, (o) => !!dataOf<CurveData>(o).front) === true}
							onFlip={(v) =>
								applyNode(cvIds, (o) => ({
									layer: v ? 10 : 0,
									data: { front: v },
								}))
							}
						/>
					</Row>
					<Row label="始端">
						<Btns
							options={CAP_OPTS}
							current={
								common(
									curves,
									(o) => dataOf<CurveData>(o).capStart ?? 'none'
								) as 'none' | 'arrow' | 'dot' | null
							}
							onPick={(v) =>
								applyData(cvIds, {
									capStart: v === 'none' ? undefined : v,
								})
							}
						/>
					</Row>
					<Row label="終端">
						<Btns
							options={CAP_OPTS}
							current={
								common(
									curves,
									(o) => dataOf<CurveData>(o).capEnd ?? 'none'
								) as 'none' | 'arrow' | 'dot' | null
							}
							onPick={(v) =>
								applyData(cvIds, {
									capEnd: v === 'none' ? undefined : v,
								})
							}
						/>
					</Row>
				</section>
			)}
			{calcs.length > 0 && (
				<section className="insp-sec">
					<div className="insp-title">
						{t('計算')}
						{calcs.length > 1 ? ` ×${calcs.length}` : ''}
					</div>
					<Row label="式">
						<Sel<CalcOp>
							options={CALC_OPS}
							label={CALC_OP_LABEL}
							current={common(calcs, (o) => dataOf<CalcData>(o).op)}
							onPick={(v) => applyData(caIds, { op: v })}
						/>
						<Sel<RoundMode>
							options={ROUND_MODES}
							label={ROUND_LABEL}
							current={common(calcs, (o) => dataOf<CalcData>(o).round)}
							onPick={(v) => applyData(caIds, { round: v })}
						/>
					</Row>
					{calcs.length === 1 && (
						<>
							{(['a', 'b'] as const).map((h) => {
								const src = operandSource(edges, calcs[0].id, h)
								return (
									<Row key={h} label={h.toUpperCase()}>
										{src !== null ? (
											<span className="insp-src">
												← {srcName(objects, src, t)}
											</span>
										) : (
											<NumField
												key={`${h}-${calcs[0].id}`}
												value={
													h === 'a'
														? dataOf<CalcData>(calcs[0])
																.constA
														: dataOf<CalcData>(calcs[0])
																.constB
												}
												onCommit={(v) =>
													applyData(
														caIds,
														h === 'a'
															? { constA: v }
															: { constB: v }
													)
												}
											/>
										)}
									</Row>
								)
							})}
						</>
					)}
					<Row label="揃え">
						<Btns
							options={ALIGN_OPTS}
							current={
								common(
									calcs,
									(o) => dataOf<CalcData>(o).align ?? 'c'
								) as 'l' | 'c' | 'r' | null
							}
							onPick={(v) => applyData(caIds, { align: v })}
						/>
					</Row>
					<Row label="文字">
						<Btns
							options={SIZE_OPTS}
							current={
								common(
									calcs,
									(o) => dataOf<CalcData>(o).size ?? 'm'
								) as 's' | 'm' | 'l' | 'xl' | null
							}
							onPick={(v) => applyData(caIds, { size: v })}
						/>
					</Row>
					<TextColorRow nodes={calcs} ids={caIds} applyData={applyData} />
					<Row label="表示">
						<Toggle
							label="枠なし"
							on={common(calcs, (o) => !!dataOf<CalcData>(o).plain) === true}
							onFlip={(v) => applyData(caIds, { plain: v })}
						/>
						<Toggle
							label="コンパクト"
							on={common(calcs, (o) => !!dataOf<CalcData>(o).mini) === true}
							onFlip={(v) => applyData(caIds, { mini: v })}
						/>
					</Row>
					<FmtRow nodes={calcs} ids={caIds} applyData={applyData} />
					<Row label="％">
						<Toggle
							label="％表示"
							on={
								common(
									calcs,
									(o) => !!dataOf<CalcData>(o).pct
								) === true
							}
							onFlip={(v) => applyData(caIds, { pct: v })}
						/>
					</Row>
				</section>
			)}
			{zones.length > 0 && (
				<section className="insp-sec">
					<div className="insp-title">
						{t('集計ゾーン')}
						{zones.length > 1 ? ` ×${zones.length}` : ''}
					</div>
					<Row label="集計">
						<Sel<AggFn>
							options={AGG_FNS}
							label={AGG_LABEL}
							current={common(zones, (o) => dataOf<ZoneData>(o).fn)}
							onPick={(v) => applyData(zoIds, { fn: v })}
						/>
						<Sel<AggLabelPos>
							options={LABEL_POS_CYCLE}
							label={LABEL_POS_LABEL}
							current={common(zones, (o) => dataOf<ZoneData>(o).labelPos)}
							onPick={(v) => applyData(zoIds, { labelPos: v })}
						/>
					</Row>
					<Row label="条件">
						<div className="vobject-colors">
							<button
								className={`vobject-swatch${common(zones, (o) => dataOf<ZoneData>(o).filter?.color ?? '') === '' ? ' active' : ''}`}
								style={{
									backgroundColor: 'transparent',
									border: '1px dashed #999',
								}}
								title={t('条件なし（全ピース対象）')}
								onClick={() =>
									applyData(zoIds, { filter: undefined })
								}
							/>
							{Object.entries(PIECE_COLORS)
								.filter(([name]) => name !== 'none')
								.map(([name, c]) => (
									<button
										key={name}
										className={`vobject-swatch${common(zones, (o) => dataOf<ZoneData>(o).filter?.color) === name ? ' active' : ''}`}
										style={{
											backgroundColor: c.fill,
											borderColor: c.border,
										}}
										title={t('この色のピースのみ集計')}
										onClick={() =>
											applyData(zoIds, {
												filter: { color: name },
											})
										}
									/>
								))}
						</div>
					</Row>
					<Row label="文字">
						<Btns
							options={SIZE_OPTS}
							current={
								common(
									zones,
									(o) => dataOf<ZoneData>(o).size ?? 'm'
								) as 's' | 'm' | 'l' | 'xl' | null
							}
							onPick={(v) => applyData(zoIds, { size: v })}
						/>
					</Row>
					<TextColorRow nodes={zones} ids={zoIds} applyData={applyData} />
					<Row label="表示">
						<Toggle
							label="枠なし"
							on={common(zones, (o) => !!dataOf<ZoneData>(o).plain) === true}
							onFlip={(v) => applyData(zoIds, { plain: v })}
						/>
						<Toggle
							label="コンパクト"
							on={common(zones, (o) => !!dataOf<ZoneData>(o).mini) === true}
							onFlip={(v) => applyData(zoIds, { mini: v })}
						/>
					</Row>
					<FmtRow nodes={zones} ids={zoIds} applyData={applyData} />
				</section>
			)}
		</div>
	)
}
