-- Личные сообщения (1-на-1). Принципы:
--  * доступ к переписке есть только у двух участников (клиенты не имеют прямого доступа к таблицам);
--  * модераторы видят личные сообщения ТОЛЬКО в жалобе (само сообщение + несколько предыдущих для контекста);
--  * тот же серверный фильтр текста, что и в общем чате (ссылки, телефоны, мат, ...);
--  * защита от спама: лимиты, запрет одинакового текста разным людям, ограничение для новых аккаунтов;
--  * блокировка пользователя, отключение личных сообщений в настройках, общий выключатель для админа (dm_feature).

alter table public.profiles add column if not exists dm_enabled boolean not null default true;

insert into public.chat_settings(key, value) values
  ('dm_feature', 'true'),
  ('dm_min_account_minutes', '5')
on conflict (key) do nothing;

create table public.user_blocks (
  blocker uuid not null references public.profiles(id),
  blocked uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  primary key (blocker, blocked),
  check (blocker <> blocked)
);
create index on public.user_blocks(blocked);

create table public.dm_conversations (
  id bigint generated always as identity primary key,
  user_a uuid not null references public.profiles(id),
  user_b uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  last_message_id bigint,
  last_message_at timestamptz,
  a_read_id bigint not null default 0,
  b_read_id bigint not null default 0,
  a_hidden_before bigint not null default 0,
  b_hidden_before bigint not null default 0,
  check (user_a < user_b),
  unique (user_a, user_b)
);
create index on public.dm_conversations(user_a, last_message_at desc);
create index on public.dm_conversations(user_b, last_message_at desc);

create table public.dm_messages (
  id bigint generated always as identity primary key,
  conversation_id bigint not null references public.dm_conversations(id) on delete cascade,
  sender_id uuid not null references public.profiles(id),
  body text not null default '' check (char_length(body) <= 1000),
  status text not null default 'visible' check (status in ('visible','deleted')),
  status_reason text,
  status_by uuid,
  status_at timestamptz,
  created_at timestamptz not null default now(),
  constraint dm_has_body check (status <> 'visible' or body <> '')
);
create index on public.dm_messages(conversation_id, id desc);
create index on public.dm_messages(sender_id, created_at desc);

alter table public.user_blocks enable row level security;
alter table public.dm_conversations enable row level security;
alter table public.dm_messages enable row level security;

-- Жалобы на личные сообщения
alter table public.reports
  add column if not exists dm_message_id bigint references public.dm_messages(id) on delete set null,
  add column if not exists context text;
create unique index if not exists reports_one_per_reporter_dm on public.reports(reporter_id, dm_message_id) where dm_message_id is not null;

-- Realtime: "пинг" о новом сообщении получает только сам адресат (приватный канал dm:<uuid>, без содержимого)
do $$
begin
  execute 'create policy dm_ping_receive on realtime.messages for select to authenticated using (realtime.topic() = ''dm:'' || (select auth.uid())::text)';
exception when others then
  raise notice 'realtime policy not created: %', sqlerrm;
end $$;

-- ───────── отправка ─────────
create or replace function public.dm_send(p_to uuid, p_body text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare p profiles; t profiles; c dm_conversations; b text := btrim(coalesce(p_body, '')); r text; mx int; mid bigint; ua uuid; ub uuid; same_cnt int;
begin
  p := _me();
  if _setting('dm_feature', 'true') <> 'true' then raise exception 'dm_disabled'; end if;
  if p.muted_until is not null and p.muted_until > now() then raise exception 'muted'; end if;
  if p_to = p.id then raise exception 'self_dm'; end if;
  select * into t from profiles where id = p_to and status = 'active';
  if not found then raise exception 'dm_unavailable'; end if;
  if exists (select 1 from user_blocks where blocker = p.id and blocked = p_to) then raise exception 'you_blocked'; end if;
  if not t.dm_enabled or exists (select 1 from user_blocks where blocker = p_to and blocked = p.id) then raise exception 'dm_unavailable'; end if;

  if b = '' then raise exception 'empty'; end if;
  mx := least(coalesce(_setting('max_message_len', '500')::int, 500), 1000);
  if char_length(b) > mx then raise exception 'too_long'; end if;
  r := check_text(b);
  if r is not null then raise exception 'blocked:%', r; end if;

  perform _rl(p.id, 'dm_burst', 5, 10);
  perform _rl(p.id, 'dm_min', 20, 60);
  perform _rl(p.id, 'dm_hour', 300, 3600);

  ua := least(p.id, p_to); ub := greatest(p.id, p_to);
  select * into c from dm_conversations where user_a = ua and user_b = ub for update;
  if not found then
    if p.created_at > now() - make_interval(mins => coalesce(_setting('dm_min_account_minutes', '5')::int, 5)) then
      raise exception 'dm_too_early';
    end if;
    perform _rl(p.id, 'dm_new_hour', 5, 3600);
    perform _rl(p.id, 'dm_new_day', 20, 86400);
    insert into dm_conversations(user_a, user_b) values (ua, ub) returning * into c;
  end if;

  -- один и тот же текст разным людям за 10 минут — признак спама
  select count(distinct m.conversation_id) into same_cnt from dm_messages m
   where m.sender_id = p.id and m.body = b and m.created_at > now() - interval '10 minutes' and m.conversation_id <> c.id;
  if same_cnt >= 2 then raise exception 'spam_detected'; end if;
  if exists (select 1 from dm_messages where conversation_id = c.id and sender_id = p.id and body = b and created_at > now() - interval '30 seconds') then
    raise exception 'duplicate';
  end if;

  insert into dm_messages(conversation_id, sender_id, body) values (c.id, p.id, b) returning id into mid;
  update dm_conversations set last_message_id = mid, last_message_at = now(),
         a_read_id = case when p.id = user_a then mid else a_read_id end,
         b_read_id = case when p.id = user_b then mid else b_read_id end
   where id = c.id;
  perform realtime.send('{}'::jsonb, 'ping', 'dm:' || p_to::text, true);
  return jsonb_build_object('conversation_id', c.id, 'message_id', mid);
end $$;

-- ───────── список диалогов ─────────
create or replace function public.dm_list() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare p profiles;
begin
  p := _me();
  return (select coalesce(jsonb_agg(z.item order by z.last_at desc), '[]')
    from (
      select c.last_message_at as last_at,
        jsonb_build_object(
          'conversation_id', c.id, 'user_id', o.id, 'display_name', o.display_name,
          'photo_url', case when o.show_photo then o.photo_url end, 'role', o.role,
          'last_body', case when lm.status = 'visible' then left(lm.body, 80) else '' end,
          'last_deleted', lm.status <> 'visible',
          'last_mine', lm.sender_id = p.id,
          'last_at', c.last_message_at,
          'unread', (select count(*) from dm_messages m
                      where m.conversation_id = c.id and m.sender_id <> p.id and m.status = 'visible'
                        and m.id > greatest(case when p.id = c.user_a then c.a_read_id else c.b_read_id end,
                                            case when p.id = c.user_a then c.a_hidden_before else c.b_hidden_before end))
        ) as item
      from dm_conversations c
      join profiles o on o.id = case when c.user_a = p.id then c.user_b else c.user_a end
      join dm_messages lm on lm.id = c.last_message_id
      where (c.user_a = p.id or c.user_b = p.id)
        and o.status = 'active'
        and c.last_message_id > case when p.id = c.user_a then c.a_hidden_before else c.b_hidden_before end
      order by c.last_message_at desc
      limit 100
    ) z);
end $$;

create or replace function public.dm_unread_count() returns int
language plpgsql stable security definer set search_path = public as $$
declare p profiles; n bigint;
begin
  p := _me();
  select coalesce(sum(s.cnt), 0) into n from (
    select (select count(*) from dm_messages m
             where m.conversation_id = c.id and m.sender_id <> p.id and m.status = 'visible'
               and m.id > greatest(case when p.id = c.user_a then c.a_read_id else c.b_read_id end,
                                   case when p.id = c.user_a then c.a_hidden_before else c.b_hidden_before end)) as cnt
      from dm_conversations c
      join profiles o on o.id = case when c.user_a = p.id then c.user_b else c.user_a end
     where (c.user_a = p.id or c.user_b = p.id) and o.status = 'active'
  ) s;
  return n::int;
end $$;

-- ───────── чтение переписки (и пометка «прочитано») ─────────
create or replace function public.dm_get(p_with uuid, p_before bigint default null, p_limit int default 50) returns jsonb
language plpgsql security definer set search_path = public as $$
declare p profiles; o profiles; c dm_conversations; hid bigint := 0; oread bigint := 0; msgs jsonb := '[]'; found_c boolean;
begin
  p := _me();
  select * into o from profiles where id = p_with and status <> 'deleted';
  if not found then raise exception 'not_found'; end if;
  select * into c from dm_conversations where user_a = least(p.id, p_with) and user_b = greatest(p.id, p_with);
  found_c := found;
  if found_c then
    hid := case when p.id = c.user_a then c.a_hidden_before else c.b_hidden_before end;
    oread := case when p.id = c.user_a then c.b_read_id else c.a_read_id end;
    select coalesce(jsonb_agg(jsonb_build_object(
             'id', m.id, 'mine', m.sender_id = p.id, 'status', m.status, 'created_at', m.created_at,
             'body', case when m.status = 'visible' then m.body else '' end) order by m.id), '[]')
      into msgs
      from (select * from dm_messages
             where conversation_id = c.id and id > hid and (p_before is null or id < p_before)
             order by id desc limit least(coalesce(p_limit, 50), 100)) m;
    if p_before is null and c.last_message_id is not null then
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

create or replace function public.dm_delete_conversation(p_with uuid) returns void
language plpgsql security definer set search_path = public as $$
declare p profiles;
begin
  p := _me();
  update dm_conversations
     set a_hidden_before = case when user_a = p.id then coalesce(last_message_id, 0) else a_hidden_before end,
         b_hidden_before = case when user_b = p.id then coalesce(last_message_id, 0) else b_hidden_before end
   where user_a = least(p.id, p_with) and user_b = greatest(p.id, p_with);
end $$;

create or replace function public.dm_delete_message(p_id bigint) returns void
language plpgsql security definer set search_path = public as $$
declare p profiles; m dm_messages; c dm_conversations; other uuid;
begin
  p := _me();
  perform _rl(p.id, 'dm_del', 30, 60);
  select * into m from dm_messages where id = p_id and sender_id = p.id and status = 'visible';
  if not found then raise exception 'not_found'; end if;
  update dm_messages set body = '', status = 'deleted', status_reason = 'deleted_by_sender', status_at = now() where id = m.id;
  select * into c from dm_conversations where id = m.conversation_id;
  other := case when c.user_a = p.id then c.user_b else c.user_a end;
  perform realtime.send('{}'::jsonb, 'ping', 'dm:' || other::text, true);
end $$;

-- ───────── блокировки и приватность ─────────
create or replace function public.block_user(p_user uuid, p_block boolean) returns void
language plpgsql security definer set search_path = public as $$
declare p profiles;
begin
  p := _me();
  perform _rl(p.id, 'block', 30, 60);
  if p_user = p.id then raise exception 'self_dm'; end if;
  if not exists (select 1 from profiles where id = p_user and status <> 'deleted') then raise exception 'not_found'; end if;
  if p_block then
    insert into user_blocks(blocker, blocked) values (p.id, p_user) on conflict do nothing;
  else
    delete from user_blocks where blocker = p.id and blocked = p_user;
  end if;
end $$;

create or replace function public.list_blocked() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare p profiles;
begin
  p := _me();
  return (select coalesce(jsonb_agg(jsonb_build_object('id', o.id, 'display_name', o.display_name,
            'photo_url', case when o.show_photo then o.photo_url end) order by b.created_at desc), '[]')
            from user_blocks b join profiles o on o.id = b.blocked
           where b.blocker = p.id and o.status <> 'deleted');
end $$;

create or replace function public.set_dm_enabled(p_enabled boolean) returns void
language plpgsql security definer set search_path = public as $$
declare p profiles;
begin
  p := _me();
  perform _rl(p.id, 'profile_edit', 20, 3600);
  update profiles set dm_enabled = coalesce(p_enabled, true) where id = p.id;
end $$;

-- ───────── жалоба на личное сообщение (модератор увидит только это сообщение + контекст) ─────────
create or replace function public.report_dm_message(p_message bigint, p_category text, p_comment text default null) returns void
language plpgsql security definer set search_path = public as $$
declare p profiles; m dm_messages; ctx text;
begin
  p := _me();
  if p.report_blocked then raise exception 'report_blocked'; end if;
  perform _rl(p.id, 'report_day', 10, 86400);
  perform _rl(p.id, 'report_min', 3, 60);
  select m2.* into m from dm_messages m2 join dm_conversations c on c.id = m2.conversation_id
   where m2.id = p_message and (c.user_a = p.id or c.user_b = p.id);
  if not found or m.status <> 'visible' then raise exception 'not_found'; end if;
  if m.sender_id = p.id then raise exception 'self_report'; end if;

  select string_agg(x.line, E'\n' order by x.id) into ctx from (
    select d.id, pr.display_name || ': ' || d.body as line
      from dm_messages d join profiles pr on pr.id = d.sender_id
     where d.conversation_id = m.conversation_id and d.id <= m.id and d.status = 'visible'
     order by d.id desc limit 6) x;

  begin
    insert into reports(reporter_id, target_user_id, dm_message_id, category, comment, snapshot, context)
    values (p.id, m.sender_id, m.id, p_category, nullif(left(btrim(coalesce(p_comment, '')), 300), ''), left(m.body, 500), left(ctx, 2000));
  exception when unique_violation then raise exception 'already_reported';
  end;
end $$;

-- ───────── обновлённые функции (добавлены поля про ЛС) ─────────
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
    'dm_enabled', p.dm_enabled, 'dm_feature', _setting('dm_feature', 'true') = 'true');
end $$;

create or replace function public.get_profile(p_id uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare p profiles; g jsonb;
begin
  perform _me();
  select * into p from profiles where id = p_id and status <> 'deleted';
  if not found then return null; end if;
  select coalesce(jsonb_agg(jsonb_build_object('emoji', x.emoji, 'title', x.title, 'n', x.n) order by x.n desc), '[]')
    into g
    from (select gf.emoji, gf.title, count(*) n from gift_transfers t join gifts gf on gf.id = t.gift_id
           where t.to_user = p_id group by gf.emoji, gf.title) x;
  return jsonb_build_object(
    'id', p.id, 'display_name', p.display_name, 'bio', p.bio, 'role', p.role,
    'photo_url', case when p.show_photo then p.photo_url end,
    'banned', p.status = 'banned', 'created_at', p.created_at, 'gifts', g,
    'messages', (select count(*) from messages where user_id = p.id and status = 'visible'),
    'dm_enabled', p.dm_enabled and p.status = 'active');
end $$;

create or replace function public.list_members(p_q text default null, p_limit int default 50) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  perform _me();
  return (select coalesce(jsonb_agg(jsonb_build_object(
            'id', p.id, 'display_name', p.display_name, 'bio', p.bio, 'role', p.role,
            'photo_url', case when p.show_photo then p.photo_url end,
            'dm_enabled', p.dm_enabled) order by p.created_at desc), '[]')
            from (select * from profiles
                   where status = 'active' and (p_q is null or p_q = '' or display_name ilike '%' || replace(replace(p_q, '%', ''), '_', '') || '%')
                   order by created_at desc limit least(coalesce(p_limit, 50), 100)) p);
end $$;

create or replace function public.export_my_data() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare p profiles;
begin
  p := _me(false);
  return jsonb_build_object(
    'exported_at', now(),
    'profile', jsonb_build_object('id', p.id, 'telegram_id', p.telegram_id, 'username', p.username, 'first_name', p.first_name,
               'last_name', p.last_name, 'display_name', p.display_name, 'bio', p.bio, 'photo_url', p.photo_url, 'created_at', p.created_at),
    'consents', (select coalesce(jsonb_agg(to_jsonb(c) - 'id'), '[]') from privacy_consents c where c.user_id = p.id),
    'messages', (select coalesce(jsonb_agg(jsonb_build_object('id', m.id, 'body', m.body, 'media', m.media_path, 'status', m.status, 'created_at', m.created_at) order by m.id), '[]') from messages m where m.user_id = p.id),
    'direct_messages_sent', (select coalesce(jsonb_agg(jsonb_build_object('id', d.id, 'body', d.body, 'status', d.status, 'created_at', d.created_at) order by d.id), '[]') from dm_messages d where d.sender_id = p.id),
    'reactions', (select coalesce(jsonb_agg(jsonb_build_object('message_id', r.message_id, 'emoji', r.emoji)), '[]') from reactions r where r.user_id = p.id),
    'ledger', (select coalesce(jsonb_agg(to_jsonb(l) - 'actor' order by l.id), '[]') from ledger l where l.user_id = p.id),
    'gifts', (select coalesce(jsonb_agg(to_jsonb(t) order by t.id), '[]') from gift_transfers t where t.from_user = p.id or t.to_user = p.id),
    'reports_made', (select coalesce(jsonb_agg(jsonb_build_object('category', r.category, 'status', r.status, 'created_at', r.created_at)), '[]') from reports r where r.reporter_id = p.id),
    'notifications', (select coalesce(jsonb_agg(jsonb_build_object('title', n.title, 'text', n.text, 'created_at', n.created_at)), '[]') from notifications n where n.user_id = p.id));
end $$;

create or replace function public.delete_my_account() returns jsonb
language plpgsql security definer set search_path = public as $$
declare p profiles; paths jsonb; was_banned boolean;
begin
  p := _me(false);
  was_banned := p.status = 'banned';
  select coalesce(jsonb_agg(media_path), '[]') into paths from messages where user_id = p.id and media_path is not null;
  insert into message_archive(message_id, user_id, body, media_path, reason, archived_by)
    select m.id, m.user_id, m.body, m.media_path, 'account_deleted_open_report', null from messages m
     where m.user_id = p.id and exists (select 1 from reports r where r.message_id = m.id and r.status = 'new');
  update messages set body = '', media_path = null, status = 'deleted', status_reason = 'account_deleted', status_at = now()
   where user_id = p.id and status <> 'deleted';
  -- личные сообщения пользователя стираются (копия для нерассмотренных жалоб уже лежит в самой жалобе)
  update dm_messages set body = '', status = 'deleted', status_reason = 'account_deleted', status_at = now()
   where sender_id = p.id and status <> 'deleted';
  delete from user_blocks where blocker = p.id or blocked = p.id;
  delete from reactions where user_id = p.id;
  delete from notifications where user_id = p.id;
  update profiles set display_name = 'Удалённый пользователь', bio = '', username = null, first_name = null,
         last_name = null, photo_url = null, show_photo = false, deleted_at = now(),
         status = case when was_banned then 'banned' else 'deleted' end,
         telegram_id = case when was_banned then telegram_id else null end
   where id = p.id;
  insert into mod_log(actor, action, target_user, reason) values (p.id, 'account_deleted', p.id, case when was_banned then 'kept_identity_banned' end);
  return jsonb_build_object('media', paths, 'keep_auth', was_banned);
end $$;

create or replace function public.admin_list_reports(p_status text default 'new', p_limit int default 50) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  perform _staff();
  return (select coalesce(jsonb_agg(jsonb_build_object(
      'id', r.id, 'category', r.category, 'comment', r.comment, 'status', r.status, 'decision', r.decision,
      'resolution_note', r.resolution_note, 'created_at', r.created_at, 'resolved_at', r.resolved_at,
      'reporter_id', r.reporter_id, 'reporter', rp.display_name,
      'target_id', r.target_user_id, 'target', tp.display_name, 'target_status', tp.status,
      'message_id', coalesce(r.message_id, r.dm_message_id), 'message_status', coalesce(m.status, dm.status), 'snapshot', r.snapshot,
      'has_media', (m.media_path is not null),
      'is_dm', r.dm_message_id is not null, 'context', r.context) order by r.id desc), '[]')
    from (select * from reports where p_status = 'all' or status = p_status order by id desc limit least(coalesce(p_limit, 50), 200)) r
    join profiles rp on rp.id = r.reporter_id
    join profiles tp on tp.id = r.target_user_id
    left join messages m on m.id = r.message_id
    left join dm_messages dm on dm.id = r.dm_message_id);
end $$;

create or replace function public.admin_resolve_report(p_id bigint, p_decision text, p_note text default null, p_hours int default null) returns text
language plpgsql security definer set search_path = public as $$
declare a profiles; r reports; media text; note text := nullif(btrim(coalesce(p_note, '')), ''); open_left int;
begin
  a := _staff();
  select * into r from reports where id = p_id for update;
  if not found then raise exception 'not_found'; end if;
  if r.status <> 'new' then raise exception 'already_resolved'; end if;
  if p_decision not in ('reject','warn','delete_message','mute','ban') then raise exception 'bad_action'; end if;
  if p_decision <> 'reject' and note is null then raise exception 'reason_required'; end if;

  if p_decision = 'reject' then
    update reports set status = 'rejected', decision = 'reject', resolution_note = note, resolved_by = a.id, resolved_at = now() where id = r.id;
    update profiles set reports_rejected = reports_rejected + 1,
           report_blocked = report_blocked or (reports_rejected + 1 >= 5) where id = r.reporter_id;
    if r.message_id is not null then
      select count(*) into open_left from reports where message_id = r.message_id and status = 'new';
      if open_left = 0 then
        update messages set status = 'visible', status_reason = null, status_at = now()
         where id = r.message_id and status = 'hidden' and status_reason = 'auto_reports';
        perform realtime.send('{}'::jsonb, 'ping', 'chat-city', false);
      end if;
    end if;
  else
    if p_decision = 'delete_message' then
      if r.dm_message_id is not null then
        update dm_messages set body = '', status = 'deleted', status_reason = 'report:' || r.category, status_by = a.id, status_at = now()
         where id = r.dm_message_id;
        perform _notify(r.target_user_id, 'Сообщение удалено', 'Ваше личное сообщение удалено модератором за нарушение правил.');
        insert into mod_log(actor, action, target_user, report_id, reason, meta)
        values (a.id, 'delete_dm_message', r.target_user_id, r.id, note, jsonb_build_object('dm_message', r.dm_message_id));
      elsif r.message_id is null then
        raise exception 'not_found';
      else
        media := _archive_and_blank(r.message_id, 'report:' || r.category, a.id, 'deleted');
        perform realtime.send('{}'::jsonb, 'ping', 'chat-city', false);
        perform _notify(r.target_user_id, 'Сообщение удалено', 'Ваше сообщение удалено модератором за нарушение правил чата.');
        insert into mod_log(actor, action, target_user, target_message, report_id, reason) values (a.id, 'delete_message', r.target_user_id, r.message_id, r.id, note);
      end if;
    else
      perform admin_user_action(r.target_user_id, p_decision, p_hours, note);
    end if;
    update reports set status = 'resolved', decision = p_decision, resolution_note = note, resolved_by = a.id, resolved_at = now()
     where status = 'new' and (id = r.id
        or (r.message_id is not null and message_id = r.message_id)
        or (r.dm_message_id is not null and dm_message_id = r.dm_message_id));
  end if;
  insert into mod_log(actor, action, target_user, report_id, reason) values (a.id, 'report_' || p_decision, r.target_user_id, r.id, note);
  return media;
end $$;

-- Политика изменилась (личные сообщения) — участники подтверждают согласие заново.
update public.chat_settings set value = '2.1', updated_at = now() where key = 'policy_version';

grant execute on function
  public.dm_send(uuid, text), public.dm_list(), public.dm_unread_count(), public.dm_get(uuid, bigint, int),
  public.dm_delete_conversation(uuid), public.dm_delete_message(bigint),
  public.block_user(uuid, boolean), public.list_blocked(), public.set_dm_enabled(boolean),
  public.report_dm_message(bigint, text, text)
to authenticated;
