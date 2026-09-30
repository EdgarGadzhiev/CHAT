import { useCallback, useEffect, useState } from 'react'
import { Bell, MessageCircle, ShieldAlert, UserRound, Users, Wallet } from 'lucide-react'
import { supabase } from './supabase'
import { callFunction, rpc, type Me } from './api'
import { getTelegramUser, getTelegramWebApp, initTelegramWebApp } from './telegram'
import { Blocked, Consent, Notice, Splash } from './screens'
import { ChatScreen } from './chat'
import { WalletScreen } from './wallet'
import { MembersScreen, NotificationsSheet, ProfileScreen } from './people'
import { ProfileSheet } from './sheets'
import { AdminScreen } from './admin'

type Tab = 'chat' | 'members' | 'wallet' | 'profile' | 'admin'
type Phase = 'loading' | 'no-telegram' | 'unavailable' | 'ready'

async function authenticate(initData: string) {
  const r = await callFunction<{ token_hash: string; type: 'magiclink' }>('tg-auth', { initData })
  const { error } = await supabase.auth.verifyOtp({ token_hash: r.token_hash, type: r.type })
  if (error) throw error
}

export default function App() {
  const [phase, setPhase] = useState<Phase>('loading')
  const [me, setMe] = useState<Me | null>(null)
  const [tab, setTab] = useState<Tab>('chat')
  const [profileId, setProfileId] = useState<string | null>(null)
  const [notifOpen, setNotifOpen] = useState(false)
  const [unread, setUnread] = useState(0)

  const refreshMe = useCallback(() => {
    rpc<Me | null>('get_me').then((m) => m && setMe(m)).catch(() => {})
  }, [])

  const refreshUnread = useCallback(() => {
    supabase.from('notifications').select('id', { count: 'exact', head: true }).eq('read', false).then(({ count }) => setUnread(count ?? 0))
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
        setPhase('ready')
      } catch {
        setPhase('unavailable')
      }
    }
    boot()
  }, [])

  useEffect(() => {
    if (phase !== 'ready') return
    refreshUnread()
    const iv = setInterval(() => { refreshMe(); refreshUnread() }, 60000)
    return () => clearInterval(iv)
  }, [phase, refreshMe, refreshUnread])

  if (phase === 'loading') return <Splash />
  if (phase === 'no-telegram') return <Notice title="Откройте NUR_CHAT в Telegram" text="Вход выполняется через ваш аккаунт Telegram. Откройте приложение через бота." />
  if (phase === 'unavailable' || !me) return <Notice title="Сервис временно недоступен" text="Не удалось выполнить вход. Закройте приложение и откройте снова через несколько минут." />
  if (me.status === 'banned') return <Blocked me={me} />
  if (!me.consent_ok) return <Consent me={me} onDone={refreshMe} />

  const staff = me.role !== 'user'
  const tabs: [Tab, string, typeof MessageCircle][] = [
    ['chat', 'Чат', MessageCircle], ['members', 'Люди', Users], ['wallet', 'Nurcoin', Wallet], ['profile', 'Профиль', UserRound],
    ...(staff ? [['admin', 'Модерация', ShieldAlert] as [Tab, string, typeof MessageCircle]] : []),
  ]

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand"><img src="/nur-chat-logo.svg" alt="" /><div><b>NUR_CHAT</b><small>Новый Уренгой · 18+</small></div></div>
        <div className="top-right">
          <button className="chip balance-chip" onClick={() => setTab('wallet')}>{me.balance} NC</button>
          <button className="icon-btn" onClick={() => setNotifOpen(true)} aria-label="Уведомления">
            <Bell size={19} />{unread > 0 && <span className="dot">{unread > 9 ? '9+' : unread}</span>}
          </button>
        </div>
      </header>

      <main className={'content' + (tab === 'chat' ? ' full' : '')}>
        {tab === 'chat' && <ChatScreen me={me} refreshMe={refreshMe} onOpenProfile={setProfileId} />}
        {tab === 'members' && <MembersScreen onOpenProfile={setProfileId} />}
        {tab === 'wallet' && <WalletScreen me={me} refreshMe={refreshMe} />}
        {tab === 'profile' && <ProfileScreen me={me} refreshMe={refreshMe} />}
        {tab === 'admin' && staff && <AdminScreen me={me} />}
      </main>

      <nav className="bottom-nav">
        {tabs.map(([k, label, Icon]) => (
          <button key={k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}><Icon size={20} /><span>{label}</span></button>
        ))}
      </nav>

      {profileId && <ProfileSheet userId={profileId} me={me} onClose={() => setProfileId(null)} onSpent={refreshMe} />}
      {notifOpen && <NotificationsSheet onClose={() => { setNotifOpen(false); refreshUnread() }} onRead={() => setUnread(0)} />}
    </div>
  )
}
