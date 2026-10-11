-- Monthly receipt-reading allowance (free plan: 30 per month). Only the
-- parse-receipt Edge Function (service_role) may spend or refund credits, so a
-- client cannot reset its own counter.

create table ocr_usage (
  user_id    uuid not null references auth.users(id) on delete cascade,
  month      date not null,                       -- first day of the month, UTC
  used       int  not null default 0 check (used >= 0),
  updated_at timestamptz not null default now(),
  primary key (user_id, month)
);
alter table ocr_usage enable row level security;
create policy ocr_usage_read_own on ocr_usage for select using (user_id = auth.uid());

-- Spends one credit; returns credits left, or -1 when the allowance is used up.
create function ocr_credit_consume(p_user uuid, p_limit int) returns int
language plpgsql security definer set search_path = public as $$
declare
  v_month date := date_trunc('month', now() at time zone 'utc')::date;
  v_used  int;
begin
  insert into ocr_usage (user_id, month, used) values (p_user, v_month, 1)
  on conflict (user_id, month) do update
    set used = ocr_usage.used + 1, updated_at = now()
    where ocr_usage.used < p_limit
  returning used into v_used;
  if v_used is null then return -1; end if;
  return p_limit - v_used;
end $$;

-- Gives back a credit when reading failed for reasons that aren't the user's.
create function ocr_credit_refund(p_user uuid) returns void
language sql security definer set search_path = public as $$
  update ocr_usage set used = used - 1, updated_at = now()
  where user_id = p_user and month = date_trunc('month', now() at time zone 'utc')::date and used > 0
$$;

revoke all on function ocr_credit_consume(uuid, int) from public;
revoke all on function ocr_credit_refund(uuid) from public;
grant execute on function ocr_credit_consume(uuid, int) to service_role;
grant execute on function ocr_credit_refund(uuid) to service_role;
