# NUR_CHAT — городской чат Нового Уренгоя (Telegram Mini App)

Городской чат с внутренней валютой **Nurcoin**. Клиент — React + Vite на Cloudflare Workers, бэкенд — Supabase (Postgres + Edge Functions + Storage).

> ⚠️ Перед публичным запуском прочитайте **[docs/LEGAL_SAFETY.md](docs/LEGAL_SAFETY.md)** — там юридические риски (152-ФЗ, локализация данных, РКН, платежи) и чек-лист.

## Возможности (MVP)
**Пользователь:** вход через Telegram, профиль и просмотр чужих, **личные сообщения** (раздел «Люди»: кнопка «Написать» у каждого участника, вкладка «Диалоги», блокировка, жалобы), общий чат (ответы, фото, реакции, realtime), жалобы, Nurcoin (баланс, покупка, история), продвижение сообщений (в топ / выделение), виртуальные подарки.
**Администрация:** поиск/блокировка/мут пользователей, история нарушений, модерация чата (удаление сообщений и фото, закрепление, правила), жалобы с решениями, балансы и корректировки с обязательной причиной, настройка подарков/цен продвижения/пакетов NC/запрещённых слов, журнал действий.
**Защита:** серверная проверка Telegram initData, RLS без прямого доступа к таблицам, автофильтр контента, rate limit, защита от массовой регистрации и злоупотребления жалобами.

## Структура
```
src/                      клиент (App, chat, wallet, people, admin, legal, ...)
supabase/migrations/      схема БД, RPC, хранилище, cron
supabase/functions/       tg-auth · delete-account · create-payment · yookassa-webhook
docs/LEGAL_SAFETY.md      юридический и security-разбор
```

## Запуск
```bash
npm install
npm run dev       # Vite; вход работает только внутри Telegram (нужна подпись initData)
npm run build
npm run deploy    # build + wrangler deploy (Cloudflare)
```

## Секреты (Supabase → Edge Functions → Secrets)
| Секрет | Зачем |
|---|---|
| `TELEGRAM_BOT_TOKEN` | проверка подписи Telegram initData (обязателен) |
| `YOOKASSA_SHOP_ID`, `YOOKASSA_SECRET_KEY` | приём платежей |
| `PAYMENT_RETURN_URL` | куда вернуть пользователя после оплаты |
| `YOOKASSA_VAT_CODE` | код НДС для чека (по умолчанию 1 — без НДС) |

Токен бота и ключи ЮKassa **никогда не кладутся во frontend и в репозиторий**.

## Первый администратор
```sql
update public.profiles set role = 'admin' where telegram_id = <ВАШ_TELEGRAM_ID>;
```

## Что не входит в MVP
Знакомства, вывод/обмен Nurcoin, оплата Nurcoin реальных товаров, маркетплейс, кейсы с выигрышами, фото в личных сообщениях.
