import { supabase } from './supabase'

export type Me = {
  id: string
  display_name: string
  bio: string
  show_photo: boolean
  photo_url: string | null
  role: 'user' | 'moderator' | 'admin'
  status: 'active' | 'banned' | 'deleted'
  ban_reason: string | null
  banned_until: string | null
  muted_until: string | null
  balance: number
  consent_ok: boolean
  policy_version: string
  created_at: string
  dm_enabled: boolean
  dm_feature: boolean
  notif_unread: number
  dm_unread: number
}

export type Msg = {
  id: number
  v: number
  user_id: string
  status: 'visible' | 'hidden' | 'deleted'
  created_at: string
  body: string
  media_path: string | null
  thumb: boolean
  reply_to: number | null
  pinned: boolean
  boosted: boolean
  highlighted: boolean
  boost_until: string | null
  highlight_until: string | null
  author: string
  author_photo: string | null
  author_role: string
  reply: { id: number; author: string; body: string } | null
  reactions: Record<string, { n: number; me: boolean }>
}

export type Member = { id: string; display_name: string; bio: string; role: string; photo_url: string | null; dm_enabled: boolean }

export type Peer = { id: string; name: string; photo: string | null }
export type Dialog = {
  conversation_id: number; user_id: string; display_name: string; photo_url: string | null; role: string
  last_body: string; last_deleted: boolean; last_mine: boolean; last_at: string; unread: number
}
export type DmMsg = { id: number; mine: boolean; status: 'visible' | 'deleted'; created_at: string; body: string }
export type DmThread = {
  other: { id: string; display_name: string; role: string; photo_url: string | null }
  blocked_by_me: boolean; can_send: boolean; other_read_id: number; messages: DmMsg[]
}

/** Шина событий: 'ping' — сигнал о ЛС с сервера, 'local' — изменили мы сами. */
export const dmBus = new EventTarget()
/** Состояние приватного realtime-канала личных сообщений (если не подключён — опрашиваем чаще). */
export const dmState = { live: false }
export type Gift = { id: number; title: string; emoji: string; price: number; enabled: boolean; sort: number }
export type PromoOption = { id: number; kind: 'top' | 'highlight'; title: string; price: number; duration_minutes: number; enabled: boolean }
export type Pack = { id: number; nc_amount: number; price_kop: number; enabled: boolean }

export const REACTIONS = ['👍', '❤️', '😂', '😮', '😢', '🔥']

export const REPORT_CATEGORIES: [string, string][] = [
  ['spam', 'Спам или реклама'],
  ['insult', 'Оскорбления, травля, угрозы'],
  ['illegal', 'Наркотики, запрещённые товары и услуги'],
  ['extremism', 'Экстремизм, призывы к насилию'],
  ['adult', 'Порнография и 18+'],
  ['minors', 'Материалы с участием несовершеннолетних'],
  ['personal_data', 'Публикация чужих персональных данных'],
  ['fraud', 'Мошенничество'],
  ['other', 'Другое'],
]

const ERRORS: Record<string, string> = {
  rate_limited: 'Слишком часто. Подождите немного.',
  slow_mode: 'Подождите пару секунд перед следующим сообщением.',
  duplicate: 'Такое сообщение уже отправлено.',
  muted: 'Вам временно запрещено писать в чат.',
  banned: 'Аккаунт заблокирован.',
  too_long: 'Сообщение слишком длинное.',
  too_many_lines: 'Слишком много строк в сообщении.',
  empty: 'Введите сообщение.',
  chat_disabled: 'Чат временно отключён.',
  insufficient_funds: 'Недостаточно Nurcoin.',
  already_reported: 'Вы уже отправляли жалобу.',
  report_blocked: 'Отправка жалоб для вас ограничена.',
  self_report: 'Нельзя пожаловаться на себя.',
  self_gift: 'Нельзя подарить подарок себе.',
  media_too_early: 'Фото можно отправлять через несколько минут после регистрации.',
  bad_media: 'Не удалось прикрепить фото.',
  bad_image_type: 'Поддерживаются фото JPEG, PNG и WebP.',
  bad_reply: 'Исходное сообщение недоступно.',
  not_found: 'Не найдено.',
  option_unavailable: 'Этот вариант сейчас недоступен.',
  forbidden: 'Недостаточно прав.',
  reason_required: 'Укажите причину.',
  payments_not_configured: 'Оплата пока не подключена.',
  dm_disabled: 'Личные сообщения временно отключены.',
  self_dm: 'Нельзя написать самому себе.',
  dm_unavailable: 'Этот пользователь не принимает личные сообщения.',
  you_blocked: 'Вы заблокировали этого пользователя. Разблокируйте его, чтобы написать.',
  dm_too_early: 'Личные сообщения станут доступны через несколько минут после регистрации.',
  spam_detected: 'Похоже на спам: одинаковое сообщение нескольким людям. Попробуйте написать иначе.',
  'blocked:links': 'Ссылки в чате запрещены.',
  'blocked:email': 'Не публикуйте email-адреса.',
  'blocked:contacts': 'Не публикуйте контакты (@username).',
  'blocked:digits': 'Не публикуйте номера телефонов, карт и другие длинные числа.',
  'blocked:word:profanity': 'Сообщение содержит недопустимую лексику.',
  'blocked:word:adult': 'Сообщение нарушает правила чата (18+).',
  'blocked:word:drugs': 'Сообщение нарушает правила чата (запрещённые вещества).',
  'blocked:word:gambling': 'Сообщение нарушает правила чата (азартные игры).',
  'blocked:word:fraud': 'Сообщение нарушает правила чата (мошенничество).',
}

export function errText(e: unknown): string {
  const m = e instanceof Error ? e.message : String(e)
  if (ERRORS[m]) return ERRORS[m]
  if (m.startsWith('blocked:')) return 'Сообщение нарушает правила чата.'
  if (/Failed to fetch|NetworkError|Load failed|network/i.test(m)) return 'Нет соединения с сервером. Проверьте интернет.'
  return 'Не удалось выполнить действие. Попробуйте ещё раз.'
}

const isAuthError = (e: { code?: string; message: string }) =>
  e.code === 'PGRST301' || e.code === 'PGRST303' || /JWT|not_authenticated/i.test(e.message)

/**
 * Вызов серверной функции. Если сессия истекла — один раз тихо входим заново (через Telegram) и повторяем.
 * Если аккаунт заблокирован или нужно новое согласие — просим приложение обновить состояние.
 */
export async function rpc<T = unknown>(fn: string, args?: Record<string, unknown>, retried = false): Promise<T> {
  const { data, error } = await supabase.rpc(fn, args)
  if (error) {
    if (!retried && isAuthError(error)) {
      try {
        const { reauth } = await import('./auth')
        await reauth()
        return rpc<T>(fn, args, true)
      } catch { /* падаем ниже с исходной ошибкой */ }
    }
    if (error.message === 'banned' || error.message === 'consent_required') window.dispatchEvent(new Event('nur:refresh-me'))
    throw new Error(error.message)
  }
  return data as T
}

export async function callFunction<T = any>(name: string, body?: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke(name, { body })
  if (error) {
    let code = error.message
    try {
      const ctx = (error as any).context
      if (ctx?.json) code = (await ctx.json()).error ?? code
    } catch { /* ignore */ }
    throw new Error(code)
  }
  return data as T
}

// ───────── фото ─────────
const urlCache = new Map<string, { url: string; exp: number }>()

/** Подписанные ссылки на файлы (кэш в памяти на ~55 минут, не больше 600 записей). */
export async function signedUrls(paths: string[]): Promise<Record<string, string>> {
  const now = Date.now()
  const need = [...new Set(paths)].filter((p) => !((urlCache.get(p)?.exp ?? 0) > now))
  if (need.length) {
    const { data } = await supabase.storage.from('chat-media').createSignedUrls(need, 3600)
    for (const r of data ?? []) if (r.path && r.signedUrl) urlCache.set(r.path, { url: r.signedUrl, exp: now + 3300_000 })
    while (urlCache.size > 600) urlCache.delete(urlCache.keys().next().value as string)
  }
  const out: Record<string, string> = {}
  for (const p of paths) {
    const c = urlCache.get(p)
    if (c) out[p] = c.url
  }
  return out
}

/** Путь миниатюры для файла фото (миниатюра лежит рядом: uuid_t.jpg). */
export const thumbPath = (p: string) => p.replace(/\.jpg$/, '_t.jpg')

async function toJpeg(bmp: ImageBitmap, max: number, quality: number): Promise<Blob> {
  const scale = Math.min(1, max / Math.max(bmp.width, bmp.height))
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(bmp.width * scale))
  canvas.height = Math.max(1, Math.round(bmp.height * scale))
  canvas.getContext('2d')!.drawImage(bmp, 0, 0, canvas.width, canvas.height)
  return await new Promise((res, rej) => canvas.toBlob((b) => (b ? res(b) : rej(new Error('bad_image'))), 'image/jpeg', quality))
}

/**
 * Перекодирует фото: полный размер ≤1280px (~150–400 КБ) и миниатюра ≤360px (~15–30 КБ) — лента грузит только миниатюры.
 * Перекодирование заодно удаляет EXIF (в том числе геолокацию).
 */
export async function prepareImage(file: File): Promise<{ full: Blob; thumb: Blob }> {
  if (!/^image\/(jpeg|png|webp)$/.test(file.type)) throw new Error('bad_image_type')
  if (file.size > 25 * 1024 * 1024) throw new Error('bad_image_type')
  const bmp = await createImageBitmap(file)
  try {
    const [full, thumb] = await Promise.all([toJpeg(bmp, 1280, 0.8), toJpeg(bmp, 360, 0.72)])
    return { full, thumb }
  } finally {
    bmp.close?.()
  }
}

export async function uploadImage(userId: string, img: { full: Blob; thumb: Blob }): Promise<string> {
  const path = `${userId}/${crypto.randomUUID()}.jpg`
  const opts = { contentType: 'image/jpeg', upsert: false, cacheControl: '31536000' }
  const bucket = supabase.storage.from('chat-media')
  const [a, b] = await Promise.all([bucket.upload(path, img.full, opts), bucket.upload(thumbPath(path), img.thumb, opts)])
  if (a.error) throw new Error('bad_media')
  if (b.error) { /* миниатюра необязательна: лента покажет полный файл */ }
  return path
}

/** Удаляет файлы фото вместе с миниатюрами (ошибки не критичны). */
export async function removeMedia(paths: (string | null | undefined)[]) {
  const list = paths.filter((p): p is string => !!p).flatMap((p) => [p, thumbPath(p)])
  for (let i = 0; i < list.length; i += 100) await supabase.storage.from('chat-media').remove(list.slice(i, i + 100)).catch(() => {})
}

export const fmtTime = (iso: string) =>
  new Date(iso).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })
export const fmtDate = (iso: string) =>
  new Date(iso).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
export const rub = (kop: number) => (kop / 100).toLocaleString('ru-RU', { maximumFractionDigits: 2 }) + ' ₽'
