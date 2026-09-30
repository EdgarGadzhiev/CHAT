-- Новые функции по умолчанию доступны роли anon (PUBLIC EXECUTE) — закрываем и выдаём права только нужным.
-- ВАЖНО: после создания любой новой функции в схеме public нужно повторять этот блок (добавляя имя функции в grant).
revoke execute on all functions in schema public from public, anon;
grant execute on function
  public.is_staff(), public.is_admin(), public.can_use_chat(),
  public.get_me(), public.accept_consents(boolean), public.update_profile(text, text, boolean),
  public.get_profile(uuid), public.list_members(text, int),
  public.get_messages(bigint, int), public.get_top_messages(),
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
  public.admin_get_log(int), public.admin_clear_chat(text),
  public.dm_send(uuid, text), public.dm_list(), public.dm_unread_count(), public.dm_get(uuid, bigint, int),
  public.dm_delete_conversation(uuid), public.dm_delete_message(bigint),
  public.block_user(uuid, boolean), public.list_blocked(), public.set_dm_enabled(boolean),
  public.report_dm_message(bigint, text, text)
to authenticated;
