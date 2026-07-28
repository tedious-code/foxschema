import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './frontend/App.tsx'
import { SetupScreen } from './frontend/components/SetupScreen'
import { SignupWizard } from './frontend/components/SignupWizard'
import { LoadingScreen } from './frontend/components/LoadingScreen'
import { resolveApiBase, setApiBase } from './frontend/api/apiBase'
import { getSetupState, type SetupState } from './frontend/api/setupApi'
import { getSignupState } from './frontend/api/signupApi'
import { hardenAgainstInspect } from './frontend/lib/harden'
import './style.css'

// Packaged desktop only: block the WebView inspector (no-op on web / in dev).
hardenAgainstInspect()

const rootEl = document.getElementById('app')
if (!rootEl) {
  throw new Error('Fox Schema boot failed: #app root missing from index.html')
}

const root = ReactDOM.createRoot(rootEl)

function renderFatal(err: unknown) {
  const message = err instanceof Error ? err.message : String(err)
  const stack = err instanceof Error ? err.stack ?? '' : ''
  root.render(
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 12,
        padding: 24,
        background: '#020617',
        color: '#fda4af',
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
        fontSize: 13,
        textAlign: 'center',
      }}
    >
      <div style={{ color: '#e2e8f0', fontWeight: 700, fontSize: 16 }}>Fox Schema failed to start</div>
      <pre
        style={{
          maxWidth: 720,
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
          background: 'rgba(136,19,55,0.25)',
          border: '1px solid rgba(244,63,94,0.35)',
          borderRadius: 8,
          padding: 16,
          margin: 0,
          textAlign: 'left',
        }}
      >
        {message}
        {stack ? `\n\n${stack}` : ''}
      </pre>
      <div style={{ color: '#94a3b8' }}>
        Open DevTools → Console, or hard-refresh (Ctrl/⌘+Shift+R).
      </div>
    </div>,
  )
}

function renderApp() {
  root.render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  )
}

/** Don't let an hung /signup/state keep the splash up forever. */
function signupStateWithTimeout(ms = 4000): Promise<{ shown: boolean }> {
  return new Promise((resolve) => {
    const timer = window.setTimeout(() => resolve({ shown: true }), ms)
    getSignupState()
      .then((s) => {
        window.clearTimeout(timer)
        resolve(s)
      })
      .catch(() => {
        window.clearTimeout(timer)
        resolve({ shown: true })
      })
  })
}

// After the required setup gate (if any) resolves: offer the skippable
// "stay in the loop" signup wizard once, then render the app. Fails open on
// a network hiccup — never let this optional step block boot.
async function afterSetup() {
  const signup = await signupStateWithTimeout()
  if (!signup.shown) {
    root.render(
      <React.StrictMode>
        <SignupWizard onDone={renderApp} />
      </React.StrictMode>,
    )
    return
  }
  renderApp()
}

// Boot: on the desktop shell, gate on first-run setup (the sidecar isn't spawned
// until the user binds an encryption key). On the web there's nothing to set up.
// A splash renders immediately so there's never a blank frame while that check
// (or, on web, resolveApiBase()) is in flight.
async function boot() {
  root.render(
    <React.StrictMode>
      <LoadingScreen />
    </React.StrictMode>,
  )

  const setup = await getSetupState().catch(() => null)

  if (setup && !setup.setup_complete) {
    root.render(
      <React.StrictMode>
        <SetupScreen
          initial={setup}
          onDone={(s: SetupState) => {
            setApiBase(s.api_base)
            void afterSetup().catch(renderFatal)
          }}
        />
      </React.StrictMode>,
    )
    return
  }

  // Already set up (or web): resolve the API base, then render.
  if (setup?.api_base) setApiBase(setup.api_base)
  else await resolveApiBase()
  await afterSetup()
}

window.addEventListener('error', (ev) => {
  // Only replace the UI if React never mounted a real screen (boot fallback still present).
  if (document.getElementById('boot-fallback')) {
    renderFatal(ev.error ?? ev.message)
  }
})
window.addEventListener('unhandledrejection', (ev) => {
  if (document.getElementById('boot-fallback')) {
    renderFatal(ev.reason)
  }
})

boot().catch(renderFatal)
