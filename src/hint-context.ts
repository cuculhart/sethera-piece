import { createContext } from 'react'

export const HintContext = createContext<{
	ids: ReadonlySet<string>
	set: (ids: string[]) => void
	clear: () => void
}>({
	ids: new Set<string>(),
	set: () => {},
	clear: () => {},
})
