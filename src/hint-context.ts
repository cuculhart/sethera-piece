import { createContext } from 'react'

export const HintContext = createContext<{
	ids: ReadonlySet<string>
	partial: ReadonlySet<string>
	group: ReadonlySet<string>
	set: (ids: string[]) => void
	clear: () => void
}>({
	ids: new Set<string>(),
	partial: new Set<string>(),
	group: new Set<string>(),
	set: () => {},
	clear: () => {},
})
