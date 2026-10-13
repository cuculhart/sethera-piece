import { createContext } from 'react'
import type { Bounds } from './lib/aggregate'

export const HintContext = createContext<{
	ids: ReadonlySet<string>
	partial: ReadonlySet<string>
	group: ReadonlySet<string>
	/** 「吸着」トグル（グリッド吸着＋オブジェクトスナップの総合ON/OFF） */
	snapOn: boolean
	/** ダークテーマ（暗い盤面）。透明ピースの自動文字色調整に使用 */
	dark: boolean
	/** 用紙の矩形（paper.on=false のとき null） */
	paperRect: Bounds | null
	/** 文書既定フォント（FONTS キー名 or カスタム書体名） */
	docFont?: string
	set: (ids: string[]) => void
	clear: () => void
}>({
	ids: new Set<string>(),
	partial: new Set<string>(),
	group: new Set<string>(),
	snapOn: false,
	dark: false,
	paperRect: null,
	set: () => {},
	clear: () => {},
})
