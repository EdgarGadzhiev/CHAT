-- Мелкая уборка после проверки advisors: дубль индекса, индекс под FK, фиксированный search_path у триггерных функций.
drop index if exists public.notifications_user_created_idx;
create index if not exists payment_orders_pack_idx on public.payment_orders (pack_id) where pack_id is not null;
alter function public._deny_mutation() set search_path = '';
alter function public._messages_bump() set search_path = '';
