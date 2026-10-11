-- The company policy (default budget and daily allowance) syncs as its own record kind.
alter table sync_records drop constraint sync_records_kind_check;
alter table sync_records add constraint sync_records_kind_check
  check (kind in ('trip', 'expense', 'rule', 'field', 'preset', 'template', 'policy', 'receipt', 'templateFile'));
