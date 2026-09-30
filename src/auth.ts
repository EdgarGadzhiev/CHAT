import { supabase } from './supabase'
import { callFunction } from './api'
import { getTelegramWebApp } from './telegram'

/** Вход через Telegram: сервер проверяет подпись initData и выдаёт одноразовый токен. */
export async function authenticate(initData: string) {
  const r = await callFunction<{ token_hash: string; type: 'magiclink' }>('tg-auth', { initData })
  const { error } = await supabase.auth.verifyOtp({ token_hash: r.token_hash, type: r.type })
  if (error) throw error
}

let pending: Promise<void> | null = null

/** Тихий повторный вход (когда сессия неожиданно истекла). Параллельные вызовы объединяются в один. */
export function reauth(): Promise<void> {
  if (!pending) {
    const initData = getTelegramWebApp()?.initData
    if (!initData) return Promise.reject(new Error('no_init_data'))
    pending = authenticate(initData).finally(() => { pending = null })
  }
  return pending
}
