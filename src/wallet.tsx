import { useEffect, useState } from 'react'
import { Wallet } from 'lucide-react'
import { supabase } from './supabase'
import { callFunction, fmtDate, rpc, rub, type Me, type Pack } from './api'
import { getTelegramWebApp } from './telegram'
import { DocLinks } from './legal'
import { Empty, useAction } from './ui'

type Row = { id: number; amount: number; balance_after: number; kind: string; note: string | null; created_at: string }
type GiftRow = { id: number; emoji: string; title: string; price: number; created_at: string; direction: 'in' | 'out'; other: string }

const KIND: Record<string, string> = {
  purchase: 'Покупка Nurcoin', spend_promo: 'Продвижение сообщения', spend_gift: 'Подарок',
  admin_adjust: 'Корректировка администрацией', refund: 'Возврат',
}

export function WalletScreen({ me, refreshMe }: { me: Me; refreshMe: () => void }) {
  const [packs, setPacks] = useState<Pack[]>([])
  const [rows, setRows] = useState<Row[]>([])
  const [gifts, setGifts] = useState<GiftRow[]>([])
  const [email, setEmail] = useState('')
  const [tab, setTab] = useState<'ops' | 'gifts'>('ops')
  const { run, busy } = useAction()

  useEffect(() => {
    refreshMe()
    supabase.from('nc_packs').select('*').eq('enabled', true).order('nc_amount').then(({ data }) => setPacks((data as Pack[]) ?? []))
    supabase.from('ledger').select('*').order('id', { ascending: false }).limit(40).then(({ data }) => setRows((data as Row[]) ?? []))
    rpc<GiftRow[]>('my_gifts_history').then(setGifts).catch(() => {})
  }, [])

  const buy = async (p: Pack) => {
    const r = await run(() => callFunction<{ confirmation_url: string }>('create-payment', { pack_id: p.id, email: email.trim() || undefined }))
    if (r?.confirmation_url) {
      const tg = getTelegramWebApp()
      if (tg?.openLink) tg.openLink(r.confirmation_url)
      else window.open(r.confirmation_url, '_blank')
    }
  }

  return (
    <section className="page">
      <div className="balance-card">
        <span className="muted">Баланс</span>
        <div className="balance"><Wallet size={26} /> {me.balance.toLocaleString('ru-RU')} <small>NC</small></div>
        <span className="muted small">Nurcoin — внутренняя единица сервиса. Не вывод и не обмен на деньги.</span>
      </div>

      <h3>Купить Nurcoin</h3>
      <div className="grid-2">
        {packs.map((p) => (
          <button key={p.id} className="tile" disabled={busy} onClick={() => buy(p)}>
            <b className="big">{p.nc_amount} NC</b>
            <span>{rub(p.price_kop)}</span>
          </button>
        ))}
      </div>
      <input className="input" type="email" inputMode="email" placeholder="Email для чека (по желанию)" value={email} onChange={(e) => setEmail(e.target.value)} />
      <p className="muted small">
        Оплата — на защищённой странице платёжной системы. Нажимая «купить», вы принимаете <DocLinks ids={[['offer', 'оферту']]} />. Email нужен только для отправки чека и у нас не сохраняется.
      </p>

      <div className="tabs">
        <button className={tab === 'ops' ? 'on' : ''} onClick={() => setTab('ops')}>История операций</button>
        <button className={tab === 'gifts' ? 'on' : ''} onClick={() => setTab('gifts')}>Подарки</button>
      </div>
      {tab === 'ops' ? (
        rows.length === 0 ? <Empty text="Операций пока нет" /> : (
          <div className="list">
            {rows.map((r) => (
              <div key={r.id} className="row">
                <span><b>{KIND[r.kind] ?? r.kind}</b><small className="muted">{r.note ? r.note + ' · ' : ''}{fmtDate(r.created_at)}</small></span>
                <b className={r.amount > 0 ? 'plus' : 'minus'}>{r.amount > 0 ? '+' : ''}{r.amount} NC</b>
              </div>
            ))}
          </div>
        )
      ) : gifts.length === 0 ? <Empty text="Подарков пока нет" /> : (
        <div className="list">
          {gifts.map((g) => (
            <div key={g.id} className="row">
              <span><b>{g.emoji} {g.title}</b><small className="muted">{g.direction === 'in' ? 'от' : 'для'} {g.other} · {fmtDate(g.created_at)}</small></span>
              <b className={g.direction === 'in' ? 'plus' : 'minus'}>{g.direction === 'in' ? 'получен' : `−${g.price} NC`}</b>
            </div>
          ))}
        </div>
      )}
    </section>
  )
}
