-- Signup creates a personal org, sync columns advance, and RLS isolates users.
\set ON_ERROR_STOP 1
insert into auth.users values ('11111111-1111-1111-1111-111111111111', 'a@example.com');
insert into trips (id, org_id, user_id, title, start_date, end_date, base_currency)
  select '22222222-2222-2222-2222-222222222222', org_id, user_id, 'Tokyo', '2026-10-01', '2026-10-05', 'KRW'
  from org_members;
update trips set title = 'Tokyo 2';

do $$
begin
  if (select version from trips) <> 2 then raise exception 'version did not bump'; end if;
  if (select count(*) from export_presets where is_builtin) <> 2 then raise exception 'built-in presets missing'; end if;
end $$;

do $$
declare u uuid := '11111111-1111-1111-1111-111111111111';
begin
  if ocr_credit_consume(u, 2) <> 1 then raise exception 'first credit'; end if;
  if ocr_credit_consume(u, 2) <> 0 then raise exception 'second credit'; end if;
  if ocr_credit_consume(u, 2) <> -1 then raise exception 'credit limit not enforced'; end if;
  perform ocr_credit_refund(u);
  if ocr_credit_consume(u, 2) <> 0 then raise exception 'refund did not return a credit'; end if;
end $$;

grant usage on schema public to authenticated;
grant all on all tables in schema public to authenticated;
set role authenticated;

select set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', false);
do $$ begin if (select count(*) from trips) <> 1 then raise exception 'owner cannot see own trip'; end if; end $$;

select set_config('request.jwt.claim.sub', '99999999-9999-9999-9999-999999999999', false);
do $$ begin if (select count(*) from trips) <> 0 then raise exception 'RLS leak: other user sees trip'; end if; end $$;

do $$ begin
  perform ocr_credit_consume('11111111-1111-1111-1111-111111111111', 30);
  raise exception 'authenticated users must not spend credits directly';
exception when insufficient_privilege then null;
end $$;
