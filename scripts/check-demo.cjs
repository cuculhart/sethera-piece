// 録画と同じ手順の内容検証（最終画面PNG＋ゾーン合計の変化をDOM確認）
const { chromium } = require('playwright-core')
const BASE = 'http://localhost:5174/sethera-piece/'
const pause = (ms) => new Promise((r) => setTimeout(r, ms))
const PAIR_W = 144, PAIR_H = 60

const LAYOUT = {
  zoneA: { id: 'zone-a', x: 300, y: 200, w: 300, h: 220 },
  zoneB: { id: 'zone-b', x: 700, y: 200, w: 300, h: 220 },
  pieceA1: { x: 330, y: 250 },
  pieceA2: { x: 330, y: 330 },
  pieceB1: { x: 770, y: 240 },
  dropAt: { x: 720, y: 305 },
}
const SCENARIOS = {
  ja: { a1: { label: 'りんご', value: 120 }, a2: { label: 'ばなな', value: 80 }, b1: { label: 'みかん', value: 50 } },
  en: { a1: { label: 'Apple', value: 120 }, a2: { label: 'Banana', value: 80 }, b1: { label: 'Orange', value: 50 } },
}
const vobject = (id, pos, { label, value }) => ({
  id, type: 'vobject', position: pos, width: PAIR_W, height: PAIR_H, zIndex: 1,
  data: { kind: 'pair', label, value, color: 'yellow', align: 'c' },
})
const zone = ({ id, x, y, w, h }) => ({
  id, type: 'zone', position: { x, y }, width: w, height: h, zIndex: 0,
  dragHandle: '.aggzone-header', selectable: false, data: { fn: 'sum', labelPos: 'bottom' },
})
const seedDoc = (lang) => {
  const s = SCENARIOS[lang]
  return { nodes: [zone(LAYOUT.zoneA), zone(LAYOUT.zoneB), vobject('piece-a1', LAYOUT.pieceA1, s.a1), vobject('piece-a2', LAYOUT.pieceA2, s.a2), vobject('piece-b1', LAYOUT.pieceB1, s.b1)], edges: [] }
}

async function run(lang) {
  const browser = await chromium.launch({ channel: 'chrome' })
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } })
  await ctx.addInitScript(({ l, doc }) => {
    localStorage.setItem('sethera-doc', JSON.stringify(doc))
    localStorage.setItem('sethera-viewport', JSON.stringify({ x: 0, y: 0, zoom: 1 }))
    localStorage.setItem('sethera-lang', l)
  }, { l: lang, doc: seedDoc(lang) })
  const page = await ctx.newPage()
  await page.goto(BASE, { waitUntil: 'networkidle' })
  await pause(1000)
  const before = await page.locator('.aggzone').evaluateAll((els) => els.map((e) => e.textContent))
  console.log(`${lang} before:`, JSON.stringify(before))
  const pre = await page.locator('.react-flow__node').evaluateAll((els) =>
    els.map((e) => { const r = e.getBoundingClientRect(); return { id: e.dataset.id, x: Math.round(r.x), y: Math.round(r.y) } }))
  console.log(`${lang} pre-drag rects:`, JSON.stringify(pre))
  const grab = { x: LAYOUT.pieceA2.x + PAIR_W / 2, y: LAYOUT.pieceA2.y + PAIR_H / 2 }
  await page.mouse.move(grab.x, grab.y); await page.mouse.down(); await pause(100)
  const wake = { x: grab.x + 8, y: grab.y }
  await page.mouse.move(wake.x, wake.y); await pause(100)
  const dest = { x: wake.x + (LAYOUT.dropAt.x - LAYOUT.pieceA2.x), y: wake.y + (LAYOUT.dropAt.y - LAYOUT.pieceA2.y) }
  for (let i = 1; i <= 12; i++) { await page.mouse.move(wake.x + (dest.x - wake.x) * i / 12, wake.y + (dest.y - wake.y) * i / 12); await pause(30) }
  await page.mouse.move(dest.x, dest.y); await pause(200)
  const mid = await page.locator('[data-id="piece-a2"]').evaluate((e) => { const r = e.getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y) } })
  console.log(`${lang} mid-drag pos (expect ~720,305):`, JSON.stringify(mid))
  await page.mouse.up(); await pause(1200)
  const after = await page.locator('.aggzone').evaluateAll((els) => els.map((e) => e.textContent))
  console.log(`${lang} after:`, JSON.stringify(after))
  const rects = await page.locator('.react-flow__node').evaluateAll((els) =>
    els.map((e) => { const r = e.getBoundingClientRect(); return { id: e.dataset.id, x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) } }))
  console.log(`${lang} rects:`, JSON.stringify(rects))
  await page.screenshot({ path: `C:/Users/eijiarai/AppData/Local/Temp/demo-check-${lang}.png` })
  await browser.close()
}
run('en').then(() => run('ja')).then(() => console.log('done')).catch(e => { console.error(e); process.exit(1) })
