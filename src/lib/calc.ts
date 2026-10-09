import type { Edge } from '@xyflow/react'
import { aggregate, contains, type Bounds } from './aggregate'
import type { BoardNode, CalcOp, NumFmt, RoundMode } from '../nodes/types'

export const CALC_OPS: CalcOp[] = ['add', 'sub', 'mul', 'div']
export const CALC_OP_LABEL: Record<CalcOp, string> = {
	add: '＋',
	sub: '−',
	mul: '×',
	div: '÷',
}
export const ROUND_MODES: RoundMode[] = ['none', 'ceil', 'floor', 'round']
export const ROUND_LABEL: Record<RoundMode, string> = {
	none: 'なし',
	ceil: '切上',
	floor: '切捨',
	round: '四捨五入',
}

export function applyOp(op: CalcOp, a: number, b: number): number | null {
	switch (op) {
		case 'add':
			return a + b
		case 'sub':
			return a - b
		case 'mul':
			return a * b
		case 'div':
			return b === 0 ? null : a / b
	}
}

export function applyRound(mode: RoundMode, n: number): number {
	switch (mode) {
		case 'ceil':
			return Math.ceil(n)
		case 'floor':
			return Math.floor(n)
		case 'round':
			return Math.round(n)
		default:
			return n
	}
}

/** ノードの矩形（position + 実測/指定サイズ） */
export function nodeBounds(n: BoardNode): Bounds {
	return {
		minX: n.position.x,
		minY: n.position.y,
		maxX: n.position.x + (n.measured?.width ?? n.width ?? 0),
		maxY: n.position.y + (n.measured?.height ?? n.height ?? 0),
	}
}

/** ゾーン（または任意の矩形）に完全包含される値ピース（vobject / calc）を返す */
export function zoneMembers(bounds: Bounds, nodes: BoardNode[]): BoardNode[] {
	return nodes.filter((n) => {
		if (n.type !== 'vobject' && n.type !== 'calc') return false
		return contains(bounds, nodeBounds(n))
	})
}

/** いずれかのゾーンに「一部だけ」重なっているピースのID集合。
 *  交差面積が閾値超 かつ 完全包含でない vobject/calc（テキストも COUNT の母数なので対象） */
export function zonePartialIds(nodes: BoardNode[]): Set<string> {
	const zones = nodes.filter((n) => n.type === 'zone')
	const out = new Set<string>()
	if (!zones.length) return out
	for (const n of nodes) {
		if (n.type !== 'vobject' && n.type !== 'calc') continue
		const b = nodeBounds(n)
		for (const z of zones) {
			const zb = nodeBounds(z)
			if (contains(zb, b)) continue
			const iw = Math.min(zb.maxX, b.maxX) - Math.max(zb.minX, b.minX)
			const ih = Math.min(zb.maxY, b.maxY) - Math.max(zb.minY, b.minY)
			if (iw > 0 && ih > 0 && iw * ih > 4) {
				out.add(n.id)
				break
			}
		}
	}
	return out
}

/** calc 入力ハンドル（'a' / 'b'）に接続しているエッジのソースノードID */
export function operandSource(
	edges: Edge[],
	calcId: string,
	handle: 'a' | 'b'
): string | null {
	const e = edges.find(
		(e) => e.target === calcId && e.targetHandle === handle
	)
	return e?.source ?? null
}

/** ノードの表示書式を取得（line 等の非数値ノードは空） */
export function numFmtOf(n: BoardNode | undefined): NumFmt {
	if (!n || n.type === 'line') return {}
	return {
		digits: n.data.digits,
		comma: n.data.comma,
		hideZero: n.data.hideZero,
		numWeight: n.data.numWeight,
		neg: n.data.neg,
	}
}

/** 数値表示要素に付ける装飾クラス（細さ・負数赤） */
export function numCls(fmt: NumFmt, v: number | null): string {
	const w =
		fmt.numWeight === 'thin'
			? ' numw-thin'
			: fmt.numWeight === 'normal'
				? ' numw-normal'
				: ''
	const r =
		(fmt.neg === 'red' || fmt.neg === 'redminus') && (v ?? 0) < 0
			? ' num-neg'
			: ''
	return w + r
}

/** ノードの数値を解決。循環参照は visited で検出して null。 */
export function nodeValue(
	id: string,
	nodes: BoardNode[],
	edges: Edge[],
	visited = new Set<string>()
): number | null {
	if (visited.has(id)) return null
	const n = nodes.find((x) => x.id === id)
	if (!n) return null
	visited.add(id)
	if (n.type === 'vobject') return n.data.value
	if (n.type === 'zone') {
		const bounds = {
			minX: n.position.x,
			minY: n.position.y,
			maxX: n.position.x + (n.measured?.width ?? n.width ?? 0),
			maxY: n.position.y + (n.measured?.height ?? n.height ?? 0),
		}
		const members = zoneMembers(bounds, nodes).filter((m) => m.id !== id)
		if (n.data.fn === 'count') return members.length
		const values = members
			.map((m) => nodeValue(m.id, nodes, edges, new Set(visited)))
			.filter((v): v is number => v !== null)
		return aggregate(n.data.fn, values)
	}
	if (n.type !== 'calc') return null
	const aSrc = operandSource(edges, id, 'a')
	const bSrc = operandSource(edges, id, 'b')
	const a =
		aSrc !== null
			? nodeValue(aSrc, nodes, edges, new Set(visited))
			: n.data.constA
	const b =
		bSrc !== null
			? nodeValue(bSrc, nodes, edges, new Set(visited))
			: n.data.constB
	if (a === null || b === null) return null
	const raw = applyOp(n.data.op, a, b)
	return raw === null ? null : applyRound(n.data.round, raw)
}
