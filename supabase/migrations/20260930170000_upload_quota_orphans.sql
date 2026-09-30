-- Защита хранилища: лимит загрузок на пользователя и автоматическая очередь «осиротевших» файлов.

create index if not exists messages_media_idx on public.messages (media_path) where media_path is not null;

-- не больше 60 файлов (≈30 фото с миниатюрами) в час на пользователя
create or replace function public.can_upload_media() returns boolean
language sql stable security definer set search_path = public, storage as $$
  select public.can_use_chat() and (
    select count(*) from storage.objects o
     where o.bucket_id = 'chat-media' and o.name like auth.uid()::text || '/%' and o.created_at > now() - interval '1 hour'
  ) < 60
$$;

drop policy if exists chat_media_insert on storage.objects;
create policy chat_media_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'chat-media' and (storage.foldername(name))[1] = (select auth.uid())::text and (select public.can_upload_media()));

-- в ежедневную очистку добавляем файлы, на которые не ссылается ни одно сообщение (загрузили, но не отправили)
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

  insert into media_trash(path)
    select o.name from storage.objects o
     where o.bucket_id = 'chat-media' and o.created_at < now() - interval '3 hours'
       and not exists (select 1 from messages m where m.media_path = o.name or m.media_path = replace(o.name, '_t.jpg', '.jpg'))
    on conflict do nothing;
end $$;

revoke execute on all functions in schema public from public, anon;
grant execute on function
  public.is_staff(), public.is_admin(), public.can_use_chat(), public.can_upload_media(),
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
