import { useSyncExternalStore } from 'react'
import enDict from './i18n/en'

/** 簡易 i18n（teaspoon-ide と同型・向きは逆転）。
 *  キー = 日本語リテラル。en 選択時のみ enDict で上書き、
 *  ja ではキー自体がそのまま返る（辞書不要）。
 *  自動判定は ja 系 → ja、それ以外 → en */

export type Lang = 'auto' | 'ja' | 'en'

const LANG_KEY = 'sethera-lang'
const EVENT = 'sethera:lang'

let lang: Lang = 'auto'
let dict: Record<string, string> = {}

/** 現在有効な言語（auto は判定結果を返す） */
export function resolvedLang(): 'ja' | 'en' {
	if (lang !== 'auto') return lang
	return navigator.language?.toLowerCase().startsWith('ja') ? 'ja' : 'en'
}
function applyDict() {
	dict = resolvedLang() === 'en' ? enDict : {}
}

export function initLang() {
	try {
		const v = localStorage.getItem(LANG_KEY)
		if (v === 'ja' || v === 'en' || v === 'auto') lang = v
	} catch {
		/* localStorage が使えない環境では auto */
	}
	applyDict()
}
export function getLang(): Lang {
	return lang
}
export function setLang(l: Lang) {
	lang = l
	try {
		localStorage.setItem(LANG_KEY, l)
	} catch {
		/* ignore */
	}
	applyDict()
	window.dispatchEvent(new Event(EVENT))
}

/** JA キーを現在の言語に翻訳。vars は `{name}` 置換 */
export function t(key: string, vars?: Record<string, string | number>): string {
	let s = dict[key]
	if (s === undefined) {
		if (resolvedLang() === 'en' && import.meta.env.DEV) {
			console.warn(`[i18n] missing key: ${key}`)
		}
		s = key
	}
	if (vars) {
		for (const [k, v] of Object.entries(vars)) {
			s = s.replaceAll(`{${k}}`, String(v))
		}
	}
	return s
}

/** 言語切替で再レンダーする t() を返すフック */
export function useT() {
	useSyncExternalStore(
		(cb) => {
			window.addEventListener(EVENT, cb)
			return () => window.removeEventListener(EVENT, cb)
		},
		() => `${lang}:${resolvedLang()}`
	)
	return t
}
