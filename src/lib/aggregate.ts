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

/** digits 省略=自動（小数3桁まで・末尾0なし）。comma=true で3桁区切り */
export function formatNumber(n: number, digits?: number, comma?: boolean): string {
	if (digits === undefined && comma !== true) {
		return Number.isInteger(n) ? String(n) : String(Math.round(n * 1000) / 1000)
	}
	return n.toLocaleString('en-US', {
		useGrouping: comma === true,
		minimumFractionDigits: digits ?? 0,
		maximumFractionDigits: digits ?? 3,
	})
}

export interface Bounds {
	minX: number
	minY: number
	maxX: number
	maxY: number
}

/** 完全包含のみ true。部分的な重なり（ハミ出し）は対象外。 */
export function contains(outer: Bounds, inner: Bounds): boolean {
	return (
		inner.minX >= outer.minX &&
		inner.minY >= outer.minY &&
		inner.maxX <= outer.maxX &&
		inner.maxY <= outer.maxY
	)
}
