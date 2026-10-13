// デモ動画の自動録画（JA/EN 2本）。
// シナリオ: あらかじめ2つの集計ゾーンとピースを配置した盤面から開始し、
//           ピースをゾーンAからゾーンBへドラッグ → 両方の合計が瞬時に変わる
// 使い方: npm run dev で :5174 を起動した状態で
//         node scripts/record-demo.mjs
// 出力: videos/sethera-demo-{ja,en}.webm
import { chromium } from 'playwright-core'
import { mkdirSync, renameSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const BASE = 'http://localhost:5174/sethera-piece/'
const OUT = 'videos'
const SIZE = { width: 1280, height: 720 }
const PAIR_W = 144
const PAIR_H = 60

// 初期盤面（flow座標＝zoom1時の画面座標）。ゾーンはzIndex 0で背面。
//   ゾーンA (300,200) 300x220: ピース2枚
//   ゾーンB (700,200) 300x220: ピース1枚
const LAYOUT = {
	zoneA: { id: 'zone-a', x: 300, y: 200, w: 300, h: 220 },
	zoneB: { id: 'zone-b', x: 700, y: 200, w: 300, h: 220 },
	pieceA1: { x: 330, y: 250 }, // 残るピース
	pieceA2: { x: 330, y: 330 }, // ← これをBへドラッグする
	pieceB1: { x: 770, y: 240 },
	// ドラッグ先（ピース左上が来る位置。B内・pieceB1とSUMチップに
	// 重ならない帯）
	dropAt: { x: 720, y: 305 },
}

// lang ごとのピース内容
const SCENARIOS = {
	ja: {
		a1: { label: 'りんご', value: 120 },
		a2: { label: 'ばなな', value: 80 },
		b1: { label: 'みかん', value: 50 },
	},
	en: {
		a1: { label: 'Apple', value: 120 },
		a2: { label: 'Banana', value: 80 },
		b1: { label: 'Orange', value: 50 },
	},
}

const pause = (ms) => new Promise((r) => setTimeout(r, ms))

const vobject = (id, pos, { label, value }) => ({
	id,
	type: 'vobject',
	position: pos,
	width: PAIR_W,
	height: PAIR_H,
	zIndex: 1,
	data: { kind: 'pair', label, value, color: 'yellow', align: 'c' },
})

const zone = ({ id, x, y, w, h }) => ({
	id,
	type: 'zone',
	position: { x, y },
	width: w,
	height: h,
	zIndex: 0,
	dragHandle: '.aggzone-header',
	selectable: false,
	data: { fn: 'sum', labelPos: 'bottom' },
})

const seedDoc = (lang) => {
	const s = SCENARIOS[lang]
	return {
		nodes: [
			zone(LAYOUT.zoneA),
			zone(LAYOUT.zoneB),
			vobject('piece-a1', LAYOUT.pieceA1, s.a1),
			vobject('piece-a2', LAYOUT.pieceA2, s.a2),
			vobject('piece-b1', LAYOUT.pieceB1, s.b1),
		],
		edges: [],
	}
}

async function record(lang) {
	const before = new Set(readdirSync(OUT))
	const browser = await chromium.launch({ channel: 'chrome' })
	const ctx = await browser.newContext({
		viewport: SIZE,
		recordVideo: { dir: OUT, size: SIZE },
	})
	await ctx.addInitScript(
		({ l, doc }) => {
			// 配置済み盤面＋言語固定＋ズーム1で開始
			localStorage.setItem('sethera-doc', JSON.stringify(doc))
			localStorage.setItem(
				'sethera-viewport',
				JSON.stringify({ x: 0, y: 0, zoom: 1 })
			)
			localStorage.setItem('sethera-lang', l)
		},
		{ l: lang, doc: seedDoc(lang) }
	)
	const page = await ctx.newPage()
	await page.goto(BASE, { waitUntil: 'networkidle' })
	await pause(1200) // 導入カット（2ゾーンと合計が読める長さ）

	// ゾーンAのピース(piece-a2)をゾーンB内へドラッグ。
	// RF はドラッグ閾値を超えた最初の move を原点にするため、
	// down 直後に小さく動かしてドラッグを起動し、その点を原点にする
	const grab = {
		x: LAYOUT.pieceA2.x + PAIR_W / 2,
		y: LAYOUT.pieceA2.y + PAIR_H / 2,
	}
	await page.mouse.move(grab.x, grab.y)
	await pause(250)
	await page.mouse.down()
	await pause(120)
	const wake = { x: grab.x + 8, y: grab.y }
	await page.mouse.move(wake.x, wake.y)
	await pause(120)
	// 必要な移動量 = dropAt - pieceA2。wake を原点として加算する
	const dest = {
		x: wake.x + (LAYOUT.dropAt.x - LAYOUT.pieceA2.x),
		y: wake.y + (LAYOUT.dropAt.y - LAYOUT.pieceA2.y),
	}
	const steps = 22
	for (let i = 1; i <= steps; i++) {
		await page.mouse.move(
			wake.x + ((dest.x - wake.x) * i) / steps,
			wake.y + ((dest.y - wake.y) * i) / steps
		)
		await pause(60)
	}
	// 最終 move が mouse.up に間に合わず手前で落ちることがあるため、
	// 目的地へ改めて移動してから待って放す
	await page.mouse.move(dest.x, dest.y)
	await pause(200)
	await page.mouse.up()
	await pause(2600) // 変わった合計を視聴者が読める長さで止まる

	await ctx.close() // ← この時点で webm が確定する
	await browser.close()

	// playwright の video はランダム名 → 撮影前後の差分をリネーム
	const created = readdirSync(OUT).filter(
		(f) => f.endsWith('.webm') && !before.has(f)
	)
	if (created.length !== 1) {
		console.error(`unexpected video files: ${created.join(', ')}`)
		return
	}
	renameSync(join(OUT, created[0]), join(OUT, `sethera-demo-${lang}.webm`))
	console.log(`saved: videos/sethera-demo-${lang}.webm`)
}

mkdirSync(OUT, { recursive: true })
for (const lang of ['ja', 'en']) {
	await record(lang)
}
