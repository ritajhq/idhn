import { createContext, type ReactNode, useContext } from 'react'
import type { Console } from './console.ts'

const ConsoleContext = createContext<Console | null>(null)

/** Hands the one `Console` to every screen below it. */
export function ConsoleProvider(
  { console, children }: { console: Console; children: ReactNode },
) {
  return (
    <ConsoleContext.Provider value={console}>
      {children}
    </ConsoleContext.Provider>
  )
}

export function useConsole(): Console {
  const console = useContext(ConsoleContext)
  if (!console) {
    throw new Error('useConsole must be used within a ConsoleProvider')
  }
  return console
}
