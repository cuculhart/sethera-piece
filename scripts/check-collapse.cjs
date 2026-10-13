// 折りたたみツールバーのアイコン確認（EN/JA）
const { chromium } = require('playwright-core')
const BASE = 'http://localhost:5174/sethera-piece/'
const pause = (ms) => new Promise((r) => setTimeout(r, ms))
async function run(lang) {
  const browser = await chromium.launch({ channel: 'chrome' })
  const ctx = await browser.newContext({ viewport: { width: 900, height: 720 } })
  await ctx.addInitScript((l) => {
    localStorage.removeItem('sethera-doc')
    localStorage.setItem('sethera-lang', l)
  }, lang)
  const page = await ctx.newPage()
  await page.goto(BASE, { waitUntil: 'networkidle' })
  await pause(800)
  await page.locator('button.tbtoggle').click() // « で折りたたみ
  await pause(400)
  await page.screenshot({ path: `C:/Users/eijiarai/AppData/Local/Temp/tb-collapsed-${lang}.png`, clip: { x: 0, y: 0, width: 60, height: 720 } })
  await browser.close()
}
run('en').then(() => run('ja')).then(() => console.log('done')).catch(e => { console.error(e); process.exit(1) })
