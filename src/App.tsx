import { Suspense, lazy, useCallback, useEffect, useState } from 'react'
import { Bell, MessageCircle, ShieldAlert, UserRound, Users, Wallet, WifiOff } from 'lucide-react'
import { supabase } from './supabase'
import { dmBus, dmState, rpc, type Me, type Peer } from './api'
import { authenticate } from './auth'
import { getTelegramUser, getTelegramWebApp, initTelegramWebApp } from './telegram'
import { Blocked, Consent, Notice, Splash } from './screens'
import { ChatScreen } from './chat'
import { WalletScreen } from './wallet'
import { MembersScreen, NotificationsSheet, ProfileScreen } from './people'
import { ProfileSheet } from './sheets'
import { DmScreen } from './dm'
import { Skeleton } from './ui'

// Панель модерации нужна единицам — не грузим её обычным пользователям
const AdminScreen = lazy(() => import('./admin').then((m) => ({ default: m.AdminScreen })))

type Tab = 'chat' | 'members' | 'wallet' | 'profile' | 'admin'
type Phase = 'loading' | 'no-telegram' | 'unavailable' | 'ready'

const ME_POLL_MS = 60_000

export default function App() {
  const [phase, setPhase] = useState<Phase>('loading')
  const [me, setMe] = useState<Me | null>(null)
  const [tab, setTab] = useState<Tab>('chat')
  const [profileId, setProfileId] = useState<string | null>(null)
  const [notifOpen, setNotifOpen] = useState(false)
  const [dm, setDm] = useState<Peer | null>(null)
  const [dmUnread, setDmUnread] = useState(0)
  const [online, setOnline] = useState(navigator.onLine)

  const refreshMe = useCallback(() => {
    rpc<Me | null>('get_me').then((m) => { if (m) { setMe(m); setDmUnread(m.dm_unread ?? 0) } }).catch(() => {})
  }, [])

  const refreshDmUnread = useCallback(() => {
    rpc<number>('dm_unread_count').then((n) => setDmUnread(n ?? 0)).catch(() => {})
  }, [])

  useEffect(() => {
    initTelegramWebApp()
    const tg = getTelegramWebApp()
    const tgUser = getTelegramUser()
    if (!tg?.initData || !tgUser) { setPhase('no-telegram'); return }

    const boot = async () => {
      try {
        const wantEmail = `tg${tgUser.id}@telegram.nurchat.internal`
        const { data } = await supabase.auth.getSession()
        let m: Me | null = null
        if (data.session?.user.email === wantEmail) {
          m = await rpc<Me | null>('get_me').catch(() => null)
        }
        if (!m) {
          await authenticate(tg.initData)
          m = await rpc<Me | null>('get_me')
        }
        if (!m) throw new Error('no_profile')
        setMe(m)
        setDmUnread(m.dm_unread ?? 0)
        setPhase('ready')
      } catch {
        setPhase('unavailable')
      }
    }
    boot()
  }, [])

  // один опрос профиля раз в минуту (баланс, блокировка, счётчики) — с разбросом, чтобы клиенты не «били» сервер одновременно
  useEffect(() => {
    if (phase !== 'ready') return
    let timer: number
    const loop = () => {
      timer = window.setTimeout(() => { if (!document.hidden) refreshMe(); loop() }, ME_POLL_MS * (0.75 + Math.random() * 0.5))
    }
    loop()
    const wake = () => { if (!document.hidden) refreshMe() }
    document.addEventListener('visibilitychange', wake)
    window.addEventListener('nur:refresh-me', refreshMe)
    return () => {
      window.clearTimeout(timer)
      document.removeEventListener('visibilitychange', wake)
      window.removeEventListener('nur:refresh-me', refreshMe)
    }
  }, [phase, refreshMe])

  useEffect(() => {
    const on = () => setOnline(true), off = () => setOnline(false)
    window.addEventListener('online', on); window.addEventListener('offline', off)
    return () => { window.removeEventListener('online', on); window.removeEventListener('offline', off) }
  }, [])

  // Личные сообщения: приватный канал «dm:<id>» присылает только сигнал «что-то пришло» (без текста)
  const myId = me?.id
  const dmFeature = me?.dm_feature
  useEffect(() => {
    if (phase !== 'ready' || !myId || !dmFeature) return
    const ch = supabase
      .channel('dm:' + myId, { config: { private: true } })
      .on('broadcast', { event: 'ping' }, () => { dmBus.dispatchEvent(new Event('ping')); refreshDmUnread() })
      .subscribe((status) => { dmState.live = status === 'SUBSCRIBED' })
    const onLocal = () => refreshDmUnread()
    dmBus.addEventListener('local', onLocal)
    return () => { supabase.removeChannel(ch); dmBus.removeEventListener('local', onLocal) }
  }, [phase, myId, dmFeature, refreshDmUnread])

  if (phase === 'loading') return <Splash />
  if (phase === 'no-telegram') return <Notice title="Откройте NUR_CHAT в Telegram" text="Вход выполняется через ваш аккаунт Telegram. Откройте приложение через бота." />
  if (phase === 'unavailable' || !me) {
    return (
      <div className="center-screen">
        <div className="card narrow">
          <img className="logo-img" src="/nur-chat-logo.svg" alt="" />
          <h1>Сервис временно недоступен</h1>
          <p className="muted">Не удалось выполнить вход. Проверьте интернет и попробуйте ещё раз.</p>
          <button className="btn primary block" onClick={() => location.reload()}>Повторить</button>
        </div>
      </div>
    )
  }
  if (me.status === 'banned') return <Blocked me={me} />
  if (!me.consent_ok) return <Consent me={me} onDone={refreshMe} />

  const staff = me.role !== 'user'
  const tabs: [Tab, string, typeof MessageCircle][] = [
    ['chat', 'Чат', MessageCircle], ['members', 'Люди', Users], ['wallet', 'Nurcoin', Wallet], ['profile', 'Профиль', UserRound],
    ...(staff ? [['admin', 'Модерация', ShieldAlert] as [Tab, string, typeof MessageCircle]] : []),
  ]
  const unread = me.notif_unread ?? 0

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand"><img src="/nur-chat-logo.svg" alt="" /><div><b>NUR_CHAT</b><small>Новый Уренгой · 18+</small></div></div>
        <div className="top-right">
          <button className="chip balance-chip" onClick={() => setTab('wallet')}><span className="coin">N</span>{me.balance.toLocaleString('ru-RU')}</button>
          <button className="icon-btn" onClick={() => setNotifOpen(true)} aria-label="Уведомления">
            <Bell size={19} />{unread > 0 && <span className="dot">{unread > 9 ? '9+' : unread}</span>}
          </button>
        </div>
      </header>

      {!online && <div className="offline-bar"><WifiOff size={14} /> Нет соединения — переподключаемся…</div>}

      {/* Чат остаётся в памяти при переключении вкладок: не теряется позиция и не перезапрашивается лента */}
      <div className={'chat-pane' + (tab === 'chat' ? '' : ' off')}>
        <ChatScreen me={me} active={tab === 'chat'} refreshMe={refreshMe} onOpenProfile={setProfileId} />
      </div>

      {tab !== 'chat' && (
        <main key={tab} className="content fade">
          {tab === 'members' && <MembersScreen me={me} dmUnread={dmUnread} onOpenProfile={setProfileId} onOpenDm={setDm} />}
          {tab === 'wallet' && <WalletScreen me={me} refreshMe={refreshMe} />}
          {tab === 'profile' && <ProfileScreen me={me} refreshMe={refreshMe} />}
          {tab === 'admin' && staff && (
            <Suspense fallback={<Skeleton rows={4} height={70} />}><AdminScreen me={me} /></Suspense>
          )}
        </main>
      )}

      <nav className="bottom-nav">
        {tabs.map(([k, label, Icon]) => (
          <button key={k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)} aria-current={tab === k ? 'page' : undefined}>
            <span className="nav-ico"><Icon size={20} />{k === 'members' && dmUnread > 0 && <i className="nav-badge">{dmUnread > 9 ? '9+' : dmUnread}</i>}</span><span>{label}</span>
          </button>
        ))}
      </nav>

      {dm && <DmScreen me={me} peer={dm} onClose={() => { setDm(null); refreshDmUnread() }} onOpenProfile={setProfileId} />}
      {profileId && (
        <ProfileSheet userId={profileId} me={me} onClose={() => setProfileId(null)} onSpent={refreshMe}
          onMessage={(p) => { setProfileId(null); setDm(p) }} />
      )}
      {notifOpen && <NotificationsSheet onClose={() => { setNotifOpen(false); refreshMe() }} onRead={refreshMe} />}
    </div>
  )
}
