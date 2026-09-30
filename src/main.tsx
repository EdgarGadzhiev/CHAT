import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { ToastProvider } from './ui'
import './app.css'
import './app2.css'
import './app3.css'
import { installMockTelegram } from './dev-mock'

if (import.meta.env.DEV && location.search.includes('mock')) installMockTelegram()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ToastProvider>
      <App />
    </ToastProvider>
  </StrictMode>,
)
