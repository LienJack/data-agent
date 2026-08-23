begin;

do $bootstrap$
begin
  if pg_catalog.current_setting('server_version_num')::integer not between 170000 and 179999 then
    raise exception using
      errcode = '0A000',
      message = 'COMMERCIAL_ARCHIVE_RETIREMENT_POSTGRES_VERSION_UNSUPPORTED';
  end if;
  if session_user <> 'postgres' or current_user <> 'postgres' then
    raise exception using
      errcode = '42501',
      message = 'COMMERCIAL_ARCHIVE_RETIREMENT_EXECUTOR_UNSAFE';
  end if;
  if not exists (
    select 1
    from platform.migration_ledger
    where owner_kind = 'app'
      and app_id = '00000000-0000-4000-8000-00000000da01'::uuid
      and migration_version = '20260725010702_app_data_agent_semantic_explorer_projection_reuse_repair'
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'COMMERCIAL_ARCHIVE_RETIREMENT_BASELINE_10702_MISSING';
  end if;
end
$bootstrap$;

set local lock_timeout = '2000ms';
set local statement_timeout = '300000ms';
set local idle_in_transaction_session_timeout = '60000ms';

select platform.acquire_migration_lock(
  'app',
  '00000000-0000-4000-8000-00000000da01'::uuid
);

create temporary table commercial_archive_before (
  relation_name text primary key,
  row_count bigint not null,
  row_digest text not null
) on commit drop;

do $snapshot$
declare
  relation_name text;
  observed_count bigint;
  observed_digest text;
begin
  foreach relation_name in array array[
    'pricing_control_state','pricing_sync_operations','model_price_candidates',
    'model_price_candidate_components','model_price_versions','model_price_components',
    'fx_rate_candidates','fx_rate_versions','pricing_control_operations','pricing_audit_log',
    'credit_accounts','credit_ledger_entries','credit_holds','credit_hold_events',
    'billing_operations','billing_audit_log','billing_runtime_state','model_bills',
    'model_bill_price_components','model_bill_events','model_billing_operations',
    'billing_reconciliation_findings'
  ] loop
    execute pg_catalog.format(
      'select pg_catalog.count(*), pg_catalog.md5(coalesce(pg_catalog.string_agg(pg_catalog.to_jsonb(archived_row)::text, E''\\n'' order by pg_catalog.to_jsonb(archived_row)::text), '''')) from app_data_agent.%I as archived_row',
      relation_name
    ) into observed_count, observed_digest;
    insert into commercial_archive_before values (
      relation_name,
      observed_count,
      observed_digest
    );
  end loop;
end
$snapshot$;
