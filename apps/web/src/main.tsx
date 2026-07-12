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

const root = ReactDOM.createRoot(document.getElementById('app')!)

function renderApp() {
  root.render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  )
}

// After the required setup gate (if any) resolves: offer the skippable
// "stay in the loop" signup wizard once, then render the app. Fails open on
// a network hiccup — never let this optional step block boot.
async function afterSetup() {
  const signup = await getSignupState().catch(() => ({ shown: true }))
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
            afterSetup()
          }}
        />
      </React.StrictMode>,
    )
    return
  }

  // Already set up (or web): resolve the API base, then render.
  if (setup?.api_base) setApiBase(setup.api_base)
  else await resolveApiBase()
  afterSetup()
}

boot()
