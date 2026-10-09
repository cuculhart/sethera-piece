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
} & NumFmt

export type ZoneData = {
	fn: AggFn
	labelPos: AggLabelPos
	plain?: boolean
	mini?: boolean
	chipPos?: { x: number; y: number }
	size?: 's' | 'm' | 'l' | 'xl'
	textColor?: string
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
} & NumFmt

export type LineWeight = 'thin' | 'bold' | 'xbold' | 'dash'
export type LineData = {
	w: LineWeight
	front?: boolean
	rect?: boolean
	/** 矩形の塗りつぶし色（PIECE_COLORS のキー名）。省略=塗りなし */
	fill?: string
}

export type VObjectNodeType = Node<VObjectData, 'vobject'>
export type ZoneNodeType = Node<ZoneData, 'zone'>
export type CalcNodeType = Node<CalcData, 'calc'>
export type LineNodeType = Node<LineData, 'line'>
export type BoardNode = VObjectNodeType | ZoneNodeType | CalcNodeType | LineNodeType
