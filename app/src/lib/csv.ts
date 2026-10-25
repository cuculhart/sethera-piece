import type { Edge, WorldObject } from '@kimetron/core'
import { dataOf, objectValue } from './calc'
import type { VObjectData } from '../types'

export type ParsedTable = string[][]

/** 取込制限（盤面が重くならない実用上限） */
export const CSV_LIMITS = {
	fileBytes: 10 * 1024 * 1024, // 10MB
	rows: 500,
	cols: 20,
	pieces: 1000,
	cellChars: 10000,
} as const

/** バイト列を文字コード自動判定でデコード。
 *  BOM(UTF-8/UTF-16LE/BE) → 厳密UTF-8 → Shift_JIS vs EUC-JP（置換文字が少ない方）。
 *  enc はデバッグ・表示用の判定結果名 */
export function decodeCsvBytes(buf: ArrayBuffer): {
	text: string
	enc: string
} {
	const b = new Uint8Array(buf)
	// BOM スニッフ
	if (b[0] === 0xef && b[1] === 0xbb && b[2] === 0xbf)
		return { text: new TextDecoder('utf-8').decode(b.subarray(3)), enc: 'utf-8(bom)' }
	if (b[0] === 0xff && b[1] === 0xfe)
		return { text: new TextDecoder('utf-16le').decode(b.subarray(2)), enc: 'utf-16le' }
	if (b[0] === 0xfe && b[1] === 0xff)
		return { text: new TextDecoder('utf-16be').decode(b.subarray(2)), enc: 'utf-16be' }
	// BOM 無し UTF-8（厳密デコードが通れば確定）
	try {
		return {
			text: new TextDecoder('utf-8', { fatal: true }).decode(b),
			enc: 'utf-8',
		}
	} catch {
		// UTF-8 ではない → 日本語レガシー（SJIS vs EUC-JP）を比較
	}
	const sjis = new TextDecoder('shift-jis').decode(b)
	const euc = new TextDecoder('euc-jp').decode(b)
	const bad = (s: string) => (s.match(/�/g) ?? []).length
	return bad(sjis) <= bad(euc)
		? { text: sjis, enc: 'shift-jis' }
		: { text: euc, enc: 'euc-jp' }
}

/** 区切り文字を先頭行から判定（引用符の外側だけ数える）。
 *  タブ > カンマ > セミコロンの優先順位で同数時は先勝ち */
export function detectDelimiter(text: string): '\t' | ',' | ';' {
	const line =
		text.split(/\r\n|\r|\n/).find((l) => l.trim() !== '') ?? ''
	const count = (d: string) => {
		let n = 0,
			inQ = false
		for (let i = 0; i < line.length; i++) {
			const ch = line[i]
			if (ch === '"') {
				if (inQ && line[i + 1] === '"') {
					i++
					continue
				}
				inQ = !inQ
				continue
			}
			if (!inQ && ch === d) n++
		}
		return n
	}
	const t = count('\t')
	const c = count(',')
	const s = count(';')
	if (t >= c && t >= s && t > 0) return '\t'
	if (c >= s && c > 0) return ','
	if (s > 0) return ';'
	return ','
}

/** RFC4180 準拠の区切りテキストパーサ。
 *  引用符（""でエスケープ）・セル内改行・CRLF/LF/CR に対応。
 *  引用符はフィールド先頭でのみ特殊扱い（途中の裸の " はリテラル） */
export function parseDelimited(text: string, delim: string): ParsedTable {
	const rows: ParsedTable = []
	let row: string[] = []
	let cell = ''
	let inQ = false
	const pushCell = () => {
		row.push(cell)
		cell = ''
	}
	const pushRow = () => {
		pushCell()
		rows.push(row)
		row = []
	}
	let i = 0
	while (i < text.length) {
		const ch = text[i]
		if (inQ) {
			if (ch === '"') {
				if (text[i + 1] === '"') {
					cell += '"'
					i += 2
					continue
				}
				inQ = false
				i++
				continue
			}
			cell += ch
			i++
			continue
		}
		if (ch === '"' && cell === '') {
			inQ = true
			i++
			continue
		}
		if (ch === delim) {
			pushCell()
			i++
			continue
		}
		if (ch === '\r' || ch === '\n') {
			if (ch === '\r' && text[i + 1] === '\n') i++
			pushRow()
			i++
			continue
		}
		cell += ch
		i++
	}
	if (cell !== '' || row.length) pushRow()
	return rows
}

/** 全行で空の列と、末尾の空行を除去 */
export function trimTable(rows: ParsedTable): ParsedTable {
	const body = rows.filter((r) => r.some((c) => c.trim() !== ''))
	if (!body.length) return []
	const cols = Math.max(...body.map((r) => r.length))
	const keep: number[] = []
	for (let c = 0; c < cols; c++)
		if (body.some((r) => (r[c] ?? '').trim() !== '')) keep.push(c)
	return body.map((r) => keep.map((c) => r[c] ?? ''))
}

/** CSV/TSV シリアライズ（引用符・区切り・改行を含むセルは quoting） */
export function toDelimited(
	rows: (string | number | null)[][],
	delim: ',' | '\t'
): string {
	const esc = (v: string | number | null) => {
		const s = v === null ? '' : String(v)
		if (s.includes('"') || s.includes(delim) || /[\r\n]/.test(s))
			return `"${s.replace(/"/g, '""')}"`
		return s
	}
	return rows.map((r) => r.map(esc).join(delim)).join('\r\n')
}

/** セルを数値にパース（カンマ・¥・%・全角スペース・()・▲ の負数表現に対応）。
 *  パース不可は null */
export function parseNumCell(s: string): number | null {
	let t = s.trim()
	if (t === '') return null
	let neg = false
	const paren = t.match(/^[（(](.+)[)）]$/)
	if (paren) {
		neg = true
		t = paren[1]
	}
	if (t.startsWith('▲') || t.startsWith('△')) {
		neg = true
		t = t.slice(1)
	}
	t = t.replace(/[,¥￥\s　%]/g, '')
	if (t.startsWith('-')) {
		neg = true
		t = t.slice(1)
	}
	if (!/^\d*\.?\d+$/.test(t)) return null
	const v = Number(t)
	if (!Number.isFinite(v)) return null
	return neg ? -v : v
}

/** テーブルの列型を自動推定（全セル数値パース可能な列は数値、他はテキスト） */
export type ColType = 'text' | 'number' | 'ignore'
export function guessColTypes(
	rows: ParsedTable,
	skipHeader: boolean
): ColType[] {
	const body = skipHeader ? rows.slice(1) : rows
	const cols = Math.max(0, ...rows.map((r) => r.length))
	return Array.from({ length: cols }, (_, c) => {
		const cells = body.map((r) => (r[c] ?? '').trim())
		const nonEmpty = cells.filter((v) => v !== '')
		if (nonEmpty.length > 0 && nonEmpty.every((v) => parseNumCell(v) !== null))
			return 'number'
		return 'text'
	})
}

/** 1行目がヘッダー行らしいか（全セル非数値かつ2行目以降に数値がある） */
export function guessHeader(rows: ParsedTable): boolean {
	if (rows.length < 2) return false
	const first = rows[0].map((c) => c.trim())
	const hasNum = first.some((c) => parseNumCell(c) !== null)
	if (hasNum) return false
	return rows
		.slice(1)
		.some((r) => r.some((c) => parseNumCell(c) !== null))
}

/** 盤面のピース群を配置どおりの行列に再構成する（CSV/TSV 書出用）。
 *  行 = y中心のクラスタ、列 = x中心のクラスタ。
 *  値はテキスト=ラベル、数値=値、計算=計算結果。罫線・ゾーン・曲線は除外 */
export function gridCsv(
	objects: WorldObject[],
	edges: Edge[],
	targets: WorldObject[]
): string[][] {
	const items = targets
		.filter((o) => o.kind === 'piece' || o.kind === 'calc')
		.map((o) => ({ o, cx: o.x + o.w / 2, cy: o.y + o.h / 2, w: o.w, h: o.h }))
	if (!items.length) return []
	// 中心座標の近い要素を同じ行/列にクラスタ（閾値=自身サイズの半分）
	const cluster = (
		get: (it: (typeof items)[0]) => number,
		size: (it: (typeof items)[0]) => number
	) => {
		const sorted = [...items].sort((a, b) => get(a) - get(b))
		const groups: (typeof items)[0][][] = []
		let cur: (typeof items)[0][] = []
		let anchor = 0
		for (const it of sorted) {
			if (cur.length && get(it) - anchor > size(it) / 2 + 2) {
				groups.push(cur)
				cur = []
				anchor = get(it)
			} else if (!cur.length) {
				anchor = get(it)
			}
			cur.push(it)
		}
		if (cur.length) groups.push(cur)
		return groups
	}
	const rowGroups = cluster((i) => i.cy, (i) => i.h)
	const colGroups = cluster((i) => i.cx, (i) => i.w)
	const colOf = new Map<string, number>()
	colGroups.forEach((g, ci) => g.forEach((i) => colOf.set(i.o.id, ci)))
	const table: string[][] = rowGroups.map((rg) => {
		const row: string[] = Array.from({ length: colGroups.length }, () => '')
		for (const it of rg) {
			const ci = colOf.get(it.o.id)
			if (ci === undefined) continue
			row[ci] = cellValue(it.o, objects, edges)
		}
		return row
	})
	return table
}

function cellValue(
	o: WorldObject,
	objects: WorldObject[],
	edges: Edge[]
): string {
	if (o.kind === 'piece') {
		const d = dataOf<VObjectData>(o)
		if (d.value !== null && d.value !== undefined) return String(d.value)
		return d.label
	}
	if (o.kind === 'calc') {
		const v = objectValue(o.id, objects, edges)
		return v === null ? '' : String(v)
	}
	return ''
}
