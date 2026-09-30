// Вход через Telegram Mini App. Проверяет подпись initData (HMAC-SHA256 с токеном бота),
// создаёт/находит пользователя и возвращает одноразовый токен для supabase.auth.verifyOtp().
// Секреты: TELEGRAM_BOT_TOKEN (задаётся вручную), SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY (есть по умолчанию).
//
// Нагрузка: клиент вызывает функцию только когда нет действующей сессии (обычно раз в несколько дней),
// поэтому здесь минимум обращений к БД: при повторном входе — 1 select + generateLink, без записей.
import { createClient } from 'npm:@supabase/supabase-js@2'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } })

const enc = new TextEncoder()
async function hmac(key: ArrayBuffer | Uint8Array, data: string): Promise<ArrayBuffer> {
  const k = await crypto.subtle.importKey('raw', key, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  return crypto.subtle.sign('HMAC', k, enc.encode(data))
}
const hex = (b: ArrayBuffer) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, '0')).join('')
async function sha256(s: string) {
  return hex(await crypto.subtle.digest('SHA-256', enc.encode(s)))
}
function safeEqual(a: string, b: string) {
  if (a.length !== b.length) return false
  let r = 0
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return r === 0
}

// Мобильные операторы отдают один IP тысячам абонентов (CGNAT), поэтому лимиты по IP мягкие:
// главный барьер — подпись Telegram (нужен настоящий аккаунт), лимиты защищают только от массовой накрутки.
const REG_PER_IP_HOUR = 30
const REG_GLOBAL_HOUR = 600

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405)

  const botToken = Deno.env.get('TELEGRAM_BOT_TOKEN')
  if (!botToken) return json({ error: 'not_configured' }, 503)

  let initData = ''
  try {
    initData = String((await req.json()).initData ?? '')
  } catch {
    return json({ error: 'bad_request' }, 400)
  }
  if (!initData || initData.length > 4096) return json({ error: 'bad_request' }, 400)

  // 1. Проверка подписи Telegram (дёшево, БД не трогаем)
  const params = new URLSearchParams(initData)
  const hash = params.get('hash')
  if (!hash) return json({ error: 'bad_signature' }, 401)
  params.delete('hash')
  const dataCheck = [...params.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${k}=${v}`).join('\n')
  const secret = await hmac(enc.encode('WebAppData'), botToken)
  const expected = hex(await hmac(secret, dataCheck))
  if (!safeEqual(expected, hash)) return json({ error: 'bad_signature' }, 401)

  const authDate = Number(params.get('auth_date') ?? 0)
  if (!authDate || Date.now() / 1000 - authDate > 3600) return json({ error: 'expired' }, 401)

  let tg: { id: number; first_name?: string; last_name?: string; username?: string; photo_url?: string; is_bot?: boolean }
  try {
    tg = JSON.parse(params.get('user') ?? '')
  } catch {
    return json({ error: 'bad_user' }, 400)
  }
  if (!tg?.id || tg.is_bot) return json({ error: 'bad_user' }, 400)

  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  const email = `tg${tg.id}@telegram.nurchat.internal`
  const { data: existing } = await admin
    .from('profiles')
    .select('id, status, auth_linked, username, first_name, last_name, photo_url')
    .eq('telegram_id', tg.id)
    .maybeSingle()

  // 2. Массовая регистрация: лимиты только для НОВЫХ пользователей
  let ipHash = ''
  if (!existing) {
    const ip = (req.headers.get('cf-connecting-ip') ?? req.headers.get('x-forwarded-for') ?? 'unknown').split(',')[0].trim()
    ipHash = await sha256(`${ip}:${botToken}`)
    const since = new Date(Date.now() - 3600_000).toISOString()
    const [byIp, global] = await Promise.all([
      admin.from('auth_attempts').select('id', { count: 'exact', head: true }).eq('ip_hash', ipHash).eq('kind', 'register').gte('created_at', since),
      admin.from('auth_attempts').select('id', { count: 'exact', head: true }).eq('kind', 'register').gte('created_at', since),
    ])
    if ((byIp.count ?? 0) >= REG_PER_IP_HOUR || (global.count ?? 0) >= REG_GLOBAL_HOUR) return json({ error: 'rate_limited' }, 429)
    await admin.from('auth_attempts').insert({ ip_hash: ipHash, kind: 'register' })
  } else if (!existing.auth_linked) {
    // старые/анонимные сессии превращаем в постоянного пользователя с привязкой к Telegram — один раз
    await admin.auth.admin.updateUserById(existing.id, { email, email_confirm: true, app_metadata: { provider: 'telegram' } })
  }

  // 3. Одноразовая ссылка → hashed_token (создаёт пользователя, если его ещё нет)
  const { data: link, error: linkErr } = await admin.auth.admin.generateLink({ type: 'magiclink', email })
  if (linkErr || !link?.properties?.hashed_token || !link.user) return json({ error: 'auth_failed' }, 500)
  const userId = link.user.id

  if (!existing) {
    let name = (tg.first_name ?? '').replace(/\s+/g, ' ').trim().slice(0, 32)
    const { data: bad } = await admin.rpc('check_text', { t: name })
    if (name.length < 2 || bad) name = 'Участник ' + String(tg.id).slice(-4)
    // upsert с ignoreDuplicates: если пользователь открыл приложение дважды одновременно, второй запрос не падает
    const { error: insErr } = await admin.from('profiles').upsert(
      {
        id: userId, telegram_id: tg.id, username: tg.username ?? null, first_name: tg.first_name ?? null,
        last_name: tg.last_name ?? null, photo_url: tg.photo_url ?? null, display_name: name, auth_linked: true,
      },
      { onConflict: 'telegram_id', ignoreDuplicates: true },
    )
    if (insErr) return json({ error: 'profile_failed' }, 500)
  } else {
    const next = {
      username: tg.username ?? null, first_name: tg.first_name ?? null, last_name: tg.last_name ?? null, photo_url: tg.photo_url ?? null,
    }
    const changed = !existing.auth_linked || next.username !== existing.username || next.first_name !== existing.first_name ||
      next.last_name !== existing.last_name || next.photo_url !== existing.photo_url
    if (changed) await admin.from('profiles').update({ ...next, auth_linked: true }).eq('id', existing.id)
  }

  return json({ token_hash: link.properties.hashed_token, type: 'magiclink' })
})
