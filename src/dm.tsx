import { Fragment, useCallback, useEffect, useRef, useState } from 'react'
import { ArrowLeft, Ban, Check, CheckCheck, Flag, Lock, MessageCircle, MoreVertical, Send, Trash2, User } from 'lucide-react'
import { dmBus, dmState, fmtTime, rpc, type Dialog, type DmMsg, type DmThread, type Me, type Peer } from './api'
import { haptic } from './telegram'
import { AutoTextarea, Avatar, Empty, MenuRow, Sheet, Skeleton, useAction } from './ui'
import { ReportSheet, type ReportTarget } from './sheets'

const notifyLocal = () => dmBus.dispatchEvent(new Event('local'))

const dayLabel = (iso: string) => {
  const d = new Date(iso), t = new Date()
  const diff = Math.round((+new Date(t.toDateString()) - +new Date(d.toDateString())) / 86400000)
  if (diff === 0) return 'Сегодня'
  if (diff === 1) return 'Вчера'
  return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' })
}

const shortTime = (iso: string) => {
  const d = new Date(iso)
  return d.toDateString() === new Date().toDateString() ? fmtTime(iso) : d.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' })
}

/** Список диалогов (вкладка «Диалоги» в разделе «Люди»). */
export function DialogsList({ onOpen }: { onOpen: (p: Peer) => void }) {
  const [list, setList] = useState<Dialog[] | null>(null)
  const load = useCallback(() => {
    rpc<Dialog[]>('dm_list').then(setList).catch(() => setList((l) => l ?? []))
  }, [])

  useEffect(() => {
    load()
    const iv = window.setInterval(load, 20000)
    dmBus.addEventListener('ping', load)
    dmBus.addEventListener('local', load)
    return () => { window.clearInterval(iv); dmBus.removeEventListener('ping', load); dmBus.removeEventListener('local', load) }
  }, [load])

  if (!list) return <Skeleton rows={4} height={68} />
  if (list.length === 0) {
    return <Empty icon={<MessageCircle size={26} />} text="Диалогов пока нет. Откройте вкладку «Участники» и нажмите значок сообщения рядом с человеком." />
  }
  return (
    <div className="group">
      {list.map((d) => (
        <button key={d.conversation_id} className="dialog" onClick={() => onOpen({ id: d.user_id, name: d.display_name, photo: d.photo_url })}>
          <Avatar name={d.display_name} url={d.photo_url} size={48} />
          <span className="dialog-text">
            <span className="dialog-top"><b>{d.display_name}</b><small>{shortTime(d.last_at)}</small></span>
            <span className="dialog-bottom">
              <span className={'preview' + (d.unread > 0 ? ' strong' : '')}>
                {d.last_mine && !d.last_deleted && <em>Вы: </em>}{d.last_deleted ? 'Сообщение удалено' : d.last_body}
              </span>
              {d.unread > 0 && <i className="unread-badge">{d.unread > 99 ? '99+' : d.unread}</i>}
            </span>
          </span>
        </button>
      ))}
    </div>
  )
}

/** Экран переписки с одним человеком. */
export function DmScreen({ me, peer, onClose, onOpenProfile }: { me: Me; peer: Peer; onClose: () => void; onOpenProfile: (id: string) => void }) {
  const { run, busy } = useAction()
  const [thread, setThread] = useState<DmThread | null>(null)
  const [text, setText] = useState('')
  const [menu, setMenu] = useState(false)
  const [msgMenu, setMsgMenu] = useState<DmMsg | null>(null)
  const [report, setReport] = useState<ReportTarget | null>(null)
  const [confirmDel, setConfirmDel] = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)
  const stick = useRef(true)
  const lastKey = useRef('')

  const load = useCallback(async () => {
    try {
      const t = await rpc<DmThread>('dm_get', { p_with: peer.id })
      setThread(t)
      const key = t.messages.map((m) => m.id + m.status).join(',') + ':' + t.other_read_id
      if (key !== lastKey.current) { lastKey.current = key; notifyLocal() }
    } catch { /* повторим по таймеру */ }
  }, [peer.id])

  useEffect(() => {
    load()
    // основной канал — realtime-сигнал; таймер — страховка (с разбросом, чтобы клиенты не били сервер одновременно)
    let t: number
    const loop = () => { t = window.setTimeout(() => { if (!document.hidden) load(); loop() }, (dmState.live ? 20000 : 6000) * (0.75 + Math.random() * 0.5)) }
    loop()
    dmBus.addEventListener('ping', load)
    return () => { window.clearTimeout(t); dmBus.removeEventListener('ping', load) }
  }, [load])

  const lastId = thread?.messages[thread.messages.length - 1]?.id
  useEffect(() => {
    if (stick.current) bottomRef.current?.scrollIntoView({ block: 'end' })
  }, [lastId, thread?.messages.length])

  const send = async () => {
    const body = text.trim()
    if (!body) return
    const ok = await run(async () => { await rpc('dm_send', { p_to: peer.id, p_body: body }); return true })
    if (ok) { setText(''); stick.current = true; haptic('success'); load() }
  }

  const toggleBlock = async () => {
    if (!thread) return
    const ok = await run(async () => { await rpc('block_user', { p_user: peer.id, p_block: !thread.blocked_by_me }); return true },
      thread.blocked_by_me ? 'Пользователь разблокирован' : 'Пользователь заблокирован')
    if (ok) { setMenu(false); load() }
  }
  const delConversation = async () => {
    const ok = await run(async () => { await rpc('dm_delete_conversation', { p_with: peer.id }); return true }, 'Диалог удалён у вас')
    if (ok) { notifyLocal(); onClose() }
  }
  const delMessage = async (m: DmMsg) => {
    const ok = await run(async () => { await rpc('dm_delete_message', { p_id: m.id }); return true })
    if (ok) { setMsgMenu(null); load() }
  }

  const muted = me.muted_until && new Date(me.muted_until) > new Date()
  const other = thread?.other
  const name = other?.display_name ?? peer.name
  const photo = other ? other.photo_url : peer.photo

  return (
    <div className="dm">
      <header className="dm-head">
        <button className="icon-btn plain" onClick={onClose} aria-label="Назад"><ArrowLeft size={22} /></button>
        <button className="dm-who" onClick={() => onOpenProfile(peer.id)}>
          <Avatar name={name} url={photo} size={38} />
          <span><b>{name}</b><small>личная переписка</small></span>
        </button>
        <button className="icon-btn plain" onClick={() => setMenu(true)} aria-label="Меню"><MoreVertical size={20} /></button>
      </header>

      <div className="dm-body" onScroll={(e) => {
        const el = e.currentTarget
        stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 120
      }}>
        {!thread ? <Skeleton rows={4} height={44} /> : (
          <>
            {thread.messages.length === 0 && (
              <div className="dm-note">
                <span className="dm-note-icon"><Lock size={20} /></span>
                <b>Личная переписка с {name}</b>
                <p>Её видите только вы двое. Модераторы видят лишь сообщения, на которые пожаловались.</p>
                <p>Никому не сообщайте пароли и коды из СМС — сотрудники NUR_CHAT их не спрашивают.</p>
              </div>
            )}
            {thread.messages.map((m, i) => {
              const prev = thread.messages[i - 1]
              const newDay = !prev || new Date(prev.created_at).toDateString() !== new Date(m.created_at).toDateString()
              const gone = m.status !== 'visible'
              return (
                <Fragment key={m.id}>
                  {newDay && <div className="day"><span>{dayLabel(m.created_at)}</span></div>}
                  <button className={'dm-msg' + (m.mine ? ' mine' : '') + (gone ? ' gone' : '')} disabled={gone} onClick={() => { haptic('light'); setMsgMenu(m) }}>
                    {gone ? <span className="tomb">Сообщение удалено</span> : <span className="dm-text">{m.body}</span>}
                    <span className="dm-meta">
                      {fmtTime(m.created_at)}
                      {m.mine && !gone && (m.id <= thread.other_read_id ? <CheckCheck size={14} className="read" /> : <Check size={14} />)}
                    </span>
                  </button>
                </Fragment>
              )
            })}
          </>
        )}
        <div ref={bottomRef} />
      </div>

      <div className="composer-wrap dm-foot">
        {thread && !thread.can_send ? (
          thread.blocked_by_me ? (
            <div className="muted-note plain">Вы заблокировали этого пользователя <button className="link" onClick={toggleBlock}>Разблокировать</button></div>
          ) : (
            <div className="muted-note plain">Этот пользователь не принимает личные сообщения</div>
          )
        ) : muted ? (
          <div className="muted-note">Вам запрещено писать до {new Date(me.muted_until!).toLocaleString('ru-RU')}</div>
        ) : (
          <div className="composer">
            <AutoTextarea value={text} onChange={setText} onSubmit={send} maxLength={500} placeholder="Сообщение…" />
            <button className="send" disabled={busy || !text.trim()} onClick={send} aria-label="Отправить"><Send size={18} /></button>
          </div>
        )}
      </div>

      {menu && (
        <Sheet title={name} kicker="Личная переписка" onClose={() => setMenu(false)}>
          <div className="group">
            <MenuRow icon={<User size={19} />} title="Открыть профиль" onClick={() => { setMenu(false); onOpenProfile(peer.id) }} />
            <MenuRow icon={<Ban size={19} />} title={thread?.blocked_by_me ? 'Разблокировать' : 'Заблокировать'}
              hint={thread?.blocked_by_me ? 'Снова сможете переписываться' : 'Человек больше не сможет вам писать'} onClick={toggleBlock} />
            <MenuRow icon={<Flag size={19} />} title="Пожаловаться на пользователя" onClick={() => { setMenu(false); setReport({ kind: 'user', id: peer.id, author: name }) }} />
            <MenuRow icon={<Trash2 size={19} />} title="Удалить диалог у меня" hint="У собеседника переписка останется" danger onClick={() => { setMenu(false); setConfirmDel(true) }} />
          </div>
        </Sheet>
      )}

      {msgMenu && (
        <Sheet title="Сообщение" onClose={() => setMsgMenu(null)}>
          <blockquote className="quote">{msgMenu.body}</blockquote>
          <div className="group">
            {msgMenu.mine ? (
              <MenuRow icon={<Trash2 size={19} />} title="Удалить сообщение" hint="Оно исчезнет у обоих" danger onClick={() => delMessage(msgMenu)} />
            ) : (
              <MenuRow icon={<Flag size={19} />} title="Пожаловаться на сообщение" hint="Модератор увидит только его и пару предыдущих"
                onClick={() => { setReport({ kind: 'dm', id: msgMenu.id, author: name }); setMsgMenu(null) }} />
            )}
          </div>
        </Sheet>
      )}

      {confirmDel && (
        <Sheet title="Удалить диалог?" onClose={() => setConfirmDel(false)}>
          <p>Переписка исчезнет только у вас. У {name} она сохранится.</p>
          <button className="btn danger block" disabled={busy} onClick={delConversation}>Удалить у меня</button>
        </Sheet>
      )}
      {report && <ReportSheet target={report} onClose={() => setReport(null)} />}
    </div>
  )
}
