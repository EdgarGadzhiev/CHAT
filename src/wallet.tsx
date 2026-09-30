import { useEffect, useMemo, useState } from 'react'
import { ArrowDownLeft, ArrowUpRight, Gift, Minus, Plus, ShieldCheck, Sparkles, Wallet } from 'lucide-react'
import { supabase } from './supabase'
import { callFunction, fmtDate, rpc, rub, type Me } from './api'
import { getTelegramWebApp, haptic } from './telegram'
import { DocLinks } from './legal'
import { Empty, Skeleton, useAction } from './ui'

type Row = { id: number; amount: number; balance_after: number; kind: string; note: string | null; created_at: string }
type GiftRow = { id: number; emoji: string; title: string; price: number; created_at: string; direction: 'in' | 'out'; other: string }
type Pricing = { rate: number; min: number; max: number; step: number }

const KIND: Record<string, string> = {
  purchase: 'Покупка Nurcoin', spend_promo: 'Продвижение сообщения', spend_gift: 'Подарок',
  admin_adjust: 'Корректировка администрацией', refund: 'Возврат',
}
const QUICK = [100, 250, 500, 1000, 2500]

export function WalletScreen({ me, refreshMe }: { me: Me; refreshMe: () => void }) {
  const [pricing, setPricing] = useState<Pricing | null>(null)
  const [amount, setAmount] = useState(250)
  const [rows, setRows] = useState<Row[] | null>(null)
  const [gifts, setGifts] = useState<GiftRow[] | null>(null)
  const [email, setEmail] = useState('')
  const [tab, setTab] = useState<'ops' | 'gifts'>('ops')
  const { run, busy } = useAction()

  useEffect(() => {
    refreshMe()
    supabase.from('chat_settings').select('key,value').in('key', ['nc_price_kop', 'nc_min', 'nc_max', 'nc_step']).then(({ data }) => {
      const s = Object.fromEntries((data ?? []).map((r) => [r.key, Number(r.value)]))
      const p = { rate: s.nc_price_kop || 100, min: s.nc_min || 50, max: s.nc_max || 5000, step: s.nc_step || 10 }
      setPricing(p)
      setAmount((a) => Math.min(p.max, Math.max(p.min, Math.round(a / p.step) * p.step)))
    })
    supabase.from('ledger').select('*').order('id', { ascending: false }).limit(40).then(({ data }) => setRows((data as Row[]) ?? []))
    rpc<GiftRow[]>('my_gifts_history').then(setGifts).catch(() => setGifts([]))
  }, [])

  const pct = useMemo(() => (pricing ? ((amount - pricing.min) / (pricing.max - pricing.min)) * 100 : 0), [amount, pricing])
  const clamp = (v: number) => (pricing ? Math.min(pricing.max, Math.max(pricing.min, v)) : v)
  const change = (v: number) => { haptic('light'); setAmount(clamp(v)) }

  const buy = async () => {
    const r = await run(() => callFunction<{ confirmation_url: string }>('create-payment', { nc_amount: amount, email: email.trim() || undefined }))
    if (r?.confirmation_url) {
      const tg = getTelegramWebApp()
      if (tg?.openLink) tg.openLink(r.confirmation_url)
      else window.open(r.confirmation_url, '_blank')
    }
  }

  return (
    <section className="page">
      <div className="balance-card">
        <span className="balance-label"><Wallet size={15} /> Ваш баланс</span>
        <div className="balance">{me.balance.toLocaleString('ru-RU')} <small>NC</small></div>
        <span className="balance-note">Внутренняя валюта сервиса — на подарки и продвижение сообщений</span>
      </div>

      <div className="panel">
        <div className="panel-head"><h3>Купить Nurcoin</h3><span className="muted small">выберите сумму ползунком</span></div>
        {!pricing ? <Skeleton rows={2} height={70} /> : (
          <>
            <div className="amount-row">
              <button className="step-btn" onClick={() => change(amount - pricing.step * 5)} aria-label="Меньше"><Minus size={18} /></button>
              <div className="amount"><b>{amount.toLocaleString('ru-RU')}</b><span>NC</span></div>
              <button className="step-btn" onClick={() => change(amount + pricing.step * 5)} aria-label="Больше"><Plus size={18} /></button>
            </div>
            <input className="slider" type="range" min={pricing.min} max={pricing.max} step={pricing.step} value={amount}
              style={{ ['--pct' as string]: pct + '%' }} onChange={(e) => setAmount(Number(e.target.value))} aria-label="Количество Nurcoin" />
            <div className="slider-scale"><span>{pricing.min}</span><span>{pricing.max.toLocaleString('ru-RU')}</span></div>
            <div className="chips center-chips">
              {QUICK.filter((q) => q >= pricing.min && q <= pricing.max).map((q) => (
                <button key={q} className={'chip pick' + (amount === q ? ' on' : '')} onClick={() => change(q)}>{q}</button>
              ))}
            </div>
            <div className="pay-line"><span>К оплате</span><b>{rub(amount * pricing.rate)}</b></div>
            <input className="input" type="email" inputMode="email" placeholder="Email для чека (по желанию)" value={email} onChange={(e) => setEmail(e.target.value)} />
            <button className="btn primary block big" disabled={busy} onClick={buy}><Sparkles size={18} /> Купить {amount} NC</button>
            <p className="legal-note"><ShieldCheck size={13} /><span>Оплата на защищённой странице платёжной системы. Покупая, вы принимаете <DocLinks ids={[['offer', 'оферту']]} />. Email нужен только для чека и у нас не хранится.</span></p>
          </>
        )}
      </div>

      <div className="segment">
        <button className={tab === 'ops' ? 'on' : ''} onClick={() => setTab('ops')}>Операции</button>
        <button className={tab === 'gifts' ? 'on' : ''} onClick={() => setTab('gifts')}>Подарки</button>
      </div>
      {tab === 'ops' ? (
        rows === null ? <Skeleton rows={3} height={56} /> : rows.length === 0 ? <Empty icon={<Wallet size={26} />} text="Операций пока нет" /> : (
          <div className="group">
            {rows.map((r) => (
              <div key={r.id} className="op-row">
                <span className={'op-icon ' + (r.amount > 0 ? 'in' : 'out')}>{r.amount > 0 ? <ArrowDownLeft size={17} /> : <ArrowUpRight size={17} />}</span>
                <span className="op-text"><b>{KIND[r.kind] ?? r.kind}</b><small>{r.note ? r.note + ' · ' : ''}{fmtDate(r.created_at)}</small></span>
                <b className={r.amount > 0 ? 'plus' : 'minus'}>{r.amount > 0 ? '+' : ''}{r.amount} NC</b>
              </div>
            ))}
          </div>
        )
      ) : gifts === null ? <Skeleton rows={3} height={56} /> : gifts.length === 0 ? <Empty icon={<Gift size={26} />} text="Подарков пока нет" /> : (
        <div className="group">
          {gifts.map((g) => (
            <div key={g.id} className="op-row">
              <span className="op-icon gift">{g.emoji}</span>
              <span className="op-text"><b>{g.title}</b><small>{g.direction === 'in' ? 'от' : 'для'} {g.other} · {fmtDate(g.created_at)}</small></span>
              <b className={g.direction === 'in' ? 'plus' : 'minus'}>{g.direction === 'in' ? 'получен' : `−${g.price} NC`}</b>
            </div>
          ))}
        </div>
      )}
    </section>
  )
}
