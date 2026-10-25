// sethera-v2 の盤面データ型。react-flow 版 (sethera/src/nodes/types.ts) から
// RF 依存を除き、kimetron WorldObject.data に載せる形に移植。
// JSON 永続化との互換のため、フィールド名・型は元のまま保持する。

export type VObjectKind = 'text' | 'number' | 'pair'
export type AggLabelPos = 'br' | 'top' | 'right' | 'bottom' | 'left' | 'free'
export type CalcOp = 'add' | 'sub' | 'mul' | 'div'
export type RoundMode = 'none' | 'ceil' | 'floor' | 'round'
export type LineWeight =
	| 'thin'
	| 'bold'
	| 'xbold'
	| 'dash'
	| 'dot'
	| 'chain'
	| 'double'
export type LineCap = 'none' | 'arrow' | 'dot'
export type Align = 'l' | 'c' | 'r'
export type TextSize = 's' | 'm' | 'l' | 'xl'
export type NegMode = 'minus' | 'paren' | 'tri' | 'red' | 'redminus'
export type AlignKind = 'h' | 'v' | 'square'

/** 数値表示の書式。digits 省略=自動、comma=3桁区切り、hideZero=値0のとき非表示。
 *  numWeight=数値の太さ（省略=太）、neg=負数表記（省略=minus、tri=▲、red=赤字） */
export interface NumFmt {
	digits?: number
	comma?: boolean
	hideZero?: boolean
	numWeight?: 'thin' | 'normal' | 'bold'
	/** minus=-、paren=()、tri=▲、red=赤字、redminus=赤字-  */
	neg?: NegMode
	/** 表示用の丸めモード（digits 桁位置に適用。'none'/未指定は標準丸め） */
	dispRound?: RoundMode
}

export interface VObjectData extends NumFmt {
	kind: VObjectKind
	label: string
	value: number | null
	color: string
	align?: Align
	size?: TextSize
	bold?: boolean
	textColor?: string
	groupId?: string
	locked?: boolean
	font?: string
}

export interface ZoneFilter {
	color: string
}

export interface ZoneData extends NumFmt {
	fn: 'sum' | 'avg' | 'count' | 'max' | 'min'
	labelPos: AggLabelPos
	mini?: boolean
	plain?: boolean
	size?: TextSize
	textColor?: string
	filter?: ZoneFilter
	chipPos?: { x: number; y: number }
}

export interface CalcData extends NumFmt {
	op: CalcOp
	round: RoundMode
	/** 結果を％表示 */
	pct?: boolean
	constA: number | null
	constB: number | null
	plain?: boolean
	mini?: boolean
	align?: Align
	size?: TextSize
	textColor?: string
	groupId?: string
	locked?: boolean
}

export interface LineData {
	w: LineWeight
	front?: boolean
	rect?: boolean
	ellipse?: boolean
	arc?: boolean
	arcStart?: number
	arcEnd?: number
	arcCcw?: boolean
	diag?: 'up' | 'down'
	fill?: string
	color?: string
	capStart?: LineCap
	capEnd?: LineCap
	groupId?: string
	locked?: boolean
}

export interface CurveData {
	/** 正規化頂点（bbox の 0..1 内座標）。リサイズに追従させるため
	 *  react-flow 版の px 頂点から変換する。 */
	pts: { fx: number; fy: number }[]
	w?: Exclude<LineWeight, 'double'>
	capStart?: LineCap
	capEnd?: LineCap
	color?: string
	front?: boolean
	groupId?: string
	locked?: boolean
}

export type AnyData =
	| VObjectData
	| ZoneData
	| CalcData
	| LineData
	| CurveData

// ── 旧 react-flow 形式（JSON 永続化・テンプレート互換用） ──
// sethera-piece が保存した JSON の shape をここに定義し、
// lib/docio.ts で kimetron objects/edges と相互変換する。

export type SNodeType = 'vobject' | 'zone' | 'calc' | 'line' | 'curve'

export interface SNode {
	id: string
	type: SNodeType
	position: { x: number; y: number }
	width?: number
	height?: number
	zIndex?: number
	dragHandle?: string
	data:
		| VObjectData
		| ZoneData
		| CalcData
		| (Omit<LineData, never> & Record<string, unknown>)
		| (Omit<CurveData, 'pts'> & { pts: { x: number; y: number }[] })
}

export interface SEdge {
	id: string
	source: string
	target: string
	sourceHandle?: string | null
	targetHandle?: string | null
	markerEnd?: unknown
}
