import { createContext, useCallback, useContext, useState, type ReactNode } from 'react'
import { X } from 'lucide-react'
import { errText } from './api'

export function Sheet({ title, kicker, onClose, children }: { title: string; kicker?: string; onClose: () => void; children: ReactNode }) {
  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-head">
          <div>
            {kicker && <span className="kicker">{kicker}</span>}
            <h2>{title}</h2>
          </div>
          <button className="icon-btn" onClick={onClose} aria-label="Закрыть"><X size={18} /></button>
        </div>
        <div className="sheet-body">{children}</div>
      </div>
    </div>
  )
}

export function Avatar({ name, url, size = 36 }: { name: string; url?: string | null; size?: number }) {
  return (
    <span className="avatar" style={{ width: size, height: size, fontSize: size * 0.42 }}>
      {url ? <img src={url} alt="" referrerPolicy="no-referrer" /> : (name?.[0] ?? '?').toUpperCase()}
    </span>
  )
}

type ToastFn = (text: string) => void
const ToastCtx = createContext<ToastFn>(() => {})
export const useToast = () => useContext(ToastCtx)

export function ToastProvider({ children }: { children: ReactNode }) {
  const [text, setText] = useState('')
  const show = useCallback((t: string) => {
    setText(t)
    setTimeout(() => setText((cur) => (cur === t ? '' : cur)), 3200)
  }, [])
  return (
    <ToastCtx.Provider value={show}>
      {children}
      {text && <div className="toast">{text}</div>}
    </ToastCtx.Provider>
  )
}

/** Запускает действие, показывая понятную ошибку в тосте. */
export function useAction() {
  const toast = useToast()
  const [busy, setBusy] = useState(false)
  const run = useCallback(async <T,>(fn: () => Promise<T>, ok?: string): Promise<T | undefined> => {
    setBusy(true)
    try {
      const r = await fn()
      if (ok) toast(ok)
      return r
    } catch (e) {
      toast(errText(e))
    } finally {
      setBusy(false)
    }
  }, [toast])
  return { run, busy }
}

export function Empty({ text }: { text: string }) {
  return <div className="empty">{text}</div>
}
