import { Fragment, memo, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { ArrowUp, ChevronDown, CornerUpLeft, Flag, Image as ImageIcon, MessageCircle, MoreHorizontal, Pin, Send, ShieldCheck, Sparkles, Trash2, X } from 'lucide-react'
import { supabase } from './supabase'
import { REACTIONS, errText, fmtTime, prepareImage, removeMedia, rpc, signedUrls, thumbPath, uploadImage, type Me, type Msg } from './api'
import { useFeed } from './feed'
import { AutoTextarea, Avatar, Sheet, Skeleton, nameColor, useAction, useToast } from './ui'
import { haptic } from './telegram'
import { PromoteSheet, ReportSheet, type ReportTarget } from './sheets'

type Props = { me: Me; active: boolean; refreshMe: () => void; onOpenProfile: (id: string) => void }

const dayLabel = (iso: string) => {
  const d = new Date(iso), t = new Date()
  const diff = Math.round((+new Date(t.toDateString()) - +new Date(d.toDateString())) / 86400000)
  if (diff === 0) return 'Сегодня'
  if (diff === 1) return 'Вчера'
  return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' })
}

export function ChatScreen({ me, active, refreshMe, onOpenProfile }: Props) {
  const toast = useToast()
  const { list, top, loaded, hasMore, live, loadOlder, react, syncSoon, setStick } = useFeed(active)
  const [urls, setUrls] = useState<Record<string, string>>({})
  const [reply, setReply] = useState<Msg | null>(null)
  const [menu, setMenu] = useState<Msg | null>(null)
  const [report, setReport] = useState<ReportTarget | null>(null)
  const [promote, setPromote] = useState<Msg | null>(null)
  const [viewer, setViewer] = useState<{ thumb?: string; full?: string } | null>(null)
  const [rules, setRules] = useState<string | null>(null)
  const [maxLen, setMaxLen] = useState(500)
  const [showDown, setShowDown] = useState(false)
  const [newCount, setNewCount] = useState(0)
  const [text, setText] = useState('')
  const [image, setImage] = useState<{ img: { full: Blob; thumb: Blob }; preview: string } | null>(null)
  const { run, busy } = useAction()
  const bottomRef = useRef<HTMLDivElement>(null)
  const scroller = useRef<HTMLDivElement>(null)
  const stick = useRef(true)
  const savedTop = useRef(0)
  const anchor = useRef<number | null>(null)
  const seenId = useRef(0)
  const urlsRef = useRef(urls)
  urlsRef.current = urls

  // настройки чата один раз
  useEffect(() => {
    supabase.from('chat_settings').select('key,value').eq('key', 'max_message_len').maybeSingle().then(({ data }) => {
      if (data) setMaxLen(Number(data.value) || 500)
    })
  }, [])

  // ссылки на фото: в ленте — миниатюры (в 10–20 раз легче полного файла)
  useEffect(() => {
    const paths: string[] = []
    for (const m of list.slice(-60)) if (m.media_path && m.status === 'visible') paths.push(m.thumb ? thumbPath(m.media_path) : m.media_path)
    for (const m of top) if (m.media_path && m.status === 'visible') paths.push(m.thumb ? thumbPath(m.media_path) : m.media_path)
    const need = paths.filter((p) => !urlsRef.current[p])
    if (need.length) signedUrls(need).then((u) => setUrls((prev) => ({ ...prev, ...u }))).catch(() => {})
  }, [list, top])

  const scrollBottom = useCallback((smooth = false) => {
    bottomRef.current?.scrollIntoView({ block: 'end', behavior: smooth ? 'smooth' : 'auto' })
  }, [])

  // новые сообщения: прилипаем к низу или показываем счётчик
  const lastId = list.length ? list[list.length - 1].id : 0
  useEffect(() => {
    if (!lastId) return
    if (stick.current) { scrollBottom(); seenId.current = lastId; setNewCount(0) }
    else setNewCount(list.filter((m) => m.id > seenId.current && m.user_id !== me.id && m.status === 'visible').length)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lastId])

  // подгрузка старых: сохраняем позицию прокрутки
  useLayoutEffect(() => {
    if (anchor.current !== null && scroller.current) {
      scroller.current.scrollTop = scroller.current.scrollHeight - anchor.current
      anchor.current = null
    }
  }, [list])

  // возврат на вкладку «Чат»
  useLayoutEffect(() => {
    if (!active || !scroller.current) return
    requestAnimationFrame(() => {
      if (!scroller.current) return
      if (stick.current) scrollBottom(); else scroller.current.scrollTop = savedTop.current
    })
  }, [active, scrollBottom])

  const loadMore = async () => {
    const el = scroller.current
    anchor.current = el ? el.scrollHeight - el.scrollTop : null
    const ok = await run(async () => { await loadOlder(); return true })
    if (!ok) anchor.current = null
  }

  const onScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const el = e.currentTarget
    savedTop.current = el.scrollTop
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 120
    if (stick.current !== atBottom) { stick.current = atBottom; setStick(atBottom); setShowDown(!atBottom) }
    if (atBottom && lastId) { seenId.current = lastId; if (newCount) setNewCount(0) }
  }

  const pickImage = async (f?: File) => {
    if (!f) return
    try {
      const img = await prepareImage(f)
      if (image) URL.revokeObjectURL(image.preview)
      setImage({ img, preview: URL.createObjectURL(img.thumb) })
    } catch (e) {
      toast(errText(e))
    }
  }

  const send = async () => {
    const body = text.trim()
    if ((!body && !image) || busy) return
    const ok = await run(async () => {
      let path: string | null = null
      if (image) path = await uploadImage(me.id, image.img)
      await rpc('send_message', { p_body: body, p_reply_to: reply?.id ?? null, p_media_path: path })
      return true
    })
    if (ok) {
      setText(''); setReply(null)
      if (image) URL.revokeObjectURL(image.preview)
      setImage(null)
      stick.current = true; setStick(true); setShowDown(false)
      haptic('success')
      syncSoon(live ? 1500 : 0) // при живом realtime сообщение придёт само, это страховка
    }
  }

  // стабильные обработчики — чтобы карточки сообщений не перерисовывались зря
  const openMenu = useCallback((m: Msg) => { haptic('light'); setMenu(m) }, [])
  const doReact = useCallback((id: number, e: string) => {
    haptic('light')
    react(id, e).catch((err) => toast(errText(err)))
  }, [react, toast])
  const openImage = useCallback(async (m: Msg) => {
    if (!m.media_path) return
    setViewer({ thumb: urlsRef.current[m.thumb ? thumbPath(m.media_path) : m.media_path] })
    const u = await signedUrls([m.media_path])
    setViewer((v) => (v ? { ...v, full: u[m.media_path!] } : v))
  }, [])
  const imgLoaded = useCallback(() => { if (stick.current) scrollBottom() }, [scrollBottom])

  const muted = me.muted_until && new Date(me.muted_until) > new Date()

  return (
    <section className="chat">
      <div className="chat-bar">
        <ShieldCheck size={14} />
        <span>Без ссылок, мата и чужих данных.</span>
        <i className={'live-dot' + (live ? ' on' : '')} title={live ? 'Соединение активно' : 'Обновление по таймеру'} />
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

      <div className="messages" ref={scroller} onScroll={onScroll}>
        {hasMore && loaded && list.length >= 60 && <button className="btn small center" disabled={busy} onClick={loadMore}>Показать ранее</button>}
        {!loaded && <Skeleton rows={5} height={56} />}
        {loaded && list.length === 0 && <div className="empty"><div className="empty-icon"><MessageCircle size={28} /></div>Пока тихо. Напишите первым!</div>}
        {list.map((m, i) => {
          const prev = list[i - 1]
          const newDay = !prev || new Date(prev.created_at).toDateString() !== new Date(m.created_at).toDateString()
          const compact = !newDay && prev.user_id === m.user_id && +new Date(m.created_at) - +new Date(prev.created_at) < 5 * 60000 && prev.status === 'visible'
          const path = m.media_path ? (m.thumb ? thumbPath(m.media_path) : m.media_path) : undefined
          return (
            <Fragment key={m.id}>
              {newDay && <div className="day"><span>{dayLabel(m.created_at)}</span></div>}
              <MessageView m={m} own={m.user_id === me.id} compact={compact} url={path ? urls[path] : undefined}
                onMenu={openMenu} onProfile={onOpenProfile} onImage={openImage} onReact={doReact} onImgLoad={imgLoaded} />
            </Fragment>
          )
        })}
        <div ref={bottomRef} />
      </div>

      {showDown && (
        <button className="down" onClick={() => { stick.current = true; setStick(true); setShowDown(false); setNewCount(0); scrollBottom(true) }} aria-label="К новым сообщениям">
          <ChevronDown size={20} />{newCount > 0 && <i className="down-badge">{newCount > 99 ? '99+' : newCount}</i>}
        </button>
      )}

      <div className="composer-wrap">
        {reply && (
          <div className="reply-bar">
            <CornerUpLeft size={14} /> <span><b>{reply.author}</b> {reply.body.slice(0, 60) || 'Фото'}</span>
            <button className="icon-btn" onClick={() => setReply(null)} aria-label="Отменить ответ"><X size={14} /></button>
          </div>
        )}
        {image && (
          <div className="reply-bar">
            <img className="thumb" src={image.preview} alt="" />
            <span className="muted small">Фото сожмётся, метаданные удалятся. Не публикуйте людей без их согласия.</span>
            <button className="icon-btn" onClick={() => { URL.revokeObjectURL(image.preview); setImage(null) }} aria-label="Убрать фото"><X size={14} /></button>
          </div>
        )}
        {muted ? (
          <div className="muted-note">Вам запрещено писать до {new Date(me.muted_until!).toLocaleString('ru-RU')}</div>
        ) : (
          <div className="composer">
            <label className="icon-btn" title="Фото" aria-label="Прикрепить фото">
              <ImageIcon size={20} />
              <input type="file" accept="image/jpeg,image/png,image/webp" hidden onChange={(e) => { pickImage(e.target.files?.[0]); e.target.value = '' }} />
            </label>
            <AutoTextarea value={text} onChange={setText} onSubmit={send} maxLength={maxLen} placeholder="Написать сообщение…" />
            <button className="send" disabled={busy || (!text.trim() && !image)} onClick={send} aria-label="Отправить"><Send size={18} /></button>
          </div>
        )}
      </div>

      {menu && (
        <MessageMenu m={menu} me={me} onClose={() => setMenu(null)}
          onReact={(e) => { doReact(menu.id, e); setMenu(null) }}
          onReply={() => { setReply(menu); setMenu(null) }}
          onReport={() => { setReport({ kind: 'message', id: menu.id, author: menu.author }); setMenu(null) }}
          onPromote={() => { setPromote(menu); setMenu(null) }}
          onChanged={() => { setMenu(null); syncSoon(live ? 1500 : 0) }} />
      )}
      {report && <ReportSheet target={report} onClose={() => setReport(null)} />}
      {promote && <PromoteSheet msg={promote} me={me} onClose={() => setPromote(null)} onSpent={() => { refreshMe(); syncSoon(live ? 1500 : 0) }} />}
      {rules !== null && <Sheet title="Правила чата" onClose={() => setRules(null)}><div className="doc">{rules.split('\n').map((l, i) => <p key={i}>{l}</p>)}</div></Sheet>}
      {viewer && (
        <div className="viewer" onClick={() => setViewer(null)} role="dialog" aria-label="Фото">
          {(viewer.full || viewer.thumb) ? <img className={viewer.full ? '' : 'blur'} src={viewer.full ?? viewer.thumb} alt="" /> : <Skeleton rows={1} height={200} />}
          <button className="icon-btn viewer-close" aria-label="Закрыть"><X size={20} /></button>
        </div>
      )}
    </section>
  )
}

type MsgProps = {
  m: Msg; own: boolean; compact: boolean; url?: string
  onMenu: (m: Msg) => void; onProfile: (id: string) => void; onImage: (m: Msg) => void
  onReact: (id: number, emoji: string) => void; onImgLoad: () => void
}

const MessageView = memo(function MessageView({ m, own, compact, url, onMenu, onProfile, onImage, onReact, onImgLoad }: MsgProps) {
  const gone = m.status !== 'visible'
  const lastTap = useRef(0)
  const [burst, setBurst] = useState(false)

  // двойной тап по сообщению — быстрая реакция ❤️
  const tap = (e: React.MouseEvent) => {
    if (gone || (e.target as HTMLElement).closest('button, img, a')) return
    const now = Date.now()
    if (now - lastTap.current < 300) {
      lastTap.current = 0
      onReact(m.id, '❤️')
      setBurst(true)
      setTimeout(() => setBurst(false), 700)
    } else lastTap.current = now
  }

  return (
    <div id={'m' + m.id} className={'msg' + (own ? ' own' : '') + (compact ? ' compact' : '') + (m.highlighted ? ' hl' : '') + (m.boosted ? ' boosted' : '')}>
      {!own && (compact ? <span className="msg-avatar spacer" /> : <button className="msg-avatar" onClick={() => onProfile(m.user_id)} aria-label={'Профиль: ' + m.author}><Avatar name={m.author} url={m.author_photo} /></button>)}
      <div className="bubble" onClick={tap}>
        {burst && <span className="heart-burst" aria-hidden>❤️</span>}
        <div className="meta">
          {!(compact || own) && <button className="author" style={{ color: nameColor(m.author) }} onClick={() => onProfile(m.user_id)}>{m.author}</button>}
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
            {m.media_path && (url
              ? <img className="photo" src={url} alt="Фото" loading="lazy" decoding="async" onLoad={onImgLoad} onClick={() => onImage(m)} />
              : <div className="photo ph" />)}
            {Object.keys(m.reactions).length > 0 && (
              <div className="reactions">
                {Object.entries(m.reactions).map(([e, r]) => (
                  <button key={e} className={'chip' + (r.me ? ' on' : '')} onClick={() => onReact(m.id, e)}>{e} {r.n}</button>
                ))}
              </div>
            )}
          </>
        )}
        {!gone && <button className="more" onClick={() => onMenu(m)} aria-label="Действия"><MoreHorizontal size={16} /></button>}
      </div>
    </div>
  )
})

function MessageMenu({ m, me, onClose, onReact, onReply, onReport, onPromote, onChanged }: {
  m: Msg; me: Me; onClose: () => void; onReact: (e: string) => void; onReply: () => void; onReport: () => void; onPromote: () => void; onChanged: () => void
}) {
  const { run, busy } = useAction()
  const [reason, setReason] = useState('')
  const own = m.user_id === me.id
  const staff = me.role !== 'user'

  const del = async () => {
    const path = await run(() => rpc<string | null>('admin_delete_message', { p_id: m.id, p_reason: reason }))
    if (path) await removeMedia([path])
    if (path !== undefined) onChanged()
  }
  const pin = async () => {
    const ok = await run(async () => { await rpc('admin_pin_message', { p_id: m.id, p_pin: !m.pinned }); return true })
    if (ok) onChanged()
  }

  return (
    <Sheet title="Сообщение" kicker={m.author} onClose={onClose}>
      <div className="react-row">
        {REACTIONS.map((e) => <button key={e} className={'react' + (m.reactions[e]?.me ? ' on' : '')} onClick={() => onReact(e)} aria-label={'Реакция ' + e}>{e}</button>)}
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
