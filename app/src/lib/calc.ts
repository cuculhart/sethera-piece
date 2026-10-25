import type { Edge, WorldObject } from '@kimetron/core'
import { aggregate, contains, formatNumber, type Bounds } from './aggregate'
import type {
	CalcData,
	CalcOp,
	NumFmt,
	RoundMode,
	VObjectData,
	ZoneData,
} from '../types'

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

export const dataOf = <T>(o: WorldObject): T => o.data as T

/** オブジェクトの矩形（x/y + w/h） */
export function objectBounds(o: WorldObject): Bounds {
	return {
		minX: o.x,
		minY: o.y,
		maxX: o.x + o.w,
		maxY: o.y + o.h,
	}
}

/** ゾーン条件への適合（filter 省略=全一致。条件ありは piece のみ対象。
 *  calc は色を持たないため SumIf 的に対象外） */
export function memberMatch(
	o: WorldObject,
	f?: { color?: string }
): boolean {
	if (!f?.color) return true
	if (o.kind !== 'piece') return false
	return (dataOf<VObjectData>(o).color ?? 'yellow') === f.color
}

/** ゾーン（または任意の矩形）に完全包含される値ピース（piece / calc）を返す */
export function zoneMembers(
	bounds: Bounds,
	objects: WorldObject[]
): WorldObject[] {
	return objects.filter((o) => {
		if (o.kind !== 'piece' && o.kind !== 'calc') return false
		return contains(bounds, objectBounds(o))
	})
}

/** いずれかのゾーンに「一部だけ」重なっているピースのID集合。
 *  交差面積が閾値超 かつ 完全包含でない piece/calc（テキストも COUNT の母数なので対象） */
export function zonePartialIds(objects: WorldObject[]): Set<string> {
	const zones = objects.filter((o) => o.kind === 'zone')
	const out = new Set<string>()
	if (!zones.length) return out
	for (const o of objects) {
		if (o.kind !== 'piece' && o.kind !== 'calc') continue
		const b = objectBounds(o)
		for (const z of zones) {
			const zb = objectBounds(z)
			if (contains(zb, b)) continue
			const iw = Math.min(zb.maxX, b.maxX) - Math.max(zb.minX, b.minX)
			const ih = Math.min(zb.maxY, b.maxY) - Math.max(zb.minY, b.minY)
			if (iw > 0 && ih > 0 && iw * ih > 4) {
				out.add(o.id)
				break
			}
		}
	}
	return out
}

/** calc 入力ポート（'a' / 'b'）に接続しているエッジのソースオブジェクトID */
export function operandSource(
	edges: Edge[],
	calcId: string,
	port: 'a' | 'b'
): string | null {
	const e = edges.find(
		(e) => e.to.obj === calcId && e.to.port === port
	)
	return e?.from.obj ?? null
}

/** オブジェクトの表示書式を取得（line/curve 等の非数値オブジェクトは空） */
export function numFmtOf(o: WorldObject | undefined): NumFmt {
	if (!o || o.kind === 'line' || o.kind === 'curve') return {}
	const d = o.data as NumFmt
	return {
		digits: d.digits,
		comma: d.comma,
		hideZero: d.hideZero,
		numWeight: d.numWeight,
		neg: d.neg,
		dispRound: d.dispRound,
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

/** オブジェクトの数値を解決。循環参照は visited で検出して null。 */
export function objectValue(
	id: string,
	objects: WorldObject[],
	edges: Edge[],
	visited = new Set<string>()
): number | null {
	if (visited.has(id)) return null
	const o = objects.find((x) => x.id === id)
	if (!o) return null
	visited.add(id)
	if (o.kind === 'piece') return dataOf<VObjectData>(o).value
	if (o.kind === 'zone') {
		const d = dataOf<ZoneData>(o)
		const bounds = objectBounds(o)
		const members = zoneMembers(bounds, objects).filter(
			(m) => m.id !== id && memberMatch(m, d.filter)
		)
		if (d.fn === 'count') return members.length
		const values = members
			.map((m) =>
				objectValue(m.id, objects, edges, new Set(visited))
			)
			.filter((v): v is number => v !== null)
		return aggregate(d.fn, values)
	}
	if (o.kind !== 'calc') return null
	const d = dataOf<CalcData>(o)
	const aSrc = operandSource(edges, id, 'a')
	const bSrc = operandSource(edges, id, 'b')
	const a =
		aSrc !== null
			? objectValue(aSrc, objects, edges, new Set(visited))
			: d.constA
	const b =
		bSrc !== null
			? objectValue(bSrc, objects, edges, new Set(visited))
			: d.constB
	if (a === null || b === null) return null
	const raw = applyOp(d.op, a, b)
	return raw === null ? null : applyRound(d.round, raw)
}

/** 値を表示用に整形。保持値は実数のまま、pct で×100、dispRound を digits 桁に適用。 */
export function formatDisplay(
	v: number,
	d: NumFmt & { pct?: boolean }
): string {
	const x = d.pct ? v * 100 : v
	let y = x
	if (d.digits !== undefined && d.dispRound && d.dispRound !== 'none') {
		const m = 10 ** d.digits
		y =
			d.dispRound === 'ceil'
				? Math.ceil(x * m) / m
				: d.dispRound === 'floor'
					? Math.floor(x * m) / m
					: Math.round(x * m) / m
	}
	const s = formatNumber(y, d.digits, d.comma, d.neg)
	return d.pct ? `${s}%` : s
}
