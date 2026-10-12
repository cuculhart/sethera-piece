import {
	useEffect,
	useState,
	type KeyboardEvent,
	type ReactNode,
} from 'react'
import { AGG_FNS, contains, type AggFn } from './lib/aggregate'
import {
	CALC_OPS,
	CALC_OP_LABEL,
	ROUND_LABEL,
	ROUND_MODES,
	operandSource,
} from './lib/calc'
import type { Edge } from '@xyflow/react'
import { LABEL_POS_CYCLE, LABEL_POS_LABEL } from './nodes/agg-zone-node'
import { LINE_COLORS, PIECE_COLORS, TEXT_COLORS } from './nodes/vobject-node'
import type {
	AggLabelPos,
	BoardNode,
	CalcNodeType,
	CalcOp,
	CurveNodeType,
	LineNodeType,
	LineWeight,
	RoundMode,
	VObjectNodeType,
	ZoneNodeType,
} from './nodes/types'

// 選択ノードへの属性適用。data マージ版と、zIndex 等のノード属性も
// 触れる版の2種を App から受け取る
export type ApplyData = (ids: string[], patch: Record<string, unknown>) => void
export type ApplyNode = (
	ids: string[],
	mk: (
		n: BoardNode
	) => Omit<Partial<BoardNode>, 'data'> & {
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
// サイズステッパーの刻みと各ノード型の最小サイズ
const SIZE_STEP = 12
const MIN_SIZE: Record<string, [number, number]> = {
	vobject: [36, 24],
	line: [12, 12],
	calc: [64, 32],
	zone: [72, 48],
}
const minOf = (n: BoardNode, axis: 0 | 1) =>
	(n.type ? MIN_SIZE[n.type] : undefined)?.[axis] ?? SIZE_STEP

// 全件同一値ならそれを返す。混在または空なら null（「未決定」表示用）
function common<T, V>(arr: T[], get: (t: T) => V): V | null {
	if (arr.length === 0) return null
	const v = get(arr[0])
	return arr.every((t) => get(t) === v) ? v : null
}

// calc 入力に接続しているソースの表示名（calc-node の Operand と同じ基準）
function srcName(nodes: BoardNode[], id: string): string {
	const n = nodes.find((x) => x.id === id)
	if (!n) return '?'
	if (n.type === 'vobject') return n.data.label || '値'
	if (n.type === 'zone') return 'Σゾーン'
	return '計算'
}

type NumericNode = VObjectNodeType | CalcNodeType | ZoneNodeType

// 数値書式（カンマ・小数桁数・0非表示）+ 表記（太さ・負数）の編集行
function FmtRow({
	nodes,
	ids,
	applyData,
}: {
	nodes: NumericNode[]
	ids: string[]
	applyData: ApplyData
}) {
	const d = common(nodes, (n) => n.data.digits)
	return (
		<>
			<Row label="書式">
				<Toggle
					label="カンマ"
					on={common(nodes, (n) => !!n.data.comma) === true}
					onFlip={(v) => applyData(ids, { comma: v })}
				/>
				<Toggle
					label="0非表示"
					on={common(nodes, (n) => !!n.data.hideZero) === true}
					onFlip={(v) => applyData(ids, { hideZero: v })}
				/>
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
			</Row>
			<Row label="表記">
				<Btns
					options={NUM_WEIGHT_OPTS}
					current={common(nodes, (n) => n.data.numWeight ?? 'bold')}
					onPick={(v) => applyData(ids, { numWeight: v })}
				/>
				<Btns
					options={NEG_OPTS}
					current={common(nodes, (n) => n.data.neg ?? 'minus')}
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
	nodes: NumericNode[]
	ids: string[]
	applyData: ApplyData
}) {
	const cur = common(nodes, (n) => n.data.textColor ?? 'auto')
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
						title={TEXT_COLOR_LABEL[name] ?? name}
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
	return (
		<div className="insp-row">
			<span className="insp-label">{label}</span>
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
	return (
		<div className="vobject-align">
			{options.map(([k, t]) => (
				<button
					key={k}
					className={`vobject-align-btn${current === k ? ' active' : ''}`}
					onClick={() => onPick(k)}
				>
					{t}
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
	return (
		<button
			className={`vobject-align-btn${on ? ' active' : ''}`}
			onClick={() => onFlip(!on)}
		>
			{label}
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
	return (
		<select
			className="insp-select"
			name="insp-select"
			value={current ?? '__mixed'}
			onChange={(e) => onPick(e.currentTarget.value as T)}
		>
			{current === null && (
				<option value="__mixed" disabled>
					（混在）
				</option>
			)}
			{options.map((o) => (
				<option key={o} value={o}>
					{label[o]}
				</option>
			))}
		</select>
	)
}

// blur 確定のテキストフィールド（VObjectEditor と同じ作法）
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
			placeholder={placeholder}
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
			placeholder={placeholder}
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
				placeholder="混在"
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
			{inp(n, setN, '個数（最大50）')}
			{inp(dx, setDx, '間隔 dx（px）')}
			{inp(dy, setDy, '間隔 dy（px）')}
			<button
				className="vobject-align-btn"
				disabled={cnt < 1}
				title="選択物を 個数×間隔(dx,dy) で一括複製（グループは別IDで独立）"
				onClick={() => onRun(cnt, num(dx), num(dy))}
			>
				複製
			</button>
		</Row>
	)
}

export function Inspector({
	sel,
	nodes,
	edges,
	applyData,
	applyNode,
	onArray,
}: {
	sel: BoardNode[]
	nodes: BoardNode[]
	edges: Edge[]
	applyData: ApplyData
	applyNode: ApplyNode
	onArray: (count: number, dx: number, dy: number) => void
}) {
	const vos = sel.filter((n): n is VObjectNodeType => n.type === 'vobject')
	const lines = sel.filter((n): n is LineNodeType => n.type === 'line')
	const curves = sel.filter((n): n is CurveNodeType => n.type === 'curve')
	const calcs = sel.filter((n): n is CalcNodeType => n.type === 'calc')
	const zones = sel.filter((n): n is ZoneNodeType => n.type === 'zone')
	const voIds = vos.map((n) => n.id)
	// 書式/表記は数値を持つピース（number・pair）のみに出す
	const numVos = vos.filter((n) => n.data.kind !== 'text')
	const numVoIds = numVos.map((n) => n.id)
	const lnIds = lines.map((n) => n.id)
	const cvIds = curves.map((n) => n.id)
	const caIds = calcs.map((n) => n.id)
	const zoIds = zones.map((n) => n.id)

	const head = [
		vos.length > 0 && `ピース×${vos.length}`,
		lines.length > 0 && `罫線×${lines.length}`,
		curves.length > 0 && `曲線×${curves.length}`,
		calcs.length > 0 && `計算×${calcs.length}`,
		zones.length > 0 && `Σ×${zones.length}`,
	]
		.filter(Boolean)
		.join('　')

	// 整列ツール用の外接寸法（auto-size ノードは measured を使う）
	const wOf = (n: BoardNode) => n.measured?.width ?? n.width ?? 0
	const hOf = (n: BoardNode) => n.measured?.height ?? n.height ?? 0
	const allIds = sel.map((n) => n.id)
	// 図形罫線（矩形・楕円・円弧）は塗りつぶし対象。形状は相互変換できる
	const boxLines = lines.filter(
		(n) => n.data.rect || n.data.ellipse || n.data.arc
	)
	// 端点装飾（通常線のみ。図形は不可）
	const plainLines = lines.filter(
		(n) => !n.data.rect && !n.data.ellipse && !n.data.arc
	)
	const fillCur = common(boxLines, (n) => n.data.fill ?? '')
	// 線色（罫線・曲線共通。省略=default）
	const lineColorCur = common(lines, (n) => n.data.color ?? 'default')
	// 図形の形状（四角/楕円/円弧）。同一ボックスデータなので相互変換できる
	const boxIds = boxLines.map((n) => n.id)
	const boxShape = common(boxLines, (n) =>
		n.data.arc ? 'arc' : n.data.ellipse ? 'ellipse' : 'rect'
	)
	// 円弧の始角・終角（度、0=3時方向・時計回り正）
	const arcs = boxLines.filter((n) => n.data.arc)
	const arcIds = arcs.map((n) => n.id)
	// サイズステッパー（全選択の共通値。混在時は null）
	const wCom = sel.length > 0 ? common(sel, wOf) : null
	const hCom = sel.length > 0 ? common(sel, hOf) : null
	// 「フィット」: ピースをほぼ包含する矩形罫線がちょうど1つのとき、
	// その矩形に位置・サイズを合わせる。複数矩形に跨る（＝包含なし）
	// または2つ以上に包含される場合は対象外。
	// 許容6px: 吸着なしの手動配置は数pxずれるので（グリッド半分）
	const FILL_TOL = 6
	const allRects = nodes.filter(
		(n): n is LineNodeType => n.type === 'line' && !!n.data.rect
	)
	const containerOf = (n: BoardNode) => {
		const hits = allRects.filter((r) =>
			contains(
				{
					minX: r.position.x,
					minY: r.position.y,
					maxX: r.position.x + (r.width ?? 0),
					maxY: r.position.y + (r.height ?? 0),
				},
				{
					minX: n.position.x,
					minY: n.position.y,
					maxX: n.position.x + wOf(n),
					maxY: n.position.y + hOf(n),
				},
				FILL_TOL
			)
		)
		return hits.length === 1 ? hits[0] : null
	}
	const fillTargets = [...vos, ...calcs]
	const fillable = fillTargets.filter((n) => containerOf(n) !== null)
	// グループ（カスタムピース）。対象は vobject/calc/line（zone 不可）。
	// 選択に既存メンバーが混ざる場合はそのグループ全体を対象に取り込む
	const GROUPABLE = new Set(['vobject', 'calc', 'line', 'curve'])
	const gid = (n: BoardNode) => (n.data as { groupId?: string }).groupId
	const selGids = new Set(
		sel.map(gid).filter((g): g is string => !!g)
	)
	const groupTargets = nodes.filter(
		(n) =>
			GROUPABLE.has(n.type ?? '') &&
			(n.selected || (!!gid(n) && selGids.has(gid(n)!)))
	)
	const canGroup = groupTargets.length >= 2
	const canUngroup = selGids.size > 0
	// ロック（対象はグループ可と同じ。zone は対象外）
	const lockables = sel.filter((n) => GROUPABLE.has(n.type ?? ''))
	const lockIds = lockables.map((n) => n.id)
	const allLocked =
		lockables.length > 0 &&
		lockables.every(
			(n) => !!(n.data as { locked?: boolean }).locked
		)
	// 配列複製の既定間隔（選択の外接高をグリッド吸着。明細行の縦並び想定）
	const arrDefDy = sel.length
		? Math.max(
				12,
				Math.round(
					(Math.max(...sel.map((n) => n.position.y + hOf(n))) -
						Math.min(...sel.map((n) => n.position.y))) /
						12
				) * 12
			)
		: 48
	const align =
		sel.length >= 2
			? {
					left: Math.min(...sel.map((n) => n.position.x)),
					right: Math.max(...sel.map((n) => n.position.x + wOf(n))),
					top: Math.min(...sel.map((n) => n.position.y)),
					bottom: Math.max(...sel.map((n) => n.position.y + hOf(n))),
					maxW: Math.max(...sel.map(wOf)),
					maxH: Math.max(...sel.map(hOf)),
				}
			: null

	return (
		<div className="inspector">
			<div className="insp-head">{head}</div>
			{align && (
				<section className="insp-sec">
					<div className="insp-title">整列</div>
					<div className="insp-row">
						<div className="vobject-align">
							<button
								className="vobject-align-btn"
								title="左揃え"
								onClick={() =>
									applyNode(allIds, (n) => ({
										position: { x: align.left, y: n.position.y },
									}))
								}
							>
								左
							</button>
							<button
								className="vobject-align-btn"
								title="右揃え（右端を揃える）"
								onClick={() =>
									applyNode(allIds, (n) => ({
										position: {
											x: align.right - wOf(n),
											y: n.position.y,
										},
									}))
								}
							>
								右
							</button>
							<button
								className="vobject-align-btn"
								title="上揃え"
								onClick={() =>
									applyNode(allIds, (n) => ({
										position: { x: n.position.x, y: align.top },
									}))
								}
							>
								上
							</button>
							<button
								className="vobject-align-btn"
								title="下揃え"
								onClick={() =>
									applyNode(allIds, (n) => ({
										position: {
											x: n.position.x,
											y: align.bottom - hOf(n),
										},
									}))
								}
							>
								下
							</button>
							<button
								className="vobject-align-btn"
								title="幅を揃える（最も広いものに合わせる）"
								onClick={() =>
									applyNode(allIds, () => ({ width: align.maxW }))
								}
							>
								幅
							</button>
							<button
								className="vobject-align-btn"
								title="高さを揃える（最も高いものに合わせる）"
								onClick={() =>
									applyNode(allIds, () => ({ height: align.maxH }))
								}
							>
								高
							</button>
						</div>
					</div>
				</section>
			)}
			{(canGroup || canUngroup) && (
				<section className="insp-sec">
					<div className="insp-title">グループ</div>
					<Row label={`対象 ${groupTargets.length}`}>
						<button
							className="vobject-align-btn"
							disabled={!canGroup}
							title="選択をまとめて1つのカスタムピースに（どのメンバーを動かしても連動。Alt+ドラッグで個別移動）"
							onClick={() =>
								applyData(
									groupTargets.map((n) => n.id),
									{ groupId: crypto.randomUUID() }
								)
							}
						>
							まとめる
						</button>
						<button
							className="vobject-align-btn"
							disabled={!canUngroup}
							title="グループを解除"
							onClick={() =>
								applyData(
									groupTargets.map((n) => n.id),
									{ groupId: undefined }
								)
							}
						>
							解除
						</button>
					</Row>
				</section>
			)}
			{lockables.length > 0 && (
				<section className="insp-sec">
					<div className="insp-title">ロック</div>
					<Row label={`対象 ${lockables.length}`}>
						<Toggle
							label={allLocked ? '解除' : 'ロック'}
							on={allLocked}
							onFlip={(v) =>
								applyData(lockIds, { locked: v ? true : undefined })
							}
						/>
						<span className="insp-hint">
							移動・リサイズ・削除・編集を抑止
						</span>
					</Row>
				</section>
			)}
			{sel.length > 0 && (
				<section className="insp-sec">
					<div className="insp-title">配列複製</div>
					<ArrayDup defDy={arrDefDy} onRun={onArray} />
				</section>
			)}
			{sel.length > 0 && (
				<section className="insp-sec">
					<div className="insp-title">サイズ</div>
					<Row label="幅">
						<SizeCtl
							value={wCom}
							onStep={(d) =>
								applyNode(allIds, (n) => ({
									width: Math.max(minOf(n, 0), wOf(n) + d),
								}))
							}
							onSet={(v) =>
								applyNode(allIds, (n) => ({
									width: Math.max(minOf(n, 0), v),
								}))
							}
						/>
					</Row>
					<Row label="高さ">
						<SizeCtl
							value={hCom}
							onStep={(d) =>
								applyNode(allIds, (n) => ({
									height: Math.max(minOf(n, 1), hOf(n) + d),
								}))
							}
							onSet={(v) =>
								applyNode(allIds, (n) => ({
									height: Math.max(minOf(n, 1), v),
								}))
							}
						/>
					</Row>
					{fillTargets.length > 0 && (
						<Row label="矩形">
							<button
								className="vobject-align-btn"
								disabled={fillable.length === 0}
								title="内側の矩形罫線に位置・サイズを合わせる（複数矩形に跨る場合は不可。約6pxの誤差は吸収）"
								onClick={() =>
									applyNode(
										fillable.map((n) => n.id),
										(n) => {
											const r = containerOf(n)
											if (!r) return {}
											return {
												position: {
													x: r.position.x,
													y: r.position.y,
												},
												width: r.width,
												height: r.height,
											}
										}
									)
								}
							>
								フィット
							</button>
						</Row>
					)}
				</section>
			)}
			{vos.length > 0 && (
				<section className="insp-sec">
					<div className="insp-title">
						ピース{vos.length > 1 ? ` ×${vos.length}` : ''}
					</div>
					{vos.length === 1 && (
						<>
							{vos[0].data.kind !== 'number' && (
								<div className="insp-row">
									<TextField
										key={`l-${vos[0].id}`}
										multiline
										value={vos[0].data.label}
										placeholder="テキスト"
										onCommit={(v) => applyData(voIds, { label: v })}
									/>
								</div>
							)}
							{vos[0].data.kind !== 'text' && (
								<Row label="値">
									<NumField
										key={`v-${vos[0].id}`}
										value={vos[0].data.value}
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
									className={`vobject-swatch${common(vos, (n) => n.data.color) === name ? ' active' : ''}`}
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
									title={name === 'none' ? '枠なし' : name}
									onClick={() => applyData(voIds, { color: name })}
								/>
							))}
						</div>
					</Row>
					<TextColorRow nodes={vos} ids={voIds} applyData={applyData} />
					<Row label="文字">
						<Btns
							options={SIZE_OPTS}
							current={common(vos, (n) => n.data.size ?? 'm')}
							onPick={(v) => applyData(voIds, { size: v })}
						/>
						<Toggle
							label="B"
							on={common(vos, (n) => !!n.data.bold) === true}
							onFlip={(v) => applyData(voIds, { bold: v })}
						/>
					</Row>
					<Row label="揃え">
						<Btns
							options={ALIGN_OPTS}
							current={common(vos, (n) => n.data.align ?? 'c')}
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
						罫線{lines.length > 1 ? ` ×${lines.length}` : ''}
					</div>
					<Row label="線種">
						<Btns
							options={WEIGHT_OPTS}
							current={common(lines, (n) => n.data.w)}
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
									title={name}
									onClick={() =>
										applyData(lnIds, {
											color:
												name === 'default'
													? undefined
													: name,
										})
									}
								/>
							))}
						</div>
					</Row>
					<Row label="表示">
						<Toggle
							label="前面"
							on={common(lines, (n) => !!n.data.front) === true}
							onFlip={(v) =>
								applyNode(lnIds, (n) => ({
									data: { ...n.data, front: v },
									zIndex: v ? 10 : 0,
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
									current={common(
										plainLines,
										(n) => n.data.diag ?? 'none'
									)}
									onPick={(v) =>
										applyData(
											plainLines.map((n) => n.id),
											{
												diag:
													v === 'none'
														? undefined
														: v,
											}
										)
									}
								/>
							</Row>
							<Row label="始端">
								<Btns
									options={CAP_OPTS}
									current={common(
										plainLines,
										(n) => n.data.capStart ?? 'none'
									)}
									onPick={(v) =>
										applyData(
											plainLines.map((n) => n.id),
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
									current={common(
										plainLines,
										(n) => n.data.capEnd ?? 'none'
									)}
									onPick={(v) =>
										applyData(
											plainLines.map((n) => n.id),
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
								value={common(arcs, (n) => n.data.arcStart ?? 0)}
								onCommit={(v) =>
									applyData(arcIds, {
										arcStart: v ?? 0,
									})
								}
							/>
							<span className="insp-hint">→</span>
							<NumField
								value={common(arcs, (n) => n.data.arcEnd ?? 270)}
								onCommit={(v) =>
									applyData(arcIds, {
										arcEnd: v ?? 0,
									})
								}
							/>
							<span className="insp-hint">°</span>
							<Toggle
								label="反時計回り"
								on={
									common(
										arcs,
										(n) => n.data.arcCcw !== false
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
									title="なし"
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
											title={name}
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
						曲線{curves.length > 1 ? ` ×${curves.length}` : ''}
					</div>
					<Row label="線種">
						<Btns
							options={CURVE_WEIGHT_OPTS}
							current={common(curves, (n) => n.data.w ?? 'thin')}
							onPick={(v) => applyData(cvIds, { w: v })}
						/>
					</Row>
					<Row label="線色">
						<div className="vobject-colors">
							{Object.entries(LINE_COLORS).map(([name, hex]) => (
								<button
									key={name}
									className={`vobject-swatch${common(curves, (n) => n.data.color ?? 'default') === name ? ' active' : ''}`}
									style={{ backgroundColor: hex }}
									title={name}
									onClick={() =>
										applyData(cvIds, {
											color:
												name === 'default'
													? undefined
													: name,
										})
									}
								/>
							))}
						</div>
					</Row>
					<Row label="表示">
						<Toggle
							label="前面"
							on={common(curves, (n) => !!n.data.front) === true}
							onFlip={(v) =>
								applyNode(cvIds, (n) => ({
									data: { ...n.data, front: v },
									zIndex: v ? 10 : 0,
								}))
							}
						/>
					</Row>
					<Row label="始端">
						<Btns
							options={CAP_OPTS}
							current={common(curves, (n) => n.data.capStart ?? 'none')}
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
							current={common(curves, (n) => n.data.capEnd ?? 'none')}
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
						計算{calcs.length > 1 ? ` ×${calcs.length}` : ''}
					</div>
					<Row label="式">
						<Sel<CalcOp>
							options={CALC_OPS}
							label={CALC_OP_LABEL}
							current={common(calcs, (n) => n.data.op)}
							onPick={(v) => applyData(caIds, { op: v })}
						/>
						<Sel<RoundMode>
							options={ROUND_MODES}
							label={ROUND_LABEL}
							current={common(calcs, (n) => n.data.round)}
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
											// 接続済みの口は定数が効かないので編集不可表示
											<span className="insp-src">
												← {srcName(nodes, src)}
											</span>
										) : (
											<NumField
												key={`${h}-${calcs[0].id}`}
												value={
													h === 'a'
														? calcs[0].data.constA
														: calcs[0].data.constB
												}
												onCommit={(v) =>
													applyData(
														caIds,
														h === 'a' ? { constA: v } : { constB: v }
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
							current={common(calcs, (n) => n.data.align ?? 'c')}
							onPick={(v) => applyData(caIds, { align: v })}
						/>
					</Row>
					<Row label="文字">
						<Btns
							options={SIZE_OPTS}
							current={common(calcs, (n) => n.data.size ?? 'm')}
							onPick={(v) => applyData(caIds, { size: v })}
						/>
					</Row>
					<TextColorRow nodes={calcs} ids={caIds} applyData={applyData} />
					<Row label="表示">
						<Toggle
							label="枠なし"
							on={common(calcs, (n) => !!n.data.plain) === true}
							onFlip={(v) => applyData(caIds, { plain: v })}
						/>
						<Toggle
							label="コンパクト"
							on={common(calcs, (n) => !!n.data.mini) === true}
							onFlip={(v) => applyData(caIds, { mini: v })}
						/>
					</Row>
					<FmtRow nodes={calcs} ids={caIds} applyData={applyData} />
				</section>
			)}
			{zones.length > 0 && (
				<section className="insp-sec">
					<div className="insp-title">
						集計ゾーン{zones.length > 1 ? ` ×${zones.length}` : ''}
					</div>
					<Row label="集計">
						<Sel<AggFn>
							options={AGG_FNS}
							label={AGG_LABEL}
							current={common(zones, (n) => n.data.fn)}
							onPick={(v) => applyData(zoIds, { fn: v })}
						/>
						<Sel<AggLabelPos>
							options={LABEL_POS_CYCLE}
							label={LABEL_POS_LABEL}
							current={common(zones, (n) => n.data.labelPos)}
							onPick={(v) => applyData(zoIds, { labelPos: v })}
						/>
					</Row>
					<Row label="文字">
						<Btns
							options={SIZE_OPTS}
							current={common(zones, (n) => n.data.size ?? 'm')}
							onPick={(v) => applyData(zoIds, { size: v })}
						/>
					</Row>
					<TextColorRow nodes={zones} ids={zoIds} applyData={applyData} />
					<Row label="表示">
						<Toggle
							label="枠なし"
							on={common(zones, (n) => !!n.data.plain) === true}
							onFlip={(v) => applyData(zoIds, { plain: v })}
						/>
						<Toggle
							label="コンパクト"
							on={common(zones, (n) => !!n.data.mini) === true}
							onFlip={(v) => applyData(zoIds, { mini: v })}
						/>
					</Row>
					<FmtRow nodes={zones} ids={zoIds} applyData={applyData} />
				</section>
			)}
		</div>
	)
}
