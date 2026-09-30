import { useEffect, useState } from 'react'
import { Flag, Gift as GiftIcon } from 'lucide-react'
import { supabase } from './supabase'
import { REPORT_CATEGORIES, rpc, type Gift, type Me, type Msg, type PromoOption } from './api'
import { Avatar, Empty, Sheet, Skeleton, useAction } from './ui'

export type ReportTarget = { kind: 'message'; id: number; author: string } | { kind: 'user'; id: string; author: string }

export function ReportSheet({ target, onClose }: { target: ReportTarget; onClose: () => void }) {
  const [cat, setCat] = useState('')
  const [comment, setComment] = useState('')
  const { run, busy } = useAction()

  const send = async () => {
    const ok = await run(async () => {
      if (target.kind === 'message') await rpc('report_message', { p_message: target.id, p_category: cat, p_comment: comment || null })
      else await rpc('report_user', { p_user: target.id, p_category: cat, p_comment: comment || null })
      return true
    }, 'Жалоба отправлена администрации')
    if (ok) onClose()
  }

  return (
    <Sheet title="Пожаловаться" kicker={target.kind === 'message' ? `Сообщение · ${target.author}` : `Пользователь · ${target.author}`} onClose={onClose}>
      <div className="radio-list">
        {REPORT_CATEGORIES.map(([k, label]) => (
          <label key={k} className={'radio' + (cat === k ? ' on' : '')}>
            <input type="radio" name="cat" checked={cat === k} onChange={() => setCat(k)} />
            {label}
          </label>
        ))}
      </div>
      <textarea className="input" rows={3} maxLength={300} placeholder="Комментарий (необязательно)" value={comment} onChange={(e) => setComment(e.target.value)} />
      <button className="btn primary block" disabled={!cat || busy} onClick={send}>Отправить жалобу</button>
      <p className="muted small">Жалобу рассматривает модератор. Заведомо ложные жалобы ведут к ограничению.</p>
    </Sheet>
  )
}

export function GiftSheet({ toId, toName, me, onClose, onSpent }: { toId: string; toName: string; me: Me; onClose: () => void; onSpent: () => void }) {
  const [gifts, setGifts] = useState<Gift[] | null>(null)
  const { run, busy } = useAction()
  useEffect(() => {
    supabase.from('gifts').select('*').eq('enabled', true).order('sort').then(({ data }) => setGifts((data as Gift[]) ?? []))
  }, [])

  const send = async (g: Gift) => {
    const ok = await run(async () => { await rpc('send_gift', { p_to: toId, p_gift: g.id }); return true }, `${g.emoji} отправлен: ${toName}`)
    if (ok) { onSpent(); onClose() }
  }

  return (
    <Sheet title="Подарок" kicker={`Для: ${toName}`} onClose={onClose}>
      <div className="balance-line">Ваш баланс: <b>{me.balance} NC</b></div>
      {!gifts ? <Skeleton rows={3} height={64} /> : gifts.length === 0 ? <Empty text="Подарки пока недоступны" /> : (
        <div className="grid-3">
          {gifts.map((g) => (
            <button key={g.id} className="tile" disabled={busy || me.balance < g.price} onClick={() => send(g)}>
              <span className="big">{g.emoji}</span>
              <b>{g.title}</b>
              <span className="muted small">{g.price} NC</span>
            </button>
          ))}
        </div>
      )}
      <p className="muted small">Подарок — цифровая картинка. Он не имеет денежной ценности, его нельзя обменять или вернуть.</p>
    </Sheet>
  )
}

export function PromoteSheet({ msg, me, onClose, onSpent }: { msg: Msg; me: Me; onClose: () => void; onSpent: () => void }) {
  const [opts, setOpts] = useState<PromoOption[] | null>(null)
  const { run, busy } = useAction()
  useEffect(() => {
    supabase.from('promo_options').select('*').eq('enabled', true).order('id').then(({ data }) => setOpts((data as PromoOption[]) ?? []))
  }, [])

  const buy = async (o: PromoOption) => {
    const ok = await run(async () => { await rpc('boost_message', { p_message: msg.id, p_option: o.id }); return true }, 'Готово!')
    if (ok) { onSpent(); onClose() }
  }
  const dur = (m: number) => (m >= 1440 ? `${Math.round(m / 1440)} сут.` : m >= 60 ? `${Math.round(m / 60)} ч.` : `${m} мин.`)

  return (
    <Sheet title="Продвинуть сообщение" kicker="Nurcoin" onClose={onClose}>
      <blockquote className="quote">{msg.body || 'Фото'}</blockquote>
      <div className="balance-line">Ваш баланс: <b>{me.balance} NC</b></div>
      {!opts ? <Skeleton rows={3} height={64} /> : opts.length === 0 ? <Empty text="Продвижение пока недоступно" /> : (
        <div className="list">
          {opts.map((o) => (
            <button key={o.id} className="row-btn" disabled={busy || me.balance < o.price} onClick={() => buy(o)}>
              <span><b>{o.title}</b><small className="muted">{o.kind === 'top' ? 'Сообщение закрепляется в верхней ленте' : 'Сообщение подсвечивается'} · {dur(o.duration_minutes)}</small></span>
              <b>{o.price} NC</b>
            </button>
          ))}
        </div>
      )}
      <p className="muted small">Продвигаемое сообщение помечается. Правила чата действуют как обычно; реклама товаров и услуг запрещена.</p>
    </Sheet>
  )
}

type ProfileData = { id: string; display_name: string; bio: string; role: string; photo_url: string | null; banned: boolean; created_at: string; messages: number; gifts: { emoji: string; title: string; n: number }[] }

export function ProfileSheet({ userId, me, onClose, onSpent }: { userId: string; me: Me; onClose: () => void; onSpent: () => void }) {
  const [p, setP] = useState<ProfileData | null | undefined>(undefined)
  const [sub, setSub] = useState<'gift' | 'report' | null>(null)
  useEffect(() => { rpc<ProfileData | null>('get_profile', { p_id: userId }).then(setP).catch(() => setP(null)) }, [userId])

  return (
    <>
      <Sheet title="Профиль" onClose={onClose}>
        {p === undefined ? <Skeleton rows={3} height={64} /> : p === null ? <Empty text="Профиль недоступен" /> : (
          <>
            <div className="profile-head">
              <div className="hero-avatar"><Avatar name={p.display_name} url={p.photo_url} size={84} /></div>
              <h3>{p.display_name} {p.role !== 'user' && <span className="badge">{p.role === 'admin' ? 'админ' : 'модератор'}</span>}</h3>
              {p.bio && <p>{p.bio}</p>}
              <span className="muted small">В чате с {new Date(p.created_at).toLocaleDateString('ru-RU')} · сообщений: {p.messages}</span>
            </div>
            <h4>Подарки</h4>
            {p.gifts.length === 0 ? <p className="muted small">Пока нет подарков</p> : (
              <div className="chips">{p.gifts.map((g) => <span key={g.emoji} className="chip" title={g.title}>{g.emoji} × {g.n}</span>)}</div>
            )}
            {p.id !== me.id && (
              <div className="actions">
                <button className="btn primary" onClick={() => setSub('gift')}><GiftIcon size={16} /> Подарить</button>
                <button className="btn" onClick={() => setSub('report')}><Flag size={16} /> Пожаловаться</button>
              </div>
            )}
          </>
        )}
      </Sheet>
      {sub === 'gift' && p && <GiftSheet toId={p.id} toName={p.display_name} me={me} onClose={() => setSub(null)} onSpent={onSpent} />}
      {sub === 'report' && p && <ReportSheet target={{ kind: 'user', id: p.id, author: p.display_name }} onClose={() => setSub(null)} />}
    </>
  )
}
