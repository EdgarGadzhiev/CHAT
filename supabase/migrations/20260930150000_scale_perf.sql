-- Масштабирование и производительность.
--  * новые сообщения рассылаются в realtime ПОЛНОСТЬЮ (клиенты не перезапрашивают ленту — нет «эффекта стада»);
--  * счётчики реакций хранятся в самом сообщении (лента строится без подзапросов по reactions);
--  * один запрос ленты get_feed (сообщения + топ), счётчики уведомлений внутри get_me;
--  * rate_limits — UNLOGGED (нет записи в WAL), частая очистка; индексы под реальные запросы;
--  * очередь удаления файлов, настраиваемые сроки хранения, мониторинг admin_health().

-- ───────── колонки ─────────
alter table public.messages
  add column if not exists reactions jsonb not null default '{}'::jsonb,
  add column if not exists has_thumb boolean not null default false;

update public.messages m set reactions = x.r
  from (select message_id, jsonb_object_agg(emoji, n) as r
          from (select message_id, emoji, count(*) as n from public.reactions group by 1, 2) q group by message_id) x
 where x.message_id = m.id;

alter table public.profiles add column if not exists auth_linked boolean not null default false;

insert into public.chat_settings(key, value) values
  ('chat_retention_days', '0'),   -- 0 = хранить сообщения общего чата бессрочно
  ('dm_retention_days', '0')
on conflict (key) do nothing;

-- ───────── индексы ─────────
create extension if not exists pg_trgm with schema extensions;
create index if not exists profiles_display_trgm on public.profiles using gin (display_name extensions.gin_trgm_ops);
create index if not exists profiles_active_created on public.profiles (created_at desc) where status = 'active';
create index if not exists reactions_user_idx on public.reactions (user_id);
create index if not exists reports_target_idx on public.reports (target_user_id);
create index if not exists reports_dm_idx on public.reports (dm_message_id) where dm_message_id is not null;
create index if not exists messages_reply_idx on public.messages (reply_to) where reply_to is not null;
create index if not exists gift_transfers_gift_idx on public.gift_transfers (gift_id);
create index if not exists notifications_unread_idx on public.notifications (user_id) where not read;
create index if not exists notifications_user_created_idx on public.notifications (user_id, created_at desc);
create index if not exists messages_top_idx on public.messages (boosted_at desc nulls last) where pinned_at is not null or boost_until is not null;
drop index if exists public.messages_created_at_idx;
drop index if exists public.messages_boost_until_idx;
drop index if exists public.messages_pinned_at_idx;
create index if not exists auth_attempts_kind_created_idx on public.auth_attempts (kind, created_at desc);

-- частые обновления: агрессивный autovacuum, лимиты не пишем в WAL
alter table public.rate_limits set unlogged;
alter table public.rate_limits set (autovacuum_vacuum_scale_factor = 0.02, autovacuum_vacuum_threshold = 200);
alter table public.messages set (autovacuum_vacuum_scale_factor = 0.05, autovacuum_analyze_scale_factor = 0.05);
alter table public.dm_conversations set (autovacuum_vacuum_scale_factor = 0.05);

-- ───────── настройки одним запросом ─────────
create or replace function public._settings() returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_object_agg(key, value), '{}'::jsonb) from chat_settings where key <> 'rules_text'
$$;

-- ───────── JSON ленты (порядок = порядок массива ids) ─────────
create or replace function public._feed_json(p_ids bigint[], p_uid uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(x.j order by x.ord), '[]'::jsonb)
  from (
    select k.ord,
      jsonb_build_object(
        'id', m.id, 'user_id', m.user_id, 'status', m.status, 'created_at', m.created_at,
        'body', case when m.status = 'visible' then m.body else '' end,
        'media_path', case when m.status = 'visible' then m.media_path end,
        'thumb', m.has_thumb,
        'reply_to', m.reply_to,
        'pinned', m.pinned_at is not null,
        'boosted', coalesce(m.boost_until > now(), false),
        'highlighted', coalesce(m.highlight_until > now(), false),
        'author', pr.display_name,
        'author_photo', case when pr.show_photo then pr.photo_url end,
        'author_role', pr.role,
        'reply', case when rm.id is null then null else jsonb_build_object(
                   'id', rm.id, 'author', rp.display_name,
                   'body', left(case when rm.status = 'visible' then rm.body else '' end, 80)) end,
        'reactions', (select coalesce(jsonb_object_agg(e.key, jsonb_build_object('n', e.value::int, 'me', jsonb_exists(mr.my, e.key))), '{}'::jsonb)
                        from jsonb_each_text(m.reactions) e)
      ) as j
    from unnest(coalesce(p_ids, '{}'::bigint[])) with ordinality as k(id, ord)
    join messages m on m.id = k.id
    join profiles pr on pr.id = m.user_id
    left join messages rm on rm.id = m.reply_to
    left join profiles rp on rp.id = rm.user_id
    left join lateral (select coalesce(jsonb_agg(r.emoji), '[]'::jsonb) as my
                         from reactions r where r.message_id = m.id and r.user_id = p_uid) mr on true
  ) x
$$;

create or replace function public.get_feed(p_before bigint default null, p_limit int default 60) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare ids bigint[]; tids bigint[]; uid uuid := auth.uid();
begin
  perform _me();
  select coalesce(array_agg(id order by id), '{}') into ids
    from (select id from messages where (p_before is null or id < p_before) order by id desc
           limit least(coalesce(p_limit, 60), 100)) x;
  if p_before is null then
    select coalesce(array_agg(id order by is_pin desc, boosted_at desc nulls last), '{}') into tids
      from (select id, (pinned_at is not null) as is_pin, boosted_at from messages
             where status = 'visible' and (pinned_at is not null or boost_until > now())
             order by (pinned_at is not null) desc, boosted_at desc nulls last limit 6) t;
  end if;
  return jsonb_build_object('messages', _feed_json(ids, uid), 'top', _feed_json(coalesce(tids, '{}'), uid));
end $$;

-- старые функции остаются для уже открытых клиентов
create or replace function public.get_messages(p_before bigint default null, p_limit int default 40) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare ids bigint[];
begin
  perform _me();
  select coalesce(array_agg(id order by id), '{}') into ids
    from (select id from messages where (p_before is null or id < p_before) order by id desc
           limit least(coalesce(p_limit, 40), 100)) x;
  return _feed_json(ids, auth.uid());
end $$;

create or replace function public.get_top_messages() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare tids bigint[];
begin
  perform _me();
  select coalesce(array_agg(id order by is_pin desc, boosted_at desc nulls last), '{}') into tids
    from (select id, (pinned_at is not null) as is_pin, boosted_at from messages
           where status = 'visible' and (pinned_at is not null or boost_until > now())
           order by (pinned_at is not null) desc, boosted_at desc nulls last limit 6) t;
  return _feed_json(tids, auth.uid());
end $$;

-- ───────── убираем публичные «пинги» (все клиенты перезапрашивали ленту) ─────────
do $$
declare f record; src text;
begin
  for f in select p.oid from pg_proc p where p.pronamespace = 'public'::regnamespace and pg_get_functiondef(p.oid) like '%''chat-city''%' loop
    src := replace(pg_get_functiondef(f.oid), 'perform realtime.send(''{}''::jsonb, ''ping'', ''chat-city'', false);', 'null;');
    execute src;
  end loop;
end $$;

-- ───────── отправка сообщения (быстрее: одни настройки, проверка пути, миниатюра) ─────────
create or replace function public.send_message(p_body text, p_reply_to bigint default null, p_media_path text default null) returns bigint
language plpgsql security definer set search_path = public as $$
declare p profiles; s jsonb := _settings(); b text := btrim(coalesce(p_body, '')); r text; mx int; last_at timestamptz; slow int; new_id bigint; has_t boolean := false;
begin
  p := _me();
  if coalesce(s->>'chat_enabled', 'true') <> 'true' then raise exception 'chat_disabled'; end if;
  if p.muted_until is not null and p.muted_until > now() then raise exception 'muted'; end if;
  b := regexp_replace(b, E'\n{3,}', E'\n\n', 'g');
  mx := least(coalesce((s->>'max_message_len')::int, 500), 1000);
  if char_length(b) > mx then raise exception 'too_long'; end if;
  if array_length(regexp_split_to_array(b, E'\n'), 1) > 8 then raise exception 'too_many_lines'; end if;
  if b = '' and p_media_path is null then raise exception 'empty'; end if;
  r := check_text(b);
  if r is not null then raise exception 'blocked:%', r; end if;

  perform _rl(p.id, 'msg_burst', 5, 10);
  perform _rl(p.id, 'msg_min', 15, 60);
  perform _rl(p.id, 'msg_hour', 200, 3600);
  if p.created_at > now() - interval '5 minutes' then perform _rl(p.id, 'msg_new', 3, 60); end if;

  slow := coalesce((s->>'slow_mode_seconds')::int, 0);
  select max(created_at) into last_at from messages where user_id = p.id;
  if slow > 0 and last_at is not null and last_at > now() - make_interval(secs => slow) then raise exception 'slow_mode'; end if;
  if b <> '' and exists (select 1 from messages where user_id = p.id and body = b and created_at > now() - interval '60 seconds') then
    raise exception 'duplicate';
  end if;

  if p_reply_to is not null and not exists (select 1 from messages where id = p_reply_to and status = 'visible') then
    raise exception 'bad_reply';
  end if;

  if p_media_path is not null then
    if p_media_path !~ ('^' || p.id::text || '/[0-9a-f-]{36}\.jpg$') then raise exception 'bad_media'; end if;
    if not exists (select 1 from storage.objects where bucket_id = 'chat-media' and name = p_media_path) then raise exception 'bad_media'; end if;
    has_t := exists (select 1 from storage.objects where bucket_id = 'chat-media' and name = regexp_replace(p_media_path, '\.jpg$', '_t.jpg'));
    if p.created_at > now() - make_interval(mins => coalesce((s->>'media_min_account_minutes')::int, 10)) then
      raise exception 'media_too_early';
    end if;
    perform _rl(p.id, 'media_hour', 20, 3600);
  end if;

  insert into messages(user_id, body, reply_to, media_path, has_thumb) values (p.id, b, p_reply_to, p_media_path, has_t) returning id into new_id;
  return new_id;
end $$;

-- ───────── реакции: счётчики хранятся в сообщении ─────────
drop function if exists public.toggle_reaction(bigint, text);
create function public.toggle_reaction(p_message bigint, p_emoji text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare p profiles; n int;
begin
  p := _me();
  if p_emoji not in ('👍','❤️','😂','😮','😢','🔥') then raise exception 'bad_emoji'; end if;
  perform _rl(p.id, 'react', 40, 60);
  perform 1 from messages where id = p_message and status = 'visible' for no key update;
  if not found then raise exception 'not_found'; end if;
  delete from reactions where message_id = p_message and user_id = p.id and emoji = p_emoji;
  get diagnostics n = row_count;
  if n > 0 then
    update messages set reactions = case when coalesce((reactions->>p_emoji)::int, 0) <= 1 then reactions - p_emoji
             else jsonb_set(reactions, array[p_emoji], to_jsonb((reactions->>p_emoji)::int - 1)) end
     where id = p_message;
  else
    insert into reactions(message_id, user_id, emoji) values (p_message, p.id, p_emoji);
    update messages set reactions = jsonb_set(reactions, array[p_emoji], to_jsonb(coalesce((reactions->>p_emoji)::int, 0) + 1), true)
     where id = p_message;
  end if;
  return (_feed_json(array[p_message], p.id)->0)->'reactions';
end $$;

-- ───────── рассылка изменений ленты в realtime (приватный канал city, только участникам) ─────────
create or replace function public._city_msg_trigger() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform realtime.send(public._feed_json(array[new.id], null)->0, 'msg', 'city', true);
  return null;
end $$;

create or replace function public._city_clear_trigger() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform realtime.send('{}'::jsonb, 'clear', 'city', true);
  return null;
end $$;

drop trigger if exists messages_push on public.messages;
create trigger messages_push after insert or update of status, body, media_path, pinned_at, boost_until, highlight_until
  on public.messages for each row execute function public._city_msg_trigger();
drop trigger if exists messages_cleared on public.messages;
create trigger messages_cleared after delete on public.messages for each statement execute function public._city_clear_trigger();

do $$
begin
  execute 'create policy city_receive on realtime.messages for select to authenticated using (realtime.topic() = ''city'' and (select public.can_use_chat()))';
exception when others then
  raise notice 'realtime policy not created: %', sqlerrm;
end $$;

-- ───────── ЛС: меньше записей, счётчик непрочитанных отдельной функцией ─────────
create or replace function public._dm_unread(p_uid uuid) returns int
language sql stable security definer set search_path = public as $$
  select coalesce(sum(s.cnt), 0)::int from (
    select (select count(*) from dm_messages m
             where m.conversation_id = c.id and m.sender_id <> p_uid and m.status = 'visible'
               and m.id > greatest(case when p_uid = c.user_a then c.a_read_id else c.b_read_id end,
                                   case when p_uid = c.user_a then c.a_hidden_before else c.b_hidden_before end)) as cnt
      from dm_conversations c
      join profiles o on o.id = case when c.user_a = p_uid then c.user_b else c.user_a end
     where (c.user_a = p_uid or c.user_b = p_uid) and o.status = 'active'
  ) s
$$;

create or replace function public.dm_unread_count() returns int
language plpgsql stable security definer set search_path = public as $$
declare p profiles;
begin
  p := _me();
  return _dm_unread(p.id);
end $$;

create or replace function public.dm_get(p_with uuid, p_before bigint default null, p_limit int default 50) returns jsonb
language plpgsql security definer set search_path = public as $$
declare p profiles; o profiles; c dm_conversations; hid bigint := 0; oread bigint := 0; myread bigint := 0; msgs jsonb := '[]'; found_c boolean;
begin
  p := _me();
  select * into o from profiles where id = p_with and status <> 'deleted';
  if not found then raise exception 'not_found'; end if;
  select * into c from dm_conversations where user_a = least(p.id, p_with) and user_b = greatest(p.id, p_with);
  found_c := found;
  if found_c then
    hid := case when p.id = c.user_a then c.a_hidden_before else c.b_hidden_before end;
    oread := case when p.id = c.user_a then c.b_read_id else c.a_read_id end;
    myread := case when p.id = c.user_a then c.a_read_id else c.b_read_id end;
    select coalesce(jsonb_agg(jsonb_build_object(
             'id', m.id, 'mine', m.sender_id = p.id, 'status', m.status, 'created_at', m.created_at,
             'body', case when m.status = 'visible' then m.body else '' end) order by m.id), '[]')
      into msgs
      from (select * from dm_messages
             where conversation_id = c.id and id > hid and (p_before is null or id < p_before)
             order by id desc limit least(coalesce(p_limit, 50), 100)) m;
    -- пометка «прочитано» пишется только если действительно есть что отметить
    if p_before is null and c.last_message_id is not null and myread < c.last_message_id then
      update dm_conversations
         set a_read_id = case when p.id = user_a then greatest(a_read_id, last_message_id) else a_read_id end,
             b_read_id = case when p.id = user_b then greatest(b_read_id, last_message_id) else b_read_id end
       where id = c.id;
    end if;
  end if;
  return jsonb_build_object(
    'other', jsonb_build_object('id', o.id, 'display_name', o.display_name, 'role', o.role,
                                'photo_url', case when o.show_photo then o.photo_url end),
    'blocked_by_me', exists (select 1 from user_blocks where blocker = p.id and blocked = o.id),
    'can_send', o.status = 'active' and o.dm_enabled and _setting('dm_feature', 'true') = 'true'
                and not exists (select 1 from user_blocks where blocker = o.id and blocked = p.id),
    'other_read_id', oread,
    'messages', msgs);
end $$;

-- get_me теперь сразу отдаёт счётчики (меньше запросов от клиента)
create or replace function public.get_me() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare p profiles; v text; ok boolean; bal bigint;
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  select * into p from profiles where id = auth.uid();
  if not found or p.status = 'deleted' then return null; end if;
  v := _setting('policy_version');
  ok := exists (select 1 from privacy_consents where user_id = p.id and policy_version = v and age_confirmed);
  select coalesce((select balance from wallets where user_id = p.id), 0) into bal;
  return jsonb_build_object(
    'id', p.id, 'display_name', p.display_name, 'bio', p.bio, 'show_photo', p.show_photo,
    'photo_url', p.photo_url, 'role', p.role,
    'status', case when p.status = 'banned' and p.banned_until is not null and p.banned_until <= now() then 'active' else p.status end,
    'ban_reason', p.ban_reason, 'banned_until', p.banned_until,
    'muted_until', case when p.muted_until > now() then p.muted_until end,
    'balance', bal, 'consent_ok', ok, 'policy_version', v,
    'created_at', p.created_at,
    'dm_enabled', p.dm_enabled, 'dm_feature', _setting('dm_feature', 'true') = 'true',
    'notif_unread', (select count(*) from notifications where user_id = p.id and not read),
    'dm_unread', case when ok then _dm_unread(p.id) else 0 end);
end $$;

-- ───────── очередь удаления файлов и сроки хранения ─────────
create table if not exists public.media_trash (
  path text primary key,
  queued_at timestamptz not null default now()
);
alter table public.media_trash enable row level security;

create or replace function public.purge_old_data() returns void language plpgsql security definer set search_path = public as $$
declare d int;
begin
  delete from rate_limits where window_start < now() - interval '25 hours';
  delete from auth_attempts where created_at < now() - interval '7 days';
  delete from notifications where read and created_at < now() - interval '90 days';
  update payment_orders set status = 'cancelled' where status = 'pending' and created_at < now() - interval '2 days';
  delete from message_archive a where a.archived_at < now() - interval '365 days'
     and not exists (select 1 from reports r where r.message_id = a.message_id and r.status = 'new');

  d := coalesce((select value::int from chat_settings where key = 'chat_retention_days'), 0);
  if d > 0 then
    insert into media_trash(path)
      select m.media_path from messages m
       where m.created_at < now() - make_interval(days => d) and m.media_path is not null and m.pinned_at is null
         and not exists (select 1 from reports r where r.message_id = m.id and r.status = 'new')
      on conflict do nothing;
    delete from messages m
     where m.created_at < now() - make_interval(days => d) and m.pinned_at is null
       and not exists (select 1 from reports r where r.message_id = m.id and r.status = 'new');
  end if;
  d := coalesce((select value::int from chat_settings where key = 'dm_retention_days'), 0);
  if d > 0 then
    delete from dm_messages x
     where x.created_at < now() - make_interval(days => d)
       and not exists (select 1 from reports r where r.dm_message_id = x.id and r.status = 'new');
  end if;
end $$;

create or replace function public.admin_media_trash(p_limit int default 200) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  perform _staff();
  return jsonb_build_object(
    'total', (select count(*) from media_trash),
    'paths', (select coalesce(jsonb_agg(path), '[]'::jsonb) from (select path from media_trash order by queued_at limit least(coalesce(p_limit, 200), 500)) x));
end $$;

create or replace function public.admin_media_trash_done(p_paths text[]) returns void
language plpgsql security definer set search_path = public as $$
begin
  perform _staff();
  delete from media_trash where path = any(coalesce(p_paths, '{}'::text[]));
end $$;

-- ───────── мониторинг ─────────
create or replace function public.admin_health() returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  perform _admin();
  return jsonb_build_object(
    'db_size_mb', (select round(pg_database_size(current_database()) / 1048576.0, 1)),
    'messages_est', (select reltuples::bigint from pg_class where oid = 'public.messages'::regclass),
    'messages_1h', (select count(*) from messages where created_at > now() - interval '1 hour'),
    'dm_1h', (select count(*) from dm_messages where created_at > now() - interval '1 hour'),
    'writers_1h', (select count(distinct user_id) from messages where created_at > now() - interval '1 hour'),
    'users_total', (select count(*) from profiles where status = 'active'),
    'storage_mb', (select round(coalesce(sum((metadata->>'size')::bigint), 0) / 1048576.0, 1) from storage.objects where bucket_id = 'chat-media'),
    'storage_files', (select count(*) from storage.objects where bucket_id = 'chat-media'),
    'connections', (select count(*) from pg_stat_activity where datname = current_database()),
    'max_connections', current_setting('max_connections')::int,
    'trash', (select count(*) from media_trash),
    'rate_limit_rows', (select count(*) from rate_limits));
end $$;

-- ───────── чистим политики (лишние дубли SELECT) ─────────
drop policy if exists "Users can view their own notifications" on public.notifications;

drop policy if exists settings_admin_w on public.chat_settings;
create policy settings_admin_ins on public.chat_settings for insert to authenticated with check ((select public.is_admin()));
create policy settings_admin_upd on public.chat_settings for update to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));
create policy settings_admin_del on public.chat_settings for delete to authenticated using ((select public.is_admin()));

drop policy if exists gifts_admin_w on public.gifts;
create policy gifts_admin_ins on public.gifts for insert to authenticated with check ((select public.is_admin()));
create policy gifts_admin_upd on public.gifts for update to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));
create policy gifts_admin_del on public.gifts for delete to authenticated using ((select public.is_admin()));

drop policy if exists promo_admin_w on public.promo_options;
create policy promo_admin_ins on public.promo_options for insert to authenticated with check ((select public.is_admin()));
create policy promo_admin_upd on public.promo_options for update to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));
create policy promo_admin_del on public.promo_options for delete to authenticated using ((select public.is_admin()));

drop policy if exists packs_admin_w on public.nc_packs;
create policy packs_admin_ins on public.nc_packs for insert to authenticated with check ((select public.is_admin()));
create policy packs_admin_upd on public.nc_packs for update to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));
create policy packs_admin_del on public.nc_packs for delete to authenticated using ((select public.is_admin()));

-- ───────── права на функции (см. lock_function_grants_2) ─────────
revoke execute on all functions in schema public from public, anon;
grant execute on function
  public.is_staff(), public.is_admin(), public.can_use_chat(),
  public.get_me(), public.accept_consents(boolean), public.update_profile(text, text, boolean),
  public.get_profile(uuid), public.list_members(text, int),
  public.get_feed(bigint, int), public.get_messages(bigint, int), public.get_top_messages(),
  public.send_message(text, bigint, text), public.toggle_reaction(bigint, text),
  public.report_message(bigint, text, text), public.report_user(uuid, text, text),
  public.boost_message(bigint, int), public.send_gift(uuid, int), public.my_gifts_history(),
  public.mark_notifications_read(), public.create_order(int),
  public.export_my_data(), public.delete_my_account(),
  public.admin_stats(), public.admin_search_users(text, int), public.admin_get_user(uuid),
  public.admin_user_action(uuid, text, int, text), public.admin_delete_message(bigint, text),
  public.admin_delete_media(bigint, text), public.admin_pin_message(bigint, boolean),
  public.admin_list_messages(bigint, int, uuid), public.admin_list_reports(text, int),
  public.admin_resolve_report(bigint, text, text, int), public.admin_adjust_balance(uuid, bigint, text),
  public.admin_get_log(int), public.admin_clear_chat(text), public.admin_health(),
  public.admin_media_trash(int), public.admin_media_trash_done(text[]),
  public.dm_send(uuid, text), public.dm_list(), public.dm_unread_count(), public.dm_get(uuid, bigint, int),
  public.dm_delete_conversation(uuid), public.dm_delete_message(bigint),
  public.block_user(uuid, boolean), public.list_blocked(), public.set_dm_enabled(boolean),
  public.report_dm_message(bigint, text, text)
to authenticated;
grant execute on function public.credit_paid_order(uuid, text), public.purge_old_data() to service_role;
