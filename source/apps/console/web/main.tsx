import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './app.tsx'
import { Console } from './console.ts'
import { ConsoleProvider } from './console-provider.tsx'

// Wiring only: one connection to the console's server, handed to the app.
// What happens after is the app's, in response to whoever uses it.
const console = new Console(location.origin)

const root = document.getElementById('root')
if (!root) throw new Error('No #root element')
createRoot(root).render(
  <StrictMode>
    <ConsoleProvider console={console}>
      <App />
    </ConsoleProvider>
  </StrictMode>,
)
