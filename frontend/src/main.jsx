import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { ErrorBoundary } from './components/ErrorBoundary'
import { LanguageProvider } from './context/LanguageContext'
import './index.css'

/**
 * Nothing thrown anywhere may take the page down.
 *
 * `componentDidCatch` only sees errors raised during React rendering. A rejected
 * promise in an event handler, a timer, or a fetch that nobody awaited escapes
 * it completely - and in a browser that is a silent failure with no UI at all.
 * These two listeners log those instead, so a stray rejection during the demo
 * leaves a trace rather than a mystery.
 */
window.addEventListener('unhandledrejection', (event) => {
  console.error('[Gramini] unhandled promise rejection (contained)', event.reason)
  event.preventDefault()
})

window.addEventListener('error', (event) => {
  console.error('[Gramini] uncaught error (contained)', event.error || event.message)
})

// The boundary wraps the PROVIDER as well as the app: if the language context
// itself ever throws, a boundary inside it would never run.
createRoot(document.getElementById('root')).render(
  <StrictMode>
    <ErrorBoundary onReset={() => window.location.reload()}>
      <LanguageProvider>
        <App />
      </LanguageProvider>
    </ErrorBoundary>
  </StrictMode>,
)
