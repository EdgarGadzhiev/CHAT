import { Fragment, useCallback, useEffect, useRef, useState } from 'react'
import { ArrowUp, ChevronDown, CornerUpLeft, Flag, Image as ImageIcon, MoreHorizontal, Pin, Send, ShieldCheck, Sparkles, Trash2, X } from 'lucide-react'
import { supabase } from './supabase'
import { REACTIONS, fmtTime, prepareImage, rpc, signedUrls, uploadImage, type Me, type Msg } from './api'
import { Avatar, Sheet, useAction, useToast } from './ui'
import { haptic } from './telegram'
import { PromoteSheet, ReportSheet, type ReportTarget } from './sheets'

type Props = { me: Me; refreshMe: () => void; onOpenProfile: (id: string) => void }

export function ChatScreen({ me, refreshMe, onOpenProfile }: Props) {
  const toast = useToast()
  const [latest, setLatest] = useState<Msg[]>([])
  const [older, setOlder] = useState<Msg[]>([])
  const [top, setTop] = useState<Msg[]>([])
  const [urls, setUrls] = useState<Record<string, string>>({})
  const [loaded, setLoaded] = useState(false)
  const [hasMore, setHasMore] = useState(true)
  const [reply, setReply] = useState<Msg | null>(null)
  const [menu, setMenu] = useState<Msg | null>(null)
  const [report, setReport] = useState<ReportTarget | null>(null)
  const [promote, setPromote] = useState<Msg | null>(null)
  const [viewer, setViewer] = useState<string | null>(null)
  const [rules, setRules] = useState<string | null>(null)
  const [maxLen, setMaxLen] = useState(500)
  const [showDown, setShowDown] = useState(false)
  const [text, setText] = useState('')
  const [image, setImage] = useState<{ blob: Blob; preview: string } | null>(null)
  const { run, busy } = useAction()
  const bottomRef = useRef<HTMLDivElement>(null)
  const scroller = useRef<HTMLDivElement>(null)
  const stick = useRef(true)
  const timer = useRef<number | undefined>(undefined)

  const loadUrls = useCallback((list: Msg[]) => {
    const paths = list.map((m) => m.media_path).filter((p): p is string => !!p)
    if (paths.length) signedUrls(paths).then((u) => setUrls((prev) => ({ ...prev, ...u })))
  }, [])

  const load = useCallback(async () => {
    try {
      const [m, t] = await Promise.all([rpc<Msg[]>('get_messages', { p_limit: 60 }), rpc<Msg[]>('get_top_messages')])
      setLatest(m)
      setTop(t)
      setLoaded(true)
      if (m.length < 60) setHasMore(false)
      loadUrls([...m, ...t])
    } catch { /* сеть — повторим по таймеру */ }
  }, [loadUrls])

  useEffect(() => {
    load()
    supabase.from('chat_settings').select('key,value').in('key', ['rules_text', 'max_message_len']).then(({ data }) => {
      for (const r of data ?? []) {
        if (r.key === 'max_message_len') setMaxLen(Number(r.value) || 500)
      }
    })
    const ping = () => { window.clearTimeout(timer.current); timer.current = window.setTimeout(load, 400) }
    const ch = supabase.channel('chat-city').on('broadcast', { event: 'ping' }, ping).subscribe()
    const iv = window.setInterval(load, 20000)
    return () => { supabase.removeChannel(ch); window.clearInterval(iv); window.clearTimeout(timer.current) }
  }, [load])

  const messages = [...older.filter((o) => !latest.length || o.id < latest[0].id), ...latest]

  useEffect(() => {
    if (stick.current) bottomRef.current?.scrollIntoView({ block: 'end' })
  }, [latest.length, latest[latest.length - 1]?.id])

  const loadOlder = async () => {
    const first = messages[0]
    if (!first) return
    const m = await run(() => rpc<Msg[]>('get_messages', { p_before: first.id, p_limit: 60 }))
    if (!m) return
    setOlder((prev) => [...m, ...prev.filter((x) => !m.some((y) => y.id === x.id))])
    if (m.length < 60) setHasMore(false)
    loadUrls(m)
  }

  const pickImage = async (f?: File) => {
    if (!f) return
    try {
      const blob = await prepareImage(f)
      setImage({ blob, preview: URL.createObjectURL(blob) })
    } catch {
      toast('Поддерживаются фото JPEG, PNG и WebP')
    }
  }

  const send = async () => {
    const body = text.trim()
    if (!body && !image) return
    const ok = await run(async () => {
      let path: string | null = null
      if (image) path = await uploadImage(me.id, image.blob)
      await rpc('send_message', { p_body: body, p_reply_to: reply?.id ?? null, p_media_path: path })
      return true
    })
    if (ok) {
      setText(''); setImage(null); setReply(null)
      stick.current = true
      haptic('success')
      load()
    }
  }

  const muted = me.muted_until && new Date(me.muted_until) > new Date()

  return (
    <section className="chat">
      <div className="chat-bar">
        <ShieldCheck size={14} />
        <span>Без ссылок, мата и чужих данных.</span>
        <button className="link" onClick={async () => {
          const { data } = await supabase.from('chat_settings').select('value').eq('key', 'rules_text').maybeSingle()
          setRules(data?.value ?? '')
        }}>Правила</button>
      </div>

      {top.length > 0 && (
        <div className="top-strip">
          {top.map((m) => (
            <button key={m.id} className={'top-item' + (m.pinned ? ' pinned' : '')} onClick={() => document.getElementById('m' + m.id)?.scrollIntoView({ block: 'center' })}>
              {m.pinned ? <Pin size={12} /> : <ArrowUp size={12} />}
              <b>{m.author}</b>
              <span>{m.body || 'Фото'}</span>
            </button>
          ))}
        </div>
      )}

      <div className="messages" ref={scroller} onScroll={(e) => {
        const el = e.currentTarget
        stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 120
        setShowDown(!stick.current)
      }}>
        {hasMore && loaded && messages.length >= 60 && <button className="btn small center" disabled={busy} onClick={loadOlder}>Показать ранее</button>}
        {!loaded && <div className="empty">Загрузка…</div>}
        {loaded && messages.length === 0 && <div className="empty">Пока тихо. Напишите первым!</div>}
        {messages.map((m, i) => {
          const prev = messages[i - 1]
          const newDay = !prev || new Date(prev.created_at).toDateString() !== new Date(m.created_at).toDateString()
          const compact = !newDay && prev.user_id === m.user_id && +new Date(m.created_at) - +new Date(prev.created_at) < 5 * 60000
          return (
            <Fragment key={m.id}>
              {newDay && <div className="day"><span>{dayLabel(m.created_at)}</span></div>}
              <MessageView m={m} own={m.user_id === me.id} compact={compact} url={m.media_path ? urls[m.media_path] : undefined}
                onMenu={() => { haptic('light'); setMenu(m) }} onProfile={() => onOpenProfile(m.user_id)} onImage={(u) => setViewer(u)}
                onReact={async (e) => { haptic('light'); await run(async () => { await rpc('toggle_reaction', { p_message: m.id, p_emoji: e }); return true }); load() }} />
            </Fragment>
          )
        })}
        <div ref={bottomRef} />
      </div>

      {showDown && <button className="down" onClick={() => { stick.current = true; bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' }) }} aria-label="Вниз"><ChevronDown size={20} /></button>}

      <div className="composer-wrap">
        {reply && (
          <div className="reply-bar">
            <CornerUpLeft size={14} /> <span><b>{reply.author}</b> {reply.body.slice(0, 60) || 'Фото'}</span>
            <button className="icon-btn" onClick={() => setReply(null)}><X size={14} /></button>
          </div>
        )}
        {image && (
          <div className="reply-bar">
            <img className="thumb" src={image.preview} alt="" />
            <span className="muted small">Фото будет сжато, метаданные удалены. Не публикуйте людей без их согласия.</span>
            <button className="icon-btn" onClick={() => setImage(null)}><X size={14} /></button>
          </div>
        )}
        {muted ? (
          <div className="muted-note">Вам запрещено писать до {new Date(me.muted_until!).toLocaleString('ru-RU')}</div>
        ) : (
          <div className="composer">
            <label className="icon-btn" title="Фото">
              <ImageIcon size={20} />
              <input type="file" accept="image/jpeg,image/png,image/webp" hidden onChange={(e) => { pickImage(e.target.files?.[0]); e.target.value = '' }} />
            </label>
            <input value={text} maxLength={maxLen} placeholder="Написать сообщение…" onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && send()} />
            <button className="send" disabled={busy || (!text.trim() && !image)} onClick={send} aria-label="Отправить"><Send size={18} /></button>
          </div>
        )}
      </div>

      {menu && (
        <MessageMenu m={menu} me={me} onClose={() => setMenu(null)}
          onReply={() => { setReply(menu); setMenu(null) }}
          onReport={() => { setReport({ kind: 'message', id: menu.id, author: menu.author }); setMenu(null) }}
          onPromote={() => { setPromote(menu); setMenu(null) }}
          onChanged={() => { setMenu(null); load() }} />
      )}
      {report && <ReportSheet target={report} onClose={() => setReport(null)} />}
      {promote && <PromoteSheet msg={promote} me={me} onClose={() => setPromote(null)} onSpent={() => { refreshMe(); load() }} />}
      {rules !== null && <Sheet title="Правила чата" onClose={() => setRules(null)}><div className="doc">{rules.split('\n').map((l, i) => <p key={i}>{l}</p>)}</div></Sheet>}
      {viewer && <div className="viewer" onClick={() => setViewer(null)}><img src={viewer} alt="" /></div>}
    </section>
  )
}

const dayLabel = (iso: string) => {
  const d = new Date(iso), t = new Date()
  const diff = Math.round((+new Date(t.toDateString()) - +new Date(d.toDateString())) / 86400000)
  if (diff === 0) return 'Сегодня'
  if (diff === 1) return 'Вчера'
  return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' })
}

function MessageView({ m, own, compact, url, onMenu, onProfile, onImage, onReact }: {
  m: Msg; own: boolean; compact: boolean; url?: string; onMenu: () => void; onProfile: () => void; onImage: (u: string) => void; onReact: (e: string) => void
}) {
  const gone = m.status !== 'visible'
  return (
    <div id={'m' + m.id} className={'msg' + (own ? ' own' : '') + (compact ? ' compact' : '') + (m.highlighted ? ' hl' : '') + (m.boosted ? ' boosted' : '')}>
      {!own && (compact ? <span className="msg-avatar spacer" /> : <button className="msg-avatar" onClick={onProfile}><Avatar name={m.author} url={m.author_photo} /></button>)}
      <div className="bubble">
        <div className="meta">
          {!(compact || own) && <button className="author" onClick={onProfile}>{m.author}</button>}
          {m.author_role !== 'user' && <span className="badge">{m.author_role === 'admin' ? 'админ' : 'мод'}</span>}
          {m.pinned && <Pin size={11} />}
          {m.boosted && <span className="promo"><Sparkles size={11} /> продвигается</span>}
          <span className="time">{fmtTime(m.created_at)}</span>
        </div>
        {gone ? (
          <p className="tomb">{m.status === 'hidden' ? 'Сообщение скрыто до проверки жалоб' : 'Сообщение удалено'}</p>
        ) : (
          <>
            {m.reply && <div className="quote"><b>{m.reply.author}</b> {m.reply.body || 'Фото'}</div>}
            {m.body && <p>{m.body}</p>}
            {m.media_path && (url ? <img className="photo" src={url} alt="Фото" loading="lazy" onClick={() => onImage(url)} /> : <div className="photo ph" />)}
            {Object.keys(m.reactions).length > 0 && (
              <div className="reactions">
                {Object.entries(m.reactions).map(([e, r]) => <button key={e} className={'chip' + (r.me ? ' on' : '')} onClick={() => onReact(e)}>{e} {r.n}</button>)}
              </div>
            )}
          </>
        )}
        {!gone && <button className="more" onClick={onMenu} aria-label="Действия"><MoreHorizontal size={16} /></button>}
      </div>
    </div>
  )
}

function MessageMenu({ m, me, onClose, onReply, onReport, onPromote, onChanged }: {
  m: Msg; me: Me; onClose: () => void; onReply: () => void; onReport: () => void; onPromote: () => void; onChanged: () => void
}) {
  const { run, busy } = useAction()
  const [reason, setReason] = useState('')
  const own = m.user_id === me.id
  const staff = me.role !== 'user'

  const react = async (e: string) => {
    const ok = await run(async () => { await rpc('toggle_reaction', { p_message: m.id, p_emoji: e }); return true })
    if (ok) onChanged()
  }
  const del = async () => {
    const path = await run(() => rpc<string | null>('admin_delete_message', { p_id: m.id, p_reason: reason }))
    if (path) await supabase.storage.from('chat-media').remove([path])
    if (path !== undefined) onChanged()
  }
  const pin = async () => {
    const ok = await run(async () => { await rpc('admin_pin_message', { p_id: m.id, p_pin: !m.pinned }); return true })
    if (ok) onChanged()
  }

  return (
    <Sheet title="Сообщение" kicker={m.author} onClose={onClose}>
      <div className="react-row">
        {REACTIONS.map((e) => <button key={e} className={'react' + (m.reactions[e]?.me ? ' on' : '')} disabled={busy} onClick={() => react(e)}>{e}</button>)}
      </div>
      <div className="list">
        <button className="row-btn" onClick={onReply}><span><CornerUpLeft size={16} /> Ответить</span></button>
        {own && <button className="row-btn" onClick={onPromote}><span><Sparkles size={16} /> Продвинуть за Nurcoin</span></button>}
        {!own && <button className="row-btn" onClick={onReport}><span><Flag size={16} /> Пожаловаться</span></button>}
        {staff && <button className="row-btn" onClick={pin} disabled={busy}><span><Pin size={16} /> {m.pinned ? 'Открепить' : 'Закрепить'}</span></button>}
      </div>
      {staff && !own && (
        <div className="mod-box">
          <input className="input" placeholder="Причина удаления" value={reason} onChange={(e) => setReason(e.target.value)} />
          <button className="btn danger" disabled={!reason.trim() || busy} onClick={del}><Trash2 size={16} /> Удалить сообщение</button>
        </div>
      )}
    </Sheet>
  )
}
