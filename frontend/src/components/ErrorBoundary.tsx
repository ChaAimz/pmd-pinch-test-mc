import { Component, type ErrorInfo, type ReactNode } from 'react'
import { AlertTriangle, RotateCcw, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'

interface Props {
  children: ReactNode
}

interface State {
  error: Error | null
}

/**
 * Catches render-time exceptions so a crash in any route shows a recoverable
 * card instead of a black screen — critical for an unattended operator display.
 *
 * Mounted around <Routes> in App.tsx; the E-Stop overlay is deliberately kept
 * OUTSIDE this boundary so hardware-safety UI survives a route crash.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // Surface to the console for the operator's support log.
    console.error('[ErrorBoundary] UI crashed:', error, info.componentStack)
  }

  private handleReset = () => this.setState({ error: null })

  private handleReload = () => window.location.reload()

  render() {
    const { error } = this.state
    if (!error) return this.props.children

    return (
      <div className="flex min-h-screen w-full items-center justify-center bg-background p-6">
        <div className="bg-card border border-border rounded-xl shadow-sm max-w-lg w-full p-6 space-y-4">
          <div className="flex items-center gap-3">
            <AlertTriangle size={22} className="shrink-0 text-red-500" />
            <h2 className="text-lg font-bold">Something went wrong</h2>
          </div>
          <p className="text-sm text-muted-foreground">
            The interface hit an unexpected error and stopped rendering this view.
            Machine motion is controlled by the PLC and is unaffected. Try again, or
            reload the app if the problem persists.
          </p>
          <pre className="max-h-40 overflow-auto rounded-md bg-muted px-3 py-2 text-xs font-mono text-red-600 dark:text-red-400 whitespace-pre-wrap break-words">
            {error.message || String(error)}
          </pre>
          <div className="flex gap-2">
            <Button onClick={this.handleReset} className="gap-1.5">
              <RotateCcw size={15} />
              Try again
            </Button>
            <Button variant="outline" onClick={this.handleReload} className="gap-1.5">
              <RefreshCw size={15} />
              Reload app
            </Button>
          </div>
        </div>
      </div>
    )
  }
}
