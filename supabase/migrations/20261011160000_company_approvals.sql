-- Company accounts: members join a company with an invite code, submit a trip
-- as a frozen snapshot, and approvers approve or reject it.

alter table organizations add column kind text not null default 'personal' check (kind in ('personal', 'company'));
alter table org_members add column email text;

create function is_org_approver(p_org uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from org_members
                 where org_id = p_org and user_id = auth.uid() and role in ('owner', 'admin', 'approver'));
$$;

-- ---------------------------------------------------------------------------
-- Companies and invites
-- ---------------------------------------------------------------------------

create table org_invites (
  code       text primary key,
  org_id     uuid not null references organizations(id) on delete cascade,
  created_by uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '14 days'
);
alter table org_invites enable row level security;
create policy org_invites_admin_read on org_invites for select using (is_org_admin(org_id));

create function require_account() returns uuid
language plpgsql stable security definer set search_path = public as $$
declare v_user uuid := auth.uid();
begin
  if v_user is null or coalesce((select is_anonymous from auth.users where id = v_user), true) then
    raise exception 'account required' using errcode = '42501';
  end if;
  return v_user;
end $$;

create function create_company(p_name text, p_currency text default 'KRW') returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_user uuid := require_account();
  v_org  uuid;
begin
  if length(trim(coalesce(p_name, ''))) = 0 then raise exception 'name required' using errcode = '22023'; end if;
  insert into organizations (name, home_currency, kind) values (trim(p_name), upper(p_currency), 'company') returning id into v_org;
  insert into org_members (org_id, user_id, role, email)
    values (v_org, v_user, 'owner', (select email from auth.users where id = v_user));
  return v_org;
end $$;

-- An 8-character code, easy to read out loud (no 0/O/1/I).
create function create_invite(p_org uuid) returns text
language plpgsql security definer set search_path = public as $$
declare
  v_user  uuid := require_account();
  v_code  text;
  v_chars text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
begin
  if not is_org_admin(p_org) then raise exception 'not an admin' using errcode = '42501'; end if;
  select string_agg(substr(v_chars, 1 + (get_byte(uuid_send(gen_random_uuid()), 0) % length(v_chars)), 1), '')
    into v_code from generate_series(1, 8);
  insert into org_invites (code, org_id, created_by) values (v_code, p_org, v_user);
  return v_code;
end $$;

create function join_company(p_code text) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_user uuid := require_account();
  v_org  uuid;
begin
  select org_id into v_org from org_invites
    where code = upper(replace(trim(p_code), '-', '')) and expires_at > now();
  if v_org is null then raise exception 'invalid code' using errcode = 'P0002'; end if;
  insert into org_members (org_id, user_id, role, email)
    values (v_org, v_user, 'member', (select email from auth.users where id = v_user))
    on conflict (org_id, user_id) do nothing;
  return v_org;
end $$;

-- Owners can't be demoted or removed here, so a company always keeps one.
create function set_member_role(p_org uuid, p_user uuid, p_role member_role) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not is_org_admin(p_org) then raise exception 'not an admin' using errcode = '42501'; end if;
  if p_role = 'owner' then raise exception 'cannot grant owner' using errcode = '22023'; end if;
  update org_members set role = p_role where org_id = p_org and user_id = p_user and role <> 'owner';
end $$;

create function remove_member(p_org uuid, p_user uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not (is_org_admin(p_org) or p_user = auth.uid()) then raise exception 'not an admin' using errcode = '42501'; end if;
  delete from org_members where org_id = p_org and user_id = p_user and role <> 'owner';
end $$;

-- ---------------------------------------------------------------------------
-- Submissions
-- ---------------------------------------------------------------------------

create table submissions (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references organizations(id) on delete cascade,
  user_id       uuid not null default auth.uid() references auth.users(id) on delete cascade,
  trip_id       text not null,
  title         text not null,
  period        text not null,
  base_currency char(3) not null,
  total         numeric(20, 4) not null,
  item_count    int not null,
  flagged_count int not null default 0,
  -- Trip, expenses, custom field names and rule notes as they were when submitted.
  snapshot      jsonb not null check (pg_column_size(snapshot) < 5000000),
  status        text not null default 'submitted' check (status in ('submitted', 'approved', 'rejected')),
  submitted_at  timestamptz not null default now(),
  submitter     text,
  decided_by    uuid references auth.users(id) on delete set null,
  decider       text,
  decided_at    timestamptz,
  comment       text
);
create index submissions_org_idx on submissions (org_id, submitted_at desc);
create index submissions_user_idx on submissions (user_id, trip_id, submitted_at desc);
alter table submissions enable row level security;

create policy submissions_read on submissions for select
  using (user_id = auth.uid() or is_org_approver(org_id));
create policy submissions_insert on submissions for insert to authenticated
  with check (user_id = auth.uid() and is_org_member(org_id) and status = 'submitted'
              and decided_by is null and decided_at is null and comment is null);
-- Decisions go through decide_submission only.

create function stamp_submitter() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  new.submitter := (select email from auth.users where id = new.user_id);
  new.submitted_at := now();
  return new;
end $$;
create trigger submissions_stamp before insert on submissions for each row execute function stamp_submitter();

create function decide_submission(p_id uuid, p_approve boolean, p_comment text default null) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_user uuid := require_account();
  v_org  uuid;
begin
  select org_id into v_org from submissions where id = p_id and status = 'submitted';
  if v_org is null then raise exception 'not waiting for a decision' using errcode = 'P0002'; end if;
  if not is_org_approver(v_org) then raise exception 'not an approver' using errcode = '42501'; end if;
  update submissions
     set status = case when p_approve then 'approved' else 'rejected' end,
         decided_by = v_user,
         decider = (select email from auth.users where id = v_user),
         decided_at = now(),
         comment = nullif(trim(coalesce(p_comment, '')), '')
   where id = p_id;
end $$;

-- Receipt photos copied at submit time, so approvers see exactly what was sent.
create table submission_files (
  submission_id uuid not null references submissions(id) on delete cascade,
  receipt_id    text not null,
  uri           text not null check (length(uri) < 4000000),
  primary key (submission_id, receipt_id)
);
alter table submission_files enable row level security;
create policy submission_files_read on submission_files for select
  using (exists (select 1 from submissions s where s.id = submission_id
                 and (s.user_id = auth.uid() or is_org_approver(s.org_id))));
create policy submission_files_insert on submission_files for insert to authenticated
  with check (exists (select 1 from submissions s where s.id = submission_id
                      and s.user_id = auth.uid() and s.status = 'submitted'));

-- Companies the caller belongs to, with their role; personal organizations are left out.
create function my_companies() returns table (id uuid, name text, home_currency text, role member_role)
language sql stable security definer set search_path = public as $$
  select o.id, o.name, o.home_currency::text, m.role
    from org_members m join organizations o on o.id = m.org_id
   where m.user_id = auth.uid() and o.kind = 'company'
   order by o.created_at;
$$;
