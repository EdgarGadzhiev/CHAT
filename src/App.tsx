import { useEffect, useMemo, useState } from 'react'
import { Bell, ChevronRight, CircleAlert, Flag, Gift, Heart, Home, MessageCircle, ShieldCheck, Star, UserRound, Wallet, X } from 'lucide-react'
import { getTelegramUser, initTelegramWebApp, type TelegramUser } from './telegram'
import { ChatRoom, DatingPage, GiftModal, Modal } from './feature-components'
import './notifications.css'

type Tab = 'home' | 'chats' | 'dating' | 'profile'
type AdminTab = 'overview' | 'reports' | 'users' | 'economy' | 'ads' | 'activity'
type Notification = { id:number; title:string; text:string; time:string; read:boolean }
type Transaction = { id:number; title:string; amount:number; time:string }
type Room = { id:string; name:string; description:string; members:number; online:number; emoji:string }

const nav = [
  { id:'home' as Tab, label:'Главная', icon:Home },
  { id:'chats' as Tab, label:'Чаты', icon:MessageCircle },
  { id:'dating' as Tab, label:'Знакомства', icon:Heart },
  { id:'profile' as Tab, label:'Профиль', icon:UserRound },
]

const rooms:Room[] = [
  { id:'dating', name:'Знакомства', description:'Главный чат для общения и новых знакомств', members:428, online:73, emoji:'💬' },
  { id:'18plus', name:'18+ знакомства', description:'Только для совершеннолетних · правила обязательны', members:216, online:41, emoji:'🔞' },
  { id:'night', name:'Ночной чат', description:'Общение, музыка и знакомства поздним вечером', members:119, online:27, emoji:'🌙' },
]

const initialNotifications:Notification[] = [
  { id:1, title:'Добро пожаловать', text:'Заполни профиль и начинай знакомиться.', time:'сейчас', read:false },
  { id:2, title:'Безопасность', text:'Если видишь нарушение, используй кнопку «Пожаловаться».', time:'сегодня', read:false },
]

export default function App(){
  const [tab,setTab]=useState<Tab>('home')
  const [room,setRoom]=useState<Room|null>(null)
  const [user,setUser]=useState<TelegramUser|null>(null)
  const [balance,setBalance]=useState(250)
  const [notifications,setNotifications]=useState(initialNotifications)
  const [transactions,setTransactions]=useState<Transaction[]>([{id:1,title:'Стартовый баланс',amount:250,time:'сегодня'}])
  const [modal,setModal]=useState<'wallet'|'notifications'|'gifts'|'rules'|'profile-edit'|null>(null)
  const [admin,setAdmin]=useState(false)
  const [adminTab,setAdminTab]=useState<AdminTab>('overview')

  useEffect(()=>{ initTelegramWebApp(); setUser(getTelegramUser()) },[])

  const name=useMemo(()=>user?[user.first_name,user.last_name].filter(Boolean).join(' '):'Гость',[user])
  const unread=notifications.filter(n=>!n.read).length
  const go=(next:Tab)=>{setRoom(null);setTab(next);setAdmin(false)}
  const notify=(title:string,text:string)=>setNotifications(v=>[{id:Date.now(),title,text,time:'сейчас',read:false},...v])
  const buy=(amount:number,price:string)=>{
    setBalance(v=>v+amount)
    setTransactions(v=>[{id:Date.now(),title:`Пополнение +${amount} NC`,amount,time:`сейчас · ${price}`},...v])
    notify('Nurcoin пополнен',`На баланс добавлено ${amount} NC.`)
  }
  const spend=(amount:number)=>setBalance(v=>Math.max(0,v-amount))
  const sendGift=(price:number,gift:string,person:string)=>{spend(price);notify('Подарок отправлен',`${gift} отправлен пользователю ${person}.`);setModal(null)}

  if(admin) return <AdminPanel tab={adminTab} setTab={setAdminTab} onExit={()=>setAdmin(false)} />

  return <div className="app-shell"><main className="app-content">
    {room ? <ChatRoom room={room} onBack={()=>setRoom(null)} onGift={()=>setModal('gifts')} onNotify={notify}/> : <>
      <TopBar name={name} unread={unread} onProfile={()=>go('profile')} onNotifications={()=>setModal('notifications')}/>
      <div className="page-transition" key={tab}>
        {tab==='home' && <HomePage name={name} balance={balance} onTab={go} onRoom={setRoom} onWallet={()=>setModal('wallet')} onGifts={()=>setModal('gifts')}/>} 
        {tab==='chats' && <ChatsPage onRoom={setRoom} onRules={()=>setModal('rules')}/>} 
        {tab==='dating' && <DatingPage balance={balance} onSpend={()=>spend(10)} onNotify={notify}/>} 
        {tab==='profile' && <ProfilePage user={user} name={name} balance={balance} onWallet={()=>setModal('wallet')} onNotifications={()=>setModal('notifications')} onRules={()=>setModal('rules')} onAdmin={()=>setAdmin(true)} onEdit={()=>setModal('profile-edit')}/>} 
      </div>
    </>}
  </main>
  {!room && <BottomNav active={tab} onChange={go}/>} 
  {modal==='wallet' && <WalletModal balance={balance} transactions={transactions} onClose={()=>setModal(null)} onBuy={buy}/>} 
  {modal==='notifications' && <NotificationsModal items={notifications} onClose={()=>setModal(null)} onRead={()=>setNotifications(v=>v.map(n=>({...n,read:true})))}/>} 
  {modal==='gifts' && <GiftModal balance={balance} onClose={()=>setModal(null)} onSend={sendGift}/>} 
  {modal==='rules' && <RulesModal onClose={()=>setModal(null)}/>} 
  {modal==='profile-edit' && <ProfileEditModal name={name} onClose={()=>setModal(null)} onSave={(value)=>{notify('Профиль обновлён',`Никнейм сохранён: ${value}`);setModal(null)}}/>}
  </div>
}

function TopBar({name,unread,onProfile,onNotifications}:{name:string;unread:number;onProfile:()=>void;onNotifications:()=>void}){return <header className="topbar"><button className="brand-button" onClick={onProfile}><div className="brand-mark">C</div><div><div className="brand-name">CHAT</div><div className="brand-subtitle">знакомства · общение · подарки</div></div></button><button className="icon-button glass-button" onClick={onNotifications}><Bell size={19}/>{unread>0&&<span className="notification-dot"/>}</button></header>}

function HomePage({name,balance,onTab,onRoom,onWallet,onGifts}:{name:string;balance:number;onTab:(t:Tab)=>void;onRoom:(r:Room)=>void;onWallet:()=>void;onGifts:()=>void}){return <section>
  <div className="hero-block"><span className="eyebrow"><Heart size={13}/> Платформа знакомств</span><h1>{name==='Гость'?'Знакомься. Общайся.':`Привет, ${name.split(' ')[0]}.`}</h1><p>Живые чаты, новые знакомства и виртуальные подарки — всё внутри CHAT.</p></div>
  <div className="balance-card"><div className="balance-topline"><span>Твой баланс</span><Wallet size={18}/></div><div className="balance-value">{balance.toLocaleString('ru-RU')} <span>NC</span></div><div className="balance-bottomline"><span>Нуркоины</span><button className="small-action" onClick={onWallet}>Пополнить <ChevronRight size={14}/></button></div></div>
  <div className="section-heading"><div><span className="section-kicker">MVP</span><h2>Что доступно</h2></div></div>
  <div className="quick-grid"><QuickCard icon={MessageCircle} title="Чаты" text="Общайся и знакомься" tone="blue" onClick={()=>onTab('chats')}/><QuickCard icon={Heart} title="Знакомства" text="Новые люди" tone="pink" onClick={()=>onTab('dating')}/><QuickCard icon={Gift} title="Подарки" text="За нуркоины" tone="gold" onClick={onGifts}/><QuickCard icon={Star} title="Активность" text="Рейтинг участников" tone="green" onClick={()=>onTab('chats')}/></div>
  <div className="section-heading section-heading-row"><div><span className="section-kicker">Сейчас онлайн</span><h2>Чаты знакомств</h2></div><button className="text-button" onClick={()=>onTab('chats')}>Все <ChevronRight size={15}/></button></div>
  <div className="room-preview-list">{rooms.map(r=><RoomRow key={r.id} room={r} onClick={()=>onRoom(r)}/>)}</div>
  <div className="economy-note"><Wallet size={17}/><div><strong>Нуркоины — только внутри CHAT</strong><span>Подарки и внутренние механики. Вывод в реальные деньги не предусмотрен.</span></div></div>
</section>}

function QuickCard({icon:Icon,title,text,tone,onClick}:{icon:any;title:string;text:string;tone:string;onClick:()=>void}){return <button className={`quick-card tone-${tone}`} onClick={onClick}><span className="quick-icon"><Icon size={20}/></span><strong>{title}</strong><span>{text}</span></button>}
function ChatsPage({onRoom,onRules}:{onRoom:(r:Room)=>void;onRules:()=>void}){return <section><PageTitle title="Чаты" subtitle="Главные комнаты для знакомств" action={<button className="icon-button" onClick={onRules}><ShieldCheck size={19}/></button>}/><div className="online-banner"><span className="live-dot"/><strong>141</strong> человек сейчас онлайн</div><div className="room-list">{rooms.map(r=><RoomRow key={r.id} room={r} large onClick={()=>onRoom(r)}/>)}</div><div className="report-hint"><Flag size={18}/><div><strong>Увидел нарушение?</strong><span>Пожалуйся на сообщение или пользователя — жалоба попадёт модератору.</span></div></div><div className="feature-section"><div className="section-heading"><div><span className="section-kicker">Экономика</span><h2>Внутри чата</h2></div></div><div className="feature-row"><div className="feature-card"><Gift size={18}/><strong>Подарки</strong><span>Отправляй за NC</span></div><div className="feature-card"><Star size={18}/><strong>Активность</strong><span>Рейтинг участников</span></div><div className="feature-card"><ShieldCheck size={18}/><strong>Модерация</strong><span>Жалобы и защита</span></div></div></div></section>}
function RoomRow({room,onClick,large=false}:{room:Room;onClick:()=>void;large?:boolean}){return <button className={`room-row ${large?'room-row-large':''}`} onClick={onClick}><div className="room-avatar">{room.emoji}</div><div className="room-info"><div className="room-title-line"><strong>{room.name}</strong><span className="room-online"><i/>{room.online}</span></div><span>{room.description}</span><small>{room.members} участников</small></div><ChevronRight size={18} className="room-chevron"/></button>}

function ProfilePage({user,name,balance,onWallet,onNotifications,onRules,onAdmin,onEdit}:{user:TelegramUser|null;name:string;balance:number;onWallet:()=>void;onNotifications:()=>void;onRules:()=>void;onAdmin:()=>void;onEdit:()=>void}){const initials=name==='Гость'?'G':name.split(' ').map(p=>p[0]).join('').slice(0,2).toUpperCase();return <section><PageTitle title="Профиль" subtitle="Твой аккаунт в CHAT" action={<button className="icon-button" onClick={onEdit}><UserRound size={18}/></button>}/><div className="profile-card"><div className="profile-avatar">{user?.photo_url?<img src={user.photo_url} alt=""/>:initials}</div><div className="profile-name"><h2>{name}</h2><span>{user?.username?`@${user.username}`:'Telegram аккаунт'}</span>{user&&<small>ID: {user.id}</small>}</div><span className="profile-about-badge">18+</span></div><div className="profile-actions"><button onClick={onEdit}>Изменить профиль</button><button onClick={onWallet}>Нуркоины · {balance} NC</button></div><div className="settings-list"><button onClick={onWallet}><Wallet size={18}/><div><strong>Нуркоины</strong><small>Баланс, подарки и история операций</small></div><ChevronRight size={17}/></button><button onClick={onNotifications}><Bell size={18}/><div><strong>Уведомления</strong><small>События и активность</small></div><ChevronRight size={17}/></button><button onClick={onRules}><ShieldCheck size={18}/><div><strong>Правила и безопасность</strong><small>Жалобы, блокировки и помощь</small></div><ChevronRight size={17}/></button><button onClick={onAdmin}><CircleAlert size={18}/><div><strong>Панель модерации</strong><small>Демо-интерфейс администратора</small></div><ChevronRight size={17}/></button></div><div className="dev-note"><strong>MVP preview</strong><span>Интерфейс подготовлен под дальнейшее подключение backend, realtime, хранения фото и ролей.</span></div></section>}

function AdminPanel({tab,setTab,onExit}:{tab:AdminTab;setTab:(t:AdminTab)=>void;onExit:()=>void}){const reports=[['Контент 18+','Пользователь @maxim','Фото в чате','На проверке'],['Оскорбление','Пользователь @dima','Сообщение','На проверке'],['Спам','Пользователь @anna','Сообщение','Решено']];const users=[['@maxim','Максим','73 сообщения','Предупреждение'],['@dima','Дмитрий','31 сообщение','Ограничен'],['@anna','Анна','184 сообщения','Активен']];return <div className="admin-shell"><header className="admin-header"><div><span className="section-kicker">CHAT ADMIN</span><h1>Модерация и управление</h1><p>Демо-панель ролей, жалоб, экономики и активности.</p></div><button className="icon-button" onClick={onExit}><X size={18}/></button></header><div className="admin-tabs">{([['overview','Обзор'],['reports','Жалобы'],['users','Пользователи'],['economy','Нуркоины'],['ads','Реклама'],['activity','Активность']] as [AdminTab,string][]).map(([id,label])=><button className={tab===id?'active':''} onClick={()=>setTab(id)} key={id}>{label}</button>)}</div>{tab==='overview'&&<div className="admin-grid"><AdminStat title="Жалобы" value="12" note="4 требуют решения"/><AdminStat title="Онлайн" value="141" note="в чатах сейчас"/><AdminStat title="Активных" value="2 418" note="пользователей"/><AdminStat title="Реклама" value="7" note="на модерации"/><div className="admin-card admin-wide"><h2>Последние действия</h2><AdminLog text="Модератор @admin отклонил жалобу #104"/><AdminLog text="Пользователю @dima выдано ограничение на сообщения"/><AdminLog text="Начислено 100 NC за недельную активность"/></div></div>}{tab==='reports'&&<AdminTable title="Жалобы" columns={['Категория','Пользователь','Контент','Статус']} rows={reports}/>} {tab==='users'&&<AdminTable title="Пользователи" columns={['Аккаунт','Имя','Активность','Статус']} rows={users}/>} {tab==='economy'&&<EconomyAdmin/>}{tab==='ads'&&<AdsAdmin/>}{tab==='activity'&&<ActivityAdmin/>}<div className="admin-footer">Все действия модераторов в рабочей версии должны журналироваться на сервере. Это демо без реального доступа к данным.</div></div>}
function AdminStat({title,value,note}:{title:string;value:string;note:string}){return <div className="admin-card"><span>{title}</span><strong>{value}</strong><small>{note}</small></div>}
function AdminLog({text}:{text:string}){return <div className="admin-log"><ShieldCheck size={15}/><span>{text}</span></div>}
function AdminTable({title,columns,rows}:{title:string;columns:string[];rows:string[][]}){return <div className="admin-card admin-table-card"><div className="admin-card-title"><h2>{title}</h2><button className="small-admin-button">Экспорт</button></div><div className="admin-table"><div className="admin-tr admin-th">{columns.map(c=><span key={c}>{c}</span>)}<span>Действия</span></div>{rows.map((r,i)=><div className="admin-tr" key={i}>{r.map((c,j)=><span key={j}>{c}</span>)}<div className="row-actions"><button>Открыть</button><button>Решить</button></div></div>)}</div></div>}
function EconomyAdmin(){return <div className="admin-grid"><AdminStat title="Оборот NC" value="184 200" note="за период"/><AdminStat title="Подарков" value="1 284" note="отправлено"/><div className="admin-card admin-wide"><h2>Настройки экономики</h2><div className="setting-row"><span>Подарок «Роза»</span><b>50 NC</b><button>Изменить</button></div><div className="setting-row"><span>Награда за недельную активность</span><b>100 NC</b><button>Изменить</button></div><div className="setting-row"><span>Лимит награды в неделю</span><b>500 NC</b><button>Изменить</button></div></div></div>}
function AdsAdmin(){return <div className="admin-grid"><AdminStat title="На модерации" value="7" note="рекламных заявок"/><AdminStat title="Активных" value="19" note="размещений"/><div className="admin-card admin-wide"><h2>Модерация рекламы</h2><div className="ad-review"><div><strong>Городское мероприятие</strong><span>Срок: 7 дней · базовое размещение</span></div><button>Отклонить</button><button className="approve">Одобрить</button></div><div className="ad-review"><div><strong>Ссылка на организатора</strong><span>Срок: 3 дня · повышенный тариф</span></div><button>Отклонить</button><button className="approve">Одобрить</button></div></div></div>}
function ActivityAdmin(){return <div className="admin-grid"><AdminStat title="Топ недели" value="@vika" note="1 842 активности"/><AdminStat title="Начислено" value="4 900 NC" note="за неделю"/><div className="admin-card admin-wide"><h2>Антинакрутка</h2><p className="admin-muted">В рабочей версии рейтинг должен учитывать сообщения, уникальных собеседников, частоту и лимиты. Повторяющийся спам и автоматические действия не должны давать награды.</p><div className="setting-row"><span>Недельная награда</span><b>Включена</b><button>Настроить</button></div><div className="setting-row"><span>Лимит сообщений в зачёт</span><b>100/день</b><button>Изменить</button></div></div></div>}

function WalletModal({balance,transactions,onClose,onBuy}:{balance:number;transactions:Transaction[];onClose:()=>void;onBuy:(amount:number,price:string)=>void}){const packs=[[100,'99 ₽'],[500,'399 ₽'],[1000,'699 ₽'],[2500,'1 499 ₽']];return <Modal title="Нуркоины" kicker={`${balance} NC · только внутри платформы`} onClose={onClose}><div className="wallet-disclaimer">Нуркоины — внутренняя единица CHAT. В MVP они не выводятся в реальные деньги и не используются для оплаты реальных товаров или услуг.</div><div className="pack-grid">{packs.map(([amount,price])=><button key={amount} onClick={()=>onBuy(amount as number,price as string)}><strong>{amount} NC</strong><span>{price}</span></button>)}</div><div className="wallet-history"><h3>История операций</h3>{transactions.map(t=><div key={t.id}><span>{t.title}<small>{t.time}</small></span><b>+{t.amount} NC</b></div>)}</div></Modal>}
function NotificationsModal({items,onClose,onRead}:{items:Notification[];onClose:()=>void;onRead:()=>void}){return <Modal title="Уведомления" kicker="Центр событий" onClose={onClose}><div className="modal-action-row"><span>{items.filter(n=>!n.read).length} непрочитанных</span><button onClick={onRead}>Прочитать всё</button></div><div className="notification-list">{items.map(n=><div className={`notification-item ${n.read?'read':''}`} key={n.id}><span className="notification-icon"><Bell size={16}/></span><div><strong>{n.title}</strong><p>{n.text}</p><small>{n.time}</small></div></div>)}</div></Modal>}
function RulesModal({onClose}:{onClose:()=>void}){return <Modal title="Правила и безопасность" kicker="Защити себя и других" onClose={onClose}><div className="rules-list"><p><b>18+</b> Раздел знакомств предназначен только для совершеннолетних.</p><p><b>Жалобы</b> Сообщай о 18+ контенте, оскорблениях, спаме и другом нарушении.</p><p><b>Фото</b> Запрещённый контент должен удаляться модерацией.</p><p><b>Блокировки</b> Пользователи могут быть ограничены или заблокированы за нарушения.</p><p><b>Приватность</b> Не публикуй чужие персональные данные без основания и согласия.</p></div><button className="primary-button" onClick={onClose}>Понятно</button></Modal>}
function ProfileEditModal({name,onClose,onSave}:{name:string;onClose:()=>void;onSave:(value:string)=>void}){const [value,setValue]=useState(name==='Гость'?'':name);return <Modal title="Профиль" kicker="Основная информация" onClose={onClose}><label className="field-label">Имя / никнейм<input className="feature-modal-input" value={value} maxLength={32} onChange={e=>setValue(e.target.value)} placeholder="Как тебя называть?"/></label><label className="field-label">О себе<textarea className="feature-modal-input" rows={4} placeholder="Пару слов о себе"/></label><button className="primary-button" disabled={!value.trim()} onClick={()=>onSave(value.trim())}>Сохранить</button></Modal>}
function PageTitle({title,subtitle,action}:{title:string;subtitle:string;action?:React.ReactNode}){return <div className="page-title"><div><h1>{title}</h1><p>{subtitle}</p></div>{action}</div>}
function BottomNav({active,onChange}:{active:Tab;onChange:(t:Tab)=>void}){return <nav className="bottom-nav">{nav.map(({id,label,icon:Icon})=><button key={id} className={active===id?'active':''} onClick={()=>onChange(id)}><Icon size={20}/><span>{label}</span></button>)}</nav>}
