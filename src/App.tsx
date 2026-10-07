import {
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
	type ChangeEvent,
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
import { LineNode } from './nodes/line-node'
import { VObjectNode } from './nodes/vobject-node'
import { HintContext } from './hint-context'
import type { BoardNode, VObjectKind, VObjectNodeType } from './nodes/types'

const GRID = 24
const DOC_KEY = 'sethera-doc'
const VP_KEY = 'sethera-viewport'

const nodeTypes = {
	vobject: VObjectNode,
	zone: AggZoneNode,
	calc: CalcNode,
	line: LineNode,
}

function loadDoc(): { nodes: BoardNode[]; edges: Edge[]; paper: PaperCfg } {
	try {
		const raw = localStorage.getItem(DOC_KEY)
		if (!raw) return { nodes: [], edges: [], paper: DEFAULT_PAPER }
		const parsed = JSON.parse(raw)
		return {
			nodes: Array.isArray(parsed?.nodes) ? parsed.nodes : [],
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
	const [doc] = useState(loadDoc)
	const [nodes, setNodes] = useState<BoardNode[]>(doc.nodes)
	const [edges, setEdges] = useState<Edge[]>(doc.edges)
	const [paper, setPaper] = useState<PaperCfg>(doc.paper)
	const [gridOn, setGridOn] = useState(true)
	const [snapOn, setSnapOn] = useState(false)
	const [hintedIds, setHintedIds] = useState<ReadonlySet<string>>(new Set())
	const rf = useReactFlow<BoardNode>()
	const wrapRef = useRef<HTMLDivElement>(null)
	const fileRef = useRef<HTMLInputElement>(null)
	const clipboard = useRef<{ nodes: BoardNode[]; edges: Edge[] }>({
		nodes: [],
		edges: [],
	})
	const savedViewport = useMemo(loadViewport, [])

	const onNodesChange = useCallback(
		(changes: NodeChange<BoardNode>[]) =>
			setNodes((nds) => applyNodeChanges(changes, nds)),
		[]
	)
	const onEdgesChange = useCallback(
		(changes: EdgeChange<Edge>[]) =>
			setEdges((es) => applyEdgeChanges(changes, es)),
		[]
	)
	const onConnect = useCallback((conn: Connection) => {
		if (!conn.source || !conn.target || conn.source === conn.target) return
		if (conn.targetHandle !== 'a' && conn.targetHandle !== 'b') return
		setEdges((es) =>
			addEdge(
				{ ...conn, markerEnd: { type: MarkerType.ArrowClosed } },
				es.filter(
					(e) =>
						!(e.target === conn.target && e.targetHandle === conn.targetHandle)
				)
			)
		)
	}, [])

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

	// Ctrl+C / Ctrl+V / Ctrl+D（選択ノード間のエッジも一緒に複製）
	useEffect(() => {
		const innerEdges = (sel: BoardNode[]) => {
			const ids = new Set(sel.map((n) => n.id))
			return rf
				.getEdges()
				.filter((e) => ids.has(e.source) && ids.has(e.target))
		}
		const duplicate = (
			srcNodes: BoardNode[],
			srcEdges: Edge[],
			select: boolean
		) => {
			if (srcNodes.length === 0) return
			const idMap = new Map(srcNodes.map((n) => [n.id, crypto.randomUUID()]))
			setNodes((nds) => [
				...(select ? nds.map((n) => ({ ...n, selected: false })) : nds),
				...srcNodes.map((n) => ({
					...serializeNode(n),
					id: idMap.get(n.id)!,
					position: { x: n.position.x + 32, y: n.position.y + 32 },
					selected: select,
				})),
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
		const onKey = (e: KeyboardEvent) => {
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
			if (!(e.ctrlKey || e.metaKey)) return
			const key = e.key.toLowerCase()
			if (key === 'c') {
				const sel = rf.getNodes().filter((n) => n.selected)
				clipboard.current = { nodes: sel, edges: innerEdges(sel) }
			} else if (key === 'd') {
				e.preventDefault()
				const sel = rf.getNodes().filter((n) => n.selected)
				duplicate(sel, innerEdges(sel), false)
			} else if (key === 'v') {
				duplicate(clipboard.current.nodes, clipboard.current.edges, true)
			}
		}
		window.addEventListener('keydown', onKey)
		return () => window.removeEventListener('keydown', onKey)
	}, [rf])

	const viewportCenter = () => {
		const rect = wrapRef.current?.getBoundingClientRect()
		return rf.screenToFlowPosition({
			x: (rect?.left ?? 0) + (rect?.width ?? window.innerWidth) / 2,
			y: (rect?.top ?? 0) + (rect?.height ?? window.innerHeight) / 2,
		})
	}

	const addObject = (kind: VObjectKind) => {
		const c = viewportCenter()
		const n = nodes.filter((s) => s.type === 'vobject').length
		const offset = (n % 8) * 28
		const node: VObjectNodeType = {
			id: crypto.randomUUID(),
			type: 'vobject',
			position: { x: c.x - 110 + offset, y: c.y - 32 + offset },
			width: 220,
			height: 64,
			zIndex: 1,
			data: {
				kind,
				label: kind === 'number' ? '' : 'テキスト',
				value: kind === 'text' ? null : 0,
				color: 'yellow',
			},
		}
		setNodes((nds) => [...nds, node])
	}

	const addCalc = () => {
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
				data: { op: 'mul', round: 'none', constA: null, constB: null },
			},
		])
	}

	const addLine = () => {
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

	const createZone = () => {
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
					data: { fn: 'sum', labelPos: 'bottom' },
				},
			])
		} else {
			const c = viewportCenter()
			setNodes((nds) => [
				...nds,
				{
					id,
					type: 'zone',
					position: { x: c.x - 160, y: c.y - 120 },
					width: 320,
					height: 240,
					zIndex: 0,
					dragHandle: '.aggzone-header',
					data: { fn: 'sum', labelPos: 'bottom' },
				},
			])
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

	const importDoc = (e: ChangeEvent<HTMLInputElement>) => {
		const f = e.currentTarget.files?.[0]
		e.currentTarget.value = ''
		if (!f) return
		f.text()
			.then((t) => {
				const parsed = JSON.parse(t)
				if (!Array.isArray(parsed?.nodes)) throw new Error('bad doc')
				setNodes(parsed.nodes)
				setEdges(Array.isArray(parsed.edges) ? parsed.edges : [])
				if (parsed.paper && typeof parsed.paper === 'object') {
					setPaper({ ...DEFAULT_PAPER, ...parsed.paper })
				}
				if (typeof parsed.viewport?.zoom === 'number') {
					rf.setViewport(parsed.viewport)
				}
			})
			.catch(() => alert('Sethera の JSON ファイルとして読み込めませんでした'))
	}

	// 用紙トグル（初回ON時にビューポート中央へ配置）
	const togglePaper = () => {
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
				width: bounds.width * SCALE,
				height: bounds.height * SCALE,
				style: {
					width: `${bounds.width * SCALE}px`,
					height: `${bounds.height * SCALE}px`,
					transform: `translate(${vp.x}px, ${vp.y}px) scale(${vp.zoom})`,
				},
			})
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

	// 罫線はドロップ時に常にグリッドへ吸着
	const onNodeDragStop = useCallback(
		(_e: unknown, _n: BoardNode, dragged: BoardNode[]) => {
			const moved = new Set(
				dragged.filter((n) => n.type === 'line').map((n) => n.id)
			)
			if (moved.size === 0) return
			setNodes((nds) =>
				nds.map((n) =>
					moved.has(n.id)
						? {
								...n,
								position: {
									x: Math.round(n.position.x / GRID) * GRID,
									y: Math.round(n.position.y / GRID) * GRID,
								},
							}
						: n
				)
			)
		},
		[]
	)

	const selectedCount = nodes.filter(
		(n) => n.selected === true && n.type === 'vobject'
	).length

	return (
		<div className="board" ref={wrapRef}>
			<HintContext.Provider
				value={useMemo(
					() => ({
						ids: hintedIds,
						set: (ids: string[]) => setHintedIds(new Set(ids)),
						clear: () => setHintedIds(new Set()),
					}),
					[hintedIds]
				)}
			>
				<ReactFlow
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
					{...(savedViewport ? { defaultViewport: savedViewport } : { fitView: true })}
				>
					{gridOn && (
						<Background variant={BackgroundVariant.Dots} gap={GRID} size={1.5} />
					)}
					{paper.on && <PaperFrame cfg={paper} onChange={setPaper} />}
				</ReactFlow>
				<div className="toolbar">
					<span className="brand">
						セセラピース <em>Visual Strategy Board</em>
					</span>
					<button onClick={() => addObject('pair')}>付箋＋数値</button>
					<button onClick={() => addObject('text')}>テキスト</button>
					<button onClick={() => addObject('number')}>数値</button>
					<button onClick={addCalc} title="四則演算ピース（ピースの右の●から線を引いて繋ぐ）">
						計算
					</button>
					<button onClick={addLine} title="罫線（横長=水平線/縦長=垂直線。線は枠の上辺・左辺に引かれる。選択中に線種変更）">
						罫線
					</button>
					<button onClick={createZone}>
						Σ 集計ゾーン{selectedCount > 0 ? ` (${selectedCount})` : ''}
					</button>
					<button
						className={gridOn ? 'active' : ''}
						title="グリッド表示"
						onClick={() => setGridOn(!gridOn)}
					>
						グリッド
					</button>
					<button
						className={snapOn ? 'active' : ''}
						title="グリッドへの吸着"
						onClick={() => setSnapOn(!snapOn)}
					>
						吸着
					</button>
					<button
						className={paper.on ? 'active' : ''}
						title="用紙枠の表示（A4/B5/A3・縦横切替）"
						onClick={togglePaper}
					>
						用紙
					</button>
					<button onClick={doPrint} title="用紙枠（または全体）の範囲を印刷">
						印刷
					</button>
					<button onClick={exportDoc} title="JSONファイルに保存">
						保存
					</button>
					<button onClick={() => fileRef.current?.click()} title="JSONファイルを開く">
						開く
					</button>
					<input
						ref={fileRef}
						type="file"
						accept=".json,application/json"
						style={{ display: 'none' }}
						onChange={importDoc}
					/>
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
			</HintContext.Provider>
		</div>
	)
}
