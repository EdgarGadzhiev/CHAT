// Создание платежа ЮKassa для покупки пакета Nurcoin.
// Секреты: YOOKASSA_SHOP_ID, YOOKASSA_SECRET_KEY, PAYMENT_RETURN_URL (необязательно), YOOKASSA_VAT_CODE (по умолчанию 1 = без НДС).
import { createClient } from 'npm:@supabase/supabase-js@2'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  const shop = Deno.env.get('YOOKASSA_SHOP_ID')
  const key = Deno.env.get('YOOKASSA_SECRET_KEY')
  if (!shop || !key) return json({ error: 'payments_not_configured' }, 503)

  const url = Deno.env.get('SUPABASE_URL')!
  const userClient = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } },
  })
  const { data: u } = await userClient.auth.getUser()
  if (!u?.user) return json({ error: 'unauthorized' }, 401)

  let body: { nc_amount?: number; email?: string } = {}
  try { body = await req.json() } catch { /* пусто */ }
  if (!Number.isInteger(body.nc_amount)) return json({ error: 'bad_request' }, 400)

  const { data: order, error } = await userClient.rpc("create_order", { p_nc: body.nc_amount })
  if (error || !order) return json({ error: error?.message ?? 'order_failed' }, 400)

  const value = (order.amount_kop / 100).toFixed(2)
  const desc = `Nurcoin: ${order.nc_amount} NC`
  const payload: Record<string, unknown> = {
    amount: { value, currency: 'RUB' },
    capture: true,
    confirmation: { type: 'redirect', return_url: Deno.env.get('PAYMENT_RETURN_URL') ?? 'https://chat-novy-urengoy.workers.dev' },
    description: desc,
    metadata: { order_id: order.id },
  }
  // Чек 54-ФЗ: email покупателя передаётся только в ЮKassa и нигде у нас не сохраняется
  const email = (body.email ?? '').trim()
  if (/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    payload.receipt = {
      customer: { email },
      items: [{
        description: desc, quantity: '1.00', amount: { value, currency: 'RUB' },
        vat_code: Number(Deno.env.get('YOOKASSA_VAT_CODE') ?? '1'), payment_mode: 'full_payment', payment_subject: 'service',
      }],
    }
  }

  const res = await fetch('https://api.yookassa.ru/v3/payments', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Idempotence-Key': order.id,
      Authorization: 'Basic ' + btoa(`${shop}:${key}`),
    },
    body: JSON.stringify(payload),
  })
  const pay = await res.json()
  if (!res.ok || !pay?.id) return json({ error: 'provider_error' }, 502)

  const admin = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } })
  await admin.from('payment_orders').update({ provider_payment_id: pay.id }).eq('id', order.id)
  return json({ confirmation_url: pay.confirmation?.confirmation_url, order_id: order.id })
})
