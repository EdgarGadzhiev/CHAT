-- NUR_CHAT core schema. Все операции клиента идут через SECURITY DEFINER RPC,
-- прямых прав на таблицы у клиентов нет (кроме чтения публичных справочников).

alter default privileges in schema public revoke execute on functions from public, anon;
alter default privileges in schema public revoke all on tables from anon;
revoke execute on all functions in schema public from public, anon;

drop function if exists public.claim_telegram_profile(bigint, text, text, text, text);

-- Старые небезопасные политики (клиент мог сам писать в profiles/notifications/consents)
drop policy if exists "Users can delete their own profile" on public.profiles;
drop policy if exists "Users can update their own profile" on public.profiles;
drop policy if exists "Users can insert their own profile" on public.profiles;
drop policy if exists "Users can view their own profile" on public.profiles;
drop policy if exists "Users can delete their own notifications" on public.notifications;
drop policy if exists "Users can insert their own notifications" on public.notifications;
drop policy if exists "Users can update their own notifications" on public.notifications;
drop policy if exists "Users can insert their own privacy consent" on public.privacy_consents;
drop policy if exists "Users can view their own privacy consents" on public.privacy_consents;

-- Профиль пользователя больше не жёстко привязан к auth.users (нужно для удаления аккаунта)
alter table public.profiles drop constraint if exists profiles_id_fkey;
alter table public.privacy_consents drop constraint if exists privacy_consents_user_id_fkey;
alter table public.profiles alter column telegram_id drop not null;
alter table public.profiles alter column first_name drop not null;

alter table public.profiles
  add column if not exists display_name text,
  add column if not exists bio text not null default '',
  add column if not exists show_photo boolean not null default false,
  add column if not exists role text not null default 'user',
  add column if not exists status text not null default 'active',
  add column if not exists ban_reason text,
  add column if not exists banned_until timestamptz,
  add column if not exists muted_until timestamptz,
  add column if not exists mute_reason text,
  add column if not exists report_blocked boolean not null default false,
  add column if not exists reports_rejected int not null default 0,
  add column if not exists deleted_at timestamptz;
update public.profiles set display_name = left(coalesce(first_name, 'Участник'), 32) where display_name is null;
alter table public.profiles alter column display_name set not null;
alter table public.profiles add constraint profiles_role_chk check (role in ('user','moderator','admin'));
alter table public.profiles add constraint profiles_status_chk check (status in ('active','banned','deleted'));
alter table public.profiles add constraint profiles_display_len check (char_length(display_name) between 1 and 32);
alter table public.profiles add constraint profiles_bio_len check (char_length(bio) <= 200);

alter table public.privacy_consents
  add column if not exists terms_version text,
  add column if not exists age_confirmed boolean not null default false;

-- ───────── настройки чата ─────────
create table public.chat_settings (
  key text primary key,
  value text not null,
  updated_at timestamptz not null default now()
);
insert into public.chat_settings(key, value) values
  ('policy_version', '2.0'),
  ('slow_mode_seconds', '3'),
  ('max_message_len', '500'),
  ('links_allowed', 'false'),
  ('media_min_account_minutes', '10'),
  ('chat_enabled', 'true'),
  ('rules_text', E'1. Уважайте участников: без оскорблений, травли и угроз.\n2. Запрещены мат, порнография, наркотики, азартные игры, экстремизм, призывы к насилию и любая незаконная информация.\n3. Не публикуйте чужие персональные данные (телефоны, адреса, документы, фото без согласия) — и свои тоже.\n4. Запрещены ссылки, спам, реклама и мошенничество.\n5. Фото — только те, на которые у вас есть права и которые не нарушают правила.\n6. Нарушение правил ведёт к удалению сообщений, ограничению или блокировке. Жалуйтесь кнопкой «Пожаловаться».');

-- ───────── запрещённые слова ─────────
create or replace function public.norm_text(t text) returns text
language sql immutable set search_path = public as $$
  select regexp_replace(
           regexp_replace(
             regexp_replace(
               translate(
                 lower(regexp_replace(coalesce(t, ''), '[​-‏‪-‮⁠-⁤﻿­]', '', 'g')),
                 'ёacekmhopxytb0346@$', 'еасекмнорхутвозчбас'),
               '[^а-я]+', ' ', 'g'),
             '(.)\1+', '\1', 'g'),
           '\s+', ' ', 'g')
$$;

create table public.banned_words (
  id int generated always as identity primary key,
  pattern text not null,
  category text not null default 'profanity',
  strict boolean not null default false,
  active boolean not null default true,
  pattern_norm text generated always as (public.norm_text(pattern)) stored
);
insert into public.banned_words(pattern, category) values
  ('хуй','profanity'),('хуе','profanity'),('хуя','profanity'),('пизд','profanity'),('пезд','profanity'),
  ('ебан','profanity'),('ебат','profanity'),('ебал','profanity'),('ебну','profanity'),('еблан','profanity'),
  ('заеб','profanity'),('наеб','profanity'),('долбоеб','profanity'),('блят','profanity'),('бляд','profanity'),
  ('мудак','profanity'),('мудил','profanity'),('пидор','profanity'),('пидар','profanity'),('пидр','profanity'),
  ('гандон','profanity'),('залуп','profanity'),('шлюх','profanity'),('сука','profanity'),('суки','profanity'),
  ('сукин','profanity'),('ублюд','profanity'),('дроч','profanity'),
  ('порно','adult'),('проституц','adult'),('интим услуги','adult'),('вебкам','adult'),
  ('закладк','drugs'),('мефедрон','drugs'),('амфетамин','drugs'),('героин','drugs'),('кокаин','drugs'),
  ('гашиш','drugs'),('спайс','drugs'),('марихуан','drugs'),('наркотик','drugs'),
  ('казино','gambling'),('букмекер','gambling'),('ставки на спорт','gambling'),('онлайн казино','gambling'),
  ('обнал','fraud'),('кардинг','fraud'),('быстрый заработок','fraud'),('легкие деньги','fraud');

-- Проверка текста: возвращает код причины или NULL.
create or replace function public.check_text(t text) returns text
language plpgsql stable security definer set search_path = public as $$
declare n text; c text; d text; r text; links_ok boolean;
begin
  if t is null or btrim(t) = '' then return null; end if;
  select coalesce((select value = 'true' from chat_settings where key = 'links_allowed'), false) into links_ok;

  if not links_ok and t ~* '(https?://|www\.|t\.me/|tg://|\m[a-z0-9-]{2,}\.(ru|com|net|org|рф|io|me|xyz|top|su|cc|ly|gl|to|club|online|site|info|biz|ws|tk|shop|store|link|click|live)\M)' then
    return 'links';
  end if;
  if t ~* '[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}' then return 'email'; end if;
  if t ~* '@[a-z0-9_]{4,}' then return 'contacts'; end if;
  d := regexp_replace(t, '(?<=\d)[\s\-\.\(\)]+(?=\d)', '', 'g');
  if d ~ '\d{10,}' then return 'digits'; end if;

  n := public.norm_text(t);
  c := replace(n, ' ', '');
  select w.category into r from banned_words w
   where w.active and w.pattern_norm <> ''
     and ((' ' || n) like '% ' || w.pattern_norm || '%' or (w.strict and c like '%' || w.pattern_norm || '%'))
   limit 1;
  if r is not null then return 'word:' || r; end if;
  return null;
end $$;

-- ───────── rate limit ─────────
create table public.rate_limits (
  user_id uuid not null,
  action text not null,
  window_start timestamptz not null,
  hits int not null default 0,
  primary key (user_id, action, window_start)
);

create or replace function public._rl(p_user uuid, p_action text, p_max int, p_window_sec int) returns void
language plpgsql security definer set search_path = public as $$
declare ws timestamptz; h int;
begin
  ws := to_timestamp(floor(extract(epoch from now()) / p_window_sec) * p_window_sec);
  insert into rate_limits(user_id, action, window_start, hits) values (p_user, p_action, ws, 1)
  on conflict (user_id, action, window_start) do update set hits = rate_limits.hits + 1
  returning hits into h;
  if h > p_max then raise exception 'rate_limited'; end if;
end $$;

-- ───────── журналы ─────────
create table public.mod_log (
  id bigint generated always as identity primary key,
  actor uuid,
  action text not null,
  target_user uuid,
  target_message bigint,
  report_id bigint,
  reason text,
  meta jsonb,
  created_at timestamptz not null default now()
);
create index on public.mod_log(target_user, created_at desc);

create or replace function public._deny_mutation() returns trigger language plpgsql as $$
begin raise exception 'immutable_table'; end $$;
create trigger mod_log_immutable before update or delete on public.mod_log for each row execute function public._deny_mutation();

-- ───────── сообщения ─────────
create table public.messages (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.profiles(id),
  body text not null default '' check (char_length(body) <= 1000),
  reply_to bigint references public.messages(id) on delete set null,
  media_path text,
  status text not null default 'visible' check (status in ('visible','hidden','deleted')),
  status_reason text,
  status_by uuid,
  status_at timestamptz,
  pinned_at timestamptz,
  pinned_by uuid,
  boost_until timestamptz,
  boosted_at timestamptz,
  highlight_until timestamptz,
  created_at timestamptz not null default now(),
  constraint messages_has_content check (status <> 'visible' or body <> '' or media_path is not null)
);
create index on public.messages(created_at desc);
create index on public.messages(user_id, created_at desc);
create index on public.messages(boost_until) where boost_until is not null;
create index on public.messages(pinned_at) where pinned_at is not null;

-- Копия удалённого/скрытого контента для разбора жалоб и обращений госорганов (виден только staff)
create table public.message_archive (
  id bigint generated always as identity primary key,
  message_id bigint not null,
  user_id uuid not null,
  body text,
  media_path text,
  reason text,
  archived_by uuid,
  archived_at timestamptz not null default now()
);

create table public.reactions (
  message_id bigint not null references public.messages(id) on delete cascade,
  user_id uuid not null references public.profiles(id),
  emoji text not null check (emoji in ('👍','❤️','😂','😮','😢','🔥')),
  created_at timestamptz not null default now(),
  primary key (message_id, user_id, emoji)
);

-- ───────── жалобы ─────────
create table public.reports (
  id bigint generated always as identity primary key,
  reporter_id uuid not null references public.profiles(id),
  target_user_id uuid not null references public.profiles(id),
  message_id bigint references public.messages(id) on delete set null,
  category text not null check (category in ('spam','insult','illegal','extremism','adult','minors','personal_data','fraud','other')),
  comment text check (char_length(comment) <= 300),
  snapshot text,
  status text not null default 'new' check (status in ('new','resolved','rejected')),
  decision text,
  resolution_note text,
  resolved_by uuid,
  created_at timestamptz not null default now(),
  resolved_at timestamptz
);
create index on public.reports(status, created_at desc);
create index on public.reports(message_id);
create unique index reports_one_per_reporter_message on public.reports(reporter_id, message_id) where message_id is not null;

-- ───────── Nurcoin ─────────
create table public.wallets (
  user_id uuid primary key references public.profiles(id),
  balance bigint not null default 0 check (balance >= 0),
  updated_at timestamptz not null default now()
);

create table public.ledger (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.profiles(id),
  amount bigint not null check (amount <> 0),
  balance_after bigint not null,
  kind text not null check (kind in ('purchase','spend_promo','spend_gift','admin_adjust','refund')),
  ref_type text,
  ref_id text,
  note text,
  actor uuid,
  created_at timestamptz not null default now()
);
create index on public.ledger(user_id, created_at desc);
create unique index ledger_purchase_once on public.ledger(kind, ref_type, ref_id) where kind in ('purchase','refund');
create trigger ledger_immutable before update or delete on public.ledger for each row execute function public._deny_mutation();

create or replace function public._wallet_apply(
  p_user uuid, p_delta bigint, p_kind text, p_ref_type text, p_ref_id text, p_note text, p_actor uuid
) returns bigint language plpgsql security definer set search_path = public as $$
declare nb bigint;
begin
  insert into wallets(user_id) values (p_user) on conflict do nothing;
  select balance + p_delta into nb from wallets where user_id = p_user for update;
  if nb < 0 then raise exception 'insufficient_funds'; end if;
  update wallets set balance = nb, updated_at = now() where user_id = p_user;
  insert into ledger(user_id, amount, balance_after, kind, ref_type, ref_id, note, actor)
  values (p_user, p_delta, nb, p_kind, p_ref_type, p_ref_id, p_note, p_actor);
  return nb;
end $$;
-- (CHECK balance>=0 тоже сработает, но даст менее понятную ошибку — поэтому выше явная проверка)

-- ───────── каталоги (цены настраивает администрация) ─────────
create table public.gifts (
  id int generated always as identity primary key,
  title text not null,
  emoji text not null,
  price int not null check (price >= 0),
  enabled boolean not null default true,
  sort int not null default 0
);
insert into public.gifts(title, emoji, price, sort) values
  ('Сердце','❤️',25,1),('Роза','🌹',50,2),('Алмаз','💎',100,3),('Подарок','🎁',150,4),('Огонь','🔥',200,5),('Корона','👑',500,6);

create table public.gift_transfers (
  id bigint generated always as identity primary key,
  from_user uuid not null references public.profiles(id),
  to_user uuid not null references public.profiles(id),
  gift_id int not null references public.gifts(id),
  price_paid int not null,
  created_at timestamptz not null default now()
);
create index on public.gift_transfers(to_user, created_at desc);
create index on public.gift_transfers(from_user, created_at desc);

create table public.promo_options (
  id int generated always as identity primary key,
  kind text not null check (kind in ('top','highlight')),
  title text not null,
  price int not null check (price >= 0),
  duration_minutes int not null check (duration_minutes > 0),
  enabled boolean not null default true
);
insert into public.promo_options(kind, title, price, duration_minutes) values
  ('top','В топ на 1 час',50,60),('top','В топ на 6 часов',200,360),('highlight','Выделить на 24 часа',30,1440);

create table public.nc_packs (
  id int generated always as identity primary key,
  nc_amount int not null check (nc_amount > 0),
  price_kop int not null check (price_kop > 0),
  enabled boolean not null default true
);
insert into public.nc_packs(nc_amount, price_kop) values (100, 9900),(500, 39900),(1000, 69900),(2500, 149900);

create table public.payment_orders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id),
  pack_id int not null references public.nc_packs(id),
  nc_amount int not null,
  amount_kop int not null,
  status text not null default 'pending' check (status in ('pending','paid','cancelled','failed')),
  provider text not null default 'yookassa',
  provider_payment_id text unique,
  created_at timestamptz not null default now(),
  paid_at timestamptz
);
create index on public.payment_orders(user_id, created_at desc);

-- ───────── служебные ─────────
create table public.auth_attempts (
  id bigint generated always as identity primary key,
  ip_hash text not null,
  kind text not null,
  created_at timestamptz not null default now()
);
create index on public.auth_attempts(ip_hash, created_at desc);

-- ───────── RLS ─────────
alter table public.profiles enable row level security;
alter table public.notifications enable row level security;
alter table public.privacy_consents enable row level security;
alter table public.chat_settings enable row level security;
alter table public.banned_words enable row level security;
alter table public.rate_limits enable row level security;
alter table public.mod_log enable row level security;
alter table public.messages enable row level security;
alter table public.message_archive enable row level security;
alter table public.reactions enable row level security;
alter table public.reports enable row level security;
alter table public.wallets enable row level security;
alter table public.ledger enable row level security;
alter table public.gifts enable row level security;
alter table public.gift_transfers enable row level security;
alter table public.promo_options enable row level security;
alter table public.nc_packs enable row level security;
alter table public.payment_orders enable row level security;
alter table public.auth_attempts enable row level security;

revoke all on all tables in schema public from anon, authenticated;

create or replace function public.is_staff() returns boolean language sql stable security definer set search_path = public as $$
  select exists(select 1 from profiles where id = auth.uid() and role in ('moderator','admin') and status = 'active')
$$;
create or replace function public.is_admin() returns boolean language sql stable security definer set search_path = public as $$
  select exists(select 1 from profiles where id = auth.uid() and role = 'admin' and status = 'active')
$$;
grant execute on function public.is_staff(), public.is_admin() to authenticated;

-- Чтение справочников и своих данных
grant select on public.notifications, public.wallets, public.ledger to authenticated;
create policy notifications_own_select on public.notifications for select to authenticated using (user_id = (select auth.uid()));
create policy wallets_own_select on public.wallets for select to authenticated using (user_id = (select auth.uid()));
create policy ledger_own_select on public.ledger for select to authenticated using (user_id = (select auth.uid()));

grant select on public.chat_settings, public.gifts, public.promo_options, public.nc_packs to authenticated;
create policy settings_read on public.chat_settings for select to authenticated using (true);
create policy gifts_read on public.gifts for select to authenticated using (enabled or public.is_admin());
create policy promo_read on public.promo_options for select to authenticated using (enabled or public.is_admin());
create policy packs_read on public.nc_packs for select to authenticated using (enabled or public.is_admin());

-- Запись в конфигурацию — только admin
grant insert, update, delete on public.chat_settings, public.gifts, public.promo_options, public.nc_packs, public.banned_words to authenticated;
grant select on public.banned_words to authenticated;
create policy settings_admin_w on public.chat_settings for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy gifts_admin_w on public.gifts for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy promo_admin_w on public.promo_options for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy packs_admin_w on public.nc_packs for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy words_admin_all on public.banned_words for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- Аудит изменений конфигурации
create or replace function public._audit_config() returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into mod_log(actor, action, meta)
  values (auth.uid(), 'config:' || tg_table_name || ':' || lower(tg_op),
          jsonb_build_object('old', case when tg_op <> 'INSERT' then to_jsonb(old) end,
                             'new', case when tg_op <> 'DELETE' then to_jsonb(new) end));
  return coalesce(new, old);
end $$;
create trigger audit_chat_settings after insert or update or delete on public.chat_settings for each row execute function public._audit_config();
create trigger audit_gifts after insert or update or delete on public.gifts for each row execute function public._audit_config();
create trigger audit_promo after insert or update or delete on public.promo_options for each row execute function public._audit_config();
create trigger audit_packs after insert or update or delete on public.nc_packs for each row execute function public._audit_config();
create trigger audit_words after insert or update or delete on public.banned_words for each row execute function public._audit_config();
