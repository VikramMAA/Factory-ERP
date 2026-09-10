import { Component, type ErrorInfo, type ReactNode } from 'react'
import { supabase } from '../lib/supabase'

// SPEC.md Phase 5: "error boundary and a client error log table." Catches
// render-time errors that would otherwise blank the whole app (the same
// failure mode fixed for missing env vars in App.tsx, generalized). Runtime
// errors outside React's render cycle are caught separately in main.tsx via
// window.onerror / unhandledrejection.
export async function logClientError(message: string, stack?: string) {
  try {
    const { data } = await supabase.auth.getSession()
    await supabase.from('client_error_log').insert({
      message: message.slice(0, 2000),
      stack: stack?.slice(0, 4000) ?? null,
      url: window.location.pathname,
      user_id: data.session?.user.id ?? null,
    })
  } catch {
    // Logging the error must never itself throw and mask the original one.
  }
}

interface State {
  error: Error | null
}

export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    void logClientError(error.message, error.stack ?? info.componentStack ?? undefined)
  }

  render() {
    if (this.state.error) {
      return (
        <div className="min-h-screen flex items-center justify-center p-4">
          <div className="max-w-sm space-y-3 text-center">
            <p className="text-red-400 font-medium">Something went wrong</p>
            <p className="text-slate-400 text-sm">
              The error has been logged. Try going back to the home screen.
            </p>
            <button
              className="h-touch px-4 rounded-lg bg-blue-600 font-medium"
              onClick={() => {
                this.setState({ error: null })
                window.location.href = '/'
              }}
            >
              Go home
            </button>
          </div>
        </div>
      )
    }
    return this.props.children
  }
}
