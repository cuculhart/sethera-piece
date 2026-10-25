import type { Edge, EdgeEndpoint, WorldObject } from '@kimetron/core'
import { CALC_PORTS, newId } from './lib/docio'
import type {
	CalcData,
	CurveData,
	LineData,
	VObjectData,
	VObjectKind,
	ZoneData,
} from './types'
import { GRID } from './colors'

// ── 配線ルール（値は out → calc の a/b に流れる） ────────────

export const WIRE_DEFAULTS = {
	route: 'bezier' as const,
	style: { color: '#a39e93', width: 1.5 },
	markerEnd: 'arrow' as const,
}

/** sethera の配線ルール: 値は out → calc 入力 a/b にのみ流れる */
export function canConnect(from: EdgeEndpoint, to: EdgeEndpoint): boolean {
	if (from.port !== 'out') return false
	return to.port === 'a' || to.port === 'b'
}

/** 方向はジェスチャでなくデータが決める — calc 入力から out へ引いても
 *  out→in のワイヤーが生成される */
export function connectOrient(
	a: EdgeEndpoint,
	b: EdgeEndpoint
): { from: EdgeEndpoint; to: EdgeEndpoint } | null {
	const isOut = (e: EdgeEndpoint) => e.port === 'out'
	const isIn = (e: EdgeEndpoint) => e.port === 'a' || e.port === 'b'
	return isOut(a) && isIn(b)
		? { from: a, to: b }
		: isIn(a) && isOut(b)
			? { from: b, to: a }
			: null
}

/** calc 入力は1本だけ — 占有済み入力への接続は既存ワイヤーを置き換える */
export function connectReplace(
	edges: Edge[],
	to: EdgeEndpoint
): string[] {
	if (to.port !== 'a' && to.port !== 'b') return []
	return edges
		.filter((e) => e.to.obj === to.obj && e.to.port === to.port)
		.map((e) => e.id)
}

/** 占有済み calc 入力を掴むと既存ワイヤーの自由端を拾う（rewire） */
export function rewirePickup(
	ep: EdgeEndpoint,
	edges: Edge[]
): string | null {
	if (ep.port !== 'a' && ep.port !== 'b') return null
	return (
		edges.find((e) => e.to.obj === ep.obj && e.to.port === ep.port)?.id ??
		null
	)
}

// ── オブジェクトファクトリ ──────────────────────────────────

const outPorts = () => [{ id: 'out', fx: 1, fy: 0.5 }]
const calcPorts = () => CALC_PORTS.map((p) => ({ ...p }))

export function makePiece(
	kind: VObjectKind,
	x: number,
	y: number
): WorldObject {
	const data: VObjectData = {
		kind,
		label: kind === 'number' ? '' : 'テキスト',
		value: kind === 'text' ? null : 0,
		color: 'yellow',
		// 数値は帳票の慣習で右揃えを既定にする
		align: kind === 'number' ? 'r' : 'c',
	}
	return {
		id: newId(),
		kind: 'piece',
		x,
		y,
		// 初期サイズは1行分（複数行はユーザーがリサイズして広げる）
		w: kind === 'pair' ? 144 : 120,
		h: kind === 'pair' ? 60 : 36,
		layer: 1,
		ports: outPorts(),
		data,
	}
}

export function makeCalc(x: number, y: number): WorldObject {
	const data: CalcData = {
		op: 'mul',
		round: 'none',
		constA: null,
		constB: null,
		align: 'r',
	}
	return {
		id: newId(),
		kind: 'calc',
		x,
		y,
		w: 64,
		h: 40,
		layer: 1,
		ports: calcPorts(),
		data,
	}
}

export function makeStroke(
	x: number,
	y: number,
	w: number,
	h: number,
	data: LineData
): WorldObject {
	return { id: newId(), kind: 'stroke', x, y, w, h, layer: 0, data }
}

export function makeZone(x: number, y: number, w: number, h: number): WorldObject {
	const data: ZoneData = { fn: 'sum', labelPos: 'bottom' }
	return {
		id: newId(),
		kind: 'zone',
		x,
		y,
		w,
		h,
		layer: 0,
		ports: outPorts(),
		data,
	}
}

/** 曲線: 正規化頂点 + PAD 込みの外接箱（react-flow 版 normalizeCurvePts 相当） */
export function makeSpline(pts: { x: number; y: number }[]): WorldObject {
	const PAD = 8
	const minX = Math.min(...pts.map((p) => p.x))
	const minY = Math.min(...pts.map((p) => p.y))
	const maxX = Math.max(...pts.map((p) => p.x))
	const maxY = Math.max(...pts.map((p) => p.y))
	const w = Math.max(GRID, Math.round(maxX - minX + PAD * 2))
	const h = Math.max(GRID, Math.round(maxY - minY + PAD * 2))
	const data: CurveData = {
		w: 'thin',
		pts: pts.map((p) => ({
			fx: (p.x - minX + PAD) / w,
			fy: (p.y - minY + PAD) / h,
		})),
	}
	return {
		id: newId(),
		kind: 'spline',
		x: minX - PAD,
		y: minY - PAD,
		w,
		h,
		layer: 0,
		data,
	}
}
