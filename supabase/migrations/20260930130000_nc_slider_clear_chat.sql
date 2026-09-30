-- Покупка Nurcoin произвольной суммой (ползунок) + очистка чата администратором.

insert into public.chat_settings(key, value) values
  ('nc_price_kop', '100'),   -- цена 1 NC в копейках
  ('nc_min', '50'),
  ('nc_max', '5000'),
  ('nc_step', '10')
on conflict (key) do nothing;

alter table public.payment_orders alter column pack_id drop not null;

drop function if exists public.create_order(int);
create or replace function public.create_order(p_nc int) returns jsonb
language plpgsql security definer set search_path = public as $$
declare p profiles; o payment_orders; mn int; mx int; st int; rate int;
begin
  p := _me();
  perform _rl(p.id, 'order', 5, 3600);
  perform _rl(p.id, 'order_day', 15, 86400);
  mn := _setting('nc_min', '50')::int; mx := _setting('nc_max', '5000')::int;
  st := greatest(_setting('nc_step', '10')::int, 1); rate := _setting('nc_price_kop', '100')::int;
  if p_nc is null or p_nc < mn or p_nc > mx or p_nc % st <> 0 then raise exception 'bad_amount'; end if;
  insert into payment_orders(user_id, pack_id, nc_amount, amount_kop) values (p.id, null, p_nc, p_nc * rate) returning * into o;
  return jsonb_build_object('id', o.id, 'nc_amount', o.nc_amount, 'amount_kop', o.amount_kop);
end $$;

-- Полная очистка чата (только admin). Копии текста сохраняются в архиве для разбора жалоб (хранятся до 1 года).
create or replace function public.admin_clear_chat(p_reason text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare a profiles; paths jsonb; n int; rs text := btrim(coalesce(p_reason, ''));
begin
  a := _admin();
  if char_length(rs) < 3 then raise exception 'reason_required'; end if;
  select coalesce(jsonb_agg(media_path), '[]') into paths from messages where media_path is not null;
  insert into message_archive(message_id, user_id, body, media_path, reason, archived_by)
    select m.id, m.user_id, m.body, m.media_path, 'chat_cleared', a.id from messages m
     where (m.body <> '' or m.media_path is not null)
       and not exists (select 1 from message_archive x where x.message_id = m.id);
  select count(*) into n from messages;
  delete from reactions where true;
  delete from messages where true;
  insert into mod_log(actor, action, reason, meta) values (a.id, 'clear_chat', rs, jsonb_build_object('messages', n));
  perform realtime.send('{}'::jsonb, 'ping', 'chat-city', false);
  return jsonb_build_object('deleted', n, 'media', paths);
end $$;

grant execute on function public.create_order(int), public.admin_clear_chat(text) to authenticated;
