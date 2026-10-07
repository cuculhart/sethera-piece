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

type Snapshot = { nodes: BoardNode[]; edges: Edge[]; paper: PaperCfg }

const GRID = 12
const HIST_MAX = 100
const APP_VERSION = '0.1.0'
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
	const [lineMode, setLineMode] = useState(false)
	const [tbCollapsed, setTbCollapsed] = useState(false)
	const [modal, setModal] = useState<'about' | 'reset' | null>(null)
	const [hintedIds, setHintedIds] = useState<ReadonlySet<string>>(new Set())
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
	const snapRef = useRef<Snapshot | null>(null)
	snapRef.current = { nodes, edges, paper }
	const lastRec = useRef({ t: 0, key: '' })
	const dragRec = useRef(false)
	const resizeRec = useRef(false)

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
			let recKey = ''
			for (const c of changes) {
				if (c.type === 'select') continue
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
			setNodes((nds) => applyNodeChanges(changes, nds))
		},
		[record]
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
			record('app')
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
			position: { x: c.x - 100 + offset, y: c.y - 20 + offset },
			width: 200,
			height: 40,
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
				data: { op: 'mul', round: 'none', constA: null, constB: null },
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
				record('app')
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
		<div className={printImg ? 'board hasimg' : 'board'} ref={wrapRef}>
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
					{...(savedViewport ? { defaultViewport: savedViewport } : { fitView: true })}
				>
					{gridOn && (
						<Background variant={BackgroundVariant.Dots} gap={GRID} size={1.2} />
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
				<div className={tbCollapsed ? 'toolbar collapsed' : 'toolbar'}>
					<button
						className="tbtoggle"
						title={tbCollapsed ? 'ツールバーを展開' : 'ツールバーを折りたたむ'}
						onClick={() => setTbCollapsed((v) => !v)}
					>
						{tbCollapsed ? '»' : '«'}
					</button>
					<span className="brand">
						Sethera Piece <em>Visual Strategy Board</em>
					</span>
					<button data-icon="付" title="付箋＋数値ピース" onClick={() => addObject('pair')}>
						付箋＋数値
					</button>
					<button data-icon="文" title="テキストピース" onClick={() => addObject('text')}>
						テキスト
					</button>
					<button data-icon="数" title="数値ピース" onClick={() => addObject('number')}>
						数値
					</button>
					<button data-icon="計" onClick={addCalc} title="四則演算ピース（ピースの右の●から線を引いて繋ぐ）">
						計算
					</button>
					<button data-icon="─" onClick={addLine} title="罫線（横長=水平線/縦長=垂直線。線は枠の上辺・左辺に引かれる。選択中に線種変更）">
						罫線
					</button>
					<button
						data-icon="✎"
						className={lineMode ? 'active' : ''}
						onClick={() => setLineMode((v) => !v)}
						title="線編集モード: ONの間は罫線だけを最前面で操作可能（他のピースはクリック不可・半透明）"
					>
						線編集
					</button>
					<button data-icon="Σ" title="選択中のピースを囲む集計ゾーン" onClick={createZone}>
						Σ 集計ゾーン{selectedCount > 0 ? ` (${selectedCount})` : ''}
					</button>
					<button
						data-icon="#"
						className={gridOn ? 'active' : ''}
						title="グリッド表示"
						onClick={() => setGridOn(!gridOn)}
					>
						グリッド
					</button>
					<button
						data-icon="吸"
						className={snapOn ? 'active' : ''}
						title="グリッドへの吸着"
						onClick={() => setSnapOn(!snapOn)}
					>
						吸着
					</button>
					<button
						data-icon="紙"
						className={paper.on ? 'active' : ''}
						title="用紙枠の表示（A4/B5/A3・縦横切替）"
						onClick={togglePaper}
					>
						用紙
					</button>
					<button data-icon="印" onClick={doPrint} title="用紙枠（または全体）の範囲を印刷">
						印刷
					</button>
					<button data-icon="保" onClick={exportDoc} title="JSONファイルに保存">
						保存
					</button>
					<button data-icon="開" onClick={() => fileRef.current?.click()} title="JSONファイルを開く">
						開く
					</button>
					<button
						data-icon="↩"
						disabled={histLen.past === 0}
						title="元に戻す (Ctrl+Z)"
						onClick={undo}
					>
						↩ 戻す
					</button>
					<button
						data-icon="↪"
						disabled={histLen.future === 0}
						title="やり直し (Ctrl+Shift+Z / Ctrl+Y)"
						onClick={redo}
					>
						↪ やり直し
					</button>
					<button
						data-icon="i"
						title="このアプリについて"
						onClick={() => setModal('about')}
					>
						About
					</button>
					<button
						data-icon="×"
						title="すべてのピース・罫線・接続を削除"
						onClick={() => setModal('reset')}
					>
						全消去
					</button>
					<input
						ref={fileRef}
						type="file"
						accept=".json,application/json"
						style={{ display: 'none' }}
						onChange={importDoc}
					/>
				</div>
				<div className="print-note">
					印刷にはツールバーの「印刷」ボタン、または Ctrl+P
					をご利用ください（ブラウザの印刷メニューからの直接印刷には対応していません）
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
							className="modal"
							onPointerDown={(e) => e.stopPropagation()}
						>
							{modal === 'about' ? (
								<>
									<h2>Sethera Piece</h2>
									<p className="modal-sub">
										セセラピース — Visual Strategy Board
									</p>
									<p>
										セルではなくピースを自由に置いて計算する、
										ビジュアルボード。見積書や集計表を、
										空間にそのまま組み立てられます。
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
											閉じる
										</button>
									</div>
								</>
							) : (
								<>
									<h2>すべて消去しますか？</h2>
									<p>
										すべてのピース・罫線・計算・接続を削除します。
										<br />
										この操作は Ctrl+Z で元に戻せます。
									</p>
									<div className="modal-actions">
										<button onClick={() => setModal(null)}>
											キャンセル
										</button>
										<button
											className="danger"
											onClick={clearAll}
										>
											全消去
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
