import { useEffect, useMemo, useState, type ReactNode } from 'react'
import {
  ArrowRight,
  Bell,
  BookOpen,
  CalendarDays,
  ChevronRight,
  CircleHelp,
  Gift,
  Heart,
  Home,
  MapPin,
  MessageCircle,
  MoreHorizontal,
  Plus,
  Search,
  Send,
  Settings,
  ShoppingBag,
  Sparkles,
  Ticket,
  UserRound,
  Users,
  Wallet,
  X,
  Zap,
} from 'lucide-react'
import { getTelegramUser, initTelegramWebApp, type TelegramUser } from './telegram'
import './notifications.css'

type Tab = 'home' | 'chats' | 'dating' | 'city' | 'profile'
type Icon = typeof Home
type NavItem = { id: Tab; label: string; icon: Icon }
type Room = { id: string; name: string; description: string; members: number; emoji: string; online: number }
type Message = { name: string; text: string; time: string; own: boolean }
type Notification = { id: number; title: string; text: string; time: string; icon: Icon; read: boolean }

const navItems: NavItem[] = [
  { id: 'home', label: 'Главная', icon: Home },
  { id: 'chats', label: 'Чаты', icon: MessageCircle },
  { id: 'dating', label: 'Знакомства', icon: Heart },
  { id: 'city', label: 'Город', icon: MapPin },
  { id: 'profile', label: 'Профиль', icon: UserRound },
]

const rooms: Room[] = [
  { id: 'main', name: 'Главный чат', description: 'Общение жителей города', members: 128, online: 34, emoji: '💬' },
  { id: 'city', name: 'Город', description: 'Новости, вопросы и события', members: 86, online: 21, emoji: '🏙️' },
  { id: 'night', name: 'Ночной чат', description: 'Для тех, кто ещё не спит', members: 47, online: 16, emoji: '🌙' },
  { id: 'music', name: 'Музыка', description: 'Треки, концерты и рекомендации', members: 32, online: 8, emoji: '🎵' },
]

const cityServices = [
  { icon: Ticket, title: 'Афиша', text: 'Концерты, события и мероприятия', badge: 'События' },
  { icon: ShoppingBag, title: 'Объявления', text: 'Купить, продать или найти', badge: 'Маркет' },
  { icon: Users, title: 'Услуги', text: 'Мастера и специалисты рядом', badge: 'Город' },
  { icon: BookOpen, title: 'Книги', text: 'Онлайн-библиотека и чтение', badge: 'Читайте' },
]

const demoMessages: Message[] = [
  { name: 'Андрей', text: 'Кто сегодня гулять? ☀️', time: '21:34', own: false },
  { name: 'Мария', text: 'Я после девяти могу', time: '21:35', own: false },
  { name: 'Ты', text: 'Давайте в центре?', time: '21:36', own: true },
  { name: 'Сергей', text: 'Я тоже за 👍', time: '21:37', own: false },
]

const demoNotifications: Notification[] = [
  { id: 1, title: 'Добро пожаловать в CHAT', text: 'Здесь будут появляться важные события и новости платформы.', time: 'только что', icon: Sparkles, read: false },
  { id: 2, title: 'Новая активность в «Городе»', text: 'В комнате сейчас 21 человек онлайн.', time: '5 мин назад', icon: MessageCircle, read: false },
  { id: 3, title: 'Тебе доступен Nurcoin', text: 'Баланс уже пополнен тестовыми 250 NC.', time: 'сегодня', icon: Wallet, read: true },
]

function App() {
  const [activeTab, setActiveTab] = useState<Tab>('home')
  const [selectedRoom, setSelectedRoom] = useState<Room | null>(null)
  const [rulesOpen, setRulesOpen] = useState(false)
  const [notificationsOpen, setNotificationsOpen] = useState(false)
  const [notifications, setNotifications] = useState<Notification[]>(demoNotifications)
  const [balance, setBalance] = useState(250)
  const [user, setUser] = useState<TelegramUser | null>(null)

  useEffect(() => {
    initTelegramWebApp()
    setUser(getTelegramUser())
  }, [])

  const displayName = useMemo(() => user ? [user.first_name, user.last_name].filter(Boolean).join(' ') : 'Гость', [user])
  const unreadNotifications = notifications.filter((item) => !item.read).length
  const openTab = (tab: Tab) => { setSelectedRoom(null); setActiveTab(tab) }
  const openRoom = (room: Room) => { setSelectedRoom(room); setActiveTab('chats') }
  const openNotifications = () => setNotificationsOpen(true)
  const markAllNotificationsRead = () => setNotifications((current) => current.map((item) => ({ ...item, read: true })))

  return (
    <div className="app-shell">
      <div className="ambient ambient-one" />
      <div className="ambient ambient-two" />
      <main className="app-content">
        {selectedRoom ? <ChatRoom room={selectedRoom} onBack={() => setSelectedRoom(null)} /> : <>
          <TopBar displayName={displayName} unreadNotifications={unreadNotifications} onProfile={() => openTab('profile')} onNotifications={openNotifications} />
          <div className="page-transition" key={activeTab}>
            {activeTab === 'home' && <HomePage displayName={displayName} balance={balance} onNavigate={openTab} onOpenRoom={openRoom} />}
            {activeTab === 'chats' && <ChatsPage onOpenRoom={openRoom} onRules={() => setRulesOpen(true)} />}
            {activeTab === 'dating' && <DatingPage balance={balance} onSpend={() => setBalance((value) => Math.max(0, value - 10))} />}
            {activeTab === 'city' && <CityPage />}
            {activeTab === 'profile' && <ProfilePage user={user} balance={balance} />}
          </div>
        </>}
      </main>
      {!selectedRoom && <BottomNavigation activeTab={activeTab} onChange={openTab} />}
      {rulesOpen && <RulesModal onClose={() => setRulesOpen(false)} />}
      {notificationsOpen && <NotificationsModal notifications={notifications} onClose={() => setNotificationsOpen(false)} onReadAll={markAllNotificationsRead} />}
    </div>
  )
}

function TopBar({ displayName, unreadNotifications, onProfile, onNotifications }: { displayName: string; unreadNotifications: number; onProfile: () => void; onNotifications: () => void }) {
  return <header className="topbar">
    <button className="brand-button" onClick={onProfile} aria-label="Открыть профиль"><div className="brand-mark">C</div><div><div className="brand-name">CHAT</div><div className="brand-subtitle">{displayName === 'Гость' ? 'городская платформа' : `Привет, ${displayName}`}</div></div></button>
    <button className="icon-button glass-button" onClick={onNotifications} aria-label="Уведомления"><Bell size={19} />{unreadNotifications > 0 && <span className="notification-dot" />}</button>
  </header>
}

function HomePage({ displayName, balance, onNavigate, onOpenRoom }: { displayName: string; balance: number; onNavigate: (tab: Tab) => void; onOpenRoom: (room: Room) => void }) {
  return <section>
    <div className="hero-block"><div className="eyebrow"><Sparkles size={14} /> Всё важное — в одном месте</div><h1>{displayName === 'Гость' ? 'Твой город.' : `С возвращением, ${displayName.split(' ')[0]}.`}</h1><p>Общайся, знакомься и находи интересное рядом.</p></div>
    <div className="balance-card"><div className="balance-glow" /><div className="balance-topline"><span className="muted-label">Твой баланс</span><Wallet size={18} /></div><div className="balance-value">{balance.toLocaleString('ru-RU')} <span>NC</span></div><div className="balance-bottomline"><span>Nurcoin</span><button className="small-action">Пополнить <ArrowRight size={14} /></button></div></div>
    <div className="section-heading"><div><span className="section-kicker">Быстрый доступ</span><h2>Что хочешь сделать?</h2></div></div>
    <div className="quick-grid"><QuickCard icon={MessageCircle} title="Чаты" text="Общение с городом" tone="blue" onClick={() => onNavigate('chats')} /><QuickCard icon={Heart} title="Знакомства" text="Новые люди рядом" tone="pink" onClick={() => onNavigate('dating')} /><QuickCard icon={MapPin} title="Город" text="Сервисы и события" tone="green" onClick={() => onNavigate('city')} /><QuickCard icon={Gift} title="Подарки" text="Сделай приятное" tone="gold" onClick={() => undefined} /></div>
    <div className="section-heading section-heading-row"><div><span className="section-kicker">Сейчас активны</span><h2>Комнаты</h2></div><button className="text-button" onClick={() => onNavigate('chats')}>Все <ChevronRight size={16} /></button></div>
    <div className="room-preview-list">{rooms.slice(0, 3).map((room) => <RoomRow key={room.id} room={room} onClick={() => onOpenRoom(room)} />)}</div>
    <div className="promo-card"><div className="promo-icon"><Zap size={19} /></div><div><strong>Информер дня</strong><span>Передай сообщение всему городу</span></div><ChevronRight size={18} className="promo-arrow" /></div>
  </section>
}

function QuickCard({ icon: Icon, title, text, tone, onClick }: { icon: Icon; title: string; text: string; tone: string; onClick: () => void }) {
  return <button className={`quick-card tone-${tone}`} onClick={onClick}><span className="quick-icon"><Icon size={20} /></span><span className="quick-title">{title}</span><span className="quick-text">{text}</span></button>
}

function ChatsPage({ onOpenRoom, onRules }: { onOpenRoom: (room: Room) => void; onRules: () => void }) {
  const [searchQuery, setSearchQuery] = useState('')
  const normalizedQuery = searchQuery.trim().toLocaleLowerCase('ru-RU')
  const filteredRooms = rooms.filter((room) => [room.name, room.description].some((value) => value.toLocaleLowerCase('ru-RU').includes(normalizedQuery)))

  return <section>
    <PageTitle title="Чаты" subtitle="Общайся с людьми своего города" action={<button className="icon-button" onClick={onRules} aria-label="Правила"><CircleHelp size={19} /></button>} />
    <div className="search-box"><Search size={18} /><input aria-label="Поиск комнат" value={searchQuery} onChange={(event) => setSearchQuery(event.target.value)} placeholder="Поиск комнат" style={{ width: '100%', border: 0, outline: 0, background: 'transparent', color: 'inherit', minWidth: 0, fontSize: 12 }} />{searchQuery && <button className="icon-button search-clear" onClick={() => setSearchQuery('')} aria-label="Очистить поиск"><X size={15} /></button>}</div>
    <div className="online-banner"><span className="live-dot" /><strong>412</strong> человек сейчас онлайн <ArrowRight size={15} /></div>
    {filteredRooms.length > 0 ? <div className="room-list">{filteredRooms.map((room) => <RoomRow key={room.id} room={room} large onClick={() => onOpenRoom(room)} />)}</div> : <div className="empty-state"><Search size={22} /><strong>Ничего не найдено</strong><span>Попробуй другое название комнаты.</span></div>}
    <div className="feature-section"><div className="section-heading"><div><span className="section-kicker">Больше возможностей</span><h2>В чатах</h2></div></div><div className="feature-row"><Feature icon={Gift} title="Подарки" text="Отправляй друзьям" /><Feature icon={Sparkles} title="Цветной ник" text="Выделись в комнате" /><Feature icon={Ticket} title="Конкурсы" text="Участвуй и выигрывай" /></div></div>
  </section>
}

function Feature({ icon: Icon, title, text }: { icon: Icon; title: string; text: string }) { return <button className="feature-card"><Icon size={19} /><strong>{title}</strong><span>{text}</span></button> }
function RoomRow({ room, onClick, large = false }: { room: Room; onClick: () => void; large?: boolean }) { return <button className={`room-row ${large ? 'room-row-large' : ''}`} onClick={onClick}><div className="room-avatar">{room.emoji}</div><div className="room-info"><div className="room-title-line"><strong>{room.name}</strong><span className="room-online"><i />{room.online}</span></div><span>{room.description}</span><small>{room.members} участников</small></div><ChevronRight size={18} className="room-chevron" /></button> }

function DatingPage({ balance, onSpend }: { balance: number; onSpend: () => void }) {
  const [entered, setEntered] = useState(false)
  const canEnter = balance >= 10
  return <section><PageTitle title="Знакомства" subtitle="Новые люди рядом" action={<button className="icon-button"><MoreHorizontal size={19} /></button>} /><div className="age-banner"><span>18+</span><div><strong>Раздел только для совершеннолетних</strong><small>Соблюдай правила общения и уважай других.</small></div></div><div className="dating-card"><div className="dating-photo-placeholder"><Heart size={34} /><span>Фото появятся здесь</span></div><div className="dating-profile"><span className="status-pill"><i /> Сейчас онлайн</span><h2>Случайная встреча</h2><p>Познакомься с новым человеком из своего города.</p></div><div className="dating-actions"><button className="round-action secondary"><X size={22} /></button><button className="main-dating-action" disabled={!canEnter || entered} onClick={() => { if (canEnter) { onSpend(); setEntered(true) } }}><Heart size={20} fill="currentColor" />{entered ? 'Ты в поиске' : 'Найти пару'}</button></div><div className="price-note">Вход для мужчин — <strong>10 NC</strong> · для девушек — бесплатно</div></div></section>
}

function CityPage() {
  return <section><PageTitle title="Город" subtitle="Всё, что происходит рядом" action={<button className="icon-button"><Search size={19} /></button>} /><div className="city-location"><MapPin size={17} /><span>Тюмень</span><ChevronRight size={15} /></div><div className="city-hero"><div><span>Сегодня в городе</span><strong>Найди что-нибудь<br />интересное ✨</strong></div><CalendarDays size={62} strokeWidth={1.2} /></div><div className="city-grid">{cityServices.map(({ icon: Icon, title, text, badge }) => <button className="city-card" key={title}><div className="city-card-icon"><Icon size={20} /></div><span className="city-badge">{badge}</span><strong>{title}</strong><p>{text}</p><ChevronRight size={16} /></button>)}</div><div className="informer-card"><div className="informer-icon">💌</div><div><span>500 NC · 1 день</span><strong>«Я тебя люблю, Миша»</strong><p>Покажи сообщение всему городу.</p></div><ArrowRight size={18} /></div></section>
}

function ProfilePage({ user, balance }: { user: TelegramUser | null; balance: number }) {
  const name = user ? [user.first_name, user.last_name].filter(Boolean).join(' ') : 'Гость'
  const initials = name === 'Гость' ? 'G' : name.split(' ').map((part) => part[0]).join('').slice(0, 2).toUpperCase()
  return <section><PageTitle title="Профиль" subtitle="Твой аккаунт в CHAT" action={<button className="icon-button"><Settings size={19} /></button>} /><div className="profile-card"><div className="profile-avatar">{user?.photo_url ? <img src={user.photo_url} alt="" /> : initials}</div><div className="profile-name"><h2>{name}</h2><span>{user?.username ? `@${user.username}` : 'Telegram аккаунт'}</span></div><button className="icon-button profile-more"><MoreHorizontal size={18} /></button></div><div className="wallet-card"><div><span>Баланс</span><strong>{balance.toLocaleString('ru-RU')} <em>NC</em></strong></div><button className="wallet-button"><Plus size={17} /> Пополнить</button></div><div className="settings-list"><button><span className="settings-icon"><Wallet size={18} /></span><div><strong>Nurcoin</strong><small>История операций и покупки</small></div><ChevronRight size={17} /></button><button><span className="settings-icon"><Bell size={18} /></span><div><strong>Уведомления</strong><small>Настройки уведомлений</small></div><ChevronRight size={17} /></button><button><span className="settings-icon"><CircleHelp size={18} /></span><div><strong>Помощь и правила</strong><small>Безопасность и поддержка</small></div><ChevronRight size={17} /></button></div><div className="dev-note"><strong>Frontend preview</strong><span>Данные и платежи подключим следующим этапом.</span></div></section>
}

function PageTitle({ title, subtitle, action }: { title: string; subtitle: string; action?: ReactNode }) { return <div className="page-title"><div><h1>{title}</h1><p>{subtitle}</p></div>{action}</div> }

function ChatRoom({ room, onBack }: { room: Room; onBack: () => void }) {
  const [message, setMessage] = useState('')
  const [messages, setMessages] = useState<Message[]>(demoMessages)
  const sendMessage = () => { const value = message.trim(); if (!value) return; setMessages((current) => [...current, { name: 'Ты', text: value, time: 'сейчас', own: true }]); setMessage('') }
  return <section className="chat-screen"><header className="chat-header"><button className="back-button" onClick={onBack}>‹</button><div className="room-avatar room-avatar-small">{room.emoji}</div><div className="chat-heading"><strong>{room.name}</strong><span><i /> {room.online} онлайн</span></div><button className="icon-button"><MoreHorizontal size={19} /></button></header><div className="chat-rules">Общайся уважительно · без спама · соблюдай правила</div><div className="messages">{messages.map((item, index) => <div className={`message-row ${item.own ? 'message-own' : ''}`} key={`${item.time}-${index}`}><div className="message-avatar">{item.name[0]}</div><div className="message-bubble"><div className="message-meta"><strong>{item.name}</strong><span>{item.time}</span></div><p>{item.text}</p></div></div>)}</div><div className="composer-wrap"><div className="composer"><button aria-label="Добавить"><Plus size={20} /></button><input value={message} onChange={(event) => setMessage(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') sendMessage() }} placeholder="Написать сообщение..." /><button className="send-button" onClick={sendMessage} aria-label="Отправить"><Send size={18} /></button></div></div></section>
}

function NotificationsModal({ notifications, onClose, onReadAll }: { notifications: Notification[]; onClose: () => void; onReadAll: () => void }) {
  const unreadCount = notifications.filter((item) => !item.read).length
  return <div className="modal-backdrop" onClick={onClose}><div className="modal notifications-modal" onClick={(event) => event.stopPropagation()}><div className="modal-header"><div><span className="section-kicker">Центр событий</span><h2>Уведомления</h2></div><button className="icon-button" onClick={onClose} aria-label="Закрыть"><X size={19} /></button></div><div className="notifications-list">{notifications.map(({ id, title, text, time, icon: Icon, read }) => <div className={`notification-item ${read ? 'is-read' : ''}`} key={id}><div className="notification-icon"><Icon size={18} /></div><div className="notification-content"><strong>{title}</strong><p>{text}</p><span>{time}</span></div>{!read && <i className="notification-unread" />}</div>)}</div><button className="primary-button notifications-read-button" onClick={onReadAll} disabled={unreadCount === 0}>{unreadCount > 0 ? `Прочитать всё (${unreadCount})` : 'Всё прочитано'}</button></div></div>
}

function BottomNavigation({ activeTab, onChange }: { activeTab: Tab; onChange: (tab: Tab) => void }) { return <nav className="bottom-nav">{navItems.map(({ id, label, icon: Icon }) => <button key={id} className={activeTab === id ? 'active' : ''} onClick={() => onChange(id)}><Icon size={20} strokeWidth={activeTab === id ? 2.4 : 1.8} /><span>{label}</span>{activeTab === id && <i />}</button>)}</nav> }
function RulesModal({ onClose }: { onClose: () => void }) { return <div className="modal-backdrop" onClick={onClose}><div className="modal" onClick={(event) => event.stopPropagation()}><div className="modal-header"><div><span className="section-kicker">Перед общением</span><h2>Правила CHAT</h2></div><button className="icon-button" onClick={onClose}><X size={19} /></button></div><div className="rules"><Rule number="01" title="Уважение" text="Не оскорбляй других участников и не провоцируй конфликты." /><Rule number="02" title="Без спама" text="Реклама, массовые сообщения и подозрительные ссылки запрещены." /><Rule number="03" title="Безопасность" text="Не публикуй чужие персональные данные и не выдавай себя за другого человека." /><Rule number="04" title="Модерация" text="За нарушения возможны предупреждение, мут или блокировка аккаунта." /></div><button className="primary-button" onClick={onClose}>Понятно</button></div></div> }
function Rule({ number, title, text }: { number: string; title: string; text: string }) { return <div className="rule"><span>{number}</span><div><strong>{title}</strong><p>{text}</p></div></div> }

export default App
