import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { createMockClient } from './dev-mock'

const supabaseUrl = 'https://fyqjxsrbomhrsgketqev.supabase.co'
const supabasePublishableKey = 'sb_publishable_GRn2b-7qJOc5xyfeQ5MYqA_uInpg70a'

// ?mock работает только в dev-режиме (npm run dev) — в production-сборке этой ветки нет.
const useMock = import.meta.env.DEV && location.search.includes('mock')

export const supabase: SupabaseClient = useMock
  ? (createMockClient() as unknown as SupabaseClient)
  : createClient(supabaseUrl, supabasePublishableKey, {
      auth: { autoRefreshToken: true, persistSession: true, detectSessionInUrl: true },
    })
