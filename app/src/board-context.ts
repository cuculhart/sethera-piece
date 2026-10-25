import { createContext } from 'react'
import type { Doc, Engine, Pt, WorldObject } from '@kimetron/core'
import type { Bounds } from './lib/aggregate'

/** 盤面オブジェクト（renderObject 内の部品）が App へアクセスする窓口。
 *  doc/selIds は IsleCanvas 再レンダーのたびに最新が流れる。 */
export interface BoardApi {
	doc: Doc
	selIds: ReadonlySet<string>
	engine: Engine
	/** ダークテーマ（暗い盤面）。透明ピースの自動文字色調整に使用 */
	dark: boolean
	snapOn: boolean
	paperRect: Bounds | null
	docFont?: string
	/** data をマージして1コミット（undo 1回） */
	updateData(id: string, patch: Record<string, unknown>): void
	/** data をマージして履歴に残さないライブ更新（ジェスチャ中）。
	 *  終端で commitDoc() を呼んで1 undo にまとめる */
	liveData(id: string, patch: Record<string, unknown>): void
	/** data 以外のフィールドも含む更新（layer/front 等） */
	updateObject(
		id: string,
		patch: Omit<Partial<WorldObject>, 'data'> & {
			data?: Record<string, unknown>
		}
	): void
	/** 実測サイズを w/h へ履歴なし反映（自動サイズ種別: calc 等） */
	liveSize(id: string, size: { w: number; h: number }): void
	/** 現在の engine.doc を1コミットとして確定する（ライブ更新の終端用） */
	commitDoc(): void
	/** クライアント座標 → ワールド座標（キャンバス左上基準） */
	worldPt(clientX: number, clientY: number): Pt
}

export const BoardContext = createContext<BoardApi | null>(null)
