export type TelegramUser = {
  id: number
  first_name: string
  last_name?: string
  username?: string
  language_code?: string
  photo_url?: string
}

type TelegramWebApp = {
  ready: () => void
  expand: () => void
  setHeaderColor?: (color: string) => void
  setBackgroundColor?: (color: string) => void
  enableClosingConfirmation?: () => void
  disableClosingConfirmation?: () => void
  initData: string
  initDataUnsafe?: {
    user?: TelegramUser
    start_param?: string
  }
  themeParams?: Record<string, string>
  colorScheme?: 'light' | 'dark'
  version?: string
  platform?: string
}

declare global {
  interface Window {
    Telegram?: {
      WebApp: TelegramWebApp
    }
  }
}

export function getTelegramWebApp(): TelegramWebApp | null {
  return window.Telegram?.WebApp ?? null
}

export function getTelegramUser(): TelegramUser | null {
  return getTelegramWebApp()?.initDataUnsafe?.user ?? null
}

export function initTelegramWebApp() {
  const webApp = getTelegramWebApp()

  if (!webApp) {
    return
  }

  webApp.ready()
  webApp.expand()
  webApp.setHeaderColor?.('#0b0d12')
  webApp.setBackgroundColor?.('#0b0d12')
}
