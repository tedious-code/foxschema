import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './frontend/App.tsx'
import { SetupScreen } from './frontend/components/SetupScreen'
import { resolveApiBase, setApiBase } from './frontend/api/apiBase'
import { getSetupState, type SetupState } from './frontend/api/setupApi'
import './style.css'

const root = ReactDOM.createRoot(document.getElementById('app')!)

function renderApp() {
  root.render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  )
}

// Boot: on the desktop shell, gate on first-run setup (the sidecar isn't spawned
// until the user binds an encryption key). On the web there's nothing to set up.
async function boot() {
  const setup = await getSetupState().catch(() => null)

  if (setup && !setup.setup_complete) {
    root.render(
      <React.StrictMode>
        <SetupScreen
          initial={setup}
          onDone={(s: SetupState) => {
            setApiBase(s.api_base)
            renderApp()
          }}
        />
      </React.StrictMode>,
    )
    return
  }

  // Already set up (or web): resolve the API base, then render.
  if (setup?.api_base) setApiBase(setup.api_base)
  else await resolveApiBase()
  renderApp()
}

boot()
