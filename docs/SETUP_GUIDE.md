# Гайд по настройке NUR_CHAT (что и куда нажимать)

## 0. Главное про «токены» простыми словами
- **Токен бота** — пароль от вашего бота. По нему Supabase проверяет, что пользователь действительно пришёл из Telegram. Хранится **только** в Supabase (Secrets). Не в коде, не в GitHub, не в чате.
- **publishable key** Supabase (`sb_publishable_…`) — публичный ключ, он уже в коде и его прятать не нужно.
- **Ключи ЮKassa** — понадобятся позже, добавляются так же, как токен бота.

## 1. Токен бота → Supabase (обязательно, иначе вход не работает)
1. Telegram → **@BotFather** → команда `/mybots`.
2. Выберите **@CHAT_NovyUrengoyBot** → **API Token** → скопируйте токен (вид `123456789:AAH…`).
3. Откройте https://supabase.com/dashboard → проект **NUR_CHAT**.
4. Левое меню → **Edge Functions** → вкладка/кнопка **Secrets** (иногда «Manage secrets»).
5. **Add new secret**: Name = `TELEGRAM_BOT_TOKEN`, Value = токен → **Save**.
6. Готово. Перезапускать ничего не нужно.

> Если токен случайно утёк (в чат, скриншот): BotFather → `/mybots` → бот → API Token → **Revoke current token**, и повторите шаг 5 с новым.

## 2. Нужно ли обновлять URL при изменениях?
**Нет.** Адрес `https://chat-novy-urengoy.gadzievedgar5.workers.dev` остаётся прежним при каждом деплое — просто закройте и снова откройте Mini App в Telegram. Менять URL в BotFather нужно только если поменяется имя воркера или домен.

## 3. Внешний вид Mini App в BotFather (по желанию)
`/mybots` → бот → **Bot Settings** → **Configure Mini App** → **Settings**:
- Mode: **Fullsize**
- Background Color: `#0B0D12`
- Header Color: `#0B0D12`
- Splash Icon: файл `docs/bot-avatar.png`

Аватар бота: `/setuserpic` → бот → отправить `docs/bot-avatar.png`.
Описание: `/setdescription` → «Городской чат Нового Уренгоя. Общайтесь, отправляйте подарки за Nurcoin.»
Короткое: `/setabouttext` → «NUR_CHAT — городской чат Нового Уренгоя».

## 4. Деплой сайта (Cloudflare)
Один раз: `npx wrangler login` (откроется браузер → **Allow**). Дальше:
```bash
npm run deploy
```
URL не меняется.

## 5. Назначить администратора
Уже сделано для `@flexikkk`. Для других:
```sql
update public.profiles set role = 'admin' where lower(username) = 'имя_без_@';
```
(SQL Editor в Supabase). Роль `moderator` — для модераторов (ограниченные права).

## 6. ЮKassa (позже)
Secrets в Supabase: `YOOKASSA_SHOP_ID`, `YOOKASSA_SECRET_KEY`. В кабинете ЮKassa → Интеграция → HTTP-уведомления:
`https://fyqjxsrbomhrsgketqev.supabase.co/functions/v1/yookassa-webhook` (событие `payment.succeeded`, `payment.canceled`).
До подключения покупка пакетов показывает «Оплата пока не подключена». Пока можно начислять Nurcoin вручную: Модерация → Люди → пользователь → «Корректировка баланса».
