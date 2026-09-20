import { useEffect, useMemo, useState } from 'react'
import {
  Bell,
  ChevronRight,
  CircleAlert,
  Gift,
  Home,
  MessageCircle,
  UserRound,
  Users,
  Wallet
} from 'lucide-react'
import {
  getTelegramUser,
  initTelegramWebApp,
  type TelegramUser
} from './telegram'
import {
  ChatRoom,
  GiftModal,
  Modal,
  PeoplePage,
  PersonModal,
  FriendsPage,
  type Person
} from './feature-components'
import { supabase } from './supabase'
import { AuthScreen } from './auth'
import './notifications.css'

type Tab = 'home' | 'chats' | 'friends' | 'profile'

type Notification = {
  id: number
  title: string
  text: string
  time: string
  read: boolean
}

type Transaction = {
  id: number
  title: string
  amount: number
  time: string
}

const people: Person[] = [
  {
    id: 1,
    name: 'Андрей',
    avatar: '👨🏻',
    username: 'andrey',
    online: true
  },
  {
    id: 2,
    name: 'Мария',
    avatar: '👩🏻',
    username: 'maria',
    online: true
  },
  {
    id: 3,
    name: 'Сергей',
    avatar: '👨🏼',
    username: 'sergey',
    online: false
  },
  {
    id: 4,
    name: 'Алина',
    avatar: '👩🏻',
    username: 'alina',
    online: true
  }
]

const nav = [
  {
    id: 'home' as Tab,
    label: 'Главная',
    icon: Home
  },
  {
    id: 'chats' as Tab,
    label: 'Чаты',
    icon: MessageCircle
  },
  {
    id: 'friends' as Tab,
    label: 'Друзья',
    icon: Users
  },
  {
    id: 'profile' as Tab,
    label: 'Профиль',
    icon: UserRound
  }
]

export default function App() {
  const [tab, setTab] = useState<Tab>('home')
  const [room, setRoom] = useState(false)
  const [user, setUser] = useState<TelegramUser | null>(null)
  const [authReady, setAuthReady] = useState(false)
  const [session, setSession] = useState<any>(null)
  const [balance, setBalance] = useState(250)

  const [notifications, setNotifications] = useState<Notification[]>([
    {
      id: 1,
      title: 'Добро пожаловать',
      text: 'Общайся, добавляй друзей и отправляй подарки.',
      time: 'сейчас',
      read: false
    }
  ])

  const [transactions, setTransactions] = useState<Transaction[]>([
    {
      id: 1,
      title: 'Стартовый баланс',
      amount: 250,
      time: 'сегодня'
    }
  ])

  const [modal, setModal] = useState<
    'wallet' | 'notifications' | 'gifts' | 'person' | null
  >(null)

  const [selected, setSelected] = useState<Person | null>(null)

  const [friends, setFriends] = useState<Person[]>(
    people.slice(0, 2)
  )

  useEffect(() => {
    initTelegramWebApp()

    setUser(getTelegramUser())

    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session)
      setAuthReady(true)
    })

    const {
      data: { subscription }
    } = supabase.auth.onAuthStateChange((_event, next) => {
      setSession(next)
      setAuthReady(true)
    })

    return () => {
      subscription.unsubscribe()
    }
  }, [])

  /*
   * ВАЖНО:
   * useMemo должен находиться ДО условных return.
   * Иначе порядок React Hooks меняется после авторизации,
   * из-за чего приложение может падать с тёмным экраном.
   */
  const name = useMemo(
    () =>
      user
        ? [user.first_name, user.last_name]
            .filter(Boolean)
            .join(' ')
        : 'Гость',
    [user]
  )

  if (!authReady) {
    return (
      <div className="auth-shell">
        <div className="auth-loading">
          NUR_CHAT
        </div>
      </div>
    )
  }

  if (!session) {
    return <AuthScreen telegramUser={user} />
  }

  const notify = (title: string, text: string) =>
    setNotifications(v => [
      {
        id: Date.now(),
        title,
        text,
        time: 'сейчас',
        read: false
      },
      ...v
    ])

  const buy = (amount: number, price: string) => {
    setBalance(v => v + amount)

    setTransactions(v => [
      {
        id: Date.now(),
        title: 'Пополнение +' + amount + ' NC',
        amount,
        time: 'сейчас · ' + price
      },
      ...v
    ])

    notify(
      'Nurcoin пополнен',
      'На баланс добавлено ' + amount + ' NC.'
    )
  }

  const sendGift = (
    price: number,
    gift: string,
    person: string
  ) => {
    setBalance(v => Math.max(0, v - price))

    notify(
      'Подарок отправлен',
      gift +
        ' отправлен пользователю ' +
        person +
        '.'
    )

    setModal(null)
  }

  const addFriend = (p: Person) => {
    if (!friends.some(f => f.id === p.id)) {
      setFriends(v => [...v, p])

      notify(
        'Новый друг',
        p.name + ' добавлен(а) в друзья.'
      )
    } else {
      notify(
        'Уже в друзьях',
        p.name +
          ' уже есть в списке друзей.'
      )
    }
  }

  const openPerson = (p: Person) => {
    setSelected(p)
    setModal('person')
  }

  const openChat = (p: Person) => {
    setSelected(p)
    setModal(null)
    setRoom(true)
  }

  const go = (t: Tab) => {
    setRoom(false)
    setTab(t)
  }

  if (room) {
    return (
      <div className="app-shell">
        <main className="app-content">
          <ChatRoom
            onBack={() => setRoom(false)}
            onGift={() => setModal('gifts')}
            onNotify={notify}
            onOpenProfile={openPerson}
          />
        </main>

        {modal === 'gifts' && (
          <GiftModal
            balance={balance}
            onClose={() => setModal(null)}
            onSend={sendGift}
          />
        )}

        {modal === 'person' && selected && (
          <PersonModal
            person={selected}
            isFriend={friends.some(
              f => f.id === selected.id
            )}
            onClose={() => setModal(null)}
            onAdd={() => addFriend(selected)}
            onChat={() => openChat(selected)}
            onGift={() => setModal('gifts')}
          />
        )}
      </div>
    )
  }

  return (
    <div className="app-shell">
      <main className="app-content">
        <TopBar
          unread={
            notifications.filter(n => !n.read).length
          }
          onNotifications={() =>
            setModal('notifications')
          }
        />

        {tab === 'home' && (
          <HomePage
            name={name}
            balance={balance}
            onChat={() => setRoom(true)}
            onWallet={() => setModal('wallet')}
            onFriends={() => go('friends')}
            onGifts={() => setModal('gifts')}
          />
        )}

        {tab === 'chats' && (
          <section>
            <PageTitle
              title="Чаты"
              subtitle="Общий чат и личные сообщения"
            />

            <button
              className="main-chat-card"
              onClick={() => setRoom(true)}
            >
              <span className="main-chat-icon">
                💬
              </span>

              <div>
                <strong>Общий чат</strong>
                <small>
                  247 онлайн · общайся со всеми
                </small>
              </div>

              <ChevronRight size={18} />
            </button>

            <div className="chat-info-card">
              <MessageCircle size={18} />

              <div>
                <strong>
                  Личные сообщения
                </strong>

                <span>
                  Открой профиль человека и нажми
                  «Написать».
                </span>
              </div>
            </div>

            <PeoplePage
              onAdd={addFriend}
              onOpenProfile={openPerson}
            />
          </section>
        )}

        {tab === 'friends' && (
          <FriendsPage
            friends={friends}
            onOpenChat={openChat}
            onOpenProfile={openPerson}
            onAdd={() => go('chats')}
          />
        )}

        {tab === 'profile' && (
          <ProfilePage
            user={user}
            name={name}
            balance={balance}
            friends={friends.length}
            onWallet={() => setModal('wallet')}
            onFriends={() => go('friends')}
            onLogout={async () => {
              await supabase.auth.signOut()
            }}
          />
        )}
      </main>

      <BottomNav
        active={tab}
        onChange={go}
      />

      {modal === 'wallet' && (
        <WalletModal
          balance={balance}
          transactions={transactions}
          onClose={() => setModal(null)}
          onBuy={buy}
        />
      )}

      {modal === 'notifications' && (
        <NotificationsModal
          items={notifications}
          onClose={() => setModal(null)}
          onRead={() =>
            setNotifications(v =>
              v.map(n => ({
                ...n,
                read: true
              }))
            )
          }
        />
      )}

      {modal === 'gifts' && (
        <GiftModal
          balance={balance}
          onClose={() => setModal(null)}
          onSend={sendGift}
        />
      )}

      {modal === 'person' && selected && (
        <PersonModal
          person={selected}
          isFriend={friends.some(
            f => f.id === selected.id
          )}
          onClose={() => setModal(null)}
          onAdd={() => addFriend(selected)}
          onChat={() => openChat(selected)}
          onGift={() => setModal('gifts')}
        />
      )}
    </div>
  )
}

function TopBar({
  unread,
  onNotifications
}: {
  unread: number
  onNotifications: () => void
}) {
  return (
    <header className="topbar">
      <div className="brand-button">
        <div className="brand-mark">
          <img
            src="/nur-chat-logo.svg"
            alt=""
          />
        </div>

        <div>
          <div className="brand-name">
            NUR_CHAT
          </div>

          <div className="brand-subtitle">
            общение · друзья · подарки
          </div>
        </div>
      </div>

      <button
        className="icon-button glass-button"
        onClick={onNotifications}
      >
        <Bell size={19} />

        {unread > 0 && (
          <span className="notification-dot" />
        )}
      </button>
    </header>
  )
}

function HomePage({
  name,
  balance,
  onChat,
  onWallet,
  onFriends,
  onGifts
}: {
  name: string
  balance: number
  onChat: () => void
  onWallet: () => void
  onFriends: () => void
  onGifts: () => void
}) {
  return (
    <section>
      <div className="hero-block">
        <span className="eyebrow">
          <MessageCircle size={13} />
          Городской чат
        </span>

        <h1>
          {name === 'Гость'
            ? 'Общайся. Находи друзей.'
            : 'Привет, ' +
              name.split(' ')[0] +
              '.'}
        </h1>

        <p>
          Общий чат, личные сообщения, друзья и
          виртуальные подарки за Nurcoin.
        </p>
      </div>

      <div className="balance-card">
        <div className="balance-topline">
          <span>Твой баланс</span>
          <Wallet size={18} />
        </div>

        <div className="balance-value">
          {balance.toLocaleString('ru-RU')}{' '}
          <span>NC</span>
        </div>

        <div className="balance-bottomline">
          <span>Nurcoin</span>

          <button
            className="small-action"
            onClick={onWallet}
          >
            Пополнить
            <ChevronRight size={14} />
          </button>
        </div>
      </div>

      <div className="section-heading">
        <div>
          <span className="section-kicker">
            NUR_CHAT
          </span>

          <h2>Быстрый доступ</h2>
        </div>
      </div>

      <div className="quick-grid">
        <button
          className="quick-card tone-blue"
          onClick={onChat}
        >
          <span className="quick-icon">
            <MessageCircle size={20} />
          </span>

          <strong>Общий чат</strong>
          <span>247 человек онлайн</span>
        </button>

        <button
          className="quick-card tone-green"
          onClick={onFriends}
        >
          <span className="quick-icon">
            <Users size={20} />
          </span>

          <strong>Друзья</strong>
          <span>Твои контакты</span>
        </button>

        <button
          className="quick-card tone-gold"
          onClick={onWallet}
        >
          <span className="quick-icon">
            <Wallet size={20} />
          </span>

          <strong>Nurcoin</strong>
          <span>Пополнить баланс</span>
        </button>

        <button
          className="quick-card tone-pink"
          onClick={onGifts}
        >
          <span className="quick-icon">
            <Gift size={20} />
          </span>

          <strong>Подарки</strong>
          <span>Отправляй друзьям</span>
        </button>
      </div>

      <div className="home-note">
        <CircleAlert size={18} />

        <div>
          <strong>
            Обычный городской чат
          </strong>

          <span>
            Без знакомств 18+ и верификации. Есть
            жалобы и модерация.
          </span>
        </div>
      </div>
    </section>
  )
}

function PageTitle({
  title,
  subtitle
}: {
  title: string
  subtitle: string
}) {
  return (
    <div className="page-title">
      <div>
        <h1>{title}</h1>
        <p>{subtitle}</p>
      </div>
    </div>
  )
}

function ProfilePage({
  user,
  name,
  balance,
  friends,
  onWallet,
  onFriends,
  onLogout
}: {
  user: TelegramUser | null
  name: string
  balance: number
  friends: number
  onWallet: () => void
  onFriends: () => void
  onLogout: () => void
}) {
  const initials =
    name === 'Гость'
      ? 'G'
      : name
          .split(' ')
          .map(p => p[0])
          .join('')
          .slice(0, 2)
          .toUpperCase()

  return (
    <section>
      <PageTitle
        title="Профиль"
        subtitle="Твой аккаунт в NUR_CHAT"
      />

      <div className="profile-card">
        <div className="profile-avatar">
          {user?.photo_url ? (
            <img
              src={user.photo_url}
              alt=""
            />
          ) : (
            initials
          )}
        </div>

        <div className="profile-name">
          <h2>{name}</h2>

          <span>
            {user?.username
              ? '@' + user.username
              : 'Telegram аккаунт'}
          </span>

          {user && (
            <small>ID: {user.id}</small>
          )}
        </div>
      </div>

      <div className="profile-actions">
        <button onClick={onWallet}>
          Nurcoin · {balance} NC
        </button>

        <button onClick={onFriends}>
          Друзья · {friends}
        </button>
      </div>

      <div className="settings-list">
        <button onClick={onWallet}>
          <Wallet size={18} />

          <div>
            <strong>Nurcoin</strong>
            <small>
              Баланс, пополнение и история
            </small>
          </div>

          <ChevronRight size={17} />
        </button>

        <button onClick={onFriends}>
          <Users size={18} />

          <div>
            <strong>Друзья</strong>
            <small>
              {friends} человека в списке
            </small>
          </div>

          <ChevronRight size={17} />
        </button>

        <button onClick={onLogout}>
          <UserRound size={18} />

          <div>
            <strong>
              Выйти из аккаунта
            </strong>

            <small>
              Сбросить текущую Supabase-сессию
            </small>
          </div>

          <ChevronRight size={17} />
        </button>
      </div>
    </section>
  )
}

function WalletModal({
  balance,
  transactions,
  onClose,
  onBuy
}: {
  balance: number
  transactions: Transaction[]
  onClose: () => void
  onBuy: (amount: number, price: string) => void
}) {
  const packs: [number, string][] = [
    [100, '99 ₽'],
    [500, '399 ₽'],
    [1000, '699 ₽'],
    [2500, '1 499 ₽']
  ]

  return (
    <Modal
      title="Nurcoin"
      kicker="КОШЕЛЁК · ВНУТРЕННЯЯ ВАЛЮТА"
      onClose={onClose}
    >
      <div className="wallet-hero">
        <div>
          <span>Текущий баланс</span>

          <strong>
            {balance.toLocaleString('ru-RU')}{' '}
            <em>NC</em>
          </strong>
        </div>

        <div className="wallet-coin">
          NC
        </div>
      </div>

      <div className="wallet-section-head">
        <span>Пополнить баланс</span>
        <small>
          Выбери пакет Nurcoin
        </small>
      </div>

      <div className="wallet-packs">
        {packs.map(([amount, price]) => (
          <button
            className={
              amount === 500
                ? 'popular'
                : ''
            }
            key={amount}
            onClick={() =>
              onBuy(amount, price)
            }
          >
            <strong>
              {amount} NC
            </strong>

            <span>{price}</span>

            {amount === 500 && (
              <em>Популярный</em>
            )}
          </button>
        ))}
      </div>

      <div className="wallet-info">
        <Wallet size={15} />

        <span>
          Сейчас это demo. После подключения
          YooKassa оплата будет проходить через
          защищённую страницу, а NC зачисляться
          после подтверждения платежа.
        </span>
      </div>

      <div className="transaction-list">
        <div className="wallet-section-head">
          <span>
            История операций
          </span>

          <small>
            Последние операции
          </small>
        </div>

        {transactions
          .slice(0, 5)
          .map(t => (
            <div
              className="transaction-row"
              key={t.id}
            >
              <span>
                {t.title}
                <small>{t.time}</small>
              </span>

              <b>
                +{t.amount} NC
              </b>
            </div>
          ))}
      </div>
    </Modal>
  )
}

function NotificationsModal({
  items,
  onClose,
  onRead
}: {
  items: Notification[]
  onClose: () => void
  onRead: () => void
}) {
  return (
    <div
      className="modal-backdrop"
      onClick={onClose}
    >
      <div
        className="modal notifications-modal"
        onClick={e =>
          e.stopPropagation()
        }
      >
        <div className="modal-header">
          <div>
            <span className="section-kicker">
              NUR_CHAT · ЦЕНТР УВЕДОМЛЕНИЙ
            </span>

            <h2>Уведомления</h2>
          </div>

          <button
            className="icon-button"
            onClick={onClose}
          >
            <Bell size={18} />
          </button>
        </div>

        {items.length === 0 ? (
          <div className="notifications-empty">
            <Bell size={24} />

            <strong>
              Пока нет уведомлений
            </strong>

            <span>
              Здесь появятся сообщения о
              друзьях, подарках и других
              событиях.
            </span>
          </div>
        ) : (
          <>
            <div className="notifications-list">
              {items.map(n => (
                <div
                  className={
                    'notification-item ' +
                    (n.read
                      ? 'is-read'
                      : '')
                  }
                  key={n.id}
                >
                  <div className="notification-icon">
                    <Bell size={16} />
                  </div>

                  <div className="notification-content">
                    <strong>
                      {n.title}
                    </strong>

                    <p>{n.text}</p>

                    <span>
                      {n.time}
                    </span>
                  </div>

                  {!n.read && (
                    <i className="notification-unread" />
                  )}
                </div>
              ))}
            </div>

            <button
              className="primary-button notifications-read-button"
              onClick={onRead}
            >
              Прочитать всё
            </button>
          </>
        )}
      </div>
    </div>
  )
}

function BottomNav({
  active,
  onChange
}: {
  active: Tab
  onChange: (t: Tab) => void
}) {
  return (
    <nav className="bottom-nav">
      {nav.map(item => {
        const Icon = item.icon

        return (
          <button
            key={item.id}
            className={
              active === item.id
                ? 'active'
                : ''
            }
            onClick={() =>
              onChange(item.id)
            }
          >
            <Icon size={19} />
            <span>{item.label}</span>
          </button>
        )
      })}
    </nav>
  )
}