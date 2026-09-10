import React from 'react'
import ReactDOM from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { BrowserRouter } from 'react-router-dom'
import App from './App'
import { startOutboxWorker } from './lib/outbox'
import { ErrorBoundary, logClientError } from './components/ErrorBoundary'
import './index.css'

const queryClient = new QueryClient()
startOutboxWorker()

// Errors outside React's render cycle (async code, event handlers) don't
// reach ErrorBoundary — caught here instead.
window.addEventListener('error', (e) => {
  void logClientError(e.message, e.error?.stack)
})
window.addEventListener('unhandledrejection', (e) => {
  const reason = e.reason
  void logClientError(
    reason instanceof Error ? reason.message : String(reason),
    reason instanceof Error ? reason.stack : undefined
  )
})

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <BrowserRouter>
          <App />
        </BrowserRouter>
      </QueryClientProvider>
    </ErrorBoundary>
  </React.StrictMode>
)
