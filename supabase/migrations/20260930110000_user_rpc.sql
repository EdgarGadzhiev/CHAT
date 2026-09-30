-- RPC для обычных пользователей.

create or replace function public._setting(p_key text, p_default text default null) returns text
language sql stable security definer set search_path = public as $$
  select coalesce((select value from chat_settings where key = p_key), p_default)
$$;

create or replace function public._me(p_need_consent boolean default true) returns public.profiles
language plpgsql security definer set search_path = public as $$
declare p profiles; v text;
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  select * into p from profiles where id = auth.uid();
  if not found or p.status = 'deleted' then raise exception 'no_profile'; end if;
  if p.status = 'banned' then
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

create or replace function public._notify(p_user uuid, p_title text, p_text text) returns void
language sql security definer set search_path = public as $$
  insert into notifications(user_id, title, text) values (p_user, p_title, p_text)
$$;

-- ───────── профиль ─────────
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
    'created_at', p.created_at);
end $$;

create or replace function public.accept_consents(p_age_confirmed boolean) returns void
language plpgsql security definer set search_path = public as $$
declare p profiles; v text;
begin
  p := _me(false);
  if not coalesce(p_age_confirmed, false) then raise exception 'age_required'; end if;
  v := _setting('policy_version');
  insert into privacy_consents(user_id, telegram_id, policy_version, terms_version, age_confirmed)
  values (p.id, coalesce(p.telegram_id, 0), v, v, true)
  on conflict (user_id, policy_version) do update set consented_at = now(), terms_version = v, age_confirmed = true;
end $$;

create or replace function public.update_profile(p_display_name text, p_bio text, p_show_photo boolean) returns void
language plpgsql security definer set search_path = public as $$
declare p profiles; nm text := btrim(coalesce(p_display_name, '')); bi text := btrim(coalesce(p_bio, '')); r text;
begin
  p := _me();
  perform _rl(p.id, 'profile_edit', 10, 3600);
  if char_length(nm) < 2 or char_length(nm) > 32 then raise exception 'bad_name'; end if;
  if char_length(bi) > 200 then raise exception 'bad_bio'; end if;
  r := check_text(nm || ' ' || bi);
  if r is not null then raise exception 'blocked:%', r; end if;
  update profiles set display_name = nm, bio = bi, show_photo = coalesce(p_show_photo, false), updated_at = now()
   where id = p.id;
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
    'messages', (select count(*) from messages where user_id = p.id and status = 'visible'));
end $$;

create or replace function public.list_members(p_q text default null, p_limit int default 50) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  perform _me();
  return (select coalesce(jsonb_agg(jsonb_build_object(
            'id', p.id, 'display_name', p.display_name, 'bio', p.bio, 'role', p.role,
            'photo_url', case when p.show_photo then p.photo_url end) order by p.created_at desc), '[]')
            from (select * from profiles
                   where status = 'active' and (p_q is null or p_q = '' or display_name ilike '%' || replace(replace(p_q, '%', ''), '_', '') || '%')
                   order by created_at desc limit least(coalesce(p_limit, 50), 100)) p);
end $$;

-- ───────── чат ─────────
create or replace function public._msg_json(m public.messages) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'id', m.id, 'user_id', m.user_id, 'status', m.status, 'created_at', m.created_at,
    'body', case when m.status = 'visible' then m.body else '' end,
    'media_path', case when m.status = 'visible' then m.media_path end,
    'reply_to', m.reply_to,
    'pinned', m.pinned_at is not null,
    'boosted', coalesce(m.boost_until > now(), false),
    'highlighted', coalesce(m.highlight_until > now(), false),
    'author', pr.display_name,
    'author_photo', case when pr.show_photo then pr.photo_url end,
    'author_role', pr.role,
    'reply', (select jsonb_build_object('id', r.id, 'author', rp.display_name,
                       'body', left(case when r.status = 'visible' then r.body else '' end, 80))
                from messages r join profiles rp on rp.id = r.user_id where r.id = m.reply_to),
    'reactions', (select coalesce(jsonb_object_agg(q.emoji, jsonb_build_object('n', q.cnt, 'me', q.mine)), '{}')
                    from (select emoji, count(*) cnt, bool_or(user_id = auth.uid()) mine
                            from reactions where message_id = m.id group by emoji) q))
  from profiles pr where pr.id = m.user_id
$$;

create or replace function public.get_messages(p_before bigint default null, p_limit int default 40) returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  perform _me();
  return (select coalesce(jsonb_agg(_msg_json(m) order by m.id), '[]')
            from (select * from messages
                   where (p_before is null or id < p_before)
                   order by id desc limit least(coalesce(p_limit, 40), 100)) m);
end $$;

create or replace function public.get_top_messages() returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  perform _me();
  return (select coalesce(jsonb_agg(_msg_json(m) order by (m.pinned_at is not null) desc, m.boosted_at desc nulls last), '[]')
            from (select * from messages
                   where status = 'visible' and (pinned_at is not null or boost_until > now())
                   order by (pinned_at is not null) desc, boosted_at desc nulls last limit 6) m);
end $$;

create or replace function public.send_message(p_body text, p_reply_to bigint default null, p_media_path text default null) returns bigint
language plpgsql security definer set search_path = public as $$
declare p profiles; b text := btrim(coalesce(p_body, '')); r text; mx int; last_at timestamptz; slow int; new_id bigint;
begin
  p := _me();
  if _setting('chat_enabled', 'true') <> 'true' then raise exception 'chat_disabled'; end if;
  if p.muted_until is not null and p.muted_until > now() then raise exception 'muted'; end if;
  mx := least(coalesce(_setting('max_message_len', '500')::int, 500), 1000);
  if char_length(b) > mx then raise exception 'too_long'; end if;
  if b = '' and p_media_path is null then raise exception 'empty'; end if;
  r := check_text(b);
  if r is not null then raise exception 'blocked:%', r; end if;

  perform _rl(p.id, 'msg_burst', 5, 10);
  perform _rl(p.id, 'msg_min', 15, 60);
  perform _rl(p.id, 'msg_hour', 200, 3600);
  if p.created_at > now() - interval '5 minutes' then perform _rl(p.id, 'msg_new', 3, 60); end if;

  slow := coalesce(_setting('slow_mode_seconds', '0')::int, 0);
  select max(created_at) into last_at from messages where user_id = p.id;
  if slow > 0 and last_at is not null and last_at > now() - make_interval(secs => slow) then raise exception 'slow_mode'; end if;
  if b <> '' and exists (select 1 from messages where user_id = p.id and body = b and created_at > now() - interval '60 seconds') then
    raise exception 'duplicate';
  end if;

  if p_reply_to is not null and not exists (select 1 from messages where id = p_reply_to and status = 'visible') then
    raise exception 'bad_reply';
  end if;

  if p_media_path is not null then
    if p_media_path not like p.id::text || '/%' then raise exception 'bad_media'; end if;
    if not exists (select 1 from storage.objects where bucket_id = 'chat-media' and name = p_media_path) then raise exception 'bad_media'; end if;
    if p.created_at > now() - make_interval(mins => coalesce(_setting('media_min_account_minutes', '10')::int, 10)) then
      raise exception 'media_too_early';
    end if;
    perform _rl(p.id, 'media_hour', 20, 3600);
  end if;

  insert into messages(user_id, body, reply_to, media_path) values (p.id, b, p_reply_to, p_media_path) returning id into new_id;
  perform realtime.send('{}'::jsonb, 'ping', 'chat-city', false);
  return new_id;
end $$;

create or replace function public.toggle_reaction(p_message bigint, p_emoji text) returns void
language plpgsql security definer set search_path = public as $$
declare p profiles;
begin
  p := _me();
  perform _rl(p.id, 'react', 40, 60);
  if not exists (select 1 from messages where id = p_message and status = 'visible') then raise exception 'not_found'; end if;
  if exists (select 1 from reactions where message_id = p_message and user_id = p.id and emoji = p_emoji) then
    delete from reactions where message_id = p_message and user_id = p.id and emoji = p_emoji;
  else
    insert into reactions(message_id, user_id, emoji) values (p_message, p.id, p_emoji);
  end if;
  perform realtime.send('{}'::jsonb, 'ping', 'chat-city', false);
end $$;

-- ───────── жалобы ─────────
create or replace function public.report_message(p_message bigint, p_category text, p_comment text default null) returns void
language plpgsql security definer set search_path = public as $$
declare p profiles; m messages; cnt int;
begin
  p := _me();
  if p.report_blocked then raise exception 'report_blocked'; end if;
  perform _rl(p.id, 'report_day', 10, 86400);
  perform _rl(p.id, 'report_min', 3, 60);
  select * into m from messages where id = p_message;
  if not found then raise exception 'not_found'; end if;
  if m.user_id = p.id then raise exception 'self_report'; end if;
  begin
    insert into reports(reporter_id, target_user_id, message_id, category, comment, snapshot)
    values (p.id, m.user_id, m.id, p_category, nullif(left(btrim(coalesce(p_comment, '')), 300), ''), left(m.body, 500));
  exception when unique_violation then raise exception 'already_reported';
  end;

  -- Авто-скрытие до проверки: ≥3 независимых жалоб от аккаунтов старше суток
  select count(distinct r.reporter_id) into cnt
    from reports r join profiles rp on rp.id = r.reporter_id
   where r.message_id = m.id and r.status = 'new' and rp.created_at < now() - interval '1 day' and not rp.report_blocked;
  if cnt >= 3 and m.status = 'visible' then
    insert into message_archive(message_id, user_id, body, media_path, reason) values (m.id, m.user_id, m.body, m.media_path, 'auto_reports');
    update messages set status = 'hidden', status_reason = 'auto_reports', status_at = now() where id = m.id;
    insert into mod_log(action, target_user, target_message, reason) values ('auto_hide', m.user_id, m.id, 'reports>=3');
    perform realtime.send('{}'::jsonb, 'ping', 'chat-city', false);
  end if;
end $$;

create or replace function public.report_user(p_user uuid, p_category text, p_comment text default null) returns void
language plpgsql security definer set search_path = public as $$
declare p profiles;
begin
  p := _me();
  if p.report_blocked then raise exception 'report_blocked'; end if;
  perform _rl(p.id, 'report_day', 10, 86400);
  perform _rl(p.id, 'report_min', 3, 60);
  if p_user = p.id then raise exception 'self_report'; end if;
  if not exists (select 1 from profiles where id = p_user and status <> 'deleted') then raise exception 'not_found'; end if;
  if exists (select 1 from reports where reporter_id = p.id and target_user_id = p_user and message_id is null and status = 'new') then
    raise exception 'already_reported';
  end if;
  insert into reports(reporter_id, target_user_id, category, comment)
  values (p.id, p_user, p_category, nullif(left(btrim(coalesce(p_comment, '')), 300), ''));
end $$;

-- ───────── Nurcoin: продвижение и подарки ─────────
create or replace function public.boost_message(p_message bigint, p_option int) returns bigint
language plpgsql security definer set search_path = public as $$
declare p profiles; m messages; o promo_options; nb bigint;
begin
  p := _me();
  if p.muted_until is not null and p.muted_until > now() then raise exception 'muted'; end if;
  perform _rl(p.id, 'promo', 20, 3600);
  select * into m from messages where id = p_message and user_id = p.id and status = 'visible';
  if not found then raise exception 'not_found'; end if;
  select * into o from promo_options where id = p_option and enabled;
  if not found then raise exception 'option_unavailable'; end if;
  nb := _wallet_apply(p.id, -o.price, 'spend_promo', 'message', m.id::text || ':' || o.id::text, o.title, p.id);
  if o.kind = 'top' then
    update messages set boost_until = greatest(coalesce(boost_until, now()), now()) + make_interval(mins => o.duration_minutes), boosted_at = now() where id = m.id;
  else
    update messages set highlight_until = greatest(coalesce(highlight_until, now()), now()) + make_interval(mins => o.duration_minutes) where id = m.id;
  end if;
  perform realtime.send('{}'::jsonb, 'ping', 'chat-city', false);
  return nb;
end $$;

create or replace function public.send_gift(p_to uuid, p_gift int) returns bigint
language plpgsql security definer set search_path = public as $$
declare p profiles; g gifts; nb bigint;
begin
  p := _me();
  perform _rl(p.id, 'gift', 20, 3600);
  if p_to = p.id then raise exception 'self_gift'; end if;
  if not exists (select 1 from profiles where id = p_to and status = 'active') then raise exception 'not_found'; end if;
  select * into g from gifts where id = p_gift and enabled;
  if not found then raise exception 'option_unavailable'; end if;
  nb := _wallet_apply(p.id, -g.price, 'spend_gift', 'gift', p_gift::text || ':' || p_to::text, g.title, p.id);
  insert into gift_transfers(from_user, to_user, gift_id, price_paid) values (p.id, p_to, g.id, g.price);
  perform _notify(p_to, 'Вам подарили ' || g.emoji, p.display_name || ' отправил(а) вам подарок «' || g.title || '».');
  return nb;
end $$;

create or replace function public.my_gifts_history() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare p profiles;
begin
  p := _me();
  return (select coalesce(jsonb_agg(jsonb_build_object(
            'id', t.id, 'emoji', g.emoji, 'title', g.title, 'price', t.price_paid, 'created_at', t.created_at,
            'direction', case when t.to_user = p.id then 'in' else 'out' end,
            'other', case when t.to_user = p.id then fp.display_name else tp.display_name end) order by t.id desc), '[]')
            from (select * from gift_transfers where from_user = p.id or to_user = p.id order by id desc limit 50) t
            join gifts g on g.id = t.gift_id
            join profiles fp on fp.id = t.from_user
            join profiles tp on tp.id = t.to_user);
end $$;

create or replace function public.mark_notifications_read() returns void
language plpgsql security definer set search_path = public as $$
begin
  update notifications set read = true where user_id = auth.uid() and not read;
end $$;

-- ───────── платежи (вызывается edge-функциями) ─────────
create or replace function public.create_order(p_pack int) returns jsonb
language plpgsql security definer set search_path = public as $$
declare p profiles; k nc_packs; o payment_orders;
begin
  p := _me();
  perform _rl(p.id, 'order', 5, 3600);
  perform _rl(p.id, 'order_day', 15, 86400);
  select * into k from nc_packs where id = p_pack and enabled;
  if not found then raise exception 'option_unavailable'; end if;
  insert into payment_orders(user_id, pack_id, nc_amount, amount_kop) values (p.id, k.id, k.nc_amount, k.price_kop) returning * into o;
  return jsonb_build_object('id', o.id, 'nc_amount', o.nc_amount, 'amount_kop', o.amount_kop);
end $$;

create or replace function public.credit_paid_order(p_order uuid, p_provider_payment_id text) returns boolean
language plpgsql security definer set search_path = public as $$
declare o payment_orders;
begin
  select * into o from payment_orders where id = p_order for update;
  if not found then raise exception 'not_found'; end if;
  if o.status = 'paid' then return false; end if;
  perform _wallet_apply(o.user_id, o.nc_amount, 'purchase', 'order', o.id::text, 'Покупка Nurcoin', null);
  update payment_orders set status = 'paid', paid_at = now(), provider_payment_id = coalesce(provider_payment_id, p_provider_payment_id) where id = o.id;
  perform _notify(o.user_id, 'Nurcoin пополнен', 'На баланс зачислено ' || o.nc_amount || ' NC.');
  return true;
end $$;
revoke execute on function public.credit_paid_order(uuid, text) from authenticated;

-- ───────── права субъекта персональных данных ─────────
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
    'reactions', (select coalesce(jsonb_agg(jsonb_build_object('message_id', r.message_id, 'emoji', r.emoji)), '[]') from reactions r where r.user_id = p.id),
    'ledger', (select coalesce(jsonb_agg(to_jsonb(l) - 'actor' order by l.id), '[]') from ledger l where l.user_id = p.id),
    'gifts', (select coalesce(jsonb_agg(to_jsonb(t) order by t.id), '[]') from gift_transfers t where t.from_user = p.id or t.to_user = p.id),
    'reports_made', (select coalesce(jsonb_agg(jsonb_build_object('category', r.category, 'status', r.status, 'created_at', r.created_at)), '[]') from reports r where r.reporter_id = p.id),
    'notifications', (select coalesce(jsonb_agg(jsonb_build_object('title', n.title, 'text', n.text, 'created_at', n.created_at)), '[]') from notifications n where n.user_id = p.id));
end $$;

-- Возвращает пути медиа, которые нужно удалить из Storage (делает edge-функция delete-account).
create or replace function public.delete_my_account() returns jsonb
language plpgsql security definer set search_path = public as $$
declare p profiles; paths jsonb; was_banned boolean;
begin
  p := _me(false);
  was_banned := p.status = 'banned';
  select coalesce(jsonb_agg(media_path), '[]') into paths from messages where user_id = p.id and media_path is not null;
  -- сохраняем копию только для сообщений, по которым есть нерассмотренные жалобы
  insert into message_archive(message_id, user_id, body, media_path, reason)
    select m.id, m.user_id, m.body, m.media_path, 'account_deleted_open_report' from messages m
     where m.user_id = p.id and exists (select 1 from reports r where r.message_id = m.id and r.status = 'new');
  update messages set body = '', media_path = null, status = 'deleted', status_reason = 'account_deleted', status_at = now()
   where user_id = p.id and status <> 'deleted';
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

-- ───────── права на вызов ─────────
grant execute on function
  public.get_me(), public.accept_consents(boolean), public.update_profile(text, text, boolean),
  public.get_profile(uuid), public.list_members(text, int),
  public.get_messages(bigint, int), public.get_top_messages(),
  public.send_message(text, bigint, text), public.toggle_reaction(bigint, text),
  public.report_message(bigint, text, text), public.report_user(uuid, text, text),
  public.boost_message(bigint, int), public.send_gift(uuid, int), public.my_gifts_history(),
  public.mark_notifications_read(), public.create_order(int),
  public.export_my_data(), public.delete_my_account()
to authenticated;
