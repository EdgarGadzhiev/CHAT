import { createContext, useCallback, useContext, useState, type ReactNode } from 'react'
import { ChevronRight, X } from 'lucide-react'
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

const hueOf = (name: string) => {
  let h = 0
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) % 360
  return h
}
/** Цвет автора по имени — единый для аватара и ника. */
export const nameColor = (name: string) => `hsl(${hueOf(name || '?')} 85% 74%)`

export function Avatar({ name, url, size = 36 }: { name: string; url?: string | null; size?: number }) {
  const h = hueOf(name || '?')
  return (
    <span
      className="avatar"
      style={{ width: size, height: size, fontSize: size * 0.44, background: url ? undefined : `linear-gradient(135deg, hsl(${h} 70% 58%), hsl(${(h + 40) % 360} 70% 44%))` }}
    >
      {url ? <img src={url} alt="" referrerPolicy="no-referrer" /> : <b>{(Array.from(name || '?')[0] ?? '?').toUpperCase()}</b>}
    </span>
  )
}

export function Skeleton({ rows = 4, height = 60 }: { rows?: number; height?: number }) {
  return (
    <div className="skeletons">
      {Array.from({ length: rows }, (_, i) => <div key={i} className="skeleton" style={{ height }} />)}
    </div>
  )
}

export function Switch({ checked, onChange, label, hint }: { checked: boolean; onChange: (v: boolean) => void; label: string; hint?: string }) {
  return (
    <button type="button" className="switch-row" onClick={() => onChange(!checked)} role="switch" aria-checked={checked}>
      <span><b>{label}</b>{hint && <small className="muted">{hint}</small>}</span>
      <span className={'switch' + (checked ? ' on' : '')}><i /></span>
    </button>
  )
}

/** Строка меню: иконка, заголовок, подпись, стрелка. */
export function MenuRow({ icon, title, hint, onClick, danger, right }: { icon: ReactNode; title: string; hint?: string; onClick?: () => void; danger?: boolean; right?: ReactNode }) {
  return (
    <button type="button" className={'menu-row' + (danger ? ' danger' : '')} onClick={onClick}>
      <span className="menu-icon">{icon}</span>
      <span className="menu-text"><b>{title}</b>{hint && <small>{hint}</small>}</span>
      {right ?? <ChevronRight size={18} className="chev" />}
    </button>
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

export function Empty({ text, icon }: { text: string; icon?: ReactNode }) {
  return <div className="empty">{icon && <div className="empty-icon">{icon}</div>}{text}</div>
}
