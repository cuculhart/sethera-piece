import { createContext } from 'react'

export const HintContext = createContext<{
	ids: ReadonlySet<string>
	partial: ReadonlySet<string>
	group: ReadonlySet<string>
	/** 「吸着」トグル（グリッド吸着＋オブジェクトスナップの総合ON/OFF） */
	snapOn: boolean
	set: (ids: string[]) => void
	clear: () => void
}>({
	ids: new Set<string>(),
	partial: new Set<string>(),
	group: new Set<string>(),
	snapOn: false,
	set: () => {},
	clear: () => {},
})
