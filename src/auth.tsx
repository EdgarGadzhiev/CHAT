import { useEffect, useState } from 'react'
import { ArrowLeft, Mail, ShieldCheck } from 'lucide-react'
import { supabase } from './supabase'
import type { TelegramUser } from './telegram'
import './auth.css'

type AuthScreenProps = {
  telegramUser: TelegramUser | null
}

export function AuthScreen({ telegramUser }: AuthScreenProps) {
  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [step, setStep] = useState<'email' | 'code'>('email')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [cooldown, setCooldown] = useState(0)

  useEffect(() => {
    if (cooldown <= 0) return

    const timer = window.setInterval(() => {
      setCooldown(value => {
        if (value <= 1) {
          window.clearInterval(timer)
          return 0
        }

        return value - 1
      })
    }, 1000)

    return () => window.clearInterval(timer)
  }, [cooldown])

  if (!telegramUser) {
    return (
      <div className="auth-shell">
        <div className="auth-card">
          <div className="auth-logo">N</div>

          <span className="auth-kicker">
            NUR_CHAT · АВТОРИЗАЦИЯ
          </span>

          <h1>Добро пожаловать</h1>

          <p className="auth-subtitle">
            Открой NUR_CHAT внутри Telegram, чтобы определить твой
            Telegram-профиль.
          </p>

          <div className="auth-error">
            Открой приложение через Telegram.
          </div>
        </div>
      </div>
    )
  }

  const sendCode = async () => {
    const value = email.trim().toLowerCase()

    if (!value || !value.includes('@')) {
      setError('Введи корректный email.')
      return
    }

    setLoading(true)
    setError('')
    setMessage('')

    const { error } = await supabase.auth.signInWithOtp({
      email: value,
      options: {
        shouldCreateUser: true,
      },
    })

    setLoading(false)

    if (error) {
      setError(error.message)
      return
    }

    setStep('code')
    setCode('')
    setCooldown(60)
    setMessage(
      'Код отправлен на почту. Введи его здесь, не закрывая NUR_CHAT.'
    )
  }

  const verifyCode = async () => {
    const value = email.trim().toLowerCase()
    const token = code.trim()

    if (!/^\d{8}$/.test(token)) {
      setError('Введи 8-значный код из письма.')
      return
    }

    setLoading(true)
    setError('')
    setMessage('')

    const { data, error } = await supabase.auth.verifyOtp({
      email: value,
      token,
      type: 'email',
    })

    if (error) {
      setLoading(false)

      setError(
        error.message === 'Token has expired or is invalid'
          ? 'Неверный или просроченный код. Запроси новый код.'
          : error.message
      )

      return
    }

    const authUser = data.user ?? data.session?.user

    if (!authUser) {
      setLoading(false)
      setError(
        'Код принят, но сессия не создалась. Попробуй войти ещё раз.'
      )
      return
    }

    const {
      data: existingProfile,
      error: profileCheckError,
    } = await supabase
      .from('profiles')
      .select('telegram_id')
      .eq('id', authUser.id)
      .maybeSingle()

    if (profileCheckError) {
      setLoading(false)

      setError(
        'Не удалось проверить профиль: ' +
          profileCheckError.message
      )

      await supabase.auth.signOut()
      return
    }

    if (
      existingProfile &&
      Number(existingProfile.telegram_id) !==
        Number(telegramUser.id)
    ) {
      setLoading(false)

      setError(
        'Этот email уже привязан к другому Telegram-аккаунту.'
      )

      await supabase.auth.signOut()
      return
    }

    const { error: profileError } = await supabase
      .from('profiles')
      .upsert({
        id: authUser.id,
        telegram_id: telegramUser.id,
        username: telegramUser.username ?? null,
        first_name: telegramUser.first_name,
        last_name: telegramUser.last_name ?? null,
        photo_url: telegramUser.photo_url ?? null,
      })

    if (profileError) {
      setLoading(false)

      setError(
        'Вход выполнен, но профиль не удалось сохранить: ' +
          profileError.message
      )

      return
    }

    if (!existingProfile) {
      const { error: notificationError } = await supabase
        .from('notifications')
        .insert({
          user_id: authUser.id,
          title: 'Добро пожаловать',
          text: 'Твой профиль NUR_CHAT создан. Теперь можно общаться, добавлять друзей и отправлять подарки.',
          read: false,
        })

      if (notificationError) {
        console.warn(
          'Не удалось создать приветственное уведомление:',
          notificationError.message
        )
      }
    }

    setLoading(false)

    setMessage(
      'Email подтверждён. Вход выполнен — открываем профиль…'
    )
  }

  const resendCode = async () => {
    if (cooldown > 0 || loading) return

    const value = email.trim().toLowerCase()

    if (!value || !value.includes('@')) {
      setError('Введи корректный email.')
      return
    }

    setLoading(true)
    setError('')
    setMessage('')

    const { error } = await supabase.auth.signInWithOtp({
      email: value,
      options: {
        shouldCreateUser: true,
      },
    })

    setLoading(false)

    if (error) {
      setError(error.message)
      return
    }

    setCooldown(60)
    setCode('')
    setMessage('Новый код отправлен на почту.')
  }

  const changeEmail = () => {
    setStep('email')
    setCode('')
    setError('')
    setMessage('')
  }

  return (
    <div className="auth-shell">
      <div className="auth-card">
        <div className="auth-logo">N</div>

        <span className="auth-kicker">
          NUR_CHAT · АВТОРИЗАЦИЯ
        </span>

        <h1>Добро пожаловать</h1>

        <p className="auth-subtitle">
          {step === 'email'
            ? 'Подтверди email, чтобы создать свой NUR_CHAT-профиль.'
            : 'Мы отправили одноразовый код на твою почту.'}
        </p>

        <div className="auth-telegram">
          <div className="auth-avatar">
            {telegramUser.photo_url ? (
              <img
                src={telegramUser.photo_url}
                alt=""
              />
            ) : (
              telegramUser.first_name[0]
            )}
          </div>

          <div>
            <strong>
              {telegramUser.first_name}
              {telegramUser.last_name
                ? ' ' + telegramUser.last_name
                : ''}
            </strong>

            <span>
              {telegramUser.username
                ? '@' + telegramUser.username
                : 'Telegram ID ' + telegramUser.id}
            </span>
          </div>
        </div>

        {step === 'email' ? (
          <>
            <label>
              Email

              <input
                value={email}
                onChange={e => {
                  setEmail(e.target.value)
                  setError('')
                }}
                placeholder="you@example.com"
                type="email"
                autoComplete="email"
                disabled={loading}
              />
            </label>

            <button
              className="auth-button"
              onClick={sendCode}
              disabled={loading}
            >
              <Mail size={17} />

              {loading
                ? 'Отправляем…'
                : 'Получить код'}
            </button>
          </>
        ) : (
          <>
            <label>
              Код из письма

              <input
                value={code}
                onChange={e => {
                  setCode(
                    e.target.value
                      .replace(/\D/g, '')
                      .slice(0, 8)
                  )

                  setError('')
                }}
                placeholder="12345678"
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={8}
                disabled={loading}
                autoFocus
              />
            </label>

            <button
              className="auth-button"
              onClick={verifyCode}
              disabled={loading || code.length !== 8}
            >
              <ShieldCheck size={17} />

              {loading
                ? 'Проверяем…'
                : 'Подтвердить код'}
            </button>

            <button
              className="auth-link"
              onClick={resendCode}
              disabled={cooldown > 0 || loading}
            >
              {cooldown > 0
                ? 'Отправить код повторно через ' +
                  cooldown +
                  ' сек.'
                : 'Отправить код повторно'}
            </button>

            <button
              className="auth-link"
              onClick={changeEmail}
              disabled={loading}
            >
              <ArrowLeft size={15} />

              Изменить email
            </button>
          </>
        )}

        {message && (
          <div className="auth-message">
            <ShieldCheck size={17} />
            {message}
          </div>
        )}

        {error && (
          <div className="auth-error">
            {error}
          </div>
        )}

        <small className="auth-footnote">
          Telegram используется для профиля, а email —
          для подтверждения входа.
        </small>
      </div>
    </div>
  )
}