import { useEffect, useState } from 'react'
import { Ban, Bell, FileText, Gift, MessageCircle, Search, ShieldCheck, Trash2, Users } from 'lucide-react'
import { supabase } from './supabase'
import { callFunction, fmtDate, rpc, type Me, type Member, type Peer } from './api'
import { DocSheet } from './legal'
import { Avatar, Empty, MenuRow, Sheet, Skeleton, Switch, useAction } from './ui'
import { DialogsList } from './dm'

export function MembersScreen({ me, dmUnread, onOpenProfile, onOpenDm }: {
  me: Me; dmUnread: number; onOpenProfile: (id: string) => void; onOpenDm: (p: Peer) => void
}) {
  const [seg, setSeg] = useState<'members' | 'dialogs'>('members')
  const [q, setQ] = useState('')
  const [list, setList] = useState<Member[] | null>(null)
  const dm = me.dm_feature
  useEffect(() => {
    if (seg !== 'members') return
    const t = setTimeout(() => rpc<Member[]>('list_members', { p_q: q, p_limit: 60 }).then(setList).catch(() => setList([])), 250)
    return () => clearTimeout(t)
  }, [q, seg])

  return (
    <section className="page">
      <div className="page-title"><h1>Люди</h1><span className="muted">Жители города в NUR_CHAT</span></div>
      {dm && (
        <div className="segment">
          <button className={seg === 'members' ? 'on' : ''} onClick={() => setSeg('members')}>Участники</button>
          <button className={seg === 'dialogs' ? 'on' : ''} onClick={() => setSeg('dialogs')}>
            Диалоги{dmUnread > 0 && <i className="seg-badge">{dmUnread > 99 ? '99+' : dmUnread}</i>}
          </button>
        </div>
      )}

      {seg === 'dialogs' && dm ? <DialogsList onOpen={onOpenDm} /> : (
        <>
          <div className="search"><Search size={17} /><input placeholder="Найти участника" value={q} maxLength={32} onChange={(e) => setQ(e.target.value)} /></div>
          {!list ? <Skeleton rows={5} height={64} /> : list.length === 0 ? <Empty icon={<Users size={26} />} text="Никого не нашли" /> : (
            <div className="group">
              {list.map((m) => (
                <div key={m.id} className="member-wrap">
                  <button className="member" onClick={() => onOpenProfile(m.id)}>
                    <Avatar name={m.display_name} url={m.photo_url} size={44} />
                    <span className="member-text">
                      <b>{m.display_name}{m.role !== 'user' && <span className="badge">{m.role === 'admin' ? 'админ' : 'мод'}</span>}</b>
                      <small>{m.bio || 'Пока ничего не рассказал(а) о себе'}</small>
                    </span>
                  </button>
                  {dm && m.id !== me.id && m.dm_enabled && (
                    <button className="dm-btn" aria-label={'Написать: ' + m.display_name} onClick={() => onOpenDm({ id: m.id, name: m.display_name, photo: m.photo_url })}>
                      <MessageCircle size={19} />
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </section>
  )
}

export function ProfileScreen({ me, refreshMe }: { me: Me; refreshMe: () => void }) {
  const [name, setName] = useState(me.display_name)
  const [bio, setBio] = useState(me.bio)
  const [showPhoto, setShowPhoto] = useState(me.show_photo)
  const [doc, setDoc] = useState<string | null>(null)
  const [blockedOpen, setBlockedOpen] = useState(false)
  const [del, setDel] = useState(false)
  const [confirm, setConfirm] = useState('')
  const { run, busy } = useAction()
  const dirty = name.trim() !== me.display_name || bio.trim() !== me.bio || showPhoto !== me.show_photo

  const save = async () => {
    const ok = await run(async () => { await rpc('update_profile', { p_display_name: name, p_bio: bio, p_show_photo: showPhoto }); return true }, 'Профиль сохранён')
    if (ok) refreshMe()
  }
  const toggleDm = async (v: boolean) => {
    const ok = await run(async () => { await rpc('set_dm_enabled', { p_enabled: v }); return true }, v ? 'Личные сообщения включены' : 'Личные сообщения выключены')
    if (ok) refreshMe()
  }
  const remove = async () => {
    const ok = await run(async () => { await callFunction('delete-account'); return true })
    if (ok) { await supabase.auth.signOut(); location.reload() }
  }

  return (
    <section className="page">
      <div className="hero">
        <div className="hero-avatar"><Avatar name={name || me.display_name} url={showPhoto ? me.photo_url : null} size={88} /></div>
        <h1>{me.display_name}</h1>
        <span className="muted small">
          {me.role !== 'user' && <span className="badge">{me.role === 'admin' ? 'администратор' : 'модератор'}</span>} в чате с {new Date(me.created_at).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' })}
        </span>
      </div>

      <div className="panel">
        <label className="field">Имя в чате<input className="input" value={name} maxLength={32} onChange={(e) => setName(e.target.value)} /></label>
        <label className="field">О себе<textarea className="input" rows={3} maxLength={200} value={bio} onChange={(e) => setBio(e.target.value)} placeholder="Коротко о себе — без контактов и ссылок" /></label>
        <div className="counter">{bio.length}/200</div>
        <Switch checked={showPhoto} onChange={setShowPhoto} label="Показывать моё фото" hint="Фото из Telegram увидят другие участники" />
        <button className="btn primary block" disabled={busy || !dirty || name.trim().length < 2} onClick={save}>Сохранить изменения</button>
      </div>

      {me.dm_feature && (
        <>
          <h3 className="section-title">Личные сообщения</h3>
          <div className="group">
            <div className="group-pad">
              <Switch checked={me.dm_enabled} onChange={toggleDm} label="Разрешить писать мне" hint="Если выключить, никто не сможет начать с вами диалог" />
            </div>
            <MenuRow icon={<Ban size={19} />} title="Заблокированные" hint="Люди, которым вы запретили писать" onClick={() => setBlockedOpen(true)} />
          </div>
        </>
      )}

      <h3 className="section-title">Документы</h3>
      <div className="group">
        <MenuRow icon={<ShieldCheck size={19} />} title="Политика обработки данных" hint="Как мы храним и защищаем ваши данные" onClick={() => setDoc('policy')} />
        <MenuRow icon={<FileText size={19} />} title="Соглашение и правила чата" hint="Что можно и нельзя публиковать" onClick={() => setDoc('terms')} />
        <MenuRow icon={<Gift size={19} />} title="Оферта о Nurcoin" hint="Условия покупки и возврата" onClick={() => setDoc('offer')} />
      </div>

      <h3 className="section-title">Аккаунт</h3>
      <div className="group">
        <MenuRow icon={<Trash2 size={19} />} title="Удалить аккаунт" hint="Профиль, сообщения и фото будут удалены" danger onClick={() => setDel(true)} />
      </div>

      {doc && <DocSheet id={doc} onClose={() => setDoc(null)} />}
      {blockedOpen && <BlockedSheet onClose={() => setBlockedOpen(false)} />}
      {del && (
        <Sheet title="Удалить аккаунт" onClose={() => setDel(false)}>
          <p>Профиль будет обезличен, ваши сообщения и фото удалены, неиспользованные Nurcoin сгорят без возврата. Это необратимо.</p>
          <input className="input" placeholder="Введите УДАЛИТЬ" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
          <button className="btn danger block" disabled={confirm.trim().toUpperCase() !== 'УДАЛИТЬ' || busy} onClick={remove}>Удалить навсегда</button>
        </Sheet>
      )}
    </section>
  )
}

type Notif = { id: string; title: string; text: string; read: boolean; created_at: string }

export function NotificationsSheet({ onClose, onRead }: { onClose: () => void; onRead: () => void }) {
  const [items, setItems] = useState<Notif[] | null>(null)
  useEffect(() => {
    supabase.from('notifications').select('*').order('created_at', { ascending: false }).limit(50).then(({ data }) => {
      setItems((data as Notif[]) ?? [])
      rpc('mark_notifications_read').then(onRead).catch(() => {})
    })
  }, [])
  return (
    <Sheet title="Уведомления" onClose={onClose}>
      {!items ? <Skeleton rows={3} height={64} /> : items.length === 0 ? <Empty icon={<Bell size={26} />} text="Пока ничего нет" /> : (
        <div className="group">
          {items.map((n) => (
            <div key={n.id} className={'notif' + (n.read ? '' : ' unread')}>
              <b>{n.title}</b><span>{n.text}</span><small>{fmtDate(n.created_at)}</small>
            </div>
          ))}
        </div>
      )}
    </Sheet>
  )
}

type Blocked = { id: string; display_name: string; photo_url: string | null }

function BlockedSheet({ onClose }: { onClose: () => void }) {
  const [list, setList] = useState<Blocked[] | null>(null)
  const { run, busy } = useAction()
  const load = () => rpc<Blocked[]>('list_blocked').then(setList).catch(() => setList([]))
  useEffect(() => { load() }, [])
  const unblock = async (u: Blocked) => {
    const ok = await run(async () => { await rpc('block_user', { p_user: u.id, p_block: false }); return true }, 'Разблокирован')
    if (ok) load()
  }
  return (
    <Sheet title="Заблокированные" onClose={onClose}>
      {!list ? <Skeleton rows={2} height={60} /> : list.length === 0 ? <Empty icon={<Ban size={26} />} text="Список пуст" /> : (
        <div className="group">
          {list.map((u) => (
            <div key={u.id} className="member-wrap">
              <div className="member"><Avatar name={u.display_name} url={u.photo_url} size={40} /><span className="member-text"><b>{u.display_name}</b></span></div>
              <button className="btn small unblock" disabled={busy} onClick={() => unblock(u)}>Разблокировать</button>
            </div>
          ))}
        </div>
      )}
    </Sheet>
  )
}
