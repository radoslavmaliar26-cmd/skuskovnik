import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { installRecorderGuards, recoverRecordings } from './audio/session'
import { startBackgroundWork } from './boot'

installRecorderGuards()
void recoverRecordings()
  .catch((e) => console.error('Obnova nahrávok zlyhala', e))
  .finally(() => startBackgroundWork())

// požiadaj o trvalé úložisko (Safari ho môže inak po čase vymazať)
void navigator.storage?.persist?.().catch(() => {})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
