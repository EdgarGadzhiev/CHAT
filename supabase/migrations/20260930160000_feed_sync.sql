-- Лёгкая синхронизация ленты: клиент присылает {id: версия}, сервер возвращает только изменения.
-- Типичный ответ — ~100 байт вместо ~24 КБ; полная лента грузится один раз при открытии.

alter table public.messages add column if not exists v int not null default 0;

create or replace function public._messages_bump() returns trigger language plpgsql as $$
begin
  new.v := old.v + 1;
  return new;
end $$;

drop trigger if exists messages_bump on public.messages;
create trigger messages_bump before update of status, body, media_path, pinned_at, boost_until, highlight_until, reactions
  on public.messages for each row execute function public._messages_bump();

create or replace function public._feed_json(p_ids bigint[], p_uid uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(x.j order by x.ord), '[]'::jsonb)
  from (
    select k.ord,
      jsonb_build_object(
        'id', m.id, 'v', m.v, 'user_id', m.user_id, 'status', m.status, 'created_at', m.created_at,
        'body', case when m.status = 'visible' then m.body else '' end,
        'media_path', case when m.status = 'visible' then m.media_path end,
        'thumb', m.has_thumb,
        'reply_to', m.reply_to,
        'pinned', m.pinned_at is not null,
        'boosted', coalesce(m.boost_until > now(), false),
        'highlighted', coalesce(m.highlight_until > now(), false),
        'boost_until', m.boost_until,
        'highlight_until', m.highlight_until,
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

create or replace function public.feed_sync(p_after bigint, p_known jsonb) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  uid uuid := auth.uid(); known jsonb := coalesce(p_known, '{}'::jsonb);
  new_ids bigint[]; ch_ids bigint[]; gone bigint[]; tids bigint[]; extra bigint[];
begin
  perform _me();
  if (select count(*) from jsonb_object_keys(known)) > 200 then raise exception 'too_many'; end if;

  select coalesce(array_agg(id order by id), '{}') into new_ids
    from (select id from messages where id > coalesce(p_after, 0) order by id limit 100) x;

  select coalesce(array_agg(m.id order by m.id), '{}') into ch_ids
    from jsonb_each_text(known) k join messages m on m.id = k.key::bigint
   where m.v <> k.value::int;

  select coalesce(array_agg(k.key::bigint), '{}') into gone
    from jsonb_each_text(known) k
   where not exists (select 1 from messages m where m.id = k.key::bigint);

  select coalesce(array_agg(id order by is_pin desc, boosted_at desc nulls last), '{}') into tids
    from (select id, (pinned_at is not null) as is_pin, boosted_at from messages
           where status = 'visible' and (pinned_at is not null or boost_until > now())
           order by (pinned_at is not null) desc, boosted_at desc nulls last limit 6) t;

  select coalesce(array_agg(t), '{}') into extra from unnest(tids) t where not jsonb_exists(known, t::text);

  return jsonb_build_object(
    'now', now(),
    'new', _feed_json(new_ids, uid),
    'changed', _feed_json(ch_ids, uid),
    'gone', to_jsonb(gone),
    'top_ids', to_jsonb(tids),
    'top_extra', _feed_json(extra, uid));
end $$;

revoke execute on all functions in schema public from public, anon;
grant execute on function
  public.is_staff(), public.is_admin(), public.can_use_chat(),
  public.get_me(), public.accept_consents(boolean), public.update_profile(text, text, boolean),
  public.get_profile(uuid), public.list_members(text, int),
  public.get_feed(bigint, int), public.feed_sync(bigint, jsonb), public.get_messages(bigint, int), public.get_top_messages(),
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
