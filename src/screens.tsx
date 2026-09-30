import { useState } from 'react'
import type { Me } from './api'
import { rpc, errText, fmtDate } from './api'
import { DocLinks } from './legal'

export function Splash({ text = 'NUR_CHAT' }: { text?: string }) {
  return (
    <div className="center-screen">
      <div className="splash"><img src="/nur-chat-logo.svg" alt="" /><span>{text}</span></div>
    </div>
  )
}

export function Notice({ title, text }: { title: string; text: string }) {
  return (
    <div className="center-screen">
      <div className="card narrow">
        <img className="logo-img" src="/nur-chat-logo.svg" alt="" />
        <h1>{title}</h1>
        <p className="muted">{text}</p>
      </div>
    </div>
  )
}

export function Blocked({ me }: { me: Me }) {
  return (
    <div className="center-screen">
      <div className="card narrow">
        <div className="logo danger">!</div>
        <h1>Аккаунт заблокирован</h1>
        <p className="muted">
          {me.banned_until ? `Блокировка действует до ${fmtDate(me.banned_until)}.` : 'Блокировка бессрочная.'}
        </p>
        {me.ban_reason && <p className="note">Причина: {me.ban_reason}</p>}
        <p className="muted small">Если вы считаете, что это ошибка, обратитесь к администрации.</p>
      </div>
    </div>
  )
}

export function Consent({ me, onDone }: { me: Me; onDone: () => void }) {
  const [age, setAge] = useState(false)
  const [pd, setPd] = useState(false)
  const [terms, setTerms] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  const submit = async () => {
    setBusy(true)
    setErr('')
    try {
      await rpc('accept_consents', { p_age_confirmed: true })
      onDone()
    } catch (e) {
      setErr(errText(e))
      setBusy(false)
    }
  }

  return (
    <div className="center-screen">
      <div className="card">
        <img className="logo-img" src="/nur-chat-logo.svg" alt="" />
        <span className="kicker">NUR_CHAT · Новый Уренгой</span>
        <h1>Добро пожаловать, {me.display_name}</h1>
        <p className="muted">
          Городской чат с внутренней валютой Nurcoin. Для входа нужно подтвердить возраст и принять условия.
        </p>

        <div className="points">
          <div><b>Что мы храним</b><span>Telegram ID, имя, username, фото (если доступны), ваши сообщения и операции с Nurcoin.</span></div>
          <div><b>Что видят другие</b><span>Только отображаемое имя, «о себе», сообщения и фото профиля (если вы включите). Telegram ID и username скрыты.</span></div>
          <div><b>Ваши права</b><span>Скачать данные и удалить аккаунт можно в разделе «Профиль».</span></div>
        </div>

        <label className="check"><input type="checkbox" checked={age} onChange={(e) => setAge(e.target.checked)} />
          <span>Мне исполнилось 18 лет</span></label>
        <label className="check"><input type="checkbox" checked={pd} onChange={(e) => setPd(e.target.checked)} />
          <span>Я даю согласие на обработку персональных данных на условиях <DocLinks ids={[['policy', 'Политики обработки персональных данных']]} /></span></label>
        <label className="check"><input type="checkbox" checked={terms} onChange={(e) => setTerms(e.target.checked)} />
          <span>Я принимаю <DocLinks ids={[['terms', 'Пользовательское соглашение и правила чата']]} /> и <DocLinks ids={[['offer', 'оферту о Nurcoin']]} /></span></label>

        {err && <div className="error">{err}</div>}
        <button className="btn primary block" disabled={!(age && pd && terms) || busy} onClick={submit}>
          {busy ? 'Сохраняем…' : 'Продолжить'}
        </button>
        <p className="muted small">Согласие сохраняется с версией документа и временем. Его можно отозвать, удалив аккаунт.</p>
      </div>
    </div>
  )
}
