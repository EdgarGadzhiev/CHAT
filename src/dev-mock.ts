// Только для локальной разработки (npm run dev, адрес с ?mock): фейковый Supabase и Telegram для проверки интерфейса.
const now = Date.now()
const ago = (min: number) => new Date(now - min * 60000).toISOString()

const me = {
  id: 'me', display_name: 'Эдгар', bio: 'Люблю Новый Уренгой и северное сияние', show_photo: false, photo_url: null, role: 'admin',
  status: 'active', ban_reason: null, banned_until: null, muted_until: null, balance: 1250, consent_ok: true, policy_version: '2.0', created_at: ago(60 * 24 * 30),
}
const msg = (id: number, user: string, author: string, body: string, min: number, extra: Record<string, unknown> = {}) => ({
  id, user_id: user, status: 'visible', created_at: ago(min), body, media_path: null, reply_to: null, pinned: false, boosted: false, highlighted: false,
  author, author_photo: null, author_role: 'user', reply: null, reactions: {}, ...extra,
})
const messages = [
  msg(1, 'u1', 'Александр', 'Всем привет! Кто сегодня на набережной?', 60 * 26),
  msg(2, 'u2', 'Fyntik', 'Погода огонь, минус 12 всего', 60 * 3),
  msg(3, 'u2', 'Fyntik', 'Иду гулять с собакой', 60 * 3 - 1),
  msg(4, 'me', 'Эдгар', 'Я тоже подтянусь через час 👍', 120, { reactions: { '👍': { n: 3, me: true }, '🔥': { n: 1, me: false } } }),
  msg(5, 'u3', 'Эмир', 'Ищу попутчиков до Тарко-Сале в выходные', 40, { boosted: true, highlighted: true }),
  msg(6, 'u1', 'Александр', 'Кинотеатр сегодня работает?', 12, { reply: { id: 2, author: 'Fyntik', body: 'Погода огонь, минус 12 всего' } }),
  { ...msg(7, 'u4', 'Модератор', '', 5), status: 'deleted' },
  msg(8, 'me', 'Эдгар', 'Правила чата — в шапке, соблюдаем уважение', 2, { pinned: true, author_role: 'admin' }),
]
const members = ['Александр', 'Fyntik', 'Эмир', 'Эдгар', 'Мария'].map((n, i) => ({ id: 'u' + i, display_name: n, bio: i % 2 ? '' : 'Живу в Новом Уренгое', role: n === 'Эдгар' ? 'admin' : 'user', photo_url: null }))
const tables: Record<string, unknown[]> = {
  gifts: [['❤️', 'Сердце', 25], ['🌹', 'Роза', 50], ['💎', 'Алмаз', 100], ['🎁', 'Подарок', 150], ['🔥', 'Огонь', 200], ['👑', 'Корона', 500]].map(([emoji, title, price], id) => ({ id, emoji, title, price, enabled: true, sort: id })),
  promo_options: [{ id: 1, kind: 'top', title: 'В топ на 1 час', price: 50, duration_minutes: 60, enabled: true }, { id: 2, kind: 'highlight', title: 'Выделить на 24 часа', price: 30, duration_minutes: 1440, enabled: true }],
  chat_settings: [{ key: 'nc_price_kop', value: '100' }, { key: 'nc_min', value: '50' }, { key: 'nc_max', value: '5000' }, { key: 'nc_step', value: '10' }, { key: 'rules_text', value: '1. Уважайте участников\n2. Без спама' }, { key: 'max_message_len', value: '500' }],
  ledger: [{ id: 1, amount: 500, balance_after: 500, kind: 'purchase', note: 'Покупка Nurcoin', created_at: ago(300) }, { id: 2, amount: -50, balance_after: 450, kind: 'spend_promo', note: 'В топ на 1 час', created_at: ago(120) }],
  notifications: [{ id: 'n1', title: 'Вам подарили 🌹', text: 'Мария отправила вам подарок «Роза».', read: false, created_at: ago(20) }],
}

function rpc(fn: string): unknown {
  switch (fn) {
    case 'get_me': return me
    case 'get_messages': return messages
    case 'get_top_messages': return messages.filter((m) => m.pinned || m.boosted)
    case 'list_members': return members
    case 'get_profile': return { ...members[0], banned: false, created_at: ago(9999), messages: 42, gifts: [{ emoji: '🌹', title: 'Роза', n: 2 }, { emoji: '💎', title: 'Алмаз', n: 1 }] }
    case 'my_gifts_history': return [{ id: 1, emoji: '🌹', title: 'Роза', price: 50, created_at: ago(200), direction: 'in', other: 'Мария' }]
    case 'admin_stats': return { users: 128, banned: 2, messages_24h: 412, reports_new: 3, nc_in_circulation: 15400 }
    case 'admin_list_reports': return [{ id: 1, category: 'spam', comment: 'Рассылает рекламу', status: 'new', decision: null, resolution_note: null, created_at: ago(30), reporter: 'Мария', target_id: 'u3', target: 'Эмир', message_id: 5, message_status: 'visible', snapshot: 'Ищу попутчиков до Тарко-Сале', has_media: false }]
    default: return []
  }
}

function builder(table: string) {
  const rows = (tables[table] ?? []) as unknown[]
  const b: Record<string, unknown> = {}
  const chain = () => b
  for (const m of ['select', 'eq', 'in', 'order', 'limit', 'insert', 'update', 'delete', 'upsert']) b[m] = chain
  b.maybeSingle = () => Promise.resolve({ data: rows[0] ?? null, error: null })
  b.then = (res: (v: unknown) => unknown) => Promise.resolve({ data: rows, error: null, count: table === 'notifications' ? 1 : rows.length }).then(res)
  return b
}

export function createMockClient() {
  const session = { user: { id: 'me', email: 'tg1@telegram.nurchat.internal' } }
  const ch = { on: () => ch, subscribe: () => ch }
  return {
    auth: {
      getSession: async () => ({ data: { session } }),
      verifyOtp: async () => ({ error: null }),
      signOut: async () => ({}),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
    },
    rpc: async (fn: string) => ({ data: rpc(fn), error: null }),
    from: (t: string) => builder(t),
    channel: () => ch,
    removeChannel: () => {},
    functions: { invoke: async () => ({ data: { confirmation_url: '' }, error: null }) },
    storage: { from: () => ({ createSignedUrls: async () => ({ data: [] }), remove: async () => ({}), upload: async () => ({ error: null }) }) },
  }
}

export function installMockTelegram() {
  ;(window as any).Telegram = {
    WebApp: {
      initData: 'mock', initDataUnsafe: { user: { id: 1, first_name: 'Эдгар', username: 'flexikkk' } },
      ready() {}, expand() {}, setHeaderColor() {}, setBackgroundColor() {},
    },
  }
}
