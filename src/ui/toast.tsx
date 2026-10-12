import { Store, useStore } from './hooks'

interface Toast {
  id: number
  text: string
  kind: 'info' | 'error'
}

const toasts = new Store<Toast[]>([])
let nextId = 1

export function toast(text: string, kind: Toast['kind'] = 'info', ms = 3200) {
  const id = nextId++
  toasts.set((t) => [...t, { id, text, kind }])
  setTimeout(() => toasts.set((t) => t.filter((x) => x.id !== id)), ms)
}

export function toastError(text: string) {
  toast(text, 'error', 6000)
}

export function Toasts() {
  const list = useStore(toasts)
  return (
    <div className="toast-wrap" aria-live="polite">
      {list.map((t) => (
        <div key={t.id} className={`toast ${t.kind === 'error' ? 'error' : ''}`}>
          {t.text}
        </div>
      ))}
    </div>
  )
}
