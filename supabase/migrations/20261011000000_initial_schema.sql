-- Initial schema for Global Trip & Expense Manager.
-- Every synced table is scoped by org_id and carries version / server_seq / deleted_at
-- so clients can push with optimistic concurrency and pull deltas by cursor.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------

create type member_role      as enum ('owner', 'admin', 'approver', 'member');
create type trip_status      as enum ('planned', 'active', 'completed', 'submitted', 'approved', 'reimbursed', 'archived');
create type expense_status   as enum ('draft', 'processing', 'needs_review', 'confirmed', 'submitted', 'approved', 'rejected');
create type expense_category as enum ('airfare', 'lodging', 'meals', 'ground_transport', 'car_rental', 'fuel', 'parking',
                                      'communication', 'entertainment', 'office_supplies', 'fees', 'other');
create type payment_method   as enum ('corporate_card', 'personal_card', 'cash', 'bank_transfer', 'mobile_pay', 'other');
create type fx_source        as enum ('auto_daily', 'cached_estimate', 'manual_card_rate', 'manual_other');
create type ocr_status       as enum ('local_only', 'uploaded', 'processing', 'parsed', 'failed', 'not_receipt');
create type policy_rule_type as enum ('daily_cap', 'per_item_cap', 'nightly_cap', 'prohibited_category', 'prohibited_keyword',
                                      'receipt_required_over', 'pre_approval_over', 'weekend_flag');
create type policy_action    as enum ('warn', 'block', 'require_justification');
create type export_format    as enum ('pdf', 'xlsx', 'csv');

-- Global sync cursor shared by all synced tables.
create sequence sync_seq;

-- ---------------------------------------------------------------------------
-- Tenancy
-- ---------------------------------------------------------------------------

create table organizations (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  home_currency char(3) not null default 'KRW',
  plan          text not null default 'free',
  created_at    timestamptz not null default now()
);

create table org_members (
  org_id     uuid not null references organizations(id) on delete cascade,
  user_id    uuid not null references auth.users(id) on delete cascade,
  role       member_role not null default 'member',
  created_at timestamptz not null default now(),
  primary key (org_id, user_id)
);
create index org_members_user_idx on org_members (user_id);

create function is_org_member(p_org uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from org_members where org_id = p_org and user_id = auth.uid());
$$;

create function is_org_admin(p_org uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from org_members
                 where org_id = p_org and user_id = auth.uid() and role in ('owner', 'admin'));
$$;

-- Every signup gets a personal one-member organization, so B2C and B2B share one model.
create function handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_org uuid;
begin
  insert into organizations (name) values (coalesce(new.email, 'Personal')) returning id into v_org;
  insert into org_members (org_id, user_id, role) values (v_org, new.id, 'owner');
  return new;
end $$;

create trigger on_auth_user_created
  after insert on auth.users for each row execute function handle_new_user();

-- Bumps version on update and stamps a fresh sync cursor on every write.
create function touch_sync_columns() returns trigger language plpgsql as $$
begin
  if tg_op = 'UPDATE' then
    new.version := old.version + 1;
  end if;
  new.server_seq := nextval('sync_seq');
  new.updated_at := now();
  return new;
end $$;

-- ---------------------------------------------------------------------------
-- Reference data
-- ---------------------------------------------------------------------------

create table fx_rates (
  rate_date date          not null,
  base      char(3)       not null,
  quote     char(3)       not null,
  rate      numeric(18,8) not null check (rate > 0),
  provider  text          not null,
  primary key (rate_date, base, quote)
);

-- ---------------------------------------------------------------------------
-- policies
-- ---------------------------------------------------------------------------

create table policies (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references organizations(id) on delete cascade,
  name        text not null,
  is_default  boolean not null default false,
  currency    char(3) not null,
  version     int not null default 1,
  server_seq  bigint not null default nextval('sync_seq'),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  deleted_at  timestamptz
);
create unique index policies_one_default on policies (org_id) where is_default and deleted_at is null;
create index policies_seq_idx on policies (org_id, server_seq);

create table policy_rules (
  id          uuid primary key default gen_random_uuid(),
  policy_id   uuid not null references policies(id) on delete cascade,
  org_id      uuid not null references organizations(id) on delete cascade,
  rule_type   policy_rule_type not null,
  category    expense_category,          -- null = every category
  region      text,                      -- null = worldwide; 'JP', 'US-NY', ...
  params      jsonb not null,
  action      policy_action not null default 'warn',
  message     text not null,
  sort_order  int not null default 0,
  version     int not null default 1,
  server_seq  bigint not null default nextval('sync_seq'),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  deleted_at  timestamptz
);
create index policy_rules_policy_idx on policy_rules (policy_id) where deleted_at is null;
create index policy_rules_seq_idx on policy_rules (org_id, server_seq);

-- ---------------------------------------------------------------------------
-- trips
-- ---------------------------------------------------------------------------

create table trips (
  id                 uuid primary key,            -- client-generated UUIDv7
  org_id             uuid not null references organizations(id) on delete cascade,
  user_id            uuid not null references auth.users(id),
  title              text not null check (char_length(title) between 1 and 120),
  purpose            text,
  destinations       jsonb not null default '[]', -- [{"city":"Tokyo","country":"JP"}]
  start_date         date not null,
  end_date           date not null,
  base_currency      char(3) not null,
  budget_total       numeric(14,2) check (budget_total >= 0),
  budget_by_category jsonb not null default '{}',
  policy_id          uuid references policies(id),
  status             trip_status not null default 'planned',
  custom_values      jsonb not null default '{}',
  submitted_at       timestamptz,
  version            int not null default 1,
  server_seq         bigint not null default nextval('sync_seq'),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  deleted_at         timestamptz,
  check (end_date >= start_date)
);
create index trips_org_user_idx on trips (org_id, user_id, start_date desc) where deleted_at is null;
create index trips_seq_idx      on trips (org_id, server_seq);

-- ---------------------------------------------------------------------------
-- expenses
-- ---------------------------------------------------------------------------

create table expenses (
  id                uuid primary key,
  org_id            uuid not null references organizations(id) on delete cascade,
  user_id           uuid not null references auth.users(id),
  trip_id           uuid references trips(id) on delete set null,
  status            expense_status not null default 'draft',
  spent_at          timestamptz not null,
  local_date        date not null,               -- date at the merchant; daily caps use this
  merchant_name     text,
  merchant_country  char(2),
  category          expense_category not null default 'other',
  description       text,
  currency          char(3) not null,
  subtotal          numeric(14,2),
  tax               numeric(14,2) not null default 0,
  tip               numeric(14,2) not null default 0,
  total             numeric(14,2) not null check (total >= 0),
  fx_rate           numeric(18,8) not null default 1 check (fx_rate > 0),  -- 1 currency = fx_rate base
  fx_source         fx_source not null default 'auto_daily',
  fx_rate_date      date,
  total_base        numeric(14,2) not null,       -- amount used in reports
  market_total_base numeric(14,2),                -- market-rate conversion, for FX delta analytics
  payment_method    payment_method not null default 'corporate_card',
  card_last4        char(4) check (card_last4 ~ '^[0-9]{4}$'),
  is_reimbursable   boolean not null default true,
  attendees         jsonb not null default '[]',
  custom_values     jsonb not null default '{}',
  field_sources     jsonb not null default '{}',  -- {"total":"ai","category":"user"}
  policy_flags      jsonb not null default '[]',
  justification     text,
  duplicate_of      uuid references expenses(id),
  version           int not null default 1,
  server_seq        bigint not null default nextval('sync_seq'),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  deleted_at        timestamptz,
  check (subtotal is null or subtotal + tax + tip <= total + 0.05)
);
create index expenses_trip_idx   on expenses (trip_id, local_date) where deleted_at is null;
create index expenses_user_idx   on expenses (org_id, user_id, spent_at desc) where deleted_at is null;
create index expenses_seq_idx    on expenses (org_id, server_seq);
create index expenses_dupe_idx   on expenses (org_id, user_id, local_date, total, currency);
create index expenses_custom_gin on expenses using gin (custom_values jsonb_path_ops);

-- ---------------------------------------------------------------------------
-- receipt_assets + expense_receipts (N:M)
-- ---------------------------------------------------------------------------

create table receipt_assets (
  id            uuid primary key,
  org_id        uuid not null references organizations(id) on delete cascade,
  user_id       uuid not null references auth.users(id),
  trip_id       uuid references trips(id) on delete set null,
  storage_path  text unique,                     -- receipts/{org}/{user}/{id}.jpg, null until uploaded
  mime_type     text not null default 'image/jpeg',
  byte_size     int,
  width         int,
  height        int,
  sha256        char(64) not null,
  source        text not null check (source in ('camera', 'gallery', 'card_statement', 'email', 'pdf')),
  captured_at   timestamptz not null,
  ocr_status    ocr_status not null default 'local_only',
  ocr_model     text,
  ocr_raw       jsonb,
  ocr_parsed    jsonb,
  ocr_error     text,
  ocr_attempts  smallint not null default 0,
  report_seq    int,                             -- appendix number in reports (#1, #2, ...)
  version       int not null default 1,
  server_seq    bigint not null default nextval('sync_seq'),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  deleted_at    timestamptz,
  unique (org_id, user_id, sha256)
);
create index receipt_assets_seq_idx on receipt_assets (org_id, server_seq);
create index receipt_assets_ocr_idx on receipt_assets (ocr_status) where ocr_status in ('uploaded', 'failed');

-- One card statement can yield many expenses; one expense can have a receipt plus a card slip.
create table expense_receipts (
  expense_id        uuid not null references expenses(id) on delete cascade,
  asset_id          uuid not null references receipt_assets(id) on delete cascade,
  org_id            uuid not null references organizations(id) on delete cascade,
  transaction_index smallint not null default 0,  -- which transaction on a multi-transaction image
  bbox              jsonb,
  created_at        timestamptz not null default now(),
  primary key (expense_id, asset_id, transaction_index)
);
create index expense_receipts_asset_idx on expense_receipts (asset_id);

-- ---------------------------------------------------------------------------
-- custom_fields
-- ---------------------------------------------------------------------------

create table custom_fields (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references organizations(id) on delete cascade,
  scope       text not null check (scope in ('trip', 'expense')),
  key         text not null check (key ~ '^[a-z][a-z0-9_]{1,39}$'),
  label       jsonb not null,                    -- {"ko":"프로젝트 코드","en":"Project code"}
  definition  jsonb not null,                    -- validated by the shared Zod schema
  is_required boolean not null default false,
  sort_order  int not null default 0,
  is_active   boolean not null default true,
  version     int not null default 1,
  server_seq  bigint not null default nextval('sync_seq'),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  deleted_at  timestamptz,
  unique (org_id, scope, key)
);
create index custom_fields_seq_idx on custom_fields (org_id, server_seq);

-- ---------------------------------------------------------------------------
-- export_presets + export_jobs
-- ---------------------------------------------------------------------------

create table export_presets (
  id                  uuid primary key default gen_random_uuid(),
  org_id              uuid references organizations(id) on delete cascade,  -- null = built-in
  name                text not null,
  format              export_format not null,
  is_builtin          boolean not null default false,
  template_key        text,
  config              jsonb not null,
  template_asset_path text,
  ai_mapping          jsonb,
  version             int not null default 1,
  server_seq          bigint not null default nextval('sync_seq'),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  deleted_at          timestamptz,
  check (is_builtin = (org_id is null))
);
create index export_presets_seq_idx on export_presets (org_id, server_seq);

create table export_jobs (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references organizations(id) on delete cascade,
  user_id       uuid not null references auth.users(id),
  trip_id       uuid not null references trips(id) on delete cascade,
  preset_id     uuid not null references export_presets(id),
  status        text not null default 'queued' check (status in ('queued', 'rendering', 'done', 'failed')),
  output_path   text,
  snapshot_hash char(64),
  error         text,
  created_at    timestamptz not null default now(),
  finished_at   timestamptz
);
create index export_jobs_trip_idx on export_jobs (trip_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Sync triggers
-- ---------------------------------------------------------------------------

create trigger policies_sync       before insert or update on policies       for each row execute function touch_sync_columns();
create trigger policy_rules_sync   before insert or update on policy_rules   for each row execute function touch_sync_columns();
create trigger trips_sync          before insert or update on trips          for each row execute function touch_sync_columns();
create trigger expenses_sync       before insert or update on expenses       for each row execute function touch_sync_columns();
create trigger receipt_assets_sync before insert or update on receipt_assets for each row execute function touch_sync_columns();
create trigger custom_fields_sync  before insert or update on custom_fields  for each row execute function touch_sync_columns();
create trigger export_presets_sync before insert or update on export_presets for each row execute function touch_sync_columns();

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------

alter table organizations    enable row level security;
alter table org_members      enable row level security;
alter table fx_rates         enable row level security;
alter table policies         enable row level security;
alter table policy_rules     enable row level security;
alter table trips            enable row level security;
alter table expenses         enable row level security;
alter table receipt_assets   enable row level security;
alter table expense_receipts enable row level security;
alter table custom_fields    enable row level security;
alter table export_presets   enable row level security;
alter table export_jobs      enable row level security;

create policy organizations_member_read on organizations for select using (is_org_member(id));
create policy organizations_admin_update on organizations for update
  using (is_org_admin(id)) with check (is_org_admin(id));

create policy org_members_read on org_members for select using (is_org_member(org_id));
create policy org_members_admin_write on org_members for all
  using (is_org_admin(org_id)) with check (is_org_admin(org_id));

-- Exchange rates are written by the fx-refresh Edge Function with the service role.
create policy fx_rates_read on fx_rates for select to authenticated using (true);

-- Org settings: members read, admins write.
create policy policies_read on policies for select using (is_org_member(org_id));
create policy policies_write on policies for all
  using (is_org_admin(org_id)) with check (is_org_admin(org_id));
create policy policy_rules_read on policy_rules for select using (is_org_member(org_id));
create policy policy_rules_write on policy_rules for all
  using (is_org_admin(org_id)) with check (is_org_admin(org_id));
create policy custom_fields_read on custom_fields for select using (is_org_member(org_id));
create policy custom_fields_write on custom_fields for all
  using (is_org_admin(org_id)) with check (is_org_admin(org_id));
create policy export_presets_read on export_presets for select
  using (org_id is null or is_org_member(org_id));
create policy export_presets_write on export_presets for all
  using (org_id is not null and is_org_admin(org_id))
  with check (org_id is not null and is_org_admin(org_id));

-- Personal data: owner reads/writes, org admins read.
create policy trips_owner_rw on trips for all
  using (user_id = auth.uid() and is_org_member(org_id))
  with check (user_id = auth.uid() and is_org_member(org_id));
create policy trips_admin_read on trips for select using (is_org_admin(org_id));

-- Submitted or approved expenses are locked for the owner.
create policy expenses_owner_read on expenses for select
  using (user_id = auth.uid() and is_org_member(org_id));
create policy expenses_owner_insert on expenses for insert
  with check (user_id = auth.uid() and is_org_member(org_id) and status not in ('submitted', 'approved'));
create policy expenses_owner_update on expenses for update
  using (user_id = auth.uid() and is_org_member(org_id) and status not in ('submitted', 'approved'))
  with check (user_id = auth.uid() and is_org_member(org_id) and status not in ('approved'));
create policy expenses_admin_read on expenses for select using (is_org_admin(org_id));

create policy receipt_assets_owner_rw on receipt_assets for all
  using (user_id = auth.uid() and is_org_member(org_id))
  with check (user_id = auth.uid() and is_org_member(org_id));
create policy receipt_assets_admin_read on receipt_assets for select using (is_org_admin(org_id));

create policy expense_receipts_owner_rw on expense_receipts for all
  using (exists (select 1 from expenses e where e.id = expense_id and e.user_id = auth.uid()))
  with check (exists (select 1 from expenses e where e.id = expense_id and e.user_id = auth.uid())
              and exists (select 1 from receipt_assets a where a.id = asset_id and a.user_id = auth.uid()));
create policy expense_receipts_admin_read on expense_receipts for select using (is_org_admin(org_id));

create policy export_jobs_owner_rw on export_jobs for all
  using (user_id = auth.uid() and is_org_member(org_id))
  with check (user_id = auth.uid() and is_org_member(org_id));

-- ---------------------------------------------------------------------------
-- Storage: private buckets, path = {org_id}/{user_id}/{file}
-- ---------------------------------------------------------------------------

insert into storage.buckets (id, name, public) values ('receipts', 'receipts', false) on conflict (id) do nothing;
insert into storage.buckets (id, name, public) values ('exports', 'exports', false) on conflict (id) do nothing;

create policy receipts_owner_rw on storage.objects for all to authenticated
  using (bucket_id in ('receipts', 'exports')
         and (storage.foldername(name))[2] = auth.uid()::text
         and is_org_member(((storage.foldername(name))[1])::uuid))
  with check (bucket_id in ('receipts', 'exports')
              and (storage.foldername(name))[2] = auth.uid()::text
              and is_org_member(((storage.foldername(name))[1])::uuid));
