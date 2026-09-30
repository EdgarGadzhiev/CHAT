import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from './supabase'
import { rpc, type Msg } from './api'

/**
 * Лента общего чата. Схема экономит нагрузку на сервер и трафик:
 *  1) первая загрузка — один запрос get_feed (последние 60 сообщений + топ);
 *  2) новые сообщения и изменения приходят по realtime целиком (никаких перезапросов «эффекта стада»);
 *  3) редкая «страховочная» синхронизация feed_sync шлёт только версии и получает только изменения (~100 байт);
 *  4) интервалы с разбросом (jitter), пауза в фоне, экспоненциальная пауза при ошибках,
 *     если realtime недоступен (лимит подключений на тарифе) — частота синхронизации автоматически растёт.
 */
const PAGE = 60
const MAX_WINDOW = 400
const LIVE_INTERVAL = 30_000
const FALLBACK_INTERVAL = 8_000

type SyncRes = { now: string; new: Msg[]; changed: Msg[]; gone: number[]; top_ids: number[]; top_extra: Msg[] }
type FeedRes = { messages: Msg[]; top: Msg[] }

export type Feed = { list: Msg[]; top: Msg[]; loaded: boolean; hasMore: boolean; live: boolean }

const same = (a: Msg, b: Msg) =>
  a.v === b.v && a.status === b.status && a.body === b.body && a.pinned === b.pinned && a.boosted === b.boosted &&
  a.highlighted === b.highlighted && a.author === b.author && a.author_photo === b.author_photo && a.thumb === b.thumb &&
  a.media_path === b.media_path && a.boost_until === b.boost_until && a.highlight_until === b.highlight_until &&
  JSON.stringify(a.reactions) === JSON.stringify(b.reactions)

export function useFeed(active: boolean) {
  const byId = useRef(new Map<number, Msg>())
  const order = useRef<number[]>([]) // id сообщений окна по возрастанию
  const topIds = useRef<number[]>([])
  const offset = useRef(0) // серверное время минус клиентское
  const flags = useRef({ loaded: false, hasMore: true, live: false })
  const stick = useRef(true)
  const activeRef = useRef(active)
  const syncing = useRef(false)
  const again = useRef(false)
  const timers = useRef<number[]>([])
  const [snap, setSnap] = useState<Feed>({ list: [], top: [], loaded: false, hasMore: true, live: false })

  const commit = useCallback(() => {
    const list: Msg[] = []
    for (const id of order.current) { const m = byId.current.get(id); if (m) list.push(m) }
    const top: Msg[] = []
    for (const id of topIds.current) { const m = byId.current.get(id); if (m && m.status === 'visible') top.push(m) }
    setSnap({ list, top, ...flags.current })
  }, [])

  const insertOrder = (id: number) => {
    const o = order.current
    if (o.includes(id)) return
    if (!o.length || id > o[o.length - 1]) { o.push(id); return }
    if (id < o[0]) return // старше загруженного окна
    let lo = 0, hi = o.length
    while (lo < hi) { const mid = (lo + hi) >> 1; if (o[mid] < id) lo = mid + 1; else hi = mid }
    o.splice(lo, 0, id)
  }

  /** Обновляет сообщение, если оно новее/изменилось. fromPush — пришло по realtime (там нет «моих» реакций). */
  const upsert = (m: Msg, fromPush = false): boolean => {
    if (!m || typeof m.id !== 'number') return false
    const cur = byId.current.get(m.id)
    if (cur && cur.v > m.v) return false
    let next = m
    if (fromPush && cur) {
      // в рассылке нет пользовательских флагов — сохраняем свои отметки реакций
      const r: Msg['reactions'] = {}
      for (const [e, x] of Object.entries(m.reactions ?? {})) r[e] = { n: x.n, me: cur.reactions[e]?.me ?? false }
      next = { ...m, reactions: r }
    }
    if (cur && same(cur, next)) return false
    byId.current.set(m.id, next)
    insertOrder(m.id)
    return true
  }

  const expire = (): boolean => {
    const now = Date.now() + offset.current
    let changed = false
    for (const [id, m] of byId.current) {
      let n = m
      if (m.boosted && m.boost_until && Date.parse(m.boost_until) <= now) n = { ...n, boosted: false }
      if (m.highlighted && m.highlight_until && Date.parse(m.highlight_until) <= now) n = { ...n, highlighted: false }
      if (n !== m) { byId.current.set(id, n); changed = true }
    }
    const before = topIds.current.length
    topIds.current = topIds.current.filter((id) => { const m = byId.current.get(id); return m && (m.pinned || m.boosted) })
    return changed || topIds.current.length !== before
  }

  const trim = () => {
    if (!stick.current || order.current.length <= MAX_WINDOW + 100) return
    const drop = order.current.splice(0, order.current.length - MAX_WINDOW)
    for (const id of drop) if (!topIds.current.includes(id)) byId.current.delete(id)
    flags.current.hasMore = true
  }

  const fullLoad = useCallback(async () => {
    const res = await rpc<FeedRes>('get_feed', { p_limit: PAGE })
    byId.current = new Map()
    order.current = []
    for (const m of res.messages) { byId.current.set(m.id, m); order.current.push(m.id) }
    for (const m of res.top) byId.current.set(m.id, m)
    topIds.current = res.top.map((m) => m.id)
    flags.current.loaded = true
    flags.current.hasMore = res.messages.length >= PAGE
    commit()
  }, [commit])

  const sync = useCallback(async () => {
    if (syncing.current) { again.current = true; return }
    syncing.current = true
    try {
      if (!flags.current.loaded) { await fullLoad(); return }
      const ord = order.current
      const known: Record<string, number> = {}
      for (const id of ord.slice(-100)) { const m = byId.current.get(id); if (m) known[id] = m.v }
      const after = ord.length ? ord[ord.length - 1] : 0
      const res = await rpc<SyncRes>('feed_sync', { p_after: after, p_known: known })
      if (res.new.length >= 100) { await fullLoad(); return } // слишком много пропустили — перезагружаем окно
      offset.current = Date.parse(res.now) - Date.now()
      let changed = false
      for (const m of res.new) changed = upsert(m) || changed
      for (const m of res.changed) changed = upsert(m) || changed
      for (const m of res.top_extra) { if (!byId.current.has(m.id)) byId.current.set(m.id, m); changed = true }
      for (const id of res.gone) {
        if (byId.current.delete(id)) changed = true
        const i = order.current.indexOf(id)
        if (i >= 0) order.current.splice(i, 1)
      }
      const prevTop = topIds.current.join()
      topIds.current = res.top_ids
      if (prevTop !== res.top_ids.join()) changed = true
      changed = expire() || changed
      trim()
      if (changed) commit()
    } finally {
      syncing.current = false
      if (again.current) { again.current = false; void sync().catch(() => {}) }
    }
  }, [commit, fullLoad])

  const later = useCallback((ms: number) => {
    const t = window.setTimeout(() => { timers.current = timers.current.filter((x) => x !== t); void sync().catch(() => {}) }, ms)
    timers.current.push(t)
  }, [sync])

  // realtime + страховочный опрос
  useEffect(() => {
    const ch = supabase
      .channel('city', { config: { private: true } })
      .on('broadcast', { event: 'msg' }, ({ payload }) => {
        if (upsert(payload as Msg, true)) { trim(); commit() }
      })
      .on('broadcast', { event: 'clear' }, () => { flags.current.loaded = false; later(150 + Math.random() * 1500) })
      .subscribe((status) => {
        const live = status === 'SUBSCRIBED'
        if (flags.current.live !== live) { flags.current.live = live; commit() }
        if (live) later(Math.random() * 800) // догоняем то, что могли пропустить
      })

    let timer: number | undefined
    let fails = 0
    const tick = async () => {
      if (activeRef.current && !document.hidden) {
        try { await sync(); fails = 0 } catch { fails++ }
      } else if (expire()) commit()
      const base = flags.current.live ? LIVE_INTERVAL : FALLBACK_INTERVAL
      const pause = base * (0.75 + Math.random() * 0.5) * (fails ? Math.min(6, 1 + fails) : 1)
      timer = window.setTimeout(tick, pause)
    }
    timer = window.setTimeout(tick, 200)

    const wake = () => { if (!document.hidden && activeRef.current) later(Math.random() * 1200) }
    document.addEventListener('visibilitychange', wake)
    window.addEventListener('online', wake)
    return () => {
      supabase.removeChannel(ch)
      window.clearTimeout(timer)
      timers.current.forEach(window.clearTimeout)
      timers.current = []
      document.removeEventListener('visibilitychange', wake)
      window.removeEventListener('online', wake)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    activeRef.current = active
    if (active) later(Math.random() * 300)
  }, [active, later])

  const loadOlder = useCallback(async () => {
    const first = order.current[0]
    if (!first) return
    const res = await rpc<FeedRes>('get_feed', { p_before: first, p_limit: PAGE })
    const ids: number[] = []
    for (const m of res.messages) { if (!byId.current.has(m.id)) byId.current.set(m.id, m); ids.push(m.id) }
    order.current = [...ids, ...order.current.filter((x) => !ids.includes(x))]
    flags.current.hasMore = res.messages.length >= PAGE
    commit()
  }, [commit])

  /** Реакция с мгновенным откликом; сервер возвращает итоговые счётчики. */
  const react = useCallback(async (msgId: number, emoji: string) => {
    const cur = byId.current.get(msgId)
    if (!cur) return
    const r = { ...cur.reactions }
    const mine = r[emoji]?.me
    const n = (r[emoji]?.n ?? 0) + (mine ? -1 : 1)
    if (n <= 0) delete r[emoji]; else r[emoji] = { n, me: !mine }
    byId.current.set(msgId, { ...cur, reactions: r })
    commit()
    try {
      const real = await rpc<Msg['reactions']>('toggle_reaction', { p_message: msgId, p_emoji: emoji })
      const c2 = byId.current.get(msgId)
      if (c2 && real) { byId.current.set(msgId, { ...c2, reactions: real }); commit() }
    } catch (e) {
      later(0)
      throw e
    }
  }, [commit, later])

  const setStick = useCallback((v: boolean) => { stick.current = v }, [])
  const syncSoon = useCallback((ms = 0) => later(ms), [later])

  return { ...snap, loadOlder, react, syncSoon, setStick }
}
