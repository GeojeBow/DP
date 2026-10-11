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

-- Company flow: create, invite, join, submit, approve; members can't decide, outsiders can't see.
reset role;
insert into auth.users (id, email) values
  ('33333333-3333-3333-3333-333333333333', 'boss@example.com'),
  ('44444444-4444-4444-4444-444444444444', 'staff@example.com');
insert into auth.users (id, email, is_anonymous) values ('55555555-5555-5555-5555-555555555555', null, true);
set role authenticated;

select set_config('request.jwt.claim.sub', '33333333-3333-3333-3333-333333333333', false);
create temp table t_company as select create_company('Acme', 'krw') as org;
create temp table t_invite as select create_invite((select org from t_company)) as code;
do $$ begin
  if (select count(*) from my_companies()) <> 1 then raise exception 'owner should see one company'; end if;
  if length((select code from t_invite)) <> 8 then raise exception 'invite code length'; end if;
end $$;

select set_config('request.jwt.claim.sub', '55555555-5555-5555-5555-555555555555', false);
do $$ begin
  perform join_company((select code from t_invite));
  raise exception 'guests must not join a company';
exception when insufficient_privilege then null;
end $$;

select set_config('request.jwt.claim.sub', '44444444-4444-4444-4444-444444444444', false);
do $$ begin
  perform join_company(lower((select code from t_invite)));
  if (select role from my_companies()) <> 'member' then raise exception 'joined as member'; end if;
end $$;
insert into submissions (org_id, trip_id, title, period, base_currency, total, item_count, snapshot)
  select org, 't1', 'Tokyo', '2026-10-01 ~ 2026-10-03', 'KRW', 42864, 3, '{"expenses":[]}' from t_company;
insert into submission_files (submission_id, receipt_id, uri) select id, 'r1', 'data:image/jpeg;base64,AA' from submissions;
do $$ begin
  if (select submitter from submissions) <> 'staff@example.com' then raise exception 'submitter not stamped'; end if;
  perform decide_submission((select id from submissions), true);
  raise exception 'members must not approve';
exception when insufficient_privilege then null;
end $$;
do $$ begin
  update submissions set status = 'approved';
  if (select status from submissions) <> 'submitted' then raise exception 'submitter changed status directly'; end if;
end $$;

select set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', false);
do $$ begin
  if (select count(*) from submissions) <> 0 or (select count(*) from submission_files) <> 0 then
    raise exception 'RLS leak: outsider sees a submission';
  end if;
end $$;

select set_config('request.jwt.claim.sub', '33333333-3333-3333-3333-333333333333', false);
do $$ begin
  if (select count(*) from submission_files) <> 1 then raise exception 'approver cannot see receipts'; end if;
  perform decide_submission((select id from submissions), false, '  영수증 누락  ');
  if (select status || '/' || comment || '/' || decider from submissions) <> 'rejected/영수증 누락/boss@example.com' then
    raise exception 'decision not recorded';
  end if;
  perform decide_submission((select id from submissions), true);
  raise exception 'a decided submission must not be decided again';
exception when no_data_found then null;
end $$;
