// 旧 sethera（react-flow）形式 SNode/SEdge と kimetron Doc の相互変換・永続化。
// localStorage / JSON ファイル / テンプレートはすべて旧形式を維持し、
// ここで kimetron 内部表現（piece/zone/calc/stroke/spline）に落とす。

import type { Doc, Edge, EdgeEndpoint, WorldObject } from '@kimetron/core'
import type {
	CurveData,
	SEdge,
	SNode,
	SNodeType,
	ZoneData,
} from '../types'
import type { PaperCfg } from './paper'
import { DEFAULT_PAPER, paperDims } from './paper'

export const DOC_KEY = 'sethera-doc'
export const VP_KEY = 'sethera-viewport'

export const newId = () => crypto.randomUUID()

// 内部 kind ↔ 旧ノード型
export const KIND_TO_TYPE: Record<string, SNodeType> = {
	piece: 'vobject',
	zone: 'zone',
	calc: 'calc',
	stroke: 'line',
	spline: 'curve',
}
export const TYPE_TO_KIND: Record<SNodeType, string> = {
	vobject: 'piece',
	zone: 'zone',
	calc: 'calc',
	line: 'stroke',
	curve: 'spline',
}

export const OUT_PORT = { id: 'out', fx: 1, fy: 0.5 }
export const CALC_PORTS = [
	{ id: 'a', fx: 0, fy: 0.3 },
	{ id: 'b', fx: 0, fy: 0.72 },
	OUT_PORT,
]

export function portsOf(kind: string) {
	if (kind === 'piece' || kind === 'zone') return [OUT_PORT]
	if (kind === 'calc') return CALC_PORTS
	return undefined
}

// デフォルトの zIndex → layer（RF 版の zIndex 規則）
export const defaultLayer = (kind: string) =>
	kind === 'piece' || kind === 'calc' ? 1 : 0

// ── SNode → WorldObject ─────────────────────────────────────

export function nodeToObject(n: SNode): WorldObject {
	const kind = TYPE_TO_KIND[n.type] ?? n.type
	const data = { ...n.data } as Record<string, unknown>
	const w = n.width ?? 60
	const h = n.height ?? 24
	if (n.type === 'curve') {
		// px 頂点 → 正規化頂点
		const pts = (data.pts as { x: number; y: number }[] | undefined) ?? []
		data.pts = pts.map((p) => ({
			fx: w > 0 ? p.x / w : 0,
			fy: h > 0 ? p.y / h : 0,
		}))
	}
	return {
		id: n.id,
		kind,
		x: n.position.x,
		y: n.position.y,
		w,
		h,
		layer: n.zIndex ?? defaultLayer(kind),
		group: (data as { groupId?: string }).groupId,
		locked: !!(data as { locked?: boolean }).locked,
		ports: portsOf(kind),
		data,
	}
}

// ── WorldObject → SNode（保存・テンプレ・CSV 判定用） ────────

export function objectToNode(o: WorldObject): SNode {
	const type = KIND_TO_TYPE[o.kind] ?? (o.kind as SNodeType)
	const data = { ...(o.data as Record<string, unknown>) }
	if (o.kind === 'spline') {
		const pts = (data.pts as { fx: number; fy: number }[] | undefined) ?? []
		data.pts = pts.map((p) => ({ x: p.fx * o.w, y: p.fy * o.h }))
	}
	// ネイティブの locked/group を data 側へ同期（旧形式互換）
	data.locked = o.locked
	data.groupId = o.group
	return {
		id: o.id,
		type,
		position: { x: o.x, y: o.y },
		width: o.w,
		height: o.h,
		zIndex: o.layer,
		data: data as SNode['data'],
	}
}

// ── Edge ↔ SEdge ────────────────────────────────────────────

const WIRE_STYLE = { color: '#a39e93', width: 1.5 } as const

export function sedgeToEdge(e: SEdge): Edge {
	return {
		id: e.id,
		from: { obj: e.source, port: e.sourceHandle ?? undefined },
		to: { obj: e.target, port: e.targetHandle ?? undefined },
		route: 'bezier',
		markerEnd: 'arrow',
		style: { ...WIRE_STYLE },
	}
}

export function edgeToSEdge(e: Edge): SEdge {
	return {
		id: e.id,
		source: e.from.obj,
		target: e.to.obj,
		sourceHandle: e.from.port ?? null,
		targetHandle: e.to.port ?? null,
	}
}

// ── Doc の生成・保存・読込 ───────────────────────────────────

export function emptyDoc(): Doc {
	return {
		schemaVersion: 1,
		units: 'px',
		origin: 'top-left',
		grid: { size: 12, snap: false, major: 8 },
		objects: [],
		edges: [],
	}
}

/** 用紙設定 → doc.page（on=false なら undefined） */
export function pageOf(paper: PaperCfg): Doc['page'] {
	if (!paper.on) return undefined
	const { w, h } = paperDims(paper)
	return { x: paper.x, y: paper.y, w, h }
}

/** 旧形式ストア → { doc, paper } */
export function storedToDoc(parsed: {
	nodes?: unknown
	edges?: unknown
	paper?: unknown
}): { doc: Doc; paper: PaperCfg } {
	const nodes = Array.isArray(parsed.nodes) ? (parsed.nodes as SNode[]) : []
	const edges = Array.isArray(parsed.edges) ? (parsed.edges as SEdge[]) : []
	const paper: PaperCfg =
		parsed.paper && typeof parsed.paper === 'object'
			? { ...DEFAULT_PAPER, ...(parsed.paper as Partial<PaperCfg>) }
			: DEFAULT_PAPER
	const doc = emptyDoc()
	doc.objects = nodes.map(nodeToObject)
	doc.edges = edges.map(sedgeToEdge)
	doc.page = pageOf(paper)
	return { doc, paper }
}

/** { doc, paper } → 旧形式ストア */
export function docToStored(doc: Doc, paper: PaperCfg) {
	return {
		nodes: doc.objects.map(objectToNode),
		edges: doc.edges.map(edgeToSEdge),
		paper,
	}
}

export function loadStoredDoc(): { doc: Doc; paper: PaperCfg } {
	try {
		const raw = localStorage.getItem(DOC_KEY)
		if (!raw) return { doc: emptyDoc(), paper: DEFAULT_PAPER }
		return storedToDoc(JSON.parse(raw))
	} catch {
		return { doc: emptyDoc(), paper: DEFAULT_PAPER }
	}
}

export function loadViewport(): { x: number; y: number; zoom: number } | null {
	try {
		const raw = localStorage.getItem(VP_KEY)
		if (!raw) return null
		const parsed = JSON.parse(raw)
		return typeof parsed?.zoom === 'number' ? parsed : null
	} catch {
		return null
	}
}

// ── 盤面操作ヘルパー（App/Inspector 共用） ───────────────────

const gidOf = (o: WorldObject) =>
	o.group ?? (o.data as { groupId?: string } | undefined)?.groupId
export const groupIdOf = gidOf
export const lockedOf = (o: WorldObject) =>
	o.locked ??
	!!(o.data as { locked?: boolean } | undefined)?.locked

/** 選択オブジェクトの groupId を持つ全メンバーへ拡張する */
export function expandGroups(
	objects: WorldObject[],
	sel: WorldObject[]
): WorldObject[] {
	const gids = new Set(sel.map(gidOf).filter((g): g is string => !!g))
	if (!gids.size) return sel
	const ids = new Set(sel.map((o) => o.id))
	return objects.filter((o) => ids.has(o.id) || (gidOf(o) && gids.has(gidOf(o)!)))
}

/** 両端が選択集合内にあるエッジ */
export function innerEdges(edges: Edge[], sel: WorldObject[]): Edge[] {
	const ids = new Set(sel.map((o) => o.id))
	return edges.filter((e) => ids.has(e.from.obj) && ids.has(e.to.obj))
}

const cloneData = (o: WorldObject): WorldObject => ({
	...o,
	shape: o.shape
		? { ...o.shape, points: o.shape.points?.map((p) => ({ ...p })) }
		: undefined,
	data: JSON.parse(JSON.stringify(o.data ?? null)),
})

/** オブジェクト・エッジの複製（id/groupId リマップ + オフセット）。
 *  戻り値はドキュメントに「追加する」オブジェクト・エッジ。 */
export function duplicateParts(
	srcObjects: WorldObject[],
	srcEdges: Edge[],
	off: { x: number; y: number } = { x: 32, y: 32 }
): { objects: WorldObject[]; edges: Edge[] } {
	if (srcObjects.length === 0) return { objects: [], edges: [] }
	const idMap = new Map(srcObjects.map((o) => [o.id, newId()]))
	const gMap = new Map<string, string>()
	const objects = srcObjects.map((o) => {
		const c = cloneData(o)
		const g = gidOf(c)
		if (g) {
			if (!gMap.has(g)) gMap.set(g, newId())
			c.group = gMap.get(g)
			;(c.data as Record<string, unknown>).groupId = gMap.get(g)
		}
		return {
			...c,
			id: idMap.get(o.id)!,
			x: o.x + off.x,
			y: o.y + off.y,
		}
	})
	const edges = srcEdges
		.filter((e) => idMap.has(e.from.obj) && idMap.has(e.to.obj))
		.map((e) => ({
			...e,
			id: newId(),
			from: { ...e.from, obj: idMap.get(e.from.obj)! },
			to: { ...e.to, obj: idMap.get(e.to.obj)! },
		}))
	return { objects, edges }
}

/** data マージ＋派生フィールド同期。
 *  o.locked/o.group が正。patch が明示的に locked/groupId を含む場合のみ
 *  data 側からネイティブへ反映する（他フィールド更新でロックが消えないよう） */
export function patchObject(o: WorldObject, patch: Record<string, unknown>): WorldObject {
	const data = { ...(o.data as Record<string, unknown>), ...patch }
	const locked = 'locked' in patch ? !!patch.locked : o.locked
	const group =
		'groupId' in patch ? (patch.groupId as string | undefined) : o.group
	data.locked = locked
	data.groupId = group
	return { ...o, data, locked, group }
}

/** 選択集合を ids に含まないものだけ残すユーティリティ（edge retarget 用） */
export const epEq = (a: EdgeEndpoint, b: EdgeEndpoint) =>
	a.obj === b.obj && a.port === b.port
