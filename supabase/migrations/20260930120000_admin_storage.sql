-- Админ/модераторские RPC, хранилище медиа, регламентная очистка.

-- _me: разрешаем читать данные даже забаненным (для экспорта/удаления своих данных)
drop function if exists public._me(boolean);
create or replace function public._me(p_need_consent boolean default true, p_allow_banned boolean default null) returns public.profiles
language plpgsql security definer set search_path = public as $$
declare p profiles; v text;
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  select * into p from profiles where id = auth.uid();
  if not found or (p.status = 'deleted') then raise exception 'no_profile'; end if;
  if p.status = 'banned' and not coalesce(p_allow_banned, not p_need_consent) then
    if p.banned_until is not null and p.banned_until <= now() then
      update profiles set status = 'active', banned_until = null, ban_reason = null
       where id = p.id returning * into p;
    else
      raise exception 'banned';
    end if;
  end if;
  if p_need_consent then
    v := _setting('policy_version');
    if not exists (select 1 from privacy_consents where user_id = p.id and policy_version = v and age_confirmed) then
      raise exception 'consent_required';
    end if;
  end if;
  return p;
end $$;

-- у экспорта и удаления аккаунта — доступ и для заблокированных
create or replace function public._staff() returns public.profiles language plpgsql security definer set search_path = public as $$
declare p profiles;
begin
  p := _me();
  if p.role not in ('moderator','admin') then raise exception 'forbidden'; end if;
  return p;
end $$;
create or replace function public._admin() returns public.profiles language plpgsql security definer set search_path = public as $$
declare p profiles;
begin
  p := _me();
  if p.role <> 'admin' then raise exception 'forbidden'; end if;
  return p;
end $$;

create or replace function public._archive_and_blank(p_msg bigint, p_reason text, p_actor uuid, p_new_status text) returns text
language plpgsql security definer set search_path = public as $$
declare m messages; old_path text;
begin
  select * into m from messages where id = p_msg for update;
  if not found then raise exception 'not_found'; end if;
  old_path := m.media_path;
  if not exists (select 1 from message_archive a where a.message_id = m.id) and (m.body <> '' or m.media_path is not null) then
    insert into message_archive(message_id, user_id, body, media_path, reason, archived_by)
    values (m.id, m.user_id, m.body, m.media_path, p_reason, p_actor);
  end if;
  update messages set body = '', media_path = null, status = p_new_status, status_reason = p_reason,
         status_by = p_actor, status_at = now(), pinned_at = null, pinned_by = null
   where id = m.id;
  return old_path;
end $$;

create or replace function public.admin_stats() returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  perform _staff();
  return jsonb_build_object(
    'users', (select count(*) from profiles where status = 'active'),
    'banned', (select count(*) from profiles where status = 'banned'),
    'messages_24h', (select count(*) from messages where created_at > now() - interval '24 hours'),
    'reports_new', (select count(*) from reports where status = 'new'),
    'nc_in_circulation', (select coalesce(sum(balance), 0) from wallets));
end $$;

create or replace function public.admin_search_users(p_q text default null, p_limit int default 30) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare q text := btrim(coalesce(p_q, ''));
begin
  perform _staff();
  return (select coalesce(jsonb_agg(jsonb_build_object(
      'id', p.id, 'display_name', p.display_name, 'username', p.username, 'telegram_id', p.telegram_id,
      'role', p.role, 'status', p.status, 'banned_until', p.banned_until, 'muted_until', p.muted_until,
      'report_blocked', p.report_blocked, 'created_at', p.created_at,
      'balance', coalesce(w.balance, 0),
      'violations', (select count(*) from mod_log l where l.target_user = p.id and l.action in ('ban','mute','warn','delete_message','auto_hide'))
    ) order by p.created_at desc), '[]')
    from (select * from profiles
           where q = '' or display_name ilike '%' || replace(replace(q, '%', ''), '_', '') || '%'
              or username ilike replace(replace(q, '%', ''), '_', '') || '%'
              or telegram_id::text = q or id::text = q
           order by created_at desc limit least(coalesce(p_limit, 30), 100)) p
    left join wallets w on w.user_id = p.id);
end $$;

create or replace function public.admin_get_user(p_id uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare p profiles;
begin
  perform _staff();
  select * into p from profiles where id = p_id;
  if not found then return null; end if;
  return jsonb_build_object(
    'id', p.id, 'display_name', p.display_name, 'username', p.username, 'telegram_id', p.telegram_id,
    'first_name', p.first_name, 'last_name', p.last_name, 'bio', p.bio, 'role', p.role, 'status', p.status,
    'ban_reason', p.ban_reason, 'banned_until', p.banned_until, 'muted_until', p.muted_until, 'mute_reason', p.mute_reason,
    'report_blocked', p.report_blocked, 'reports_rejected', p.reports_rejected, 'created_at', p.created_at,
    'balance', coalesce((select balance from wallets where user_id = p.id), 0),
    'reports_against', (select count(*) from reports where target_user_id = p.id),
    'messages', (select count(*) from messages where user_id = p.id),
    'violations', (select coalesce(jsonb_agg(jsonb_build_object('action', l.action, 'reason', l.reason, 'meta', l.meta, 'actor', l.actor, 'at', l.created_at) order by l.id desc), '[]')
                     from (select * from mod_log where target_user = p.id order by id desc limit 40) l),
    'ledger', (select coalesce(jsonb_agg(jsonb_build_object('id', l.id, 'amount', l.amount, 'balance_after', l.balance_after, 'kind', l.kind, 'note', l.note, 'at', l.created_at) order by l.id desc), '[]')
                 from (select * from ledger where user_id = p.id order by id desc limit 40) l));
end $$;

create or replace function public.admin_user_action(p_user uuid, p_action text, p_hours int default null, p_reason text default null) returns void
language plpgsql security definer set search_path = public as $$
declare a profiles; t profiles; rs text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  a := _staff();
  select * into t from profiles where id = p_user;
  if not found then raise exception 'not_found'; end if;
  if t.id = a.id then raise exception 'forbidden'; end if;
  if t.role = 'admin' or (t.role = 'moderator' and a.role <> 'admin') then raise exception 'forbidden'; end if;
  if p_action in ('ban','mute') and rs is null then raise exception 'reason_required'; end if;

  if p_action = 'ban' then
    if a.role = 'moderator' and (p_hours is null or p_hours > 72) then raise exception 'forbidden'; end if;
    update profiles set status = case when deleted_at is not null then status else 'banned' end,
           banned_until = case when p_hours is null then null else now() + make_interval(hours => p_hours) end, ban_reason = rs
     where id = t.id;
  elsif p_action = 'unban' then
    update profiles set status = case when deleted_at is not null then 'deleted' else 'active' end, banned_until = null, ban_reason = null where id = t.id;
  elsif p_action = 'mute' then
    update profiles set muted_until = now() + make_interval(hours => coalesce(p_hours, 24)), mute_reason = rs where id = t.id;
    perform _notify(t.id, 'Ограничение отправки сообщений', 'Вы не можете писать в чат до ' || to_char(now() + make_interval(hours => coalesce(p_hours, 24)), 'DD.MM HH24:MI') || ' UTC. Причина: ' || rs);
  elsif p_action = 'unmute' then
    update profiles set muted_until = null, mute_reason = null where id = t.id;
  elsif p_action = 'report_block' then
    update profiles set report_blocked = true where id = t.id;
  elsif p_action = 'report_unblock' then
    update profiles set report_blocked = false, reports_rejected = 0 where id = t.id;
  elsif p_action = 'warn' then
    if rs is null then raise exception 'reason_required'; end if;
    perform _notify(t.id, 'Предупреждение модератора', rs);
  else
    raise exception 'bad_action';
  end if;
  insert into mod_log(actor, action, target_user, reason, meta) values (a.id, p_action, t.id, rs, jsonb_build_object('hours', p_hours));
end $$;

create or replace function public.admin_delete_message(p_id bigint, p_reason text) returns text
language plpgsql security definer set search_path = public as $$
declare a profiles; path text; uid uuid;
begin
  a := _staff();
  if btrim(coalesce(p_reason, '')) = '' then raise exception 'reason_required'; end if;
  select user_id into uid from messages where id = p_id;
  path := _archive_and_blank(p_id, p_reason, a.id, 'deleted');
  insert into mod_log(actor, action, target_user, target_message, reason) values (a.id, 'delete_message', uid, p_id, p_reason);
  perform realtime.send('{}'::jsonb, 'ping', 'chat-city', false);
  return path;
end $$;

create or replace function public.admin_delete_media(p_id bigint, p_reason text) returns text
language plpgsql security definer set search_path = public as $$
declare a profiles; m messages; path text;
begin
  a := _staff();
  if btrim(coalesce(p_reason, '')) = '' then raise exception 'reason_required'; end if;
  select * into m from messages where id = p_id;
  if not found or m.media_path is null then raise exception 'not_found'; end if;
  path := m.media_path;
  insert into message_archive(message_id, user_id, body, media_path, reason, archived_by) values (m.id, m.user_id, m.body, m.media_path, p_reason, a.id);
  update messages set media_path = null,
         status = case when body = '' then 'deleted' else status end,
         status_reason = case when body = '' then p_reason else status_reason end,
         status_by = a.id, status_at = now()
   where id = m.id;
  insert into mod_log(actor, action, target_user, target_message, reason) values (a.id, 'delete_media', m.user_id, m.id, p_reason);
  perform realtime.send('{}'::jsonb, 'ping', 'chat-city', false);
  return path;
end $$;

create or replace function public.admin_pin_message(p_id bigint, p_pin boolean) returns void
language plpgsql security definer set search_path = public as $$
declare a profiles;
begin
  a := _staff();
  update messages set pinned_at = case when p_pin then now() end, pinned_by = case when p_pin then a.id end
   where id = p_id and status = 'visible';
  if not found then raise exception 'not_found'; end if;
  insert into mod_log(actor, action, target_message) values (a.id, case when p_pin then 'pin' else 'unpin' end, p_id);
  perform realtime.send('{}'::jsonb, 'ping', 'chat-city', false);
end $$;

create or replace function public.admin_list_messages(p_before bigint default null, p_limit int default 40, p_user uuid default null) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  perform _staff();
  return (select coalesce(jsonb_agg(jsonb_build_object(
      'id', m.id, 'user_id', m.user_id, 'author', pr.display_name, 'status', m.status, 'status_reason', m.status_reason,
      'created_at', m.created_at, 'pinned', m.pinned_at is not null, 'media_path', coalesce(m.media_path, ar.media_path),
      'media_removed', m.media_path is null and ar.media_path is not null,
      'body', case when m.body <> '' then m.body else coalesce(ar.body, '') end) order by m.id desc), '[]')
    from (select * from messages where (p_before is null or id < p_before) and (p_user is null or user_id = p_user)
           order by id desc limit least(coalesce(p_limit, 40), 100)) m
    join profiles pr on pr.id = m.user_id
    left join lateral (select a.body, a.media_path from message_archive a where a.message_id = m.id order by a.id desc limit 1) ar on true);
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
      'message_id', r.message_id, 'message_status', m.status, 'snapshot', r.snapshot,
      'has_media', (m.media_path is not null)) order by r.id desc), '[]')
    from (select * from reports where p_status = 'all' or status = p_status order by id desc limit least(coalesce(p_limit, 50), 200)) r
    join profiles rp on rp.id = r.reporter_id
    join profiles tp on tp.id = r.target_user_id
    left join messages m on m.id = r.message_id);
end $$;

create or replace function public.admin_resolve_report(p_id bigint, p_decision text, p_note text default null, p_hours int default null) returns text
language plpgsql security definer set search_path = public as $$
declare a profiles; r reports; media text; note text := nullif(btrim(coalesce(p_note, '')), ''); rej int; open_left int;
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
        update messages set status = 'visible', status_reason = null, status_at = now(), body = coalesce((select body from message_archive where message_id = r.message_id and reason = 'auto_reports' order by id desc limit 1), body),
               media_path = coalesce((select media_path from message_archive where message_id = r.message_id and reason = 'auto_reports' order by id desc limit 1), media_path)
         where id = r.message_id and status = 'hidden' and status_reason = 'auto_reports';
        perform realtime.send('{}'::jsonb, 'ping', 'chat-city', false);
      end if;
    end if;
  else
    if p_decision = 'delete_message' then
      if r.message_id is null then raise exception 'not_found'; end if;
      media := _archive_and_blank(r.message_id, 'report:' || r.category, a.id, 'deleted');
      perform realtime.send('{}'::jsonb, 'ping', 'chat-city', false);
      perform _notify(r.target_user_id, 'Сообщение удалено', 'Ваше сообщение удалено модератором за нарушение правил чата.');
      insert into mod_log(actor, action, target_user, target_message, report_id, reason) values (a.id, 'delete_message', r.target_user_id, r.message_id, r.id, note);
    else
      perform admin_user_action(r.target_user_id, p_decision, p_hours, note);
    end if;
    update reports set status = 'resolved', decision = p_decision, resolution_note = note, resolved_by = a.id, resolved_at = now()
     where status = 'new' and (id = r.id or (r.message_id is not null and message_id = r.message_id));
  end if;
  insert into mod_log(actor, action, target_user, report_id, reason) values (a.id, 'report_' || p_decision, r.target_user_id, r.id, note);
  return media; -- путь файла, который клиент должен удалить из Storage
end $$;

create or replace function public.admin_adjust_balance(p_user uuid, p_delta bigint, p_reason text) returns bigint
language plpgsql security definer set search_path = public as $$
declare a profiles; nb bigint; rs text := btrim(coalesce(p_reason, ''));
begin
  a := _admin();
  if char_length(rs) < 5 then raise exception 'reason_required'; end if;
  if p_delta = 0 or abs(p_delta) > 1000000 then raise exception 'bad_amount'; end if;
  if not exists (select 1 from profiles where id = p_user and status <> 'deleted') then raise exception 'not_found'; end if;
  nb := _wallet_apply(p_user, p_delta, 'admin_adjust', 'admin', a.id::text, rs, a.id);
  insert into mod_log(actor, action, target_user, reason, meta) values (a.id, 'balance_adjust', p_user, rs, jsonb_build_object('delta', p_delta, 'balance_after', nb));
  perform _notify(p_user, case when p_delta > 0 then 'Начисление Nurcoin' else 'Списание Nurcoin' end, abs(p_delta) || ' NC. ' || rs);
  return nb;
end $$;

create or replace function public.admin_get_log(p_limit int default 100) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  perform _admin();
  return (select coalesce(jsonb_agg(jsonb_build_object('id', l.id, 'actor', l.actor, 'action', l.action, 'target_user', l.target_user,
            'target_message', l.target_message, 'reason', l.reason, 'meta', l.meta, 'at', l.created_at) order by l.id desc), '[]')
            from (select * from mod_log order by id desc limit least(coalesce(p_limit, 100), 500)) l);
end $$;

-- ───────── хранилище медиа ─────────
create or replace function public.can_use_chat() returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from profiles p where p.id = auth.uid() and p.status = 'active'
                   and exists (select 1 from privacy_consents c where c.user_id = p.id
                                 and c.policy_version = public._setting('policy_version') and c.age_confirmed))
$$;
grant execute on function public.can_use_chat() to authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('chat-media', 'chat-media', false, 3145728, array['image/jpeg','image/png','image/webp'])
on conflict (id) do update set public = false, file_size_limit = 3145728, allowed_mime_types = array['image/jpeg','image/png','image/webp'];

create policy chat_media_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'chat-media' and (storage.foldername(name))[1] = (select auth.uid())::text and public.can_use_chat());
create policy chat_media_select on storage.objects for select to authenticated
  using (bucket_id = 'chat-media' and public.can_use_chat());
create policy chat_media_delete on storage.objects for delete to authenticated
  using (bucket_id = 'chat-media' and ((storage.foldername(name))[1] = (select auth.uid())::text or public.is_staff()));

-- ───────── регламентная очистка ─────────
create or replace function public.purge_old_data() returns void language plpgsql security definer set search_path = public as $$
begin
  delete from rate_limits where window_start < now() - interval '2 days';
  delete from auth_attempts where created_at < now() - interval '7 days';
  delete from notifications where read and created_at < now() - interval '90 days';
  update payment_orders set status = 'cancelled' where status = 'pending' and created_at < now() - interval '2 days';
  delete from message_archive a where a.archived_at < now() - interval '365 days'
     and not exists (select 1 from reports r where r.message_id = a.message_id and r.status = 'new');
end $$;
revoke execute on function public.purge_old_data() from authenticated;

grant execute on function
  public.admin_stats(), public.admin_search_users(text, int), public.admin_get_user(uuid),
  public.admin_user_action(uuid, text, int, text), public.admin_delete_message(bigint, text),
  public.admin_delete_media(bigint, text), public.admin_pin_message(bigint, boolean),
  public.admin_list_messages(bigint, int, uuid), public.admin_list_reports(text, int),
  public.admin_resolve_report(bigint, text, text, int), public.admin_adjust_balance(uuid, bigint, text),
  public.admin_get_log(int)
to authenticated;
