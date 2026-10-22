import {
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
	type ChangeEvent,
	type MouseEvent,
} from 'react'
import {
	addEdge,
	applyEdgeChanges,
	applyNodeChanges,
	Background,
	BackgroundVariant,
	getNodesBounds,
	getViewportForBounds,
	MarkerType,
	ReactFlow,
	ReactFlowProvider,
	SelectionMode,
	useReactFlow,
	type Connection,
	type Edge,
	type EdgeChange,
	type NodeChange,
	type NodeDimensionChange,
	type NodePositionChange,
	type Viewport,
} from '@xyflow/react'
import { flushSync } from 'react-dom'
import { toPng } from 'html-to-image'
import '@xyflow/react/dist/style.css'
import {
	DEFAULT_PAPER,
	PaperFrame,
	paperDims,
	type PaperCfg,
} from './paper-frame'
import { AggZoneNode } from './nodes/agg-zone-node'
import { CalcNode } from './nodes/calc-node'
import { LineNode, STROKES as LINE_STROKES } from './nodes/line-node'
import { CurveNode, normalizeCurvePts } from './nodes/curve-node'
import { VObjectNode } from './nodes/vobject-node'
import { zonePartialIds } from './lib/calc'
import {
	CSV_LIMITS,
	gridCsv,
	parseNumCell,
	toDelimited,
	type ColType,
	type ParsedTable,
} from './lib/csv'
import { loadTemplates, saveTemplates, type Template } from './lib/templates'
import { missingFonts } from './lib/fonts'
import { FontSelect } from './font-select'
import {
	getLang,
	resolvedLang,
	setLang,
	useT,
	type Lang,
} from './i18n'
import { CsvPane } from './csv-pane'
import { Inspector } from './inspector'
import { HintContext } from './hint-context'
import type {
	BoardNode,
	LineWeight,
	VObjectKind,
	VObjectNodeType,
} from './nodes/types'

type Snapshot = { nodes: BoardNode[]; edges: Edge[]; paper: PaperCfg }

const gidOf = (n: BoardNode) => (n.data as { groupId?: string }).groupId
const lockedOf = (n: BoardNode) =>
	!!(n.data as { locked?: boolean }).locked
// 集計ゾーンは常に selectable:false（ボックス選択から除外するため）。
// 古い文書やテンプレ経由で来たゾーンにも適用する正規化
const fixZoneSelectable = (n: BoardNode): BoardNode =>
	n.type === 'zone' && n.selectable !== false
		? ({ ...n, selectable: false } as BoardNode)
		: n

const GRID = 12
const HIST_MAX = 100
const APP_VERSION = '1.0.2'
const DOC_KEY = 'sethera-doc'
const VP_KEY = 'sethera-viewport'
const TB_COLOR_KEY = 'sethera-toolbar-color'
const QUIET_KEY = 'sethera-quiet'
const THEME_KEY = 'sethera-theme'
type Theme = 'standard' | 'quiet' | 'dark'

const nodeTypes = {
	vobject: VObjectNode,
	zone: AggZoneNode,
	calc: CalcNode,
	line: LineNode,
	curve: CurveNode,
}

// 連動リサイズの対象型と最小サイズ（zone は対象外）
const RESIZE_MIN: Record<string, { w: number; h: number }> = {
	vobject: { w: 36, h: 24 },
	calc: { w: 64, h: 32 },
	line: { w: 12, h: 12 },
	curve: { w: 24, h: 24 },
}

/** hex色（#rgb/#rrggbb）が暗めかどうか（輝度で判定） */
function isDarkColor(hex: string): boolean {
	const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim())
	if (!m) return false
	const h =
		m[1].length === 3
			? m[1].split('').map((c) => c + c).join('')
			: m[1]
	const r = parseInt(h.slice(0, 2), 16)
	const g = parseInt(h.slice(2, 4), 16)
	const b = parseInt(h.slice(4, 6), 16)
	return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255 < 0.5
}

/** 複数選択中の連動リサイズ。ドラッグ主の「動いた辺」の移動量を、
 *  他の選択中の対象ノードの同じ辺にも適用する変更を追加して返す。
 *  左辺: x+=dx & w-=dx（右端固定）/ 右辺: w+=dw / 上辺・下辺も同様。
 *  zone は RESIZE_MIN にないので巻き込まない */
function withResizeFollowers(
	changes: NodeChange<BoardNode>[],
	nds: BoardNode[]
): NodeChange<BoardNode>[] {
	const dim = changes.find(
		(c): c is NodeDimensionChange =>
			c.type === 'dimensions' && c.resizing === true && !!c.dimensions
	)
	if (!dim) return changes
	const src = nds.find((n) => n.id === dim.id)
	if (!src?.selected || !RESIZE_MIN[src.type ?? '']) return changes
	const sw = src.measured?.width ?? src.width ?? 0
	const sh = src.measured?.height ?? src.height ?? 0
	const dims = dim.dimensions!
	const dw = dims.width - sw
	const dh = dims.height - sh
	if (dw === 0 && dh === 0) return changes
	const pos = changes.find(
		(c): c is NodePositionChange =>
			c.type === 'position' && c.id === dim.id && !!c.position
	)
	const dx = pos ? (pos.position!.x - src.position.x) : 0
	const dy = pos ? (pos.position!.y - src.position.y) : 0
	const extra: NodeChange<BoardNode>[] = []
	for (const n of nds) {
		const min = RESIZE_MIN[n.type ?? '']
		if (!n.selected || n.id === src.id || !min) continue
		const w = n.measured?.width ?? n.width ?? 0
		const h = n.measured?.height ?? n.height ?? 0
		let x = n.position.x
		let y = n.position.y
		let nw = w
		let nh = h
		if (dx !== 0) {
			x += dx
			nw = w - dx
		} else if (dw !== 0) nw = w + dw
		if (dy !== 0) {
			y += dy
			nh = h - dy
		} else if (dh !== 0) nh = h + dh
		nw = Math.max(min.w, nw)
		nh = Math.max(min.h, nh)
		if (x !== n.position.x || y !== n.position.y)
			extra.push({
				id: n.id,
				type: 'position',
				position: { x, y },
			})
		if (nw !== w || nh !== h)
			extra.push({
				id: n.id,
				type: 'dimensions',
				dimensions: { width: nw, height: nh },
				setAttributes: true,
			})
	}
	return extra.length ? [...changes, ...extra] : changes
}

/** グループ連動移動。ドラッグ中ノードに groupId があれば、同じ groupId の
 *  他メンバーへ同量の position 変更を追加して返す（未選択メンバーも動く）。
 *  既にこのバッチで動くメンバー（複数選択ドラッグ）は除外 */
function withDragFollowers(
	changes: NodeChange<BoardNode>[],
	nds: BoardNode[]
): NodeChange<BoardNode>[] {
	const deltas = new Map<string, { dx: number; dy: number }>()
	for (const c of changes) {
		if (c.type !== 'position' || !c.dragging || !c.position) continue
		const n = nds.find((x) => x.id === c.id)
		const g = n && gidOf(n)
		if (!n || !g || deltas.has(g)) continue
		deltas.set(g, {
			dx: c.position.x - n.position.x,
			dy: c.position.y - n.position.y,
		})
	}
	if (!deltas.size) return changes
	const moving = new Set(
		changes.filter((c) => c.type === 'position').map((c) => c.id)
	)
	const extra: NodeChange<BoardNode>[] = []
	for (const n of nds) {
		const g = gidOf(n)
		if (!g || moving.has(n.id)) continue
		const d = deltas.get(g)
		if (!d) continue
		extra.push({
			id: n.id,
			type: 'position',
			position: { x: n.position.x + d.dx, y: n.position.y + d.dy },
			dragging: true,
		})
	}
	return extra.length ? [...changes, ...extra] : changes
}

/** 複数ノードの同時ドラッグを剛体移動にする。RF の snapToGrid は
 *  ドラッグ中ノードを個別にグリッドへ丸め、非グリッドの相対オフセット
 *  （円弧端点との接合など）を壊すため、先頭の position 変更（ドライバー）
 *  の差分を全員へそのまま適用する。差分への吸着はグリッド倍数（位相維持）。
 *  オブジェクトスナップが成立した軸は precise な値を優先して丸めない */
function rigidifyDrag(
	changes: NodeChange<BoardNode>[],
	nds: BoardNode[],
	grid: { x: boolean; y: boolean }
): NodeChange<BoardNode>[] {
	const mov = changes.filter(
		(c): c is NodePositionChange =>
			c.type === 'position' && c.dragging === true && !!c.position
	)
	if (mov.length < 2) {
		// ドラッグ終端: RF は最終位置を絶対グリッド吸着で別バッチ送信し、
		// 掴んだノードだけ位相を失う。最終フレームの位置を維持して固定する
		// （単独ドラッグでは最終フレーム=終端位置で実質 no-op。
		//  updater が2回実行されても結果が同じ純粋処理にする）
		const ends = changes.some(
			(c) =>
				c.type === 'position' &&
				c.dragging === false &&
				!!c.position
		)
		if (!ends) return changes
		// 追従メンバーは RF から終了変更が来ず dragging:true が残る。
		// getNodesInside は dragging ノードを常に範囲内とみなすため、
		// 残ると以後の全範囲選択に巻き込まれる。ここで全員降ろす
		const ended = new Set(
			changes
				.filter(
					(c) =>
						c.type === 'position' && c.dragging === false
				)
				.map((c) => ('id' in c ? c.id : ''))
		)
		const unstuck: NodeChange<BoardNode>[] = []
		for (const n of nds) {
			if ((n as { dragging?: boolean }).dragging && !ended.has(n.id))
				unstuck.push({
					id: n.id,
					type: 'position',
					dragging: false,
				})
		}
		return [
			...changes.map((c) => {
				if (
					c.type !== 'position' ||
					c.dragging !== false ||
					!c.position
				)
					return c
				const n = nds.find((x) => x.id === c.id)
				if (!n) return c
				return {
					...c,
					position: { x: n.position.x, y: n.position.y },
				}
			}),
			...unstuck,
		]
	}
	const rn = nds.find((n) => n.id === mov[0].id)
	if (!rn) return changes
	const ddx = mov[0].position!.x - rn.position.x
	const ddy = mov[0].position!.y - rn.position.y
	const dx = grid.x ? Math.round(ddx / GRID) * GRID : ddx
	const dy = grid.y ? Math.round(ddy / GRID) * GRID : ddy
	return changes.map((c) => {
		if (c.type !== 'position' || !c.position) return c
		if (c.dragging !== true && c.dragging !== false) return c
		const n = nds.find((x) => x.id === c.id)
		if (!n) return c
		return {
			...c,
			position: { x: n.position.x + dx, y: n.position.y + dy },
		}
	})
}

/** グリッド上の値だけ丸める。グリッド外の値はオブジェクトスナップ等で
 *  意図的に置かれた位置とみなし尊重する（丸めると接合が崩れる） */
const snapOrKeep = (v: number) => {
	const g = Math.round(v / GRID) * GRID
	return Math.abs(v - g) < 2 ? g : Math.round(v)
}

// ---- オブジェクトスナップ＋寸法リードアウト（ドラッグ/リサイズ中のみ） ----

const sizeOf = (n: BoardNode) => ({
	w: n.measured?.width ?? n.width ?? 0,
	h: n.measured?.height ?? n.height ?? 0,
})

type SnapHud = {
	x: number
	y: number
	w: number
	h: number
	kind: 'drag' | 'resize'
}
type SnapResult = {
	changes: NodeChange<BoardNode>[]
	guides: { xs: number[]; ys: number[] }
	hud: SnapHud
}

/** 吸着ターゲット座標（移動中・選択中ノードを除く全ノード＋用紙の辺/中心） */
function snapTargets(
	nds: BoardNode[],
	paper: PaperCfg,
	exclIds: Set<string>,
	exclGids: Set<string>
) {
	const xs = new Set<number>()
	const ys = new Set<number>()
	const push = (x: number, y: number, w: number, h: number) => {
		xs.add(x)
		xs.add(x + w / 2)
		xs.add(x + w)
		ys.add(y)
		ys.add(y + h / 2)
		ys.add(y + h)
	}
	for (const n of nds) {
		if (exclIds.has(n.id)) continue
		const g = gidOf(n)
		if (g && exclGids.has(g)) continue
		const { w, h } = sizeOf(n)
		push(n.position.x, n.position.y, w, h)
		// 円弧の実端点も吸着対象に（箱の辺・中点では拾えない位置にある）
		if (n.type === 'line' && n.data.arc) {
			const cx = n.position.x + w / 2
			const cy = n.position.y + h / 2
			const sy = n.data.arcCcw !== false ? -1 : 1
			for (const deg of [n.data.arcStart ?? 0, n.data.arcEnd ?? 270]) {
				const a = (deg * Math.PI) / 180
				xs.add(cx + (w / 2) * Math.cos(a))
				ys.add(cy + (h / 2) * Math.sin(a) * sy)
			}
		}
		// 曲線は全頂点を吸着対象に（端点・中間点どちらにも合わせられる）
		if (n.type === 'curve') {
			for (const p of n.data.pts) {
				xs.add(n.position.x + p.x)
				ys.add(n.position.y + p.y)
			}
		}
	}
	if (paper.on) {
		const { w, h } = paperDims(paper)
		push(paper.x, paper.y, w, h)
	}
	return { xs: [...xs], ys: [...ys] }
}

/** 候補とターゲットの最小差分が閾値以内ならその差分とターゲット座標を返す */
function snapBest(cands: number[], targets: number[], th: number) {
	let off = 0
	let hit: number | null = null
	let min = th + 1
	for (const c of cands)
		for (const t of targets) {
			const d = Math.abs(c - t)
			if (d <= th && d < min) {
				min = d
				off = t - c
				hit = t
			}
		}
	return { off, hit }
}

/** ドラッグ/リサイズの change 列にスナップ補正を掛け、ガイド・HUD情報を返す。
 *  対象操作がなければ null */
function applyBoardSnap(
	changes: NodeChange<BoardNode>[],
	nds: BoardNode[],
	paper: PaperCfg,
	th: number
): SnapResult | null {
	const moving = changes.filter(
		(c): c is NodePositionChange =>
			c.type === 'position' && c.dragging === true && !!c.position
	)
	const exclIds = new Set(
		nds.filter((n) => n.selected).map((n) => n.id)
	)
	const exclGids = new Set(
		nds
			.filter((n) => n.selected)
			.map(gidOf)
			.filter((g): g is string => !!g)
	)
	if (moving.length) {
		// 移動中ノード群の外接ボックス（デルタ適用後）
		const n0 = nds.find((n) => n.id === moving[0].id)
		if (!n0) return null
		const dx = moving[0].position!.x - n0.position.x
		const dy = moving[0].position!.y - n0.position.y
		let x0 = Infinity,
			y0 = Infinity,
			x1 = -Infinity,
			y1 = -Infinity
		const ids = new Set(moving.map((c) => c.id))
		for (const c of moving) {
			const n = nds.find((x) => x.id === c.id)
			if (!n) continue
			exclIds.add(n.id)
			const { w, h } = sizeOf(n)
			x0 = Math.min(x0, n.position.x + dx)
			y0 = Math.min(y0, n.position.y + dy)
			x1 = Math.max(x1, n.position.x + dx + w)
			y1 = Math.max(y1, n.position.y + dy + h)
		}
		const bw = x1 - x0
		const bh = y1 - y0
		const t = snapTargets(nds, paper, exclIds, exclGids)
		const candsX = [x0, x0 + bw / 2, x1]
		const candsY = [y0, y0 + bh / 2, y1]
		if (moving.length === 1) {
			// 罫線の実ストロークは箱辺+半線幅。線の「芯」を吸着候補に
			// して円弧端点などとの接合を正確にする
			if (
				n0.type === 'line' &&
				!n0.data.rect &&
				!n0.data.ellipse &&
				!n0.data.arc &&
				!n0.data.diag
			) {
				const sw = (
					LINE_STROKES[
						n0.data.w as Exclude<LineWeight, 'double'>
					] ?? LINE_STROKES.thin
				).width
				const off = sw / 2
				const sz = sizeOf(n0)
				if (sz.w >= sz.h) candsY.push(y0 + off)
				else candsX.push(x0 + off)
			}
			// 曲線は全頂点を吸着候補に（端点を他要素に合わせられる）
			if (n0.type === 'curve') {
				for (const p of n0.data.pts) {
					candsX.push(n0.position.x + dx + p.x)
					candsY.push(n0.position.y + dy + p.y)
				}
			}
		}
		const rx = snapBest(candsX, t.xs, th)
		const ry = snapBest(candsY, t.ys, th)
		const ox = rx.hit !== null ? rx.off : 0
		const oy = ry.hit !== null ? ry.off : 0
		return {
			changes: changes.map((c) =>
				c.type === 'position' &&
				c.dragging === true &&
				c.position &&
				ids.has(c.id)
					? {
							...c,
							position: {
								x: c.position.x + ox,
								y: c.position.y + oy,
							},
						}
					: c
			),
			guides: {
				xs: rx.hit !== null ? [rx.hit] : [],
				ys: ry.hit !== null ? [ry.hit] : [],
			},
			hud: { x: x0 + ox, y: y0 + oy, w: bw, h: bh, kind: 'drag' },
		}
	}
	// リサイズ: ドライバーの dimensions change（resizing=true）
	const dim = changes.find(
		(c): c is NodeDimensionChange =>
			c.type === 'dimensions' && c.resizing === true && !!c.dimensions
	)
	if (!dim) return null
	const src = nds.find((n) => n.id === dim.id)
	if (!src) return null
	exclIds.add(src.id)
	const posC = changes.find(
		(c): c is NodePositionChange =>
			c.type === 'position' && c.id === dim.id && !!c.position
	)
	const { w: ow, h: oh } = sizeOf(src)
	const nx = posC?.position?.x ?? src.position.x
	const ny = posC?.position?.y ?? src.position.y
	const nw = dim.dimensions!.width
	const nh = dim.dimensions!.height
	const oldR = src.position.x + ow
	const oldB = src.position.y + oh
	const newR = nx + nw
	const newB = ny + nh
	const t = snapTargets(nds, paper, exclIds, exclGids)
	const leftMoved = nx !== src.position.x
	const rightMoved = newR !== oldR
	const topMoved = ny !== src.position.y
	const bottomMoved = newB !== oldB
	const rx = leftMoved
		? snapBest([nx], t.xs, th)
		: rightMoved
			? snapBest([newR], t.xs, th)
			: { off: 0, hit: null }
	const ry = topMoved
		? snapBest([ny], t.ys, th)
		: bottomMoved
			? snapBest([newB], t.ys, th)
			: { off: 0, hit: null }
	const sx = nx + (leftMoved ? rx.off : 0)
	const sy = ny + (topMoved ? ry.off : 0)
	const sw = nw + (leftMoved ? -rx.off : rightMoved ? rx.off : 0)
	const sh = nh + (topMoved ? -ry.off : bottomMoved ? ry.off : 0)
	return {
		changes: changes.map((c) => {
			if (!('id' in c) || c.id !== dim.id) return c
			if (c.type === 'dimensions' && c.dimensions)
				return { ...c, dimensions: { width: sw, height: sh } }
			if (c.type === 'position' && c.position)
				return { ...c, position: { x: sx, y: sy } }
			return c
		}),
		guides: {
			xs: rx.hit !== null ? [rx.hit] : [],
			ys: ry.hit !== null ? [ry.hit] : [],
		},
		hud: { x: sx, y: sy, w: sw, h: sh, kind: 'resize' },
	}
}

function loadDoc(): { nodes: BoardNode[]; edges: Edge[]; paper: PaperCfg } {
	try {
		const raw = localStorage.getItem(DOC_KEY)
		if (!raw) return { nodes: [], edges: [], paper: DEFAULT_PAPER }
		const parsed = JSON.parse(raw)
		return {
			nodes: Array.isArray(parsed?.nodes)
				? parsed.nodes.map(fixZoneSelectable)
				: [],
			edges: Array.isArray(parsed?.edges) ? parsed.edges : [],
			paper:
				parsed?.paper && typeof parsed.paper === 'object'
					? { ...DEFAULT_PAPER, ...parsed.paper }
					: DEFAULT_PAPER,
		}
	} catch {
		return { nodes: [], edges: [], paper: DEFAULT_PAPER }
	}
}

function loadViewport(): Viewport | null {
	try {
		const raw = localStorage.getItem(VP_KEY)
		if (!raw) return null
		const parsed = JSON.parse(raw)
		return typeof parsed?.zoom === 'number' ? parsed : null
	} catch {
		return null
	}
}

function serializeNode(n: BoardNode): BoardNode {
	return {
		id: n.id,
		type: n.type,
		position: n.position,
		width: n.width,
		height: n.height,
		zIndex: n.zIndex,
		dragHandle: n.dragHandle,
		data: n.data,
		selected: false,
	} as BoardNode
}

function serializeEdge(e: Edge): Edge {
	return {
		id: e.id,
		source: e.source,
		target: e.target,
		sourceHandle: e.sourceHandle,
		targetHandle: e.targetHandle,
		markerEnd: e.markerEnd,
	} as Edge
}

export default function App() {
	return (
		<div className="app">
			<ReactFlowProvider>
				<Board />
			</ReactFlowProvider>
		</div>
	)
}

function Board() {
	const t = useT()
	// 折りたたみツールバーのアイコン用。漢字グリフは英語UIでは記号に切替
	const ic = (ja: string, en: string) =>
		resolvedLang() === 'en' ? en : ja
	const [doc] = useState(loadDoc)
	const [nodes, setNodes] = useState<BoardNode[]>(doc.nodes)
	const [edges, setEdges] = useState<Edge[]>(doc.edges)
	const [paper, setPaper] = useState<PaperCfg>(doc.paper)
	const [gridOn, setGridOn] = useState(true)
	const [snapOn, setSnapOn] = useState(false)
	const [lineMode, setLineMode] = useState(false)
	const [zoneDraw, setZoneDraw] = useState(false)
	const [curveDraw, setCurveDraw] = useState(false)
	const [curvePts, setCurvePts] = useState<{ x: number; y: number }[]>([])
	const [curveHover, setCurveHover] = useState<{ x: number; y: number } | null>(
		null
	)
	const zoneDrawStart = useRef<{ x: number; y: number } | null>(null)
	const [tbCollapsed, setTbCollapsed] = useState(false)
	const [modal, setModal] = useState<
		'about' | 'reset' | 'settings' | 'templates' | 'csv' | null
	>(null)
	const [tbColor, setTbColor] = useState(
		() => localStorage.getItem(TB_COLOR_KEY) ?? ''
	)
	// テーマ: 標準／Quiet（UI明度抑制）／ダーク（CAD風の暗い盤面）
	// 旧 sethera-quiet 保存値は quiet に読み替え（書き込みは新キーに一元化）
	const [theme, setTheme] = useState<Theme>(() => {
		const t = localStorage.getItem(THEME_KEY)
		if (t === 'dark' || t === 'quiet') return t
		if (localStorage.getItem(QUIET_KEY) === '1') return 'quiet'
		return 'standard'
	})
	const applyTheme = (t: Theme) => {
		setTheme(t)
		if (t === 'standard') localStorage.removeItem(THEME_KEY)
		else localStorage.setItem(THEME_KEY, t)
		// 旧キーは読み替え用に残す（書き込みも同期して不整合を防ぐ）
		if (t === 'quiet') localStorage.setItem(QUIET_KEY, '1')
		else localStorage.removeItem(QUIET_KEY)
	}
	const applyTbColor = (c: string) => {
		setTbColor(c)
		if (c) localStorage.setItem(TB_COLOR_KEY, c)
		else localStorage.removeItem(TB_COLOR_KEY)
	}
	const [hintedIds, setHintedIds] = useState<ReadonlySet<string>>(new Set())
	// ゾーンに一部だけ重なっている（= 式に効いていない）ピースの警告表示
	const partialIds = useMemo(() => zonePartialIds(nodes), [nodes])
	// 選択メンバーと同じ groupId を持つ全ノード（グループの可視化用）
	const groupSelIds = useMemo(() => {
		const gids = new Set(
			nodes.filter((n) => n.selected).map(gidOf).filter((g): g is string => !!g)
		)
		const out = new Set<string>()
		if (!gids.size) return out
		for (const n of nodes) {
			const g = gidOf(n)
			if (g && gids.has(g)) out.add(n.id)
		}
		return out
	}, [nodes])
	const rf = useReactFlow<BoardNode>()
	const wrapRef = useRef<HTMLDivElement>(null)
	const fileRef = useRef<HTMLInputElement>(null)
	const clipboard = useRef<{ nodes: BoardNode[]; edges: Edge[] }>({
		nodes: [],
		edges: [],
	})
	const savedViewport = useMemo(loadViewport, [])

	// ---- undo/redo 履歴（変更前スナップショット、最大 HIST_MAX 件） ----
	const histPast = useRef<Snapshot[]>([])
	const histFuture = useRef<Snapshot[]>([])
	const [histLen, setHistLen] = useState({ past: 0, future: 0 })
	// ドラッグ/リサイズ中のスナップガイドと寸法リードアウト（フロー座標）
	const [snapGuides, setSnapGuides] = useState<{
		xs: number[]
		ys: number[]
	} | null>(null)
	const [snapHud, setSnapHud] = useState<SnapHud | null>(null)
	const snapRef = useRef<Snapshot | null>(null)
	snapRef.current = { nodes, edges, paper }
	const lastRec = useRef({ t: 0, key: '' })
	const dragRec = useRef(false)
	const resizeRec = useRef(false)
	// Alt 押下中はグループ連動を抑制（メンバーの個別移動用）
	const altDown = useRef(false)
	useEffect(() => {
		const dn = (e: KeyboardEvent) => {
			if (e.key === 'Alt') altDown.current = true
		}
		const up = (e: KeyboardEvent) => {
			if (e.key === 'Alt') altDown.current = false
		}
		const off = () => {
			altDown.current = false
			// フォーカス喪失中にブラウザ外でボタンを離すと mouseup が
			// 届かず、範囲選択・ドラッグが永続する。d3-drag は window の
			// mouseup を待つので合成イベントで終了させる
			// （pointer 版に備えて pointerup も投げる）
			window.dispatchEvent(
				new MouseEvent('mouseup', { bubbles: true, view: window })
			)
			window.dispatchEvent(
				new PointerEvent('pointerup', { bubbles: true })
			)
		}
		const vis = () => {
			if (document.hidden) off()
		}
		window.addEventListener('keydown', dn)
		window.addEventListener('keyup', up)
		window.addEventListener('blur', off)
		document.addEventListener('visibilitychange', vis)
		return () => {
			window.removeEventListener('keydown', dn)
			window.removeEventListener('keyup', up)
			window.removeEventListener('blur', off)
			document.removeEventListener('visibilitychange', vis)
		}
	}, [])

	// 起動時に残留した dragging:true を掃除（dragging ノードは
	// getNodesInside が常に範囲内とみなし範囲選択に巻き込まれる）。
	// 追従合成の副作用で残り得るため、ドラッグ終端でも降ろしている
	useEffect(() => {
		setNodes((nds) =>
			nds.some((n) => n.dragging)
				? nds.map((n) =>
						n.dragging ? { ...n, dragging: false } : n
					)
				: nds
		)
	}, [])

	// 変更適用前に現状態を積む。150ms以内の連続記録は同一ジェスチャとして統合、
	// key+win指定で連続操作（自由ドラッグ等）をさらに長い窓で統合
	const record = useCallback((key = '', win = 0) => {
		const now = Date.now()
		const l = lastRec.current
		if (now - l.t < 150 || (key !== '' && key === l.key && now - l.t < win))
			return
		lastRec.current = { t: now, key }
		histPast.current.push(structuredClone(snapRef.current!))
		if (histPast.current.length > HIST_MAX) histPast.current.shift()
		histFuture.current = []
		setHistLen({ past: histPast.current.length, future: 0 })
	}, [])

	const undo = useCallback(() => {
		const prev = histPast.current.pop()
		if (!prev || !snapRef.current) return
		histFuture.current.push(structuredClone(snapRef.current))
		const s = structuredClone(prev)
		setNodes(s.nodes)
		setEdges(s.edges)
		setPaper(s.paper)
		setHistLen({
			past: histPast.current.length,
			future: histFuture.current.length,
		})
	}, [])

	const redo = useCallback(() => {
		const next = histFuture.current.pop()
		if (!next || !snapRef.current) return
		histPast.current.push(structuredClone(snapRef.current))
		const s = structuredClone(next)
		setNodes(s.nodes)
		setEdges(s.edges)
		setPaper(s.paper)
		setHistLen({
			past: histPast.current.length,
			future: histFuture.current.length,
		})
	}, [])

	const onNodesChange = useCallback(
		(changes: NodeChange<BoardNode>[]) => {
			const locked = new Set(
				snapRef.current!.nodes.filter(lockedOf).map((n) => n.id)
			)
			let recKey = ''
			for (const c of changes) {
				if (c.type === 'select') continue
				// ロックノードへの記録対象操作は無効化されるので履歴にも積まない
				if ('id' in c && locked.has(c.id) && c.type !== 'dimensions')
					continue
				if (c.type === 'position' && c.dragging) {
					if (!dragRec.current) {
						record('drag')
						dragRec.current = true
					}
					continue
				}
				if (c.type === 'position' && c.dragging === false) {
					dragRec.current = false
					continue
				}
				if (c.type === 'dimensions' && c.resizing === true) {
					if (!resizeRec.current) {
						record('resize')
						resizeRec.current = true
					}
					continue
				}
				if (c.type === 'dimensions') {
					// リサイズ終了時 or マウント時の寸法通知は記録しない
					resizeRec.current = false
					continue
				}
				recKey =
					c.type === 'remove'
						? 'rm'
						: c.type === 'add'
							? 'add'
							: c.type === 'replace'
								? `r:${c.id}`
								: 'misc'
			}
			if (recKey) record(recKey, recKey.startsWith('r:') ? 600 : 0)
			// オブジェクトスナップ＋寸法リードアウト（ドラッグ/リサイズ中のみ。
			// フォロワー計算より先にドライバーの値を補正して連動を保つ）
			const snapped = applyBoardSnap(
				changes,
				snapRef.current!.nodes,
				snapRef.current!.paper,
				// グリッド吸着下でもオブジェクトスナップが届くよう、
				// 閾値は半グリッド超（グリッド+6pxの端点にも吸着可）
				Math.max(6 / (rf.getZoom() || 1), GRID / 2 + 1)
			)
			if (snapped) {
				// 吸着OFFではガイド・位置補正を抑止（寸法HUDは常時表示）
				setSnapGuides(snapOn ? snapped.guides : null)
				setSnapHud(snapped.hud)
			} else if (
				changes.some(
					(c) =>
						(c.type === 'position' && c.dragging === false) ||
						(c.type === 'dimensions' &&
							c.dimensions &&
							c.resizing !== true)
				)
			) {
				setSnapGuides(null)
				setSnapHud(null)
			}
			const ch = snapped && snapOn ? snapped.changes : changes
			setNodes((nds) =>
				applyNodeChanges(
					withResizeFollowers(
						// グループ追従を含めた全ドラッグ変更を剛体化
						// （ドライバーも位相を維持。Alt個別移動は mov<2 で素通し）
						rigidifyDrag(
							altDown.current ? ch : withDragFollowers(ch, nds),
							nds,
							{
								// オブジェクトスナップ成立軸はその精度を優先（丸めない）
								x:
									snapOn &&
									!(snapped && snapped.guides.xs.length > 0),
								y:
									snapOn &&
									!(snapped && snapped.guides.ys.length > 0),
							}
						),
						nds
					).filter((c) => {
						// ロック: ドラッグ・リサイズ・削除・ノード内UIからの更新を抑止
						// （寸法の受動通知は通す。追従で追加された変更にも適用）
						if (
							'id' in c &&
							locked.has(c.id) &&
							(c.type === 'position' ||
								c.type === 'remove' ||
								c.type === 'replace' ||
								(c.type === 'dimensions' && c.resizing === true))
						)
							return false
						return true
					}),
					nds
				)
			)
		},
		[record, rf, snapOn]
	)
	const onEdgesChange = useCallback(
		(changes: EdgeChange<Edge>[]) => {
			for (const c of changes) {
				if (c.type === 'select') continue
				record(c.type === 'remove' ? 'rm' : 'add')
				break
			}
			setEdges((es) => applyEdgeChanges(changes, es))
		},
		[record]
	)
	const onConnect = useCallback((conn: Connection) => {
		if (!conn.source || !conn.target || conn.source === conn.target) return
		if (conn.targetHandle !== 'a' && conn.targetHandle !== 'b') return
		record('add')
		setEdges((es) =>
			addEdge(
				{ ...conn, markerEnd: { type: MarkerType.ArrowClosed } },
				es.filter(
					(e) =>
						!(e.target === conn.target && e.targetHandle === conn.targetHandle)
				)
			)
		)
	}, [record])

	// localStorage への自動保存（debounce）
	useEffect(() => {
		const t = setTimeout(() => {
			localStorage.setItem(
				DOC_KEY,
				JSON.stringify({
					nodes: nodes.map(serializeNode),
					edges: edges.map(serializeEdge),
					paper,
				})
			)
		}, 300)
		return () => clearTimeout(t)
	}, [nodes, edges, paper])

	// 印刷: 用紙（または全オブジェクト外接矩形）を高解像度キャプチャして印刷
	const [printImg, setPrintImg] = useState<{ src: string; page: string } | null>(
		null
	)
	useEffect(() => {
		const clear = () => setPrintImg(null)
		window.addEventListener('afterprint', clear)
		return () => window.removeEventListener('afterprint', clear)
	}, [])

	const doPrint = async () => {
		const root = wrapRef.current
		const vpEl = root?.querySelector<HTMLElement>('.react-flow__viewport')
		if (!root || !vpEl) return
		let bounds: { x: number; y: number; width: number; height: number }
		let page = 'auto'
		if (paper.on) {
			const { w, h } = paperDims(paper)
			bounds = { x: paper.x, y: paper.y, width: w, height: h }
			page = `${paper.size}${paper.landscape ? ' landscape' : ''}`
		} else {
			const b = getNodesBounds(rf.getNodes())
			if (!isFinite(b.width) || b.width === 0) {
				alert('印刷対象がありません')
				return
			}
			bounds = {
				x: b.x - 24,
				y: b.y - 24,
				width: b.width + 48,
				height: b.height + 48,
			}
		}
		// 選択枠・ハンドル等の装飾を写り込ませない
		const prevSelected = rf
			.getNodes()
			.filter((n) => n.selected)
			.map((n) => n.id)
		flushSync(() =>
			setNodes((nds) =>
				nds.map((n) => (n.selected ? { ...n, selected: false } : n))
			)
		)
		root.classList.add('capturing')
		try {
			const SCALE = 2
			const vp = getViewportForBounds(
				bounds,
				bounds.width * SCALE,
				bounds.height * SCALE,
				0.1,
				3,
				0
			)
			const dataUrl = await toPng(vpEl, {
				backgroundColor: '#ffffff',
				// バンドルWebフォント（Noto Sans JPのunicode-range分割）の
				// 埋め込みは空画像の原因になるためスキップ。PDF側はOSフォントで描画
				skipFonts: true,
				width: bounds.width * SCALE,
				height: bounds.height * SCALE,
				style: {
					width: `${bounds.width * SCALE}px`,
					height: `${bounds.height * SCALE}px`,
					transform: `translate(${vp.x}px, ${vp.y}px) scale(${vp.zoom})`,
				},
			})
			if (dataUrl.length < 5000) throw new Error('empty capture')
			setPrintImg({ src: dataUrl, page })
		} catch {
			alert('印刷イメージの生成に失敗しました')
		} finally {
			root.classList.remove('capturing')
			if (prevSelected.length > 0) {
				setNodes((nds) =>
					nds.map((n) =>
						prevSelected.includes(n.id) ? { ...n, selected: true } : n
					)
				)
			}
		}
	}

	// 選択ノードがグループに属していれば、そのグループ全員に拡張する
	// （rf.getNodes() は常に最新を返すのでコンポーネント外側で使い回せる）
	const expandGroups = (sel: BoardNode[]) => {
		const gids = new Set(
			sel.map(gidOf).filter((g): g is string => !!g)
		)
		if (!gids.size) return sel
		return rf.getNodes().filter((n) => {
			const g = gidOf(n)
			return n.selected || (!!g && gids.has(g))
		})
	}
	const innerEdges = (sel: BoardNode[]) => {
		const ids = new Set(sel.map((n) => n.id))
		return rf
			.getEdges()
			.filter((e) => ids.has(e.source) && ids.has(e.target))
	}
	const duplicate = (
		srcNodes: BoardNode[],
		srcEdges: Edge[],
		select: boolean,
		off: { x: number; y: number } = { x: 32, y: 32 }
	) => {
		if (srcNodes.length === 0) return
		record('app')
		const idMap = new Map(srcNodes.map((n) => [n.id, crypto.randomUUID()]))
		// グループは複製ごとに新ID（オリジナルとは非連携）
		const gMap = new Map<string, string>()
		const remapData = (n: BoardNode): BoardNode['data'] => {
			const g = gidOf(n)
			if (!g) return n.data
			if (!gMap.has(g)) gMap.set(g, crypto.randomUUID())
			return { ...n.data, groupId: gMap.get(g) } as BoardNode['data']
		}
		setNodes((nds) => [
			...(select ? nds.map((n) => ({ ...n, selected: false })) : nds),
			...srcNodes.map(
				(n): BoardNode => ({
					...serializeNode(n),
					...(n.type === 'zone' ? { selectable: false } : {}),
					id: idMap.get(n.id)!,
					position: {
						x: n.position.x + off.x,
						y: n.position.y + off.y,
					},
					data: remapData(n),
					selected: select,
				} as BoardNode)
			),
		])
		setEdges((es) => [
			...es,
			...srcEdges.map((e) => ({
				...serializeEdge(e),
				id: crypto.randomUUID(),
				source: idMap.get(e.source)!,
				target: idMap.get(e.target)!,
				selected: false,
			})),
		])
	}

	// 選択物（グループ展開済）を N 個・間隔 dx,dy で一括複製。
	// 各コピーは新しい id/groupId の独立実体（duplicate と同じ規則）。
	// 1回の setNodes/setEdges で全コピー生成 → Undo 1ステップ
	const arrayDup = (count: number, dx: number, dy: number) => {
		const n = Math.min(50, Math.max(1, Math.round(count)))
		const sel = expandGroups(nodes.filter((x) => x.selected))
		if (!sel.length) return
		record('app')
		const inner = innerEdges(sel)
		const newNodes: BoardNode[] = []
		const newEdges: Edge[] = []
		for (let i = 1; i <= n; i++) {
			const idMap = new Map(
				sel.map((x) => [x.id, crypto.randomUUID()])
			)
			const gMap = new Map<string, string>()
			for (const x of sel) {
				const g = gidOf(x)
				let data = x.data
				if (g) {
					if (!gMap.has(g)) gMap.set(g, crypto.randomUUID())
					data = {
						...x.data,
						groupId: gMap.get(g),
					} as BoardNode['data']
				}
				newNodes.push({
					...serializeNode(x),
					...(x.type === 'zone' ? { selectable: false } : {}),
					id: idMap.get(x.id)!,
					position: {
						x: x.position.x + dx * i,
						y: x.position.y + dy * i,
					},
					data,
					selected: true,
				} as BoardNode)
			}
			for (const e of inner) {
				newEdges.push({
					...serializeEdge(e),
					id: crypto.randomUUID(),
					source: idMap.get(e.source)!,
					target: idMap.get(e.target)!,
					selected: false,
				})
			}
		}
		setNodes((nds) => [
			...nds.map((x) => (x.selected ? { ...x, selected: false } : x)),
			...newNodes,
		])
		setEdges((es) => [...es, ...newEdges])
	}

	// Ctrl+C / Ctrl+V / Ctrl+D（選択ノード間のエッジも一緒に複製）
	useEffect(() => {
		const onKey = (e: KeyboardEvent) => {
			// Ctrl+P はツールのキャプチャ印刷へ
			if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'p') {
				e.preventDefault()
				void doPrint()
				return
			}
			const el = document.activeElement as HTMLElement | null
			if (
				el &&
				(el.tagName === 'INPUT' ||
					el.tagName === 'SELECT' ||
					el.tagName === 'TEXTAREA' ||
					el.isContentEditable)
			) {
				return
			}
			// 矢印キー微移動: 矢印=グリッド1歩、Shift+矢印=1px
			// （グループは全体移動、ロック品は除外）
			if (
				!e.ctrlKey &&
				!e.metaKey &&
				!e.altKey &&
				e.key.startsWith('Arrow') &&
				!document.querySelector('.modal-back')
			) {
				const sel = rf.getNodes().filter((n) => n.selected)
				if (sel.length === 0) return
				e.preventDefault()
				const step = e.shiftKey ? 1 : GRID
				const dx =
					e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0
				const dy =
					e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0
				const gids = new Set(
					sel.map(gidOf).filter((g): g is string => !!g)
				)
				record('kbd:' + sel.map((n) => n.id).join(','), 800)
				setNodes((nds) =>
					nds.map((n) => {
						const g = gidOf(n)
						if (!(n.selected || (!!g && gids.has(g))) || lockedOf(n))
							return n
						return {
							...n,
							position: { x: n.position.x + dx, y: n.position.y + dy },
						}
					})
				)
				return
			}
			if (!(e.ctrlKey || e.metaKey)) return
			const key = e.key.toLowerCase()
			if (key === 'z') {
				e.preventDefault()
				if (e.shiftKey) redo()
				else undo()
			} else if (key === 'y') {
				e.preventDefault()
				redo()
			} else if (key === 'c') {
				const sel = expandGroups(rf.getNodes().filter((n) => n.selected))
				clipboard.current = { nodes: sel, edges: innerEdges(sel) }
			} else if (key === 'd') {
				e.preventDefault()
				const sel = expandGroups(rf.getNodes().filter((n) => n.selected))
				duplicate(sel, innerEdges(sel), false)
			} else if (key === 'v') {
				duplicate(clipboard.current.nodes, clipboard.current.edges, true)
			}
		}
		window.addEventListener('keydown', onKey)
		return () => window.removeEventListener('keydown', onKey)
	}, [rf, record, undo, redo, doPrint])

	const viewportCenter = () => {
		const rect = wrapRef.current?.getBoundingClientRect()
		return rf.screenToFlowPosition({
			x: (rect?.left ?? 0) + (rect?.width ?? window.innerWidth) / 2,
			y: (rect?.top ?? 0) + (rect?.height ?? window.innerHeight) / 2,
		})
	}

	const addObject = (kind: VObjectKind) => {
		record('app')
		const c = viewportCenter()
		const n = nodes.filter((s) => s.type === 'vobject').length
		const offset = (n % 8) * 28
		const node: VObjectNodeType = {
			id: crypto.randomUUID(),
			type: 'vobject',
			position: { x: c.x - 60 + offset, y: c.y - 20 + offset },
			// 初期サイズは1行分（複数行はユーザーがリサイズして広げる）
			width: kind === 'pair' ? 144 : 120,
			height: kind === 'pair' ? 60 : 36,
			zIndex: 1,
			data: {
				kind,
				label: kind === 'number' ? '' : t('テキスト'),
				value: kind === 'text' ? null : 0,
				color: 'yellow',
				// 数値は帳票の慣習で右揃えを既定にする
				align: kind === 'number' ? 'r' : 'c',
			},
		}
		setNodes((nds) => [...nds, node])
	}

	const addCalc = () => {
		record('app')
		const c = viewportCenter()
		const n = nodes.filter((s) => s.type === 'calc').length
		const offset = (n % 8) * 28
		setNodes((nds) => [
			...nds,
			{
				id: crypto.randomUUID(),
				type: 'calc',
				position: { x: c.x - 90 + offset, y: c.y + 60 + offset },
				zIndex: 1,
				data: {
					op: 'mul',
					round: 'none',
					constA: null,
					constB: null,
					align: 'r',
				},
			},
		])
	}

	const addLine = () => {
		record('app')
		const c = viewportCenter()
		setNodes((nds) => [
			...nds,
			{
				id: crypto.randomUUID(),
				type: 'line',
				position: { x: c.x - 120, y: c.y + 120 },
				width: 240,
				height: GRID,
				zIndex: 0,
				data: { w: 'thin' },
			},
		])
	}

	const addRect = () => {
		record('app')
		const c = viewportCenter()
		setNodes((nds) => [
			...nds,
			{
				id: crypto.randomUUID(),
				type: 'line',
				position: { x: c.x - 120, y: c.y - 90 },
				width: 240,
				height: 180,
				zIndex: 0,
				data: { w: 'thin', rect: true },
			},
		])
	}

	const addEllipse = () => {
		record('app')
		const c = viewportCenter()
		setNodes((nds) => [
			...nds,
			{
				id: crypto.randomUUID(),
				type: 'line',
				position: { x: c.x - 120, y: c.y - 90 },
				width: 240,
				height: 180,
				zIndex: 0,
				data: { w: 'thin', ellipse: true },
			},
		])
	}

	const addDiag = () => {
		record('app')
		const c = viewportCenter()
		setNodes((nds) => [
			...nds,
			{
				id: crypto.randomUUID(),
				type: 'line',
				position: { x: c.x - 90, y: c.y - 60 },
				width: 180,
				height: 120,
				zIndex: 0,
				data: { w: 'thin', diag: 'down' },
			},
		])
	}

	const createZone = () => {
		record('app')
		const selected = nodes.filter(
			(n): n is VObjectNodeType => n.selected === true && n.type === 'vobject'
		)
		const id = crypto.randomUUID()
		if (selected.length > 0) {
			const minX = Math.min(...selected.map((s) => s.position.x))
			const minY = Math.min(...selected.map((s) => s.position.y))
			const maxX = Math.max(
				...selected.map((s) => s.position.x + (s.measured?.width ?? s.width ?? 0))
			)
			const maxY = Math.max(
				...selected.map((s) => s.position.y + (s.measured?.height ?? s.height ?? 0))
			)
			setNodes((nds) => [
				...nds,
				{
					id,
					type: 'zone',
					position: { x: minX - 24, y: minY - 56 },
					width: maxX - minX + 48,
					height: maxY - minY + 80,
					zIndex: 0,
					dragHandle: '.aggzone-header',
					selectable: false,
					data: { fn: 'sum', labelPos: 'bottom' },
				},
			])
		}
	}

	// ゾーン描画モード: 左ドラッグの選択マーキーを流用して対角2点で作成。
	// 角座標は常にグリッド吸着（罫線と同じ思想）
	const onSelectionStart = useCallback(
		(e: { clientX: number; clientY: number }) => {
			if (!zoneDraw) return
			zoneDrawStart.current = { x: e.clientX, y: e.clientY }
		},
		[zoneDraw]
	)
	const onSelectionEnd = useCallback(
		(e: { clientX: number; clientY: number }) => {
			if (!zoneDraw || !zoneDrawStart.current) return
			const a = rf.screenToFlowPosition(zoneDrawStart.current)
			const b = rf.screenToFlowPosition({ x: e.clientX, y: e.clientY })
			zoneDrawStart.current = null
			setZoneDraw(false)
			const x0 = Math.min(a.x, b.x)
			const y0 = Math.min(a.y, b.y)
			const x1 = Math.max(a.x, b.x)
			const y1 = Math.max(a.y, b.y)
			// 微小ドラッグは誤操作としてキャンセル
			if (x1 - x0 < 24 || y1 - y0 < 24) return
			const sx = Math.round(x0 / GRID) * GRID
			const sy = Math.round(y0 / GRID) * GRID
			const w = Math.round(x1 / GRID) * GRID - sx
			const h = Math.round(y1 / GRID) * GRID - sy
			record('app')
			const id = crypto.randomUUID()
			setNodes((nds) => [
				// マーキーで拾われたピースの選択は解除し、新ゾーンを選択状態に
				// （zIndex 0 で背面に行っても選択枠で位置が分かる）
				...nds.map((n) => (n.selected ? { ...n, selected: false } : n)),
				{
					id,
					type: 'zone',
					position: { x: sx, y: sy },
					width: w,
					height: h,
					zIndex: 0,
					dragHandle: '.aggzone-header',
					// ボックス選択から除外（getNodesInside の
					// excludeNonSelectableNodes が効く）。
					// クリック選択は onNodeClick で手動復元
					selectable: false,
					selected: true,
					data: { fn: 'sum', labelPos: 'bottom' },
				},
			])
		},
		[zoneDraw, rf, record]
	)

	// ゾーンは selectable:false（ボックス選択から除外）のため、
	// クリック選択は手動で行う。Shift+クリックで選択の追加/解除
	const onNodeClick = useCallback(
		(e: MouseEvent, n: BoardNode) => {
			if (n.type !== 'zone') return
			const add = e.shiftKey
			setNodes((nds) =>
				nds.map((x) => {
					if (x.id === n.id)
						return { ...x, selected: add ? !x.selected : true }
					if (!add && x.selected) return { ...x, selected: false }
					return x
				})
			)
		},
		[]
	)

	// ゾーン描画モードをEscで解除
	useEffect(() => {
		if (!zoneDraw) return
		const onEsc = (e: KeyboardEvent) => {
			if (e.key === 'Escape') setZoneDraw(false)
		}
		window.addEventListener('keydown', onEsc)
		return () => window.removeEventListener('keydown', onEsc)
	}, [zoneDraw])

	// 曲線描画モード: 打ち込んだ頂点を確定（3点未満は破棄）
	const commitCurve = () => {
		if (curvePts.length >= 3) {
			record('app')
			const minX = Math.min(...curvePts.map((p) => p.x))
			const minY = Math.min(...curvePts.map((p) => p.y))
			const nz = normalizeCurvePts(
				{ x: minX, y: minY },
				curvePts.map((p) => ({ x: p.x - minX, y: p.y - minY }))
			)
			setNodes((nds) => [
				...nds,
				{
					id: crypto.randomUUID(),
					type: 'curve',
					position: nz.position,
					width: nz.width,
					height: nz.height,
					zIndex: 0,
					data: { w: 'thin', pts: nz.pts },
					selected: true,
				},
			])
		}
		setCurveDraw(false)
		setCurvePts([])
		setCurveHover(null)
	}

	// 曲線描画モード中: Enterで確定、Escでキャンセル、
	// カーソル位置はグリッド吸着してプレビュー。
	// 確定は「最後と同じ点を再クリック」でも行う（onPaneClick側。
	// 連打が dblclick 判定されるため window dblclick は使わない）
	useEffect(() => {
		if (!curveDraw) return
		const onKey = (e: KeyboardEvent) => {
			if (e.key === 'Escape') {
				setCurveDraw(false)
				setCurvePts([])
				setCurveHover(null)
			} else if (e.key === 'Enter') {
				commitCurve()
			}
		}
		const onMove = (e: globalThis.MouseEvent) => {
			const p = rf.screenToFlowPosition({ x: e.clientX, y: e.clientY })
			setCurveHover({
				x: Math.round(p.x / GRID) * GRID,
				y: Math.round(p.y / GRID) * GRID,
			})
		}
		window.addEventListener('keydown', onKey)
		window.addEventListener('mousemove', onMove)
		return () => {
			window.removeEventListener('keydown', onKey)
			window.removeEventListener('mousemove', onMove)
		}
	}, [curveDraw, curvePts, rf])

	// Σボタン: ピース選択中は従来どおり即作成、未選択時は描画モードのON/OFF
	const onZoneButton = () => {
		if (nodes.some((n) => n.selected && n.type === 'vobject')) {
			setZoneDraw(false)
			createZone()
		} else {
			setZoneDraw((v) => !v)
		}
	}

	// ドキュメントのエクスポート / インポート（JSON）
	const exportDoc = () => {
		const doc = {
			app: 'sethera',
			version: 1,
			nodes: nodes.map(serializeNode),
			edges: edges.map(serializeEdge),
			viewport: rf.getViewport(),
			paper,
		}
		const blob = new Blob([JSON.stringify(doc, null, 2)], {
			type: 'application/json',
		})
		const url = URL.createObjectURL(blob)
		const a = document.createElement('a')
		a.href = url
		a.download = `sethera-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, '')}.json`
		a.click()
		URL.revokeObjectURL(url)
	}

	// ─── CSV/TSV 取込・書出（Excel との往復） ───
	// 取込: 行×列のピース群をビューポート中央に生成（数値列は数値ピース
	//  → ゾーン集計が即効く）。生成物は全選択状態で返す
	const importCsv = (rows: ParsedTable, colTypes: ColType[]) => {
		record('app')
		const c = viewportCenter()
		const g = (v: number) => Math.round(v / GRID) * GRID
		const ROW_H = 36 // vobject 既定高（3グリッド）
		const colW = (t: ColType) => (t === 'number' ? 132 : 240)
		const totalW = colTypes.reduce(
			(a, t) => a + (t === 'ignore' ? 0 : colW(t)),
			0
		)
		const x0 = g(c.x - totalW / 2)
		const y0 = g(c.y - (rows.length * ROW_H) / 2)
		const newNodes: BoardNode[] = []
		rows.forEach((r, ri) => {
			let x = x0
			colTypes.forEach((t, ci) => {
				if (t === 'ignore') return
				const w = colW(t)
				const cx = x
				x += w
				const cell = (r[ci] ?? '').slice(0, CSV_LIMITS.cellChars)
				if (cell.trim() === '') return
				const num = t === 'number' ? parseNumCell(cell) : null
				newNodes.push({
					id: crypto.randomUUID(),
					type: 'vobject',
					position: { x: cx, y: y0 + ri * ROW_H },
					width: w,
					height: ROW_H,
					zIndex: 1,
					selected: true,
					data:
						num !== null
							? {
									kind: 'number',
									label: '',
									value: num,
									color: 'yellow',
									align: 'r',
								}
							: {
									kind: 'text',
									label: cell,
									value: null,
									color: 'yellow',
									align: 'l',
								},
				} as VObjectNodeType)
			})
		})
		setNodes((nds) => [
			...nds.map((n) => (n.selected ? { ...n, selected: false } : n)),
			...newNodes,
		])
	}
	// 書出: 盤面配置から行列を再構成（計算は結果値、罫線・ゾーンは除外）
	const csvTargets = (scope: 'sel' | 'all') =>
		scope === 'sel' ? expandGroups(nodes.filter((n) => n.selected)) : nodes
	const copyCsvTsv = (scope: 'sel' | 'all') => {
		const table = gridCsv(nodes, edges, csvTargets(scope))
		void navigator.clipboard.writeText(toDelimited(table, '\t'))
		return table.length
	}
	const saveCsvFile = (scope: 'sel' | 'all') => {
		const table = gridCsv(nodes, edges, csvTargets(scope))
		// UTF-8 BOM 付き（日本の Excel が既定で正しく開ける形式）
		const blob = new Blob(['\uFEFF' + toDelimited(table, ',')], {
			type: 'text/csv;charset=utf-8',
		})
		const url = URL.createObjectURL(blob)
		const a = document.createElement('a')
		a.href = url
		a.download = `sethera-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, '')}.csv`
		a.click()
		URL.revokeObjectURL(url)
		return table.length
	}
	const csvScopeCount = (scope: 'sel' | 'all') =>
		csvTargets(scope).filter(
			(n) => n.type === 'vobject' || n.type === 'calc'
		).length

	const importDoc = (e: ChangeEvent<HTMLInputElement>) => {
		const f = e.currentTarget.files?.[0]
		e.currentTarget.value = ''
		if (!f) return
		f.text()
			.then((txt) => {
				const parsed = JSON.parse(txt)
				if (!Array.isArray(parsed?.nodes)) throw new Error('bad doc')
				record('app')
				const nextNodes = parsed.nodes.map(fixZoneSelectable)
				setNodes(nextNodes)
				setEdges(Array.isArray(parsed.edges) ? parsed.edges : [])
				if (parsed.paper && typeof parsed.paper === 'object') {
					setPaper({ ...DEFAULT_PAPER, ...parsed.paper })
				}
				// カスタム書体の未所持を警告（表示は既定フォントへフォールバック）
				const missing = missingFonts([
					parsed.paper?.font,
					...nextNodes.map((n: BoardNode) =>
						n.type === 'vobject' ? n.data.font : undefined
					),
				])
				if (missing.length > 0) {
					alert(
						t('この環境に無いフォントが使われています: {f}\n（既定フォントで表示されます）', {
							f: missing.join('、'),
						})
					)
				}
				if (typeof parsed.viewport?.zoom === 'number') {
					rf.setViewport(parsed.viewport)
				}
			})
			.catch(() =>
				alert(t('Sethera の JSON ファイルとして読み込めませんでした'))
			)
	}

	// ─── テンプレートライブラリ ─────────────────────────────
	// 文書とは別の localStorage キーに保存（文書を開き直しても残る）
	const [templates, setTemplates] = useState<Template[]>(loadTemplates)
	const persistTemplates = (ts: Template[]) => {
		setTemplates(ts)
		saveTemplates(ts)
	}
	// テンプレート保存対象はグループ展開後の個数。
	// 2以上なら「保存が目的」、0/1なら「参照・メンテが目的」とみなす
	const tplSaveCount = expandGroups(
		nodes.filter((n) => n.selected)
	).length

	// 選択（グループ含む）を相対座標に正規化して登録
	const saveAsTemplate = (name: string): boolean => {
		const sel = expandGroups(nodes.filter((n) => n.selected))
		if (sel.length === 0) return false
		const minX = Math.min(...sel.map((n) => n.position.x))
		const minY = Math.min(...sel.map((n) => n.position.y))
		persistTemplates([
			...templates,
			{
				id: crypto.randomUUID(),
				name: name.trim() || t('無題'),
				createdAt: new Date().toISOString().slice(0, 10),
				nodes: sel.map(
					(n) =>
						({
							...serializeNode(n),
							position: {
								x: n.position.x - minX,
								y: n.position.y - minY,
							},
							selected: false,
						}) as BoardNode
				),
				edges: innerEdges(sel).map(serializeEdge),
			},
		])
		return true
	}

	// 正規化座標の外接中央がビューポート中央に来る位置へ複製
	// （duplicate の idMap/gMap リマップで毎回独立した実体になる）
	const insertTemplate = (t: Template) => {
		const minX = Math.min(...t.nodes.map((n) => n.position.x))
		const minY = Math.min(...t.nodes.map((n) => n.position.y))
		const maxX = Math.max(
			...t.nodes.map((n) => n.position.x + (n.width ?? 0))
		)
		const maxY = Math.max(
			...t.nodes.map((n) => n.position.y + (n.height ?? 0))
		)
		const c = viewportCenter()
		duplicate(t.nodes, t.edges, true, {
			x: c.x - (minX + maxX) / 2,
			y: c.y - (minY + maxY) / 2,
		})
		setModal(null)
	}

	const renameTemplate = (id: string, name: string) => {
		persistTemplates(
			templates.map((t) => (t.id === id ? { ...t, name } : t))
		)
	}
	const deleteTemplate = (id: string) => {
		persistTemplates(templates.filter((t) => t.id !== id))
	}
	const exportTemplate = (t: Template) => {
		const doc = {
			app: 'sethera-template',
			version: 1,
			name: t.name,
			nodes: t.nodes,
			edges: t.edges,
		}
		const blob = new Blob([JSON.stringify(doc, null, 2)], {
			type: 'application/json',
		})
		const url = URL.createObjectURL(blob)
		const a = document.createElement('a')
		a.href = url
		a.download = `sethera-tpl-${t.name || 'template'}.json`
		a.click()
		URL.revokeObjectURL(url)
	}
	const importTemplate = (e: ChangeEvent<HTMLInputElement>) => {
		const f = e.currentTarget.files?.[0]
		e.currentTarget.value = ''
		if (!f) return
		f.text()
			.then((txt) => {
				const parsed = JSON.parse(txt)
				if (!Array.isArray(parsed?.nodes)) throw new Error('bad tpl')
				persistTemplates([
					...templates,
					{
						id: crypto.randomUUID(),
						name:
							typeof parsed.name === 'string' && parsed.name
								? parsed.name
								: t('読み込みテンプレート'),
						nodes: parsed.nodes,
						edges: Array.isArray(parsed.edges) ? parsed.edges : [],
					},
				])
			})
			.catch(() =>
				alert(t('テンプレートの JSON として読み込めませんでした'))
			)
	}

	// 用紙トグル（初回ON時にビューポート中央へ配置）
	const togglePaper = () => {
		record('app')
		if (!paper.on && !paper.placed) {
			const { w, h } = paperDims(paper)
			const c = viewportCenter()
			setPaper({
				...paper,
				on: true,
				placed: true,
				x: Math.round((c.x - w / 2) / GRID) * GRID,
				y: Math.round((c.y - h / 2) / GRID) * GRID,
			})
		} else {
			setPaper({ ...paper, on: !paper.on })
		}
	}

	// 全クリア＆リセット（確認モーダル経由。record済みなのでCtrl+Zで復元可）
	const clearAll = () => {
		record('app')
		setNodes([])
		setEdges([])
		setModal(null)
	}

	// モーダルをEscで閉じる
	useEffect(() => {
		if (!modal) return
		const onEsc = (e: KeyboardEvent) => {
			if (e.key === 'Escape') setModal(null)
		}
		window.addEventListener('keydown', onEsc)
		return () => window.removeEventListener('keydown', onEsc)
	}, [modal])

	// 罫線はドロップ時にグリッドへ吸着（ただしグリッド±2px内のみ。
	// 円弧端点への接合など、オブジェクトスナップで置かれた非グリッド
	// 位置は尊重する）
	const onNodeDragStop = useCallback(
		(_e: unknown, _n: BoardNode, dragged: BoardNode[]) => {
			const moved = new Set(
				dragged.filter((n) => n.type === 'line').map((n) => n.id)
			)
			if (moved.size === 0) return
			setNodes((nds) => {
				// 複数メンバーのグループは剛体移動済み。掴んだノードだけを
				// 個別に丸めると接合（円弧端点との0.75pxずれ等）が崩れる
				const seen = new Set<string>()
				const multi = new Set<string>()
				for (const n of nds) {
					const g = gidOf(n)
					if (!g) continue
					if (seen.has(g)) multi.add(g)
					else seen.add(g)
				}
				return nds.map((n) => {
					const g = gidOf(n)
					if (!moved.has(n.id) || (g && multi.has(g))) return n
					return {
						...n,
						position: {
							x: snapOrKeep(n.position.x),
							y: snapOrKeep(n.position.y),
						},
					}
				})
			})
		},
		[]
	)

	const selectedCount = nodes.filter(
		(n) => n.selected === true && n.type === 'vobject'
	).length
	const selNodes = nodes.filter((n) => n.selected === true)

	// プロパティペインからの一括適用。連続変更は 500ms 窓で履歴統合
	const applyData = useCallback(
		(ids: string[], patch: Record<string, unknown>) => {
			record('attr', 500)
			const set = new Set(ids)
			// ロック中のノードは属性を変更しない
			// （locked キー自体の変更=ロック/解除操作は許可）
			const allowLock = 'locked' in patch
			setNodes((nds) =>
				nds.map((n) =>
					set.has(n.id) && (allowLock || !lockedOf(n))
						? ({ ...n, data: { ...n.data, ...patch } } as BoardNode)
						: n
				)
			)
		},
		[record]
	)
	const applyNode = useCallback(
		(
			ids: string[],
			mk: (
				n: BoardNode
			) => Omit<Partial<BoardNode>, 'data'> & {
				data?: Record<string, unknown>
			}
		) => {
			record('attr', 500)
			const set = new Set(ids)
			setNodes((nds) =>
				nds.map((n) => {
					// ロック中は変更しない（locked キーを含む変更=解除操作は許可）
					if (!set.has(n.id)) return n
					const p = mk(n)
					if (lockedOf(n) && !(p.data && 'locked' in p.data)) return n
					return {
						...n,
						...p,
						data: { ...n.data, ...(p.data ?? {}) },
					} as BoardNode
				})
			)
		},
		[record]
	)

	return (
		<div
			className={`board${printImg ? ' hasimg' : ''}${theme !== 'standard' ? ` ${theme}` : ''}`}
			ref={wrapRef}
		>
			<HintContext.Provider
				value={useMemo(
					() => ({
						ids: hintedIds,
						partial: partialIds,
						group: groupSelIds,
						snapOn,
						dark: theme === 'dark',
						paperRect: paper.on
							? {
									minX: paper.x,
									minY: paper.y,
									maxX: paper.x + paperDims(paper).w,
									maxY: paper.y + paperDims(paper).h,
								}
							: null,
						docFont: paper.font,
						set: (ids: string[]) => setHintedIds(new Set(ids)),
						clear: () => setHintedIds(new Set()),
					}),
					[
						hintedIds,
						partialIds,
						groupSelIds,
						snapOn,
						theme,
						paper,
					]
				)}
			>
				<ReactFlow
					className={lineMode ? 'linemode' : undefined}
					nodes={nodes}
					edges={edges}
					nodeTypes={nodeTypes}
					onNodesChange={onNodesChange}
					onEdgesChange={onEdgesChange}
					onConnect={onConnect}
					onNodeDragStop={onNodeDragStop}
					panOnDrag={[1, 2]}
					selectionOnDrag
					selectionMode={SelectionMode.Partial}
					zoomOnScroll
					snapToGrid={snapOn}
					snapGrid={[GRID, GRID]}
					deleteKeyCode={['Backspace', 'Delete']}
					minZoom={0.2}
					maxZoom={3}
					onMoveEnd={(_e, vp) =>
						localStorage.setItem(VP_KEY, JSON.stringify(vp))
					}
					onSelectionStart={onSelectionStart}
					onSelectionEnd={onSelectionEnd}
					onNodeClick={onNodeClick}
					// RF 組み込みの矢印キー移動（a11y）は無効化。
					// F4 の矢印微移動（12px/Shift=1px）と二重に動くのを防ぐ
					disableKeyboardA11y
					// RF 組み込み要素（選択矩形・エッジ・ハンドル等）の明暗
					colorMode={theme === 'dark' ? 'dark' : 'light'}
					// 曲線描画中は既存ノードを誤って掴まないよう操作を抑止
					nodesDraggable={!curveDraw}
					elementsSelectable={!curveDraw}
					onPaneClick={(e) => {
						if (zoneDraw) setZoneDraw(false)
						if (curveDraw) {
							const p = rf.screenToFlowPosition({
								x: e.clientX,
								y: e.clientY,
							})
							const g = {
								x: Math.round(p.x / GRID) * GRID,
								y: Math.round(p.y / GRID) * GRID,
							}
							const last = curvePts[curvePts.length - 1]
							if (last && last.x === g.x && last.y === g.y) {
								// 最後と同じ点の再クリック（≈ダブルクリック）=確定
								if (curvePts.length >= 3) commitCurve()
								return
							}
							setCurvePts((pts) => [...pts, g])
						}
					}}
					{...(savedViewport ? { defaultViewport: savedViewport } : { fitView: true })}
				>
					{gridOn && (
						<Background
							variant={BackgroundVariant.Dots}
							gap={GRID}
							size={1.2}
							color={
								theme === 'dark'
									? '#454c5e'
									: theme === 'quiet'
										? '#cfc8ba'
										: undefined
							}
						/>
					)}
					{paper.on && (
						<PaperFrame
							cfg={paper}
							onChange={(cfg) => {
								record('paper', 600)
								setPaper(cfg)
							}}
						/>
					)}
				</ReactFlow>
				{(snapGuides || snapHud) &&
					(() => {
						const rect = wrapRef.current?.getBoundingClientRect()
						const toScreen = (fx: number, fy: number) => {
							const p = rf.flowToScreenPosition({ x: fx, y: fy })
							return {
								x: p.x - (rect?.left ?? 0),
								y: p.y - (rect?.top ?? 0),
							}
						}
						return (
							<div className="snaplayer">
								{snapGuides?.xs.map((x) => (
									<div
										key={`gx${x}`}
										className="snapguide v"
										style={{ left: toScreen(x, 0).x }}
									/>
								))}
								{snapGuides?.ys.map((y) => (
									<div
										key={`gy${y}`}
										className="snapguide h"
										style={{ top: toScreen(0, y).y }}
									/>
								))}
								{snapHud &&
									(() => {
										const p = toScreen(
											snapHud.x + snapHud.w,
											snapHud.y
										)
										return (
											<div
												className="snaphud"
												style={{ left: p.x + 8, top: p.y - 26 }}
											>
												{snapHud.kind === 'drag'
													? `${Math.round(snapHud.x)}, ${Math.round(snapHud.y)}`
													: `${Math.round(snapHud.w)}×${Math.round(snapHud.h)}`}
											</div>
										)
									})()}
							</div>
						)
					})()}
				{curveDraw && (
					<div className="curvehint">
						{t('曲線: クリックで頂点（3点以上）、同じ点の再クリック or Enter で確定、Escでキャンセル')}
					</div>
				)}
				{curveDraw &&
					curvePts.length > 0 &&
					(() => {
						const rect = wrapRef.current?.getBoundingClientRect()
						const toScreen = (fx: number, fy: number) => {
							const p = rf.flowToScreenPosition({ x: fx, y: fy })
							return {
								x: p.x - (rect?.left ?? 0),
								y: p.y - (rect?.top ?? 0),
							}
						}
						const all = curveHover
							? [...curvePts, curveHover]
							: curvePts
						return (
							<svg className="curvelayer">
								<polyline
									points={all
										.map((p) => {
											const s = toScreen(p.x, p.y)
											return `${s.x},${s.y}`
										})
										.join(' ')}
									fill="none"
									stroke="#6666cc"
									strokeWidth={1.5}
									strokeDasharray="6 4"
								/>
								{all.map((p, i) => {
									const s = toScreen(p.x, p.y)
									return (
										<circle
											key={i}
											cx={s.x}
											cy={s.y}
											r={3}
											fill={i === curvePts.length ? '#9999dd' : '#6666cc'}
										/>
									)
								})}
							</svg>
						)
					})()}
				{selNodes.length > 0 && (
					<Inspector
						sel={selNodes}
						nodes={nodes}
						edges={edges}
						applyData={applyData}
						applyNode={applyNode}
						onArray={arrayDup}
					/>
				)}
				<div
					className={`toolbar${tbCollapsed ? ' collapsed' : ''}${isDarkColor(tbColor) ? ' tb-dark' : ''}`}
					style={tbColor ? { background: tbColor } : undefined}
				>
					<button
						className="tbtoggle"
						title={
							tbCollapsed
								? t('ツールバーを展開')
								: t('ツールバーを折りたたむ')
						}
						onClick={() => setTbCollapsed((v) => !v)}
					>
						{tbCollapsed ? '»' : '«'}
					</button>
					<span className="brand">
						Sethera Piece <em>Visual Strategy Board</em>
					</span>
					<button
						className="tb-lang"
						title={t('言語を切り替え')}
						aria-label={t('言語を切り替え')}
						onClick={() =>
							setLang(resolvedLang() === 'en' ? 'ja' : 'en')
						}
					>
						{resolvedLang() === 'en' ? 'JA' : 'EN'}
					</button>
					<button data-icon={ic('付', '▣')} title={t('付箋＋数値ピース')} onClick={() => addObject('pair')}>
						{t('付箋＋数値')}
					</button>
					<button data-icon={ic('文', 'T')} title={t('テキストピース')} onClick={() => addObject('text')}>
						{t('テキスト')}
					</button>
					<button data-icon={ic('数', '№')} title={t('数値ピース')} onClick={() => addObject('number')}>
						{t('数値')}
					</button>
					<button data-icon={ic('計', 'ƒ')} onClick={addCalc} title={t('四則演算ピース（ピースの右の●から線を引いて繋ぐ）')}>
						{t('計算')}
					</button>
					<button data-icon="─" onClick={addLine} title={t('罫線（横長=水平線/縦長=垂直線。線は枠の上辺・左辺に引かれる。選択中に線種変更）')}>
						{t('罫線')}
					</button>
					<button data-icon="□" onClick={addRect} title={t('矩形罫線（4辺の枠。グリッド吸着で隣接矩形の辺が完全に重なる）')}>
						{t('矩形')}
					</button>
					<button
						data-icon="◯"
						onClick={addEllipse}
						title={t('楕円（w=h で正円。塗り・線種・二重線に対応）')}
					>
						{t('楕円')}
					</button>
					<button
						data-icon="╲"
						onClick={addDiag}
						title={t('斜線（枠の対角線。↗向きはペインで切替。端点装飾・線種・二重線に対応）')}
					>
						{t('斜線')}
					</button>
					<button
						data-icon="∿"
						className={curveDraw ? 'active' : ''}
						onClick={() => {
							if (curveDraw) {
								// 描画中の再クリック: 3点以上あれば確定、なければ取消
								if (curvePts.length >= 3) commitCurve()
								else {
									setCurveDraw(false)
									setCurvePts([])
									setCurveHover(null)
								}
							} else {
								setZoneDraw(false)
								setCurveDraw(true)
							}
						}}
						title={t('曲線を描画（クリックで頂点を打ち込み、同じ点の再クリック or Enter で確定。全点を通るスプライン）')}
					>
						{t('曲線')}
					</button>
					<button
						data-icon="✎"
						className={lineMode ? 'active' : ''}
						onClick={() => setLineMode((v) => !v)}
						title={t('線編集モード: ONの間は罫線だけを最前面で操作可能（他のピースはクリック不可・半透明）')}
					>
						{t('線編集')}
					</button>
					<button
						data-icon="Σ"
						className={zoneDraw ? 'active' : ''}
						title={
							selectedCount > 0
								? t('選択中のピースを囲む集計ゾーン')
								: t('集計ゾーンをドラッグで描画（対角2点を指定。Esc/クリックでキャンセル）')
						}
						onClick={onZoneButton}
					>
						{t('Σ 集計ゾーン')}
						{selectedCount > 0 ? ` (${selectedCount})` : ''}
					</button>
					<button
						data-icon="#"
						className={gridOn ? 'active' : ''}
						title={t('グリッド表示')}
						onClick={() => setGridOn(!gridOn)}
					>
						{t('グリッド')}
					</button>
					<button
						data-icon={ic('吸', '◈')}
						className={snapOn ? 'active' : ''}
						title={t('吸着: グリッド吸着＋他ピースの端点/中点/中心への吸着（ガイド線表示）')}
						onClick={() => setSnapOn(!snapOn)}
					>
						{t('吸着')}
					</button>
					<button
						data-icon={ic('紙', '▭')}
						className={paper.on ? 'active' : ''}
						title={t('用紙枠の表示（A4/B5/A3・縦横切替）')}
						onClick={togglePaper}
					>
						{t('用紙')}
					</button>
					<button data-icon={ic('印', '⎙')} onClick={doPrint} title={t('用紙枠（または全体）の範囲を印刷')}>
						{t('印刷')}
					</button>
					<button data-icon={ic('保', '⬇')} onClick={exportDoc} title={t('JSONファイルに保存')}>
						{t('保存')}
					</button>
					<button data-icon={ic('開', '⬆')} onClick={() => fileRef.current?.click()} title={t('JSONファイルを開く')}>
						{t('開く')}
					</button>
					<button
						data-icon={ic('表', '▦')}
						onClick={() => setModal('csv')}
						title={t('CSV/TSV の取込・書出（Excel のコピー貼り付け・ファイル読込・計算結果の引き渡し）')}
					>
						CSV
					</button>
					<button
						data-icon={ic('鋳', '⧉')}
						title={t('テンプレートライブラリ（選択を雛形として保存・呼び出し）')}
						onClick={() => setModal('templates')}
					>
						{t('テンプレ')}
					</button>
					<button
						data-icon="↩"
						disabled={histLen.past === 0}
						title={t('元に戻す (Ctrl+Z)')}
						onClick={undo}
					>
						↩ {t('戻す')}
					</button>
					<button
						data-icon="↪"
						disabled={histLen.future === 0}
						title={t('やり直し (Ctrl+Shift+Z / Ctrl+Y)')}
						onClick={redo}
					>
						↪ {t('やり直し')}
					</button>
					<button
						data-icon="⚙"
						title={t('設定')}
						onClick={() => setModal('settings')}
					>
						{t('設定')}
					</button>
					<button
						data-icon="i"
						title={t('このアプリについて')}
						onClick={() => setModal('about')}
					>
						About
					</button>
					<button
						data-icon="×"
						title={t('すべてのピース・罫線・接続を削除')}
						onClick={() => setModal('reset')}
					>
						{t('全消去')}
					</button>
					<input
						ref={fileRef}
						type="file"
						name="docfile"
						accept=".json,application/json"
						style={{ display: 'none' }}
						onChange={importDoc}
					/>
				</div>
				<div className="print-note">
					{t('印刷にはツールバーの「印刷」ボタン、または Ctrl+P をご利用ください（ブラウザの印刷メニューからの直接印刷には対応していません）')}
				</div>
				{printImg && (
					<div className="print-stage">
						<style>{`@page { size: ${printImg.page}; margin: 0 }`}</style>
						<img
							src={printImg.src}
							alt=""
							onLoad={() => setTimeout(() => window.print(), 50)}
						/>
					</div>
				)}
				{modal && (
					<div
						className="modal-back"
						onPointerDown={() => setModal(null)}
					>
						<div
							className={`modal${modal === 'csv' ? ' csv' : ''}`}
							onPointerDown={(e) => e.stopPropagation()}
						>
							{modal === 'about' ? (
								<>
									<h2>Sethera Piece</h2>
									<p className="modal-sub">
										セセラピース — Visual Strategy Board
									</p>
									<p>
										{t('セルではなくピースを自由に置いて計算する、ビジュアルボード。見積書や集計表を、空間にそのまま組み立てられます。')}
									</p>
									<dl className="modal-meta">
										<div>
											<dt>Version</dt>
											<dd>{APP_VERSION}</dd>
										</div>
										<div>
											<dt>License</dt>
											<dd>MIT</dd>
										</div>
										<div>
											<dt>Copyright</dt>
											<dd>© 2026 cuculhart</dd>
										</div>
										<div>
											<dt>Built with</dt>
											<dd>React Flow / Vite</dd>
										</div>
									</dl>
									<div className="modal-actions">
										<button onClick={() => setModal(null)}>
											{t('閉じる')}
										</button>
									</div>
								</>
							) : modal === 'settings' ? (
								<SettingsPane
									color={tbColor}
									onChange={applyTbColor}
									theme={theme}
									onTheme={applyTheme}
									lang={getLang()}
									onLang={setLang}
									font={paper.font ?? 'sans'}
									onFont={(f) => {
										record('paper', 600)
										setPaper({ ...paper, font: f === 'sans' ? undefined : f })
									}}
									onClose={() => setModal(null)}
								/>
							) : modal === 'templates' ? (
								<TemplatesPane
									templates={templates}
									saveCount={tplSaveCount}
									onSave={saveAsTemplate}
									onInsert={insertTemplate}
									onRename={renameTemplate}
									onDelete={deleteTemplate}
									onExport={exportTemplate}
									onImport={importTemplate}
									onClose={() => setModal(null)}
								/>
							) : modal === 'csv' ? (
								<CsvPane
									selCount={csvScopeCount('sel')}
									totalCount={csvScopeCount('all')}
									onImport={importCsv}
									onCopyTsv={copyCsvTsv}
									onSaveCsv={saveCsvFile}
									onClose={() => setModal(null)}
								/>
							) : (
								<>
									<h2>{t('すべて消去しますか？')}</h2>
									<p>
										{t('すべてのピース・罫線・計算・接続を削除します。')}
										<br />
										{t('この操作は Ctrl+Z で元に戻せます。')}
									</p>
									<div className="modal-actions">
										<button onClick={() => setModal(null)}>
											{t('キャンセル')}
										</button>
										<button
											className="danger"
											onClick={clearAll}
										>
											{t('全消去')}
										</button>
									</div>
								</>
							)}
						</div>
					</div>
				)}
			</HintContext.Provider>
		</div>
	)
}

/** 設定モーダル本体。将来の設定項目はここに行を足す */
function SettingsPane({
	color,
	onChange,
	theme,
	onTheme,
	lang,
	onLang,
	font,
	onFont,
	onClose,
}: {
	color: string
	onChange: (c: string) => void
	theme: Theme
	onTheme: (t: Theme) => void
	lang: Lang
	onLang: (l: Lang) => void
	/** 文書既定フォント（FONTS キー名 or カスタム書体名） */
	font: string
	onFont: (f: string) => void
	onClose: () => void
}) {
	const t = useT()
	const [draft, setDraft] = useState(color)
	const valid = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(draft)
	const pickValue = valid
		? draft.length === 4
			? `#${draft[1]}${draft[1]}${draft[2]}${draft[2]}${draft[3]}${draft[3]}`
			: draft
		: '#ffffff'
	return (
		<>
			<h2>{t('設定')}</h2>
			<div className="settings-row">
				<label htmlFor="tbcolor">{t('ツールバーの色')}</label>
				<input
					type="color"
					name="tbcolor-pick"
					value={pickValue}
					onChange={(e) => {
						setDraft(e.target.value)
						onChange(e.target.value)
					}}
				/>
				<input
					id="tbcolor"
					className={`settings-hex${draft && !valid ? ' invalid' : ''}`}
					value={draft}
					placeholder="#ffffff"
					onChange={(e) => {
						setDraft(e.target.value)
						const v = e.target.value.trim()
						if (/^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(v)) onChange(v)
					}}
				/>
				<button
					onClick={() => {
						setDraft('')
						onChange('')
					}}
				>
					{t('既定')}
				</button>
			</div>
			<div className="settings-row">
				<label htmlFor="theme">{t('テーマ')}</label>
				<select
					id="theme"
					className="insp-select"
					value={theme}
					onChange={(e) => onTheme(e.target.value as Theme)}
				>
					<option value="standard">{t('標準')}</option>
					<option value="quiet">
						{t('Quiet（UI の明度を抑える）')}
					</option>
					<option value="dark">{t('ダーク（暗い盤面）')}</option>
				</select>
			</div>
			<div className="settings-row">
				<label htmlFor="lang">{t('言語')}</label>
				<select
					id="lang"
					className="insp-select"
					value={lang}
					onChange={(e) => onLang(e.target.value as Lang)}
				>
					<option value="auto">{t('自動（ブラウザ）')}</option>
					<option value="ja">日本語</option>
					<option value="en">English</option>
				</select>
			</div>
			<div className="settings-row">
				<label htmlFor="docfont">{t('文書のフォント')}</label>
				<FontSelect
					id="docfont"
					value={font}
					onPick={onFont}
					allowInherit={false}
				/>
			</div>
			<div className="modal-actions">
				<button onClick={onClose}>{t('閉じる')}</button>
			</div>
		</>
	)
}

/** テンプレートライブラリのモーダル本体。
 *  保存・一覧・挿入・改名・削除・JSON 書出/読込 */
function TemplatesPane({
	templates,
	saveCount,
	onSave,
	onInsert,
	onRename,
	onDelete,
	onExport,
	onImport,
	onClose,
}: {
	templates: Template[]
	// グループ展開後の保存対象数。2以上=保存モード、0/1=ライブラリモード
	saveCount: number
	onSave: (name: string) => boolean
	onInsert: (t: Template) => void
	onRename: (id: string, name: string) => void
	onDelete: (id: string) => void
	onExport: (t: Template) => void
	onImport: (e: ChangeEvent<HTMLInputElement>) => void
	onClose: () => void
}) {
	const t = useT()
	const [name, setName] = useState('')
	const [editingId, setEditingId] = useState<string | null>(null)
	const [editName, setEditName] = useState('')
	const canSave = saveCount >= 2
	const doSave = () => {
		if (onSave(name)) setName('')
	}
	const commitRename = (t: Template) => {
		const v = editName.trim()
		if (v && v !== t.name) onRename(t.id, v)
		setEditingId(null)
	}
	return (
		<>
			<h2>{t('テンプレート')}</h2>
			<p className="modal-sub">
				{canSave
					? t('選択中の {n} ピースを雛形として保存します', {
							n: saveCount,
						})
					: t('雛形の呼び出し・管理（文書とは別に保管）。保存するには複数ピースを選んでから開いてください')}
			</p>
			{canSave && (
				<div className="tpl-save">
					<input
						className="insp-text"
						name="tpl-name"
						value={name}
						placeholder={t('新規テンプレート名')}
						onChange={(e) => setName(e.target.value)}
						onKeyDown={(e) => {
							if (e.key === 'Enter') doSave()
						}}
					/>
					<button onClick={doSave}>
						{t('選択×{n} を保存', { n: saveCount })}
					</button>
				</div>
			)}
			{templates.length === 0 ? (
				<p className="insp-hint">
					{t('まだテンプレートがありません。グループ化した明細行や罫線セットを登録すると、他の文書でも呼び出せます')}
				</p>
			) : (
				<ul className="tpl-list">
					{templates.map((tpl) => (
						<li key={tpl.id} className="tpl-row">
							{canSave ? (
								<span className="tpl-name">{tpl.name}</span>
							) : editingId === tpl.id ? (
								<input
									className="insp-text tpl-name-input"
									name="tpl-rename"
									value={editName}
									autoFocus
									onChange={(e) =>
										setEditName(e.target.value)
									}
									onBlur={() => commitRename(tpl)}
									onKeyDown={(e) => {
										if (e.key === 'Enter') commitRename(tpl)
										else if (e.key === 'Escape')
											setEditingId(null)
									}}
								/>
							) : (
								<span
									className="tpl-name"
									title={t('クリックで改名')}
									onClick={() => {
										setEditingId(tpl.id)
										setEditName(tpl.name)
									}}
								>
									{tpl.name}
								</span>
							)}
							<span className="tpl-count">
								{t('{n} ピース', { n: tpl.nodes.length })}
								{tpl.createdAt ? `・${tpl.createdAt}` : ''}
							</span>
							{!canSave && (
								<>
									<button onClick={() => onInsert(tpl)}>
										{t('挿入')}
									</button>
									<button
										onClick={() => onExport(tpl)}
										title={t('JSON ファイルに書き出し')}
									>
										{t('書出')}
									</button>
									<button
										className="danger"
										onClick={() => onDelete(tpl.id)}
									>
										{t('削除')}
									</button>
								</>
							)}
						</li>
					))}
				</ul>
			)}
			<div className="modal-actions">
				{canSave ? (
					<span className="insp-hint">
						{t('挿入・改名・書出・削除は選択を解除してから開いてください')}
					</span>
				) : (
					<label className="tpl-import">
						{t('JSON から読み込み')}
						<input
							type="file"
							name="tpl-file"
							accept=".json,application/json"
							style={{ display: 'none' }}
							onChange={onImport}
						/>
					</label>
				)}
				<button onClick={onClose}>{t('閉じる')}</button>
			</div>
		</>
	)
}
