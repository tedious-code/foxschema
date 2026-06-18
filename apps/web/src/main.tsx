import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './frontend/App.tsx'
import { resolveApiBase } from './frontend/api/apiBase'
import './style.css'

// Resolve the API base (dynamic sidecar port under Tauri) before first render,
// so the very first request hits the right origin.
resolveApiBase().finally(() => {
  ReactDOM.createRoot(document.getElementById('app')!).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  )
})
