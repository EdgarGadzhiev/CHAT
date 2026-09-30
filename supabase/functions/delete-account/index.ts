// Удаление аккаунта по запросу субъекта ПДн: анонимизация профиля, удаление медиа (и миниатюр) и (если нет блокировки) учётной записи входа.
import { createClient } from 'npm:@supabase/supabase-js@2'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } })

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  const auth = req.headers.get('Authorization') ?? ''
  const url = Deno.env.get('SUPABASE_URL')!
  const userClient = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: auth } } })
  const { data: u } = await userClient.auth.getUser()
  if (!u?.user) return json({ error: 'unauthorized' }, 401)

  const { data, error } = await userClient.rpc('delete_my_account')
  if (error) return json({ error: error.message }, 400)

  const admin = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } })
  const paths: string[] = (data?.media ?? []).filter(Boolean)
  const all = paths.flatMap((p) => [p, p.replace(/\.jpg$/, '_t.jpg')])
  for (let i = 0; i < all.length; i += 100) await admin.storage.from('chat-media').remove(all.slice(i, i + 100))
  if (!data?.keep_auth) await admin.auth.admin.deleteUser(u.user.id)
  return json({ ok: true })
})
