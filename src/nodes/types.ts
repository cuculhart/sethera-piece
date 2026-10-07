import type { Node } from '@xyflow/react'
import type { AggFn } from '../lib/aggregate'

export type VObjectKind = 'text' | 'number' | 'pair'
export type AggLabelPos = 'br' | 'top' | 'right' | 'bottom' | 'left' | 'free'
export type CalcOp = 'add' | 'sub' | 'mul' | 'div'
export type RoundMode = 'none' | 'ceil' | 'floor' | 'round'

export type VObjectData = {
	kind: VObjectKind
	label: string
	value: number | null
	color: string
	align?: 'l' | 'c' | 'r'
	size?: 's' | 'm' | 'l' | 'xl'
	bold?: boolean
}

export type ZoneData = {
	fn: AggFn
	labelPos: AggLabelPos
	plain?: boolean
	mini?: boolean
	chipPos?: { x: number; y: number }
	size?: 's' | 'm' | 'l' | 'xl'
}

export type CalcData = {
	op: CalcOp
	round: RoundMode
	constA: number | null
	constB: number | null
	mini?: boolean
	align?: 'l' | 'c' | 'r'
	plain?: boolean
}

export type LineWeight = 'thin' | 'bold' | 'xbold' | 'dash'
export type LineData = {
	w: LineWeight
	front?: boolean
}

export type VObjectNodeType = Node<VObjectData, 'vobject'>
export type ZoneNodeType = Node<ZoneData, 'zone'>
export type CalcNodeType = Node<CalcData, 'calc'>
export type LineNodeType = Node<LineData, 'line'>
export type BoardNode = VObjectNodeType | ZoneNodeType | CalcNodeType | LineNodeType
