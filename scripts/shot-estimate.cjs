// README用静止画: 米国式見積書をA4用紙上に再現してスクリーンショット
// 構成: タイトル/請求先/明細テーブル(罫線) → Σゾーンが小計 → 税 → calcが総額
const { chromium } = require('playwright-core')
const BASE = 'http://localhost:5174/sethera-piece/'
const pause = (ms) => new Promise((r) => setTimeout(r, ms))

const text = (id, x, y, w, h, label, extra = {}) => ({
	id, type: 'vobject', position: { x, y }, width: w, height: h, zIndex: 1,
	data: { kind: 'text', label, value: null, color: 'none', align: 'l', ...extra },
})
const num = (id, x, y, w, value, extra = {}) => ({
	id, type: 'vobject', position: { x, y }, width: w, height: 28, zIndex: 1,
	data: { kind: 'number', label: '', value, color: 'white', align: 'r', comma: true, ...extra },
})
const line = (id, x, y, w) => ({
	id, type: 'line', position: { x, y }, width: w, height: 12, zIndex: 0,
	data: { w: 'thin' },
})
const rect = (id, x, y, w, h) => ({
	id, type: 'line', position: { x, y }, width: w, height: h, zIndex: 0,
	data: { w: 'thin', rect: true },
})
const zone = (id, x, y, w, h) => ({
	id, type: 'zone', position: { x, y }, width: w, height: h, zIndex: 0,
	dragHandle: '.aggzone-header', selectable: false,
	data: { fn: 'sum', labelPos: 'bottom' },
})
const calc = (id, x, y, w) => ({
	id, type: 'calc', position: { x, y }, width: w, height: 36, zIndex: 1,
	data: { op: 'add', round: 'none', constA: null, constB: null, align: 'r', comma: true, bold: true, plain: true, size: 'l', mini: true },
})

// A4縦 = 794x1122（用紙原点 0,0。余白64）
const doc = {
	nodes: [
		// ヘッダ
		text('title', 64, 56, 300, 52, 'ESTIMATE', { size: 'll', bold: true }),
		text('from', 470, 60, 260, 84,
			'Acme Studio LLC\n123 Market Street\nSan Francisco, CA 94103',
			{ size: 's' }),

		// 請求先・メタ情報
		text('billto-h', 64, 208, 200, 24, 'BILL TO', { size: 's', bold: true }),
		text('billto', 64, 236, 260, 84,
			'Rivera Bakery Inc.\n45 Pine Avenue\nAustin, TX 78701',
			{ size: 'm' }),
		text('meta', 470, 208, 260, 96,
			'ESTIMATE #   2025-0042\nDATE   Oct 13, 2025\nVALID UNTIL   Nov 13, 2025',
			{ size: 's' }),

		// 明細テーブル（枠＋ヘッダ下線）
		rect('tbl', 64, 390, 666, 240),
		line('tbl-sep', 64, 438, 666),
		text('h-desc', 76, 398, 300, 28, 'DESCRIPTION', { size: 's', bold: true }),
		text('h-qty', 380, 398, 80, 28, 'QTY', { size: 's', bold: true, align: 'r' }),
		text('h-rate', 462, 398, 90, 28, 'RATE', { size: 's', bold: true, align: 'r' }),
		text('h-amt', 580, 398, 140, 28, 'AMOUNT', { size: 's', bold: true, align: 'r' }),

		// 明細3行（y: 450 / 494 / 538）
		text('d1', 76, 458, 300, 28, 'Website design & build'),
		num('q1', 380, 458, 80, 1, { color: 'none' }),
		num('r1', 462, 458, 90, 2800, { color: 'none' }),
		num('a1', 580, 458, 140, 2800),
		text('d2', 76, 502, 300, 28, 'Brand logo package'),
		num('q2', 380, 502, 80, 1, { color: 'none' }),
		num('r2', 462, 502, 90, 1200, { color: 'none' }),
		num('a2', 580, 502, 140, 1200),
		text('d3', 76, 546, 300, 28, 'Copywriting (per page)'),
		num('q3', 380, 546, 80, 5, { color: 'none' }),
		num('r3', 462, 546, 90, 160, { color: 'none' }),
		num('a3', 580, 546, 140, 800),

		// Σゾーン: AMOUNT列だけを囲む → 小計 4,800
		zone('zone-amt', 570, 444, 178, 184),

		// 税・総額（ゾーン結果＋税額をcalcで加算 → 配線でライブ計算）
		text('lbl-sub', 400, 600, 150, 28, 'SUBTOTAL', { size: 's', bold: true, align: 'r' }),
		text('lbl-tax', 400, 648, 190, 28, 'TAX (8.25%)', { size: 's', align: 'r' }),
		num('tax', 640, 648, 108, 396),
		text('lbl-tot', 400, 696, 190, 32, 'TOTAL', { size: 'm', bold: true, align: 'r' }),
		calc('total', 640, 694, 108),

		// フッタ
		text('notes', 64, 1000, 500, 56,
			'Payment terms: Net 30\nThank you for your business!',
			{ size: 's' }),
	],
	edges: [
		{ id: 'e-sub', source: 'zone-amt', target: 'total', sourceHandle: 'out', targetHandle: 'a', markerEnd: { type: 'arrowclosed' } },
		{ id: 'e-tax', source: 'tax', target: 'total', sourceHandle: 'out', targetHandle: 'b', markerEnd: { type: 'arrowclosed' } },
	],
	paper: { on: true, x: 0, y: 0, size: 'A4', landscape: false, placed: true },
}

async function run(lang) {
	const browser = await chromium.launch({ channel: 'chrome' })
	const ctx = await browser.newContext({ viewport: { width: 1400, height: 1000 }, deviceScaleFactor: 2 })
	await ctx.addInitScript(({ l, doc }) => {
		localStorage.setItem('sethera-doc', JSON.stringify(doc))
		localStorage.setItem('sethera-viewport', JSON.stringify({ x: 300, y: 24, zoom: 0.85 }))
		localStorage.setItem('sethera-lang', l)
	}, { l: lang, doc })
	const page = await ctx.newPage()
	await page.goto(BASE, { waitUntil: 'networkidle' })
	await pause(1200)
	console.log(`${lang} zones:`, await page.locator('.aggzone').evaluateAll((els) => els.map((e) => e.textContent)))
	console.log(`${lang} total:`, await page.locator('.calc-result').first().textContent().catch(() => 'n/a'))
	await page.screenshot({ path: `C:/Users/eijiarai/AppData/Local/Temp/estimate-${lang}.png` })
	await browser.close()
}
run('en').then(() => run('ja')).then(() => console.log('done')).catch(e => { console.error(e); process.exit(1) })
