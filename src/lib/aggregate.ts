export type AggFn = 'sum' | 'avg' | 'count' | 'max' | 'min'

export const AGG_FNS: AggFn[] = ['sum', 'avg', 'count', 'max', 'min']

export function aggregate(fn: AggFn, values: number[]): number | null {
	if (values.length === 0) return null
	switch (fn) {
		case 'sum':
			return values.reduce((a, b) => a + b, 0)
		case 'avg':
			return values.reduce((a, b) => a + b, 0) / values.length
		case 'count':
			return values.length
		case 'max':
			return Math.max(...values)
		case 'min':
			return Math.min(...values)
	}
}

/** digits 省略=自動（小数3桁まで・末尾0なし）。comma=true で3桁区切り。
 *  neg: 'tri'→▲絶対値、'paren'→(絶対値)、'red'→符号なし絶対値を赤字、
 *  'redminus'→符号つきを赤字（赤字は表示側で .num-neg クラスを付けて色付け） */
export function formatNumber(
	n: number,
	digits?: number,
	comma?: boolean,
	neg?: 'minus' | 'paren' | 'tri' | 'red' | 'redminus'
): string {
	const styled = (neg === 'tri' || neg === 'paren' || neg === 'red') && n < 0
	const v = styled ? Math.abs(n) : n
	const s =
		digits === undefined && comma !== true
			? Number.isInteger(v)
				? String(v)
				: String(Math.round(v * 1000) / 1000)
			: v.toLocaleString('en-US', {
					useGrouping: comma === true,
					minimumFractionDigits: digits ?? 0,
					maximumFractionDigits: digits ?? 3,
				})
	if (!styled) return s
	if (neg === 'tri') return `▲${s}`
	if (neg === 'paren') return `(${s})`
	return s
}

export interface Bounds {
	minX: number
	minY: number
	maxX: number
	maxY: number
}

/** 完全包含のみ true。部分的な重なり（ハミ出し）は対象外。
 *  tol は許容誤差（外側が tol だけ拡張される） */
export function contains(outer: Bounds, inner: Bounds, tol = 0): boolean {
	return (
		inner.minX >= outer.minX - tol &&
		inner.minY >= outer.minY - tol &&
		inner.maxX <= outer.maxX + tol &&
		inner.maxY <= outer.maxY + tol
	)
}
