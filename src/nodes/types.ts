import type { Node } from '@xyflow/react'
import type { AggFn } from '../lib/aggregate'

export type VObjectKind = 'text' | 'number' | 'pair'
export type AggLabelPos = 'br' | 'top' | 'right' | 'bottom' | 'left' | 'free'
export type CalcOp = 'add' | 'sub' | 'mul' | 'div'
export type RoundMode = 'none' | 'ceil' | 'floor' | 'round'

/** 数値表示の書式。digits 省略=自動、comma=3桁区切り、hideZero=値0のとき非表示。
 *  numWeight=数値の太さ（省略=太）、neg=負数表記（省略=minus、tri=▲、red=赤字） */
export type NumFmt = {
	digits?: number
	comma?: boolean
	hideZero?: boolean
	numWeight?: 'thin' | 'normal' | 'bold'
	/** minus=-、paren=()、tri=▲、red=赤字、redminus=赤字-  */
	neg?: 'minus' | 'paren' | 'tri' | 'red' | 'redminus'
}

export type VObjectData = {
	kind: VObjectKind
	label: string
	value: number | null
	color: string
	align?: 'l' | 'c' | 'r'
	size?: 's' | 'm' | 'l' | 'xl'
	bold?: boolean
	/** 文字色。省略=テーマ既定の text 色 */
	textColor?: string
	/** グループID（カスタムピース）。同じIDのノードは一括で動く */
	groupId?: string
	/** ロック。ドラッグ・リサイズ・削除・属性編集を抑止 */
	locked?: boolean
	/** フォント（FONTS キー名 or カスタム書体名）。省略=文書既定 */
	font?: string
} & NumFmt

export type ZoneData = {
	fn: AggFn
	labelPos: AggLabelPos
	plain?: boolean
	mini?: boolean
	chipPos?: { x: number; y: number }
	size?: 's' | 'm' | 'l' | 'xl'
	textColor?: string
	/** 条件付き集計。省略=全メンバー対象（従来どおり） */
	filter?: {
		/** ピース色（PIECE_COLORS のキー名。'none' は条件に使えない） */
		color?: string
	}
} & NumFmt

export type CalcData = {
	op: CalcOp
	round: RoundMode
	constA: number | null
	constB: number | null
	mini?: boolean
	align?: 'l' | 'c' | 'r'
	plain?: boolean
	size?: 's' | 'm' | 'l' | 'xl'
	textColor?: string
	/** グループID（カスタムピース）。同じIDのノードは一括で動く */
	groupId?: string
	/** ロック。ドラッグ・リサイズ・削除・属性編集を抑止 */
	locked?: boolean
} & NumFmt

export type LineWeight =
	| 'thin'
	| 'bold'
	| 'xbold'
	| 'dash'
	| 'dot'
	| 'chain'
	| 'double'
/** 線の端点装飾。none=なし、arrow=矢印、dot=丸 */
export type LineCap = 'none' | 'arrow' | 'dot'
export type LineData = {
	w: LineWeight
	front?: boolean
	rect?: boolean
	/** 楕円（rect と同じ外接ボックス意味論の図形バリアント） */
	ellipse?: boolean
	/** 円弧（外接楕円の一部。角度は度、0=3時方向） */
	arc?: boolean
	/** 斜線（'down'=左上→右下 ╲、'up'=左下→右上 ╱）。
	 *  通常線のバリアントで端点装飾・線種・二重が使える */
	diag?: 'down' | 'up'
	arcStart?: number
	arcEnd?: number
	/** 角度の正方向。true=反時計回り（CAD/数学式、規定）・false=時計回り（SVG式） */
	arcCcw?: boolean
	/** 矩形の塗りつぶし色（PIECE_COLORS のキー名）。省略=塗りなし */
	fill?: string
	/** 始端・終端の端点装飾（通常線のみ。省略=なし） */
	capStart?: LineCap
	capEnd?: LineCap
	/** 線色（LINE_COLORS のキー名）。省略=既定の #333 */
	color?: string
	/** グループID（カスタムピース）。同じIDのノードは一括で動く */
	groupId?: string
	/** ロック。ドラッグ・リサイズ・削除・属性編集を抑止 */
	locked?: boolean
}

export type VObjectNodeType = Node<VObjectData, 'vobject'>
export type ZoneNodeType = Node<ZoneData, 'zone'>
export type CalcNodeType = Node<CalcData, 'calc'>
export type LineNodeType = Node<LineData, 'line'>

// 曲線（Catmull-Rom スプライン。pts はノード座標系、PAD 分オフセット）
export type CurveData = {
	pts: { x: number; y: number }[]
	w?: Exclude<LineWeight, 'double'>
	capStart?: LineCap
	capEnd?: LineCap
	/** 線色（LINE_COLORS のキー名）。省略=既定の #333 */
	color?: string
	front?: boolean
	groupId?: string
	locked?: boolean
}
export type CurveNodeType = Node<CurveData, 'curve'>
export type BoardNode =
	| VObjectNodeType
	| ZoneNodeType
	| CalcNodeType
	| LineNodeType
	| CurveNodeType
