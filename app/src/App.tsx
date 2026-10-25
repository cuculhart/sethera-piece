import {
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
	type ChangeEvent,
	type PointerEvent as RPointerEvent,
} from 'react'
import { flushSync } from 'react-dom'
import { toPng } from 'html-to-image'
import type { Doc, Edge, Pt, WorldObject } from '@kimetron/core'
import { moveObjects } from '@kimetron/core'
import { IsleCanvas, useEngine, useEngineVersion } from '@kimetron/react'
import { BoardContext, type BoardApi } from './board-context'
import { HintContext } from './hint-context'
import { Inspector, type ApplyData, type ApplyNode } from './inspector'
import { CsvPane } from './csv-pane'
import { PaperFrame } from './paper-frame'
import { FontSelect } from './font-select'
import { renderObject } from './parts'
import {
	canConnect,
	connectOrient,
	connectReplace,
	makeCalc,
	makePiece,
	makeSpline,
	makeStroke,
	makeZone,
	rewirePickup,
	WIRE_DEFAULTS,
} from './model'
import {
	DOC_KEY,
	VP_KEY,
	docToStored,
	duplicateParts,
	edgeToSEdge,
	expandGroups,
	innerEdges,
	loadStoredDoc,
	loadViewport,
	newId,
	nodeToObject,
	objectToNode,
	pageOf,
	patchObject,
	sedgeToEdge,
	storedToDoc,
} from './lib/docio'
import { DEFAULT_PAPER, paperDims, type PaperCfg } from './lib/paper'
import { GRID } from './colors'
import { objectValue, zonePartialIds } from './lib/calc'
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
import { getLang, resolvedLang, setLang, useT, type Lang } from './i18n'
import type { VObjectKind } from './types'
import './styles.css'

const APP_VERSION = '2.0.0'
const TB_COLOR_KEY = 'sethera-toolbar-color'
const QUIET_KEY = 'sethera-quiet'
const THEME_KEY = 'sethera-theme'
type Theme = 'standard' | 'quiet' | 'dark'

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

const DOT_COLOR: Record<Theme, string> = {
	standard: '#b7b0a2',
	quiet: '#cfc8ba',
	dark: '#454c5e',
}

export default function App() {
	return (
		<div className="app">
			<Board />
		</div>
	)
}

function Board() {
	const t = useT()
	// 折りたたみツールバーのアイコン用。漢字グリフは英語UIでは記号に切替
	const ic = (ja: string, en: string) => (resolvedLang() === 'en' ? en : ja)

	const engine = useEngine({
		units: 'px',
		origin: 'top-left',
		grid: { size: GRID, snap: false },
	})
	useEngineVersion(engine)
	const doc = engine.doc

	const initial = useMemo(loadStoredDoc, [])
	const [paper, setPaperState] = useState<PaperCfg>(initial.paper)
	const paperRef = useRef(paper)
	const setPaper = useCallback((p: PaperCfg) => {
		paperRef.current = p
		setPaperState(p)
	}, [])
	const [gridOn, setGridOn] = useState(true)
	const [snapOn, setSnapOn] = useState(false)
	// リレーション線＋ポートの表示（完成図モード）。印刷とは独立
	const [wiresOn, setWiresOn] = useState(
		() => localStorage.getItem('sethera-wires') !== '0'
	)
	const toggleWires = () => {
		setWiresOn((v) => {
			localStorage.setItem('sethera-wires', v ? '0' : '1')
			return !v
		})
	}
	const [lineMode, setLineMode] = useState(false)
	const [zoneDraw, setZoneDraw] = useState(false)
	const [curveDraw, setCurveDraw] = useState(false)
	const [curvePts, setCurvePts] = useState<Pt[]>([])
	const [curveHover, setCurveHover] = useState<Pt | null>(null)
	const [zoneRect, setZoneRect] = useState<{
		a: Pt
		b: Pt
	} | null>(null)
	const [tbCollapsed, setTbCollapsed] = useState(false)
	const [modal, setModal] = useState<
		'about' | 'reset' | 'settings' | 'templates' | 'csv' | null
	>(null)
	const [tbColor, setTbColor] = useState(
		() => localStorage.getItem(TB_COLOR_KEY) ?? ''
	)
	// テーマ: 標準／Quiet（UI明度抑制）／ダーク（CAD風の暗い盤面）
	const [theme, setTheme] = useState<Theme>(() => {
		const v = localStorage.getItem(THEME_KEY)
		if (v === 'dark' || v === 'quiet') return v
		if (localStorage.getItem(QUIET_KEY) === '1') return 'quiet'
		return 'standard'
	})
	const applyTheme = (v: Theme) => {
		setTheme(v)
		if (v === 'standard') localStorage.removeItem(THEME_KEY)
		else localStorage.setItem(THEME_KEY, v)
		if (v === 'quiet') localStorage.setItem(QUIET_KEY, '1')
		else localStorage.removeItem(QUIET_KEY)
	}
	const applyTbColor = (c: string) => {
		setTbColor(c)
		if (c) localStorage.setItem(TB_COLOR_KEY, c)
		else localStorage.removeItem(TB_COLOR_KEY)
	}
	const [hintedIds, setHintedIds] = useState<ReadonlySet<string>>(new Set())
	const [selIds, setSelIds] = useState<ReadonlySet<string>>(new Set())
	const wrapRef = useRef<HTMLDivElement>(null)
	const fileRef = useRef<HTMLInputElement>(null)
	const tplFileRef = useRef<HTMLInputElement>(null)
	const clipboard = useRef<{ objects: WorldObject[]; edges: Edge[] }>({
		objects: [],
		edges: [],
	})

	// ── エンジンの配線フック ──────────────────────────────
	useEffect(() => {
		engine.connectEdge = WIRE_DEFAULTS
		engine.canConnect = canConnect
		engine.connectReplace = (_from, to) =>
			connectReplace(engine.doc.edges, to)
		engine.connectOrient = connectOrient
		engine.rewireEdge = (ep) => rewirePickup(ep, engine.doc.edges)
	}, [engine])

	// ── ヒットフィルタ ──────────────────────────────────
	// ゾーンは常にヒット対象外（ボディはマーキーにスルー。選択・移動は
	// ヘッダーの独自ハンドラ）。線編集モードは罫線のみヒット
	useEffect(() => {
		engine.hitFilter = (o) =>
			lineMode ? o.kind === 'stroke' : o.kind !== 'zone'
		engine.marqueeFilter = (o) =>
			lineMode ? o.kind === 'stroke' : o.kind !== 'zone'
		// 通常モード: 重なりでは罫線・曲線より他オブジェクトを優先ヒット
		engine.hitPriority = lineMode
			? undefined
			: (o) => (o.kind === 'stroke' || o.kind === 'spline' ? 0 : 1)
		engine.snapObjects = snapOn
		engine.setGrid({ snap: snapOn })
		// 線非表示モードでは見えないワイヤーをヒットさせない
		engine.edgeFilter = wiresOn ? undefined : () => false
	}, [engine, lineMode, snapOn, wiresOn])

	// ── 吸着ターゲット（曲線頂点・円弧端点。用紙辺/中心と通常の
	//    オブジェクト辺はエンジン側で生成される） ──────────────
	useEffect(() => {
		const xs: number[] = []
		const ys: number[] = []
		for (const o of doc.objects) {
			if (o.kind === 'spline') {
				for (const p of (o.data as { pts?: { fx: number; fy: number }[] })
					.pts ?? []) {
					xs.push(o.x + p.fx * o.w)
					ys.push(o.y + p.fy * o.h)
				}
			}
			if (o.kind === 'stroke') {
				const d = o.data as {
					arc?: boolean
					arcStart?: number
					arcEnd?: number
					arcCcw?: boolean
				}
				if (d.arc) {
					const cx = o.x + o.w / 2
					const cy = o.y + o.h / 2
					const sy = d.arcCcw !== false ? -1 : 1
					for (const deg of [d.arcStart ?? 0, d.arcEnd ?? 270]) {
						const a = (deg * Math.PI) / 180
						xs.push(cx + (o.w / 2) * Math.cos(a))
						ys.push(cy + (o.h / 2) * Math.sin(a) * sy)
					}
				}
			}
		}
		engine.snapExtra = { xs, ys }
	}, [engine, doc.objects])

	// ── 初期文書のロード ─────────────────────────────────
	const loaded = useRef(false)
	useEffect(() => {
		if (loaded.current) return
		loaded.current = true
		engine.setDoc(initial.doc)
		const vp = loadViewport()
		if (vp) {
			engine.viewport = vp
			engine.patchDoc(engine.doc)
		}
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [engine])

	// ── localStorage 自動保存（debounce）＋ビューポート保存 ──
	useEffect(() => {
		let tm: ReturnType<typeof setTimeout> | null = null
		const off = engine.onDocChange((d) => {
			if (tm) clearTimeout(tm)
			tm = setTimeout(() => {
				localStorage.setItem(
					DOC_KEY,
					JSON.stringify(docToStored(d, paperRef.current))
				)
			}, 300)
		})
		return () => {
			off()
			if (tm) clearTimeout(tm)
		}
	}, [engine])
	useEffect(() => {
		let tm: ReturnType<typeof setTimeout> | null = null
		const off = engine.subscribe(() => {
			if (tm) clearTimeout(tm)
			tm = setTimeout(() => {
				localStorage.setItem(VP_KEY, JSON.stringify(engine.viewport))
			}, 500)
		})
		return () => {
			off()
			if (tm) clearTimeout(tm)
		}
	}, [engine])

	// ── 座標変換（クライアント px → ワールド） ──────────────
	const worldPt = useCallback(
		(cx: number, cy: number): Pt => {
			const r = wrapRef.current?.getBoundingClientRect()
			return engine.screenToWorld({
				x: cx - (r?.left ?? 0),
				y: cy - (r?.top ?? 0),
			})
		},
		[engine]
	)
	const viewportCenter = useCallback((): Pt => {
		const r = wrapRef.current?.getBoundingClientRect()
		return engine.screenToWorld({
			x: (r?.width ?? window.innerWidth) / 2,
			y: (r?.height ?? window.innerHeight) / 2,
		})
	}, [engine])

	// ── Inspector からの適用（1 setDoc = 1 undo） ────────────
	const applyData = useCallback<ApplyData>(
		(ids, patch) => {
			const set = new Set(ids)
			engine.setDoc({
				...engine.doc,
				objects: engine.doc.objects.map((o) =>
					set.has(o.id) && ('locked' in patch || !o.locked)
						? patchObject(o, patch)
						: o
				),
			})
		},
		[engine]
	)
	const applyNode = useCallback<ApplyNode>(
		(ids, mk) => {
			const set = new Set(ids)
			engine.setDoc({
				...engine.doc,
				objects: engine.doc.objects.map((o) => {
					if (!set.has(o.id)) return o
					const p = mk(o)
					const { data, ...rest } = p
					if (
						o.locked &&
						!('locked' in rest) &&
						!(data && 'locked' in data)
					)
						return o
					return {
						...o,
						...rest,
						data: {
							...(o.data as Record<string, unknown>),
							...(data ?? {}),
						},
					}
				}),
			})
		},
		[engine]
	)

	// ── BoardContext（renderObject 内の部品が使う API） ────────
	const api = useMemo<BoardApi>(
		() => ({
			doc,
			selIds,
			engine,
			dark: theme === 'dark',
			snapOn,
			paperRect: paper.on
				? {
						minX: paper.x,
						minY: paper.y,
						maxX: paper.x + paperDims(paper).w,
						maxY: paper.y + paperDims(paper).h,
					}
				: null,
			docFont: paper.font,
			updateData: (id, patch) => applyData([id], patch),
			updateObject: (id, patch) => applyNode([id], () => patch),
			liveData: (id, patch) =>
				engine.patchDoc({
					...engine.doc,
					objects: engine.doc.objects.map((o) =>
						o.id === id ? patchObject(o, patch) : o
					),
				}),
			liveSize: (id, size) =>
				engine.patchDoc({
					...engine.doc,
					objects: engine.doc.objects.map((o) =>
						o.id === id ? { ...o, ...size } : o
					),
				}),
			commitDoc: () => engine.commitDoc(),
			worldPt,
		}),
		[
			doc,
			selIds,
			engine,
			theme,
			snapOn,
			paper,
			applyData,
			applyNode,
			worldPt,
		]
	)

	// ── オブジェクト追加 ──────────────────────────────────
	const addObj = (o: WorldObject) => {
		engine.setDoc({ ...engine.doc, objects: [...engine.doc.objects, o] })
		engine.setSelection([o.id])
	}
	const addPiece = (kind: VObjectKind) => {
		const c = viewportCenter()
		const n = engine.doc.objects.filter((o) => o.kind === 'piece').length
		const off = (n % 8) * 28
		addObj(makePiece(kind, c.x - 60 + off, c.y - 20 + off))
	}
	const addCalc = () => {
		const c = viewportCenter()
		const n = engine.doc.objects.filter((o) => o.kind === 'calc').length
		const off = (n % 8) * 28
		addObj(makeCalc(c.x - 90 + off, c.y + 60 + off))
	}
	const addStroke = (data: { [k: string]: unknown }, w: number, h: number, dx: number, dy: number) => {
		const c = viewportCenter()
		addObj(makeStroke(c.x + dx, c.y + dy, w, h, data as never))
	}
	const addLine = () => addStroke({ w: 'thin' }, 240, GRID, -120, 120)
	const addRect = () => addStroke({ w: 'thin', rect: true }, 240, 180, -120, -90)
	const addEllipse = () =>
		addStroke({ w: 'thin', ellipse: true }, 240, 180, -120, -90)
	const addDiag = () =>
		addStroke({ w: 'thin', diag: 'down' }, 180, 120, -90, -60)

	// ── Σゾーン ──────────────────────────────────────────
	const createZone = () => {
		const sel = engine.doc.objects.filter(
			(o) => selIds.has(o.id) && o.kind === 'piece'
		)
		if (sel.length === 0) return
		const minX = Math.min(...sel.map((o) => o.x))
		const minY = Math.min(...sel.map((o) => o.y))
		const maxX = Math.max(...sel.map((o) => o.x + o.w))
		const maxY = Math.max(...sel.map((o) => o.y + o.h))
		const z = makeZone(minX - 24, minY - 56, maxX - minX + 48, maxY - minY + 80)
		addObj(z)
	}
	const onZoneButton = () => {
		if (
			engine.doc.objects.some((o) => selIds.has(o.id) && o.kind === 'piece')
		) {
			setZoneDraw(false)
			createZone()
		} else {
			setCurveDraw(false)
			setZoneDraw((v) => !v)
		}
	}

	// ── 複製・クリップボード ────────────────────────────────
	const selObjects = () => engine.doc.objects.filter((o) => selIds.has(o.id))
	const expandedSel = () =>
		expandGroups(engine.doc.objects, selObjects())
	const duplicate = (
		srcObjects: WorldObject[],
		srcEdges: Edge[],
		select: boolean,
		off: Pt = { x: 32, y: 32 }
	) => {
		if (srcObjects.length === 0) return
		const { objects, edges } = duplicateParts(srcObjects, srcEdges, off)
		engine.setDoc({
			...engine.doc,
			objects: [...engine.doc.objects, ...objects],
			edges: [...engine.doc.edges, ...edges],
		})
		if (select) engine.setSelection(objects.map((o) => o.id))
	}
	const duplicateSel = (select = false) => {
		const sel = expandedSel()
		duplicate(
			sel,
			innerEdges(engine.doc.edges, sel),
			select
		)
	}

	// 配列複製（Inspector から）
	const arrayDup = (count: number, dx: number, dy: number) => {
		const n = Math.min(50, Math.max(1, Math.round(count)))
		const sel = expandedSel()
		if (!sel.length) return
		const inner = innerEdges(engine.doc.edges, sel)
		const objects: WorldObject[] = []
		const edges: Edge[] = []
		for (let i = 1; i <= n; i++) {
			const d = duplicateParts(sel, inner, { x: dx * i, y: dy * i })
			objects.push(...d.objects)
			edges.push(...d.edges)
		}
		engine.setDoc({
			...engine.doc,
			objects: [...engine.doc.objects, ...objects],
			edges: [...engine.doc.edges, ...edges],
		})
		engine.setSelection(objects.map((o) => o.id))
	}

	// ── 印刷（用紙または全オブジェクト外接を 2x キャプチャ） ──
	const [printImg, setPrintImg] = useState<{
		src: string
		page: string
	} | null>(null)
	useEffect(() => {
		const clear = () => setPrintImg(null)
		window.addEventListener('afterprint', clear)
		return () => window.removeEventListener('afterprint', clear)
	}, [])
	const doPrint = useCallback(async () => {
		const canvas = wrapRef.current?.querySelector<HTMLElement>('.ki-canvas')
		const wrap = wrapRef.current
		if (!canvas || !wrap) return
		let bounds: { x: number; y: number; w: number; h: number }
		let page = 'auto'
		if (paperRef.current.on) {
			const { w, h } = paperDims(paperRef.current)
			bounds = { x: paperRef.current.x, y: paperRef.current.y, w, h }
			page = `${paperRef.current.size}${paperRef.current.landscape ? ' landscape' : ''}`
		} else {
			const objs = engine.doc.objects
			if (objs.length === 0) {
				alert(t('印刷対象がありません'))
				return
			}
			const x0 = Math.min(...objs.map((o) => o.x))
			const y0 = Math.min(...objs.map((o) => o.y))
			const x1 = Math.max(...objs.map((o) => o.x + o.w))
			const y1 = Math.max(...objs.map((o) => o.y + o.h))
			bounds = { x: x0 - 24, y: y0 - 24, w: x1 - x0 + 48, h: y1 - y0 + 48 }
		}
		const prevSel = [...engine.selectedIds]
		const prevVp = { ...engine.viewport }
		engine.setSelection([])
		flushSync(() => {
			engine.viewport = { x: -bounds.x, y: -bounds.y, zoom: 1 }
			engine.patchDoc(engine.doc)
		})
		wrap.classList.add('capturing')
		try {
			const dataUrl = await toPng(canvas, {
				backgroundColor: '#ffffff',
				// バンドルWebフォントの埋め込みは空画像の原因になるためスキップ
				skipFonts: true,
				pixelRatio: 2,
				width: bounds.w,
				height: bounds.h,
				style: {
					width: `${bounds.w}px`,
					height: `${bounds.h}px`,
					overflow: 'hidden',
				},
			})
			if (dataUrl.length < 5000) throw new Error('empty capture')
			setPrintImg({ src: dataUrl, page })
		} catch {
			alert(t('印刷イメージの生成に失敗しました'))
		} finally {
			wrap.classList.remove('capturing')
			flushSync(() => {
				engine.viewport = prevVp
				engine.patchDoc(engine.doc)
			})
			engine.setSelection(prevSel)
		}
	}, [engine, t])

	// ── ゾーン描画レイヤー ─────────────────────────────────
	const zoneStart = useRef<Pt | null>(null)
	const onZoneDown = (e: RPointerEvent<HTMLDivElement>) => {
		if (e.button !== 0) return
		const p = worldPt(e.clientX, e.clientY)
		zoneStart.current = p
		setZoneRect({ a: p, b: p })
		e.currentTarget.setPointerCapture(e.pointerId)
	}
	const onZoneMove = (e: RPointerEvent<HTMLDivElement>) => {
		if (!zoneStart.current) return
		setZoneRect({ a: zoneStart.current, b: worldPt(e.clientX, e.clientY) })
	}
	const onZoneUp = () => {
		const r = zoneRect
		zoneStart.current = null
		setZoneRect(null)
		setZoneDraw(false)
		if (!r) return
		const x0 = Math.min(r.a.x, r.b.x)
		const y0 = Math.min(r.a.y, r.b.y)
		const x1 = Math.max(r.a.x, r.b.x)
		const y1 = Math.max(r.a.y, r.b.y)
		if (x1 - x0 < 24 || y1 - y0 < 24) return
		const sx = Math.round(x0 / GRID) * GRID
		const sy = Math.round(y0 / GRID) * GRID
		const w = Math.round(x1 / GRID) * GRID - sx
		const h = Math.round(y1 / GRID) * GRID - sy
		addObj(makeZone(sx, sy, w, h))
	}

	// ── 曲線描画レイヤー ────────────────────────────────────
	const commitCurve = useCallback(() => {
		if (curvePts.length >= 3) {
			const sp = makeSpline(curvePts)
			engine.setDoc({
				...engine.doc,
				objects: [...engine.doc.objects, sp],
			})
			engine.setSelection([sp.id])
		}
		setCurveDraw(false)
		setCurvePts([])
		setCurveHover(null)
	}, [curvePts, engine])
	const curveSnap = (p: Pt): Pt => ({
		x: Math.round(p.x / GRID) * GRID,
		y: Math.round(p.y / GRID) * GRID,
	})
	const onCurveDown = (e: RPointerEvent<HTMLDivElement>) => {
		if (e.button !== 0) return
		const g = curveSnap(worldPt(e.clientX, e.clientY))
		const last = curvePts[curvePts.length - 1]
		if (last && last.x === g.x && last.y === g.y) {
			// 最後と同じ点の再クリック（≈ダブルクリック）=確定
			if (curvePts.length >= 3) commitCurve()
			return
		}
		setCurvePts((pts) => [...pts, g])
	}
	const onCurveMove = (e: RPointerEvent<HTMLDivElement>) => {
		setCurveHover(curveSnap(worldPt(e.clientX, e.clientY)))
	}
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
		window.addEventListener('keydown', onKey)
		return () => window.removeEventListener('keydown', onKey)
	}, [curveDraw, commitCurve])
	useEffect(() => {
		if (!zoneDraw) return
		const onEsc = (e: KeyboardEvent) => {
			if (e.key === 'Escape') setZoneDraw(false)
		}
		window.addEventListener('keydown', onEsc)
		return () => window.removeEventListener('keydown', onEsc)
	}, [zoneDraw])

	// ── ゾーンヘッダーの独自ドラッグ（ゾーン本体はクリックスルー
	//    のため、選択・移動はここで面倒を見る） ────────────────
	const snapRef = useRef(snapOn)
	snapRef.current = snapOn
	const lineModeRef = useRef(lineMode)
	lineModeRef.current = lineMode
	useEffect(() => {
		const el = wrapRef.current
		if (!el) return
		let drag: {
			id: string
			startW: Pt
			orig: Pt
			moved: boolean
		} | null = null
		const onMove = (ev: PointerEvent) => {
			if (!drag) return
			const w = worldPt(ev.clientX, ev.clientY)
			let nx = drag.orig.x + (w.x - drag.startW.x)
			let ny = drag.orig.y + (w.y - drag.startW.y)
			if (snapRef.current) {
				nx = Math.round(nx / GRID) * GRID
				ny = Math.round(ny / GRID) * GRID
			}
			drag.moved = true
			const id = drag.id
			engine.patchDoc({
				...engine.doc,
				objects: engine.doc.objects.map((o) =>
					o.id === id ? { ...o, x: nx, y: ny } : o
				),
			})
		}
		const onUp = () => {
			if (drag?.moved) engine.commitDoc()
			drag = null
		}
		const onDown = (e: PointerEvent) => {
			if (e.button !== 0 || lineModeRef.current) return
			const target = e.target as HTMLElement
			const hdr = target.closest?.('.aggzone-header') as HTMLElement | null
			if (!hdr) return
			if (target.closest('button,select,input')) return
			const objEl = hdr.closest('[data-ki-obj]') as HTMLElement | null
			const zoneId = objEl?.dataset.kiObj
			if (!zoneId) return
			// 「自由」チップは本体が chipPos 移動（部品側が処理）。
			// グリップだけゾーン移動
			if (
				hdr.classList.contains('free') &&
				!target.closest('.aggzone-grip')
			)
				return
			e.stopPropagation()
			e.preventDefault()
			const z = engine.doc.objects.find((o) => o.id === zoneId)
			if (!z) return
			if (e.shiftKey) {
				const s = new Set(engine.selectedIds)
				if (s.has(zoneId)) s.delete(zoneId)
				else s.add(zoneId)
				engine.setSelection(s)
			} else if (!engine.selectedIds.has(zoneId)) {
				engine.setSelection([zoneId])
			}
			if (z.locked) return
			drag = {
				id: zoneId,
				startW: worldPt(e.clientX, e.clientY),
				orig: { x: z.x, y: z.y },
				moved: false,
			}
			window.addEventListener('pointermove', onMove)
			window.addEventListener('pointerup', onUp, { once: true })
		}
		el.addEventListener('pointerdown', onDown, true)
		return () => {
			el.removeEventListener('pointerdown', onDown, true)
			window.removeEventListener('pointermove', onMove)
			window.removeEventListener('pointerup', onUp)
		}
	}, [engine, worldPt])

	// ── ドキュメント I/O ─────────────────────────────────
	const exportDoc = () => {
		const d = docToStored(engine.doc, paper)
		const out = {
			app: 'sethera',
			version: 1,
			nodes: d.nodes,
			edges: d.edges,
			viewport: engine.viewport,
			paper,
		}
		const blob = new Blob([JSON.stringify(out, null, 2)], {
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
			.then((txt) => {
				const parsed = JSON.parse(txt)
				if (!Array.isArray(parsed?.nodes)) throw new Error('bad doc')
				const { doc: d, paper: p } = storedToDoc(parsed)
				engine.setDoc(d)
				setPaper(p)
				const missing = missingFonts([
					p.font,
					...d.objects
						.filter((o) => o.kind === 'piece')
						.map((o) => (o.data as { font?: string }).font),
				])
				if (missing.length > 0) {
					alert(
						t(
							'この環境に無いフォントが使われています: {f}\n（既定フォントで表示されます）',
							{ f: missing.join('、') }
						)
					)
				}
				if (typeof parsed.viewport?.zoom === 'number') {
					engine.viewport = parsed.viewport
					engine.patchDoc(engine.doc)
				}
			})
			.catch(() =>
				alert(t('Sethera の JSON ファイルとして読み込めませんでした'))
			)
	}

	// ── CSV ──────────────────────────────────────────────
	const importCsv = (rows: ParsedTable, colTypes: ColType[]) => {
		const c = viewportCenter()
		const g = (v: number) => Math.round(v / GRID) * GRID
		const ROW_H = 36
		const colW = (ty: ColType) => (ty === 'number' ? 132 : 240)
		const totalW = colTypes.reduce(
			(a, ty) => a + (ty === 'ignore' ? 0 : colW(ty)),
			0
		)
		const x0 = g(c.x - totalW / 2)
		const y0 = g(c.y - (rows.length * ROW_H) / 2)
		const newObjects: WorldObject[] = []
		rows.forEach((r, ri) => {
			let x = x0
			colTypes.forEach((ty, ci) => {
				if (ty === 'ignore') return
				const w = colW(ty)
				const cx = x
				x += w
				const cell = (r[ci] ?? '').slice(0, CSV_LIMITS.cellChars)
				if (cell.trim() === '') return
				const num = ty === 'number' ? parseNumCell(cell) : null
				const o =
					num !== null
						? makePiece('number', cx, y0 + ri * ROW_H)
						: makePiece('text', cx, y0 + ri * ROW_H)
				o.w = w
				o.h = ROW_H
				o.data = {
					...(o.data as object),
					...(num !== null
						? { label: '', value: num, align: 'r' }
						: { label: cell, value: null, align: 'l' }),
				}
				newObjects.push(o)
			})
		})
		engine.setDoc({
			...engine.doc,
			objects: [...engine.doc.objects, ...newObjects],
		})
		engine.setSelection(newObjects.map((o) => o.id))
	}
	const csvTargets = (scope: 'sel' | 'all') =>
		scope === 'sel' ? expandedSel() : engine.doc.objects
	const copyCsvTsv = (scope: 'sel' | 'all') => {
		const table = gridCsv(
			engine.doc.objects,
			engine.doc.edges,
			csvTargets(scope)
		)
		void navigator.clipboard.writeText(toDelimited(table, '\t'))
		return table.length
	}
	const saveCsvFile = (scope: 'sel' | 'all') => {
		const table = gridCsv(
			engine.doc.objects,
			engine.doc.edges,
			csvTargets(scope)
		)
		const blob = new Blob(['﻿' + toDelimited(table, ',')], {
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
			(o) => o.kind === 'piece' || o.kind === 'calc'
		).length

	// ── テンプレート ─────────────────────────────────────
	const [templates, setTemplates] = useState<Template[]>(loadTemplates)
	const persistTemplates = (ts: Template[]) => {
		setTemplates(ts)
		saveTemplates(ts)
	}
	const tplSaveCount = expandedSel().length
	const saveAsTemplate = (name: string): boolean => {
		const sel = expandedSel()
		if (sel.length === 0) return false
		const minX = Math.min(...sel.map((o) => o.x))
		const minY = Math.min(...sel.map((o) => o.y))
		persistTemplates([
			...templates,
			{
				id: newId(),
				name: name.trim() || t('無題'),
				createdAt: new Date().toISOString().slice(0, 10),
				nodes: sel.map((o) => {
					const n = objectToNode(o)
					return {
						...n,
						position: { x: n.position.x - minX, y: n.position.y - minY },
					}
				}),
				edges: innerEdges(engine.doc.edges, sel).map(edgeToSEdge),
			},
		])
		return true
	}
	const insertTemplate = (tpl: Template) => {
		const objects = tpl.nodes.map(nodeToObject)
		const edges = tpl.edges.map(sedgeToEdge)
		const minX = Math.min(...objects.map((o) => o.x))
		const minY = Math.min(...objects.map((o) => o.y))
		const maxX = Math.max(...objects.map((o) => o.x + o.w))
		const maxY = Math.max(...objects.map((o) => o.y + o.h))
		const c = viewportCenter()
		duplicate(objects, edges, true, {
			x: c.x - (minX + maxX) / 2,
			y: c.y - (minY + maxY) / 2,
		})
		setModal(null)
	}
	const renameTemplate = (id: string, name: string) =>
		persistTemplates(templates.map((x) => (x.id === id ? { ...x, name } : x)))
	const deleteTemplate = (id: string) =>
		persistTemplates(templates.filter((x) => x.id !== id))
	const exportTemplate = (tpl: Template) => {
		const out = {
			app: 'sethera-template',
			version: 1,
			name: tpl.name,
			nodes: tpl.nodes,
			edges: tpl.edges,
		}
		const blob = new Blob([JSON.stringify(out, null, 2)], {
			type: 'application/json',
		})
		const url = URL.createObjectURL(blob)
		const a = document.createElement('a')
		a.href = url
		a.download = `sethera-tpl-${tpl.name || 'template'}.json`
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
						id: newId(),
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

	// ── 用紙 ────────────────────────────────────────────
	const commitPaper = (p: PaperCfg) => {
		setPaper(p)
		engine.setDoc({ ...engine.doc, page: pageOf(p) })
	}
	const livePaper = (p: PaperCfg) => {
		setPaper(p)
		engine.patchDoc({ ...engine.doc, page: pageOf(p) })
	}
	const togglePaper = () => {
		if (!paper.on && !paper.placed) {
			const { w, h } = paperDims(paper)
			const c = viewportCenter()
			commitPaper({
				...paper,
				on: true,
				placed: true,
				x: Math.round((c.x - w / 2) / GRID) * GRID,
				y: Math.round((c.y - h / 2) / GRID) * GRID,
			})
		} else {
			commitPaper({ ...paper, on: !paper.on })
		}
	}
	// ロード後は doc.page が正（storedToDoc が設定済み）。paper 変更のみ
	// commitPaper/livePaper 経由で doc.page へ流すので別途同期は不要

	// ── 全消去 ──────────────────────────────────────────
	const clearAll = () => {
		engine.setDoc({ ...engine.doc, objects: [], edges: [] })
		setModal(null)
	}

	// ── モーダル Esc ────────────────────────────────────
	useEffect(() => {
		if (!modal) return
		const onEsc = (e: KeyboardEvent) => {
			if (e.key === 'Escape') setModal(null)
		}
		window.addEventListener('keydown', onEsc)
		return () => window.removeEventListener('keydown', onEsc)
	}, [modal])

	// ── キーボード ──────────────────────────────────────
	const arrowHeld = useRef(false)
	useEffect(() => {
		const onKey = (e: KeyboardEvent) => {
			const mod = e.ctrlKey || e.metaKey
			const el = document.activeElement as HTMLElement | null
			const inField =
				el &&
				(el.tagName === 'INPUT' ||
					el.tagName === 'SELECT' ||
					el.tagName === 'TEXTAREA' ||
					el.isContentEditable)
			// Ctrl+P はツールのキャプチャ印刷へ
			if (mod && e.key.toLowerCase() === 'p') {
				e.preventDefault()
				void doPrint()
				return
			}
			if (inField) return
			// 矢印キー微移動: 矢印=グリッド1歩、Shift+矢印=1px。
			// 押下中は patchDoc（履歴なし）、keyup で1コミットにまとめる
			if (
				!mod &&
				!e.altKey &&
				e.key.startsWith('Arrow') &&
				!document.querySelector('.modal-back')
			) {
				const sel = expandedSel().filter((o) => !o.locked)
				if (sel.length === 0) return
				e.preventDefault()
				const step = e.shiftKey ? 1 : GRID
				const dx =
					e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0
				const dy =
					e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0
				arrowHeld.current = true
				engine.patchDoc(
					moveObjects(
						engine.doc,
						sel.map((o) => o.id),
						dx,
						dy
					)
				)
				return
			}
			if (e.key === 'Delete' || e.key === 'Backspace') {
				e.preventDefault()
				engine.removeSelected()
				return
			}
			if (!mod) return
			const key = e.key.toLowerCase()
			if (key === 'z') {
				e.preventDefault()
				if (e.shiftKey) engine.redo()
				else engine.undo()
			} else if (key === 'y') {
				e.preventDefault()
				engine.redo()
			} else if (key === 'c') {
				const sel = expandedSel()
				clipboard.current = {
					objects: sel,
					edges: innerEdges(engine.doc.edges, sel),
				}
			} else if (key === 'd') {
				e.preventDefault()
				duplicateSel()
			} else if (key === 'v') {
				duplicate(
					clipboard.current.objects,
					clipboard.current.edges,
					true
				)
			}
		}
		const onKeyUp = (e: KeyboardEvent) => {
			if (e.key.startsWith('Arrow') && arrowHeld.current) {
				arrowHeld.current = false
				engine.commitDoc()
			}
		}
		window.addEventListener('keydown', onKey)
		window.addEventListener('keyup', onKeyUp)
		return () => {
			window.removeEventListener('keydown', onKey)
			window.removeEventListener('keyup', onKeyUp)
		}
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [engine, selIds, doPrint])

	// ── 表示用 ──────────────────────────────────────────
	const sel = doc.objects.filter((o) => selIds.has(o.id))
	const selectedPieceCount = sel.filter((o) => o.kind === 'piece').length
	const partialIds = useMemo(() => zonePartialIds(doc.objects), [doc.objects])
	const groupSelIds = useMemo(() => {
		const gids = new Set(
			sel.map((o) => o.group).filter((g): g is string => !!g)
		)
		const out = new Set<string>()
		if (!gids.size) return out
		for (const o of doc.objects) {
			if (o.group && gids.has(o.group)) out.add(o.id)
		}
		return out
	}, [doc.objects, sel])
	const hint = useMemo(
		() => ({
			ids: hintedIds,
			partial: partialIds,
			group: groupSelIds,
			snapOn,
			dark: theme === 'dark',
			paperRect: api.paperRect,
			docFont: paper.font,
			set: (ids: string[]) => setHintedIds(new Set(ids)),
			clear: () => setHintedIds(new Set()),
		}),
		[hintedIds, partialIds, groupSelIds, snapOn, theme, api.paperRect, paper.font]
	)

	// グリッドドット（kimetron の線グリッドの代わりに RF 版同様のドットを描く）
	const vp = engine.viewport
	const gridStyle =
		gridOn && doc.grid.size > 0
			? {
					backgroundImage: `radial-gradient(circle, ${DOT_COLOR[theme]} 1.1px, transparent 1.1px)`,
					backgroundSize: `${doc.grid.size * vp.zoom}px ${doc.grid.size * vp.zoom}px`,
					backgroundPosition: `${vp.x}px ${vp.y}px`,
				}
			: { backgroundImage: 'none' }

	const toScreen = (p: Pt) => engine.worldToScreen(p)

	return (
		<div
			className={`board${printImg ? ' hasimg' : ''}${theme !== 'standard' ? ` ${theme}` : ''}${lineMode ? ' linemode' : ''}${paper.ghost ? ' paper-ghost' : ''}${wiresOn ? '' : ' nowire'}`}
			ref={wrapRef}
		>
			<BoardContext.Provider value={api}>
				<HintContext.Provider value={hint}>
					<IsleCanvas
						engine={engine}
						renderObject={renderObject}
						onSelectionChange={setSelIds}
						autoOrigin={false}
						style={gridStyle}
					/>
					{paper.on && (
						<PaperFrame
							paper={paper}
							engine={engine}
							toWorld={worldPt}
							onLive={livePaper}
							onCommit={commitPaper}
						/>
					)}
					{(zoneDraw || curveDraw) && (
						<div
							className="drawlayer"
							onPointerDown={zoneDraw ? onZoneDown : onCurveDown}
							onPointerMove={zoneDraw ? onZoneMove : onCurveMove}
							onPointerUp={zoneDraw ? onZoneUp : undefined}
						>
							{zoneDraw && zoneRect && (
								<div
									className="ki-marquee zone-marquee"
									style={{
										left: Math.min(
											toScreen(zoneRect.a).x,
											toScreen(zoneRect.b).x
										),
										top: Math.min(
											toScreen(zoneRect.a).y,
											toScreen(zoneRect.b).y
										),
										width: Math.abs(
											toScreen(zoneRect.b).x - toScreen(zoneRect.a).x
										),
										height: Math.abs(
											toScreen(zoneRect.b).y - toScreen(zoneRect.a).y
										),
									}}
								/>
							)}
							{curveDraw && curvePts.length > 0 && (
								<svg className="curvelayer">
									<polyline
										points={[...curvePts, ...(curveHover ? [curveHover] : [])]
											.map((p) => {
												const s = toScreen(p)
												return `${s.x},${s.y}`
											})
											.join(' ')}
										fill="none"
										stroke="#6666cc"
										strokeWidth={1.5}
										strokeDasharray="6 4"
									/>
									{[...curvePts, ...(curveHover ? [curveHover] : [])].map(
										(p, i) => {
											const s = toScreen(p)
											return (
												<circle
													key={i}
													cx={s.x}
													cy={s.y}
													r={3}
													fill={
														i === curvePts.length
															? '#9999dd'
															: '#6666cc'
													}
												/>
											)
										}
									)}
								</svg>
							)}
						</div>
					)}
					{curveDraw && (
						<div className="curvehint">
							{t(
								'曲線: クリックで頂点（3点以上）、同じ点の再クリック or Enter で確定、Escでキャンセル'
							)}
						</div>
					)}
					{zoneDraw && (
						<div className="curvehint">
							{t(
								'集計ゾーン: 対角2点をドラッグで指定（Escまたはクリックでキャンセル）'
							)}
						</div>
					)}
					{sel.length > 0 && (
						<Inspector
							sel={sel}
							objects={doc.objects}
							edges={doc.edges}
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
							Sethera Piece <span className="brand-ver">v{APP_VERSION}</span>
							<em>Visual Strategy Board</em>
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
						<button
							data-icon={ic('付', '▣')}
							title={t('付箋＋数値ピース')}
							onClick={() => addPiece('pair')}
						>
							{t('付箋＋数値')}
						</button>
						<button
							data-icon={ic('文', 'T')}
							title={t('テキストピース')}
							onClick={() => addPiece('text')}
						>
							{t('テキスト')}
						</button>
						<button
							data-icon={ic('数', '№')}
							title={t('数値ピース')}
							onClick={() => addPiece('number')}
						>
							{t('数値')}
						</button>
						<button
							data-icon={ic('計', 'ƒ')}
							onClick={addCalc}
							title={t('四則演算ピース（ピースの右の●から線を引いて繋ぐ）')}
						>
							{t('計算')}
						</button>
						<button
							data-icon="─"
							onClick={addLine}
							title={t('罫線（横長=水平線/縦長=垂直線。線は枠の上辺・左辺に引かれる。選択中に線種変更）')}
						>
							{t('罫線')}
						</button>
						<button
							data-icon="□"
							onClick={addRect}
							title={t('矩形罫線（4辺の枠。グリッド吸着で隣接矩形の辺が完全に重なる）')}
						>
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
								selectedPieceCount > 0
									? t('選択中のピースを囲む集計ゾーン')
									: t('集計ゾーンをドラッグで描画（対角2点を指定。Esc/クリックでキャンセル）')
							}
							onClick={onZoneButton}
						>
							{t('Σ 集計ゾーン')}
							{selectedPieceCount > 0 ? ` (${selectedPieceCount})` : ''}
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
							data-icon="⇢"
							className={wiresOn ? 'active' : ''}
							title={t('リレーション線と接続ポートの表示/非表示（OFF=完成図モード。印刷からは常に除外）')}
							onClick={toggleWires}
						>
							{t('リレーション')}
						</button>
						<button
							data-icon={ic('紙', '▭')}
							className={paper.on ? 'active' : ''}
							title={t('用紙枠の表示（A4/B5/A3・縦横切替）')}
							onClick={togglePaper}
						>
							{t('用紙')}
						</button>
						<button
							data-icon={ic('印', '⎙')}
							onClick={() => void doPrint()}
							title={t('用紙枠（または全体）の範囲を印刷')}
						>
							{t('印刷')}
						</button>
						<button
							data-icon={ic('保', '⬇')}
							onClick={exportDoc}
							title={t('JSONファイルに保存')}
						>
							{t('保存')}
						</button>
						<button
							data-icon={ic('開', '⬆')}
							onClick={() => fileRef.current?.click()}
							title={t('JSONファイルを開く')}
						>
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
							disabled={!engine.canUndo}
							title={t('元に戻す (Ctrl+Z)')}
							onClick={() => engine.undo()}
						>
							↩ {t('戻す')}
						</button>
						<button
							data-icon="↪"
							disabled={!engine.canRedo}
							title={t('やり直し (Ctrl+Shift+Z / Ctrl+Y)')}
							onClick={() => engine.redo()}
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
						{t(
							'印刷にはツールバーの「印刷」ボタン、または Ctrl+P をご利用ください（ブラウザの印刷メニューからの直接印刷には対応していません）'
						)}
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
											{t(
												'セルではなくピースを自由に置いて計算する、ビジュアルボード。見積書や集計表を、空間にそのまま組み立てられます。'
											)}
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
												<dd>Kimetron Isle / Vite</dd>
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
										onFont={(f) =>
											commitPaper({
												...paper,
												font: f === 'sans' ? undefined : f,
											})
										}
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
										fileRef={tplFileRef}
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
											<button className="danger" onClick={clearAll}>
												{t('全消去')}
											</button>
										</div>
									</>
								)}
							</div>
						</div>
					)}
				</HintContext.Provider>
			</BoardContext.Provider>
		</div>
	)
}

/** 設定モーダル本体 */
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

/** テンプレートライブラリのモーダル本体 */
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
	fileRef,
}: {
	templates: Template[]
	saveCount: number
	onSave: (name: string) => boolean
	onInsert: (t: Template) => void
	onRename: (id: string, name: string) => void
	onDelete: (id: string) => void
	onExport: (t: Template) => void
	onImport: (e: ChangeEvent<HTMLInputElement>) => void
	onClose: () => void
	fileRef: React.RefObject<HTMLInputElement | null>
}) {
	const t = useT()
	const [name, setName] = useState('')
	const [editingId, setEditingId] = useState<string | null>(null)
	const [editName, setEditName] = useState('')
	const canSave = saveCount >= 2
	const doSave = () => {
		if (onSave(name)) setName('')
	}
	const commitRename = (tpl: Template) => {
		const v = editName.trim()
		if (v && v !== tpl.name) onRename(tpl.id, v)
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
					<button onClick={onClose}>{t('閉じる')}</button>
				) : (
					<>
						<button onClick={() => fileRef.current?.click()}>
							{t('テンプレートを読み込み…')}
						</button>
						<input
							ref={fileRef}
							type="file"
							name="tpl-file"
							accept=".json,application/json"
							style={{ display: 'none' }}
							onChange={onImport}
						/>
						<button onClick={onClose}>{t('閉じる')}</button>
					</>
				)}
			</div>
		</>
	)
}
