import { useEffect, useState } from 'react'
import { Search } from 'lucide-react'
import { supabase } from './supabase'
import { callFunction, fmtDate, rpc, type Me, type Member } from './api'
import { DocLinks } from './legal'
import { Avatar, Empty, Sheet, useAction } from './ui'

export function MembersScreen({ onOpenProfile }: { onOpenProfile: (id: string) => void }) {
  const [q, setQ] = useState('')
  const [list, setList] = useState<Member[] | null>(null)
  useEffect(() => {
    const t = setTimeout(() => rpc<Member[]>('list_members', { p_q: q, p_limit: 60 }).then(setList).catch(() => setList([])), 250)
    return () => clearTimeout(t)
  }, [q])
  return (
    <section className="page">
      <div className="search"><Search size={16} /><input placeholder="Найти участника" value={q} maxLength={32} onChange={(e) => setQ(e.target.value)} /></div>
      {!list ? <Empty text="Загрузка…" /> : list.length === 0 ? <Empty text="Никого не нашли" /> : (
        <div className="list">
          {list.map((m) => (
            <button key={m.id} className="row-btn" onClick={() => onOpenProfile(m.id)}>
              <span className="who"><Avatar name={m.display_name} url={m.photo_url} /><span><b>{m.display_name}</b><small className="muted">{m.bio || '—'}</small></span></span>
            </button>
          ))}
        </div>
      )}
    </section>
  )
}

export function ProfileScreen({ me, refreshMe }: { me: Me; refreshMe: () => void }) {
  const [name, setName] = useState(me.display_name)
  const [bio, setBio] = useState(me.bio)
  const [showPhoto, setShowPhoto] = useState(me.show_photo)
  const [exportText, setExportText] = useState<string | null>(null)
  const [del, setDel] = useState(false)
  const [confirm, setConfirm] = useState('')
  const { run, busy } = useAction()

  const save = async () => {
    const ok = await run(async () => { await rpc('update_profile', { p_display_name: name, p_bio: bio, p_show_photo: showPhoto }); return true }, 'Профиль сохранён')
    if (ok) refreshMe()
  }
  const exportData = async () => {
    const d = await run(() => rpc('export_my_data'))
    if (d) setExportText(JSON.stringify(d, null, 2))
  }
  const remove = async () => {
    const ok = await run(async () => { await callFunction('delete-account'); return true })
    if (ok) { await supabase.auth.signOut(); location.reload() }
  }

  return (
    <section className="page">
      <div className="profile-head">
        <Avatar name={name} url={showPhoto ? me.photo_url : null} size={80} />
        <span className="muted small">Так вас видят другие участники</span>
      </div>
      <label className="field">Имя в чате<input className="input" value={name} maxLength={32} onChange={(e) => setName(e.target.value)} /></label>
      <label className="field">О себе<textarea className="input" rows={3} maxLength={200} value={bio} onChange={(e) => setBio(e.target.value)} placeholder="Коротко о себе (без контактов и ссылок)" /></label>
      <label className="check"><input type="checkbox" checked={showPhoto} onChange={(e) => setShowPhoto(e.target.checked)} /><span>Показывать фото из Telegram другим участникам</span></label>
      <button className="btn primary block" disabled={busy || name.trim().length < 2} onClick={save}>Сохранить</button>

      <h3>Документы</h3>
      <div className="links"><DocLinks ids={[['policy', 'Политика обработки ПДн'], ['terms', 'Соглашение и правила'], ['offer', 'Оферта о Nurcoin']]} /></div>

      <h3>Ваши данные</h3>
      <div className="actions">
        <button className="btn" disabled={busy} onClick={exportData}>Скачать мои данные</button>
        <button className="btn danger" onClick={() => setDel(true)}>Удалить аккаунт</button>
      </div>

      {exportText && (
        <Sheet title="Мои данные" kicker="Копия в формате JSON" onClose={() => setExportText(null)}>
          <textarea className="input mono" rows={14} readOnly value={exportText} onFocus={(e) => e.currentTarget.select()} />
          <button className="btn primary block" onClick={() => navigator.clipboard?.writeText(exportText)}>Скопировать</button>
        </Sheet>
      )}
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
      {!items ? <Empty text="Загрузка…" /> : items.length === 0 ? <Empty text="Пока ничего нет" /> : (
        <div className="list">
          {items.map((n) => (
            <div key={n.id} className={'row col' + (n.read ? '' : ' unread')}>
              <b>{n.title}</b><span>{n.text}</span><small className="muted">{fmtDate(n.created_at)}</small>
            </div>
          ))}
        </div>
      )}
    </Sheet>
  )
}
