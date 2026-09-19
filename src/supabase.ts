import { createClient } from '@supabase/supabase-js'

const supabaseUrl = 'https://fyqjxsrbomhrsgketqev.supabase.co'
const supabasePublishableKey = 'sb_publishable_GRn2b-7qJOc5xyfeQ5MYqA_uInpg70a'

export const supabase = createClient(supabaseUrl, supabasePublishableKey, {
  auth: {
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: true,
  },
})
