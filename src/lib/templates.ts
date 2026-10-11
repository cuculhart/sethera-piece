import type { Edge } from '@xyflow/react'
import type { BoardNode } from '../nodes/types'

// テンプレート（カスタムピースの雛形）。
// 文書とは別の localStorage キーに保存し、文書を開き直しても残る横断ライブラリ
export type Template = {
	id: string
	name: string
	createdAt?: string
	nodes: BoardNode[]
	edges: Edge[]
}

const KEY = 'sethera-templates'

export function loadTemplates(): Template[] {
	try {
		const raw = localStorage.getItem(KEY)
		if (!raw) return []
		const parsed = JSON.parse(raw)
		if (!Array.isArray(parsed)) return []
		return parsed.filter(
			(t): t is Template =>
				!!t &&
				typeof t.id === 'string' &&
				typeof t.name === 'string' &&
				Array.isArray(t.nodes) &&
				Array.isArray(t.edges)
		)
	} catch {
		return []
	}
}

export function saveTemplates(ts: Template[]) {
	localStorage.setItem(KEY, JSON.stringify(ts))
}
