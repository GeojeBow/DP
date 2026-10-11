-- Personal sync: each device keeps its data locally and mirrors it here, one
-- row per record. The device pushes changed rows and pulls rows whose
-- server-side updated_at is newer than its last pull.

create table sync_records (
  user_id           uuid not null default auth.uid() references auth.users(id) on delete cascade,
  kind              text not null check (kind in ('trip', 'expense', 'rule', 'field', 'preset', 'template', 'receipt', 'templateFile')),
  id                text not null check (length(id) between 1 and 100),
  data              jsonb check (data is null or pg_column_size(data) < 3000000),
  deleted           boolean not null default false,
  client_updated_at timestamptz not null,
  updated_at        timestamptz not null default clock_timestamp(),
  primary key (user_id, kind, id)
);
create index sync_records_pull on sync_records (user_id, updated_at);

alter table sync_records enable row level security;
create policy sync_records_owner on sync_records for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Server clock decides pull order, whatever the device sent.
create function sync_records_touch() returns trigger language plpgsql as $$
begin
  new.updated_at := clock_timestamp();
  return new;
end $$;
create trigger sync_records_touch before insert or update on sync_records
  for each row execute function sync_records_touch();
