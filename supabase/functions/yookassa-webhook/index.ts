// Webhook ЮKassa. Тело уведомления НЕ считается доверенным: статус и сумма перепроверяются запросом к API ЮKassa.
// Зачисление идемпотентно (credit_paid_order + уникальный индекс в ledger).
import { createClient } from 'npm:@supabase/supabase-js@2'

Deno.serve(async (req) => {
  if (req.method !== 'POST') return new Response('method not allowed', { status: 405 })
  const shop = Deno.env.get('YOOKASSA_SHOP_ID')
  const key = Deno.env.get('YOOKASSA_SECRET_KEY')
  if (!shop || !key) return new Response('not configured', { status: 503 })

  let paymentId = ''
  try {
    const evt = await req.json()
    paymentId = String(evt?.object?.id ?? '')
  } catch {
    return new Response('bad request', { status: 400 })
  }
  if (!/^[0-9a-f-]{20,64}$/i.test(paymentId)) return new Response('bad request', { status: 400 })

  const res = await fetch(`https://api.yookassa.ru/v3/payments/${paymentId}`, {
    headers: { Authorization: 'Basic ' + btoa(`${shop}:${key}`) },
  })
  if (!res.ok) return new Response('provider error', { status: 502 })
  const pay = await res.json()

  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } })
  const orderId = pay?.metadata?.order_id
  if (!orderId) return new Response('ok')
  const { data: order } = await admin.from('payment_orders').select('*').eq('id', orderId).maybeSingle()
  if (!order || order.provider_payment_id !== pay.id) return new Response('ok')

  if (pay.status === 'succeeded' && pay.paid === true) {
    if (Math.round(Number(pay.amount?.value) * 100) !== order.amount_kop || pay.amount?.currency !== 'RUB') {
      await admin.from('payment_orders').update({ status: 'failed' }).eq('id', order.id)
      return new Response('amount mismatch', { status: 200 })
    }
    const { error } = await admin.rpc('credit_paid_order', { p_order: order.id, p_provider_payment_id: pay.id })
    if (error) return new Response('retry', { status: 500 }) // ЮKassa повторит уведомление
  } else if (pay.status === 'canceled') {
    await admin.from('payment_orders').update({ status: 'cancelled' }).eq('id', order.id).eq('status', 'pending')
  }
  return new Response('ok')
})
