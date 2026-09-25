import { useState } from 'react'
import type { TelegramUser } from './telegram'
import './privacy-consent.css'

type Props = {
  telegramUser: TelegramUser | null
  loading: boolean
  error: string
  onAccept: () => void
}

export function PrivacyConsent({
  telegramUser,
  loading,
  error,
  onAccept,
}: Props) {
  const [checked, setChecked] = useState(false)
  const [showPolicy, setShowPolicy] = useState(false)

  if (!telegramUser) {
    return (
      <div className="privacy-shell">
        <div className="privacy-card">
          <div className="privacy-logo">N</div>
          <span className="privacy-kicker">NUR_CHAT · ДОСТУП</span>
          <h1>Открой NUR_CHAT в Telegram</h1>
          <p>
            Приложение использует данные твоего Telegram-профиля
            для создания профиля NUR_CHAT.
          </p>
          <div className="privacy-warning">
            Открой Mini App через Telegram, чтобы продолжить.
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="privacy-shell">
      <div className="privacy-card">
        <div className="privacy-logo">N</div>

        <span className="privacy-kicker">
          NUR_CHAT · ПЕРСОНАЛЬНЫЕ ДАННЫЕ
        </span>

        <h1>Перед началом</h1>

        <p className="privacy-lead">
          NUR_CHAT использует данные твоего Telegram-профиля,
          чтобы создать и обслуживать твой профиль в городском чате.
        </p>

        <div className="privacy-profile">
          <div className="privacy-avatar">
            {telegramUser.photo_url ? (
              <img src={telegramUser.photo_url} alt="" />
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

        <div className="privacy-points">
          <div>
            <strong>Что используем</strong>
            <span>
              Telegram ID, имя, фамилию, username и фотографию,
              если они доступны в Telegram.
            </span>
          </div>

          <div>
            <strong>Зачем</strong>
            <span>
              Для создания профиля, общения, друзей, уведомлений
              и работы функций NUR_CHAT.
            </span>
          </div>

          <div>
            <strong>Без email</strong>
            <span>
              Для входа в NUR_CHAT email и код из письма больше не нужны.
            </span>
          </div>
        </div>

        <label className="privacy-check">
          <input
            type="checkbox"
            checked={checked}
            onChange={e => setChecked(e.target.checked)}
            disabled={loading}
          />
          <span>
            Я даю согласие на обработку моих персональных данных
            для работы NUR_CHAT и подтверждаю, что ознакомился(ась)
            с{' '}
            <button
              type="button"
              className="privacy-link"
              onClick={() => setShowPolicy(true)}
            >
              Политикой обработки персональных данных
            </button>
            .
          </span>
        </label>

        {error && (
          <div className="privacy-error">
            {error}
          </div>
        )}

        <button
          className="privacy-accept"
          disabled={!checked || loading}
          onClick={onAccept}
        >
          {loading ? 'Создаём профиль…' : 'Продолжить в NUR_CHAT'}
        </button>

        <small className="privacy-footnote">
          Согласие сохраняется с версией документа и временем его
          предоставления. Его можно отозвать, обратившись к оператору.
        </small>
      </div>

      {showPolicy && (
        <div
          className="privacy-modal-backdrop"
          onClick={() => setShowPolicy(false)}
        >
          <div
            className="privacy-modal"
            onClick={e => e.stopPropagation()}
          >
            <div className="privacy-modal-head">
              <div>
                <span>ДОКУМЕНТ · ВЕРСИЯ 1.0</span>
                <h2>Политика обработки персональных данных</h2>
              </div>

              <button
                type="button"
                onClick={() => setShowPolicy(false)}
                aria-label="Закрыть"
              >
                ×
              </button>
            </div>

            <div className="privacy-document">
              <p>
                Настоящая Политика определяет порядок обработки
                персональных данных пользователей NUR_CHAT.
              </p>

              <h3>1. Оператор</h3>
              <p>
                Оператор: <strong>[УКАЖИТЕ ФИО ИЛИ НАИМЕНОВАНИЕ ОПЕРАТОРА]</strong>.
                Адрес: <strong>[УКАЖИТЕ АДРЕС ОПЕРАТОРА]</strong>.
                Контактный email: <strong>[УКАЖИТЕ EMAIL ДЛЯ ОБРАЩЕНИЙ]</strong>.
              </p>

              <h3>2. Какие данные обрабатываются</h3>
              <p>
                Telegram ID, имя, фамилия, username и фотография профиля,
                если эти сведения доступны через Telegram Mini App.
                Также обрабатываются данные, которые пользователь
                самостоятельно размещает в NUR_CHAT, включая сообщения
                и другой пользовательский контент.
              </p>

              <h3>3. Цели обработки</h3>
              <p>
                Создание и обслуживание профиля пользователя, обеспечение
                работы чатов и личного общения, работа друзей, уведомлений,
                подарков и других функций NUR_CHAT, обеспечение безопасности
                и модерации сервиса, а также рассмотрение обращений пользователей.
              </p>

              <h3>4. Правовые основания</h3>
              <p>
                Обработка осуществляется на основаниях, предусмотренных
                законодательством Российской Федерации, в том числе на основании
                согласия пользователя в случаях, когда оно необходимо.
              </p>

              <h3>5. Срок хранения</h3>
              <p>
                Данные хранятся в течение срока, необходимого для достижения
                целей обработки, либо до прекращения соответствующего основания
                обработки, если законодательство не требует иного хранения.
              </p>

              <h3>6. Передача и поручение обработки</h3>
              <p>
                Для работы сервиса могут использоваться технологические
                поставщики, которым предоставляется только необходимый объём
                данных. Конкретный перечень таких поставщиков и место обработки
                должны быть указаны оператором в окончательной редакции Политики.
              </p>

              <h3>7. Права пользователя</h3>
              <p>
                Пользователь вправе запрашивать сведения об обработке своих
                персональных данных, требовать их уточнения, блокирования или
                уничтожения в случаях, предусмотренных законом, а также отзывать
                согласие, если обработка основана на согласии.
              </p>

              <h3>8. Безопасность</h3>
              <p>
                Оператор принимает необходимые правовые, организационные и
                технические меры для защиты персональных данных от неправомерного
                или случайного доступа, изменения, раскрытия, уничтожения и иных
                неправомерных действий.
              </p>

              <h3>9. Контакты</h3>
              <p>
                Обращения по вопросам обработки персональных данных направляются
                оператору по адресу: <strong>[УКАЖИТЕ EMAIL]</strong>.
              </p>

              <div className="privacy-draft-note">
                Важно: перед публичным запуском NUR_CHAT необходимо заменить
                поля в квадратных скобках реальными данными оператора и привести
                раздел о поставщиках и местах обработки в соответствие с фактической
                инфраструктурой проекта.
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
