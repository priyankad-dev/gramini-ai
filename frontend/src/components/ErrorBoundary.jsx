import { Component } from 'react'

/**
 * The last line of defence for a live demo.
 *
 * Without this, ONE unhandled error anywhere in the tree unmounts the whole app
 * and leaves a white screen - the single worst thing that can happen on stage,
 * because there is no way back except a reload, and a reload loses the
 * conversation.
 *
 * With it, the failure is contained: the user sees a calm message in their own
 * language and a button that puts them straight back to a working app.
 *
 * Deliberately a class component. Error boundaries have no hooks equivalent -
 * `componentDidCatch` is the only way React exposes this.
 */
export class ErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { failed: false }
  }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  componentDidCatch(error, info) {
    // Logged, never swallowed: the demo continues, and the cause is still
    // recoverable from the console afterwards.
    console.error('[Gramini] render error contained by ErrorBoundary', error, info)
  }

  handleReset = () => {
    this.setState({ failed: false })
    this.props.onReset?.()
  }

  render() {
    if (!this.state.failed) return this.props.children

    // Plain strings, not the i18n bundle: whatever crashed might BE the
    // language context, and a fallback that depends on the broken thing is not
    // a fallback.
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center gap-5 px-6 text-center">
        <span aria-hidden="true" className="text-5xl">🌾</span>
        <div>
          <p className="text-lg font-bold text-ink">कुछ गड़बड़ हो गई</p>
          <p className="mt-1 text-base text-muted">
            Something went wrong. Your information is safe.
          </p>
        </div>
        <button
          type="button"
          onClick={this.handleReset}
          className="min-h-tap rounded-xl2 bg-saffron px-6 py-3 text-base font-bold text-onbrand"
        >
          फिर से शुरू कीजिए · Start again
        </button>
      </div>
    )
  }
}
