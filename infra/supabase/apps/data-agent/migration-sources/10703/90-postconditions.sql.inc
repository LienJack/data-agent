create table app_data_agent.commercial_archive_retirement_receipts (
  migration_version text primary key,
  relation_snapshots jsonb not null check (
    pg_catalog.jsonb_typeof(relation_snapshots) = 'object'
  ),
  retired_at timestamptz not null default pg_catalog.clock_timestamp()
);

insert into app_data_agent.commercial_archive_retirement_receipts (
  migration_version,
  relation_snapshots
)
select
  '20260725010703_app_data_agent_commercial_archive_retirement',
  pg_catalog.jsonb_object_agg(
    relation_name,
    pg_catalog.jsonb_build_object('row_count', row_count, 'row_digest', row_digest)
    order by relation_name
  )
from commercial_archive_before;

create trigger commercial_archive_retirement_receipts_immutable
before insert or update or delete on app_data_agent.commercial_archive_retirement_receipts
for each row execute function app_data_agent.reject_commercial_archive_mutation();

alter table app_data_agent.commercial_archive_retirement_receipts
  owner to data_agent_identity_rpc_owner;
revoke all on table app_data_agent.commercial_archive_retirement_receipts
from public, anon, authenticated, service_role, data_agent_backend;

do $postconditions$
declare
  relation_name text;
  before_count bigint;
  before_digest text;
  after_count bigint;
  after_digest text;
  target regprocedure;
  definition text;
  status_constraint text;
begin
  for relation_name, before_count, before_digest in
    select snapshot.relation_name, snapshot.row_count, snapshot.row_digest
    from commercial_archive_before as snapshot
    order by snapshot.relation_name
  loop
    execute pg_catalog.format(
      'select pg_catalog.count(*), pg_catalog.md5(coalesce(pg_catalog.string_agg(pg_catalog.to_jsonb(archived_row)::text, E''\\n'' order by pg_catalog.to_jsonb(archived_row)::text), '''')) from app_data_agent.%I as archived_row',
      relation_name
    ) into after_count, after_digest;
    if after_count <> before_count or after_digest <> before_digest then
      raise exception using
        errcode = 'P0001',
        message = 'COMMERCIAL_ARCHIVE_HISTORY_CHANGED';
    end if;
    if pg_catalog.has_table_privilege(
      'data_agent_backend',
      pg_catalog.format('app_data_agent.%I', relation_name),
      'INSERT,UPDATE,DELETE'
    ) then
      raise exception using
        errcode = 'P0001',
        message = 'COMMERCIAL_ARCHIVE_BACKEND_WRITE_GRANT_REMAINS';
    end if;
    if not exists (
      select 1
      from pg_catalog.pg_trigger as trigger
      join pg_catalog.pg_class as relation on relation.oid = trigger.tgrelid
      join pg_catalog.pg_namespace as namespace on namespace.oid = relation.relnamespace
      where namespace.nspname = 'app_data_agent'
        and relation.relname = relation_name
        and trigger.tgname = relation_name || '_archive_read_only'
        and not trigger.tgisinternal
    ) then
      raise exception using
        errcode = 'P0001',
        message = 'COMMERCIAL_ARCHIVE_READ_ONLY_TRIGGER_MISSING';
    end if;
  end loop;

  foreach target in array array[
    'app_data_agent.apply_model_catalog_command(uuid,uuid,jsonb)'::regprocedure,
    'app_data_agent.apply_model_provider_connection_command(uuid,uuid,jsonb)'::regprocedure,
    'app_data_agent.apply_model_provider_selection(uuid,uuid,jsonb)'::regprocedure,
    'platform.list_active_model_catalog(uuid,uuid)'::regprocedure,
    'platform.sync_environment_model_catalog(uuid,uuid,jsonb)'::regprocedure,
    'platform.sync_environment_model_catalog_unlocked(uuid,uuid,jsonb)'::regprocedure,
    'platform.record_model_api_authentication(uuid,uuid,jsonb)'::regprocedure,
    'platform.read_operations_health(uuid,uuid)'::regprocedure
  ] loop
    definition := pg_catalog.lower(pg_catalog.pg_get_functiondef(target));
    if definition like '%billing%'
      or definition like '%pricing%'
      or definition like '%credit_%'
      or definition like '%model_price%'
      or definition like '%fx_rate%'
      or definition like '%unbillable%'
    then
      raise exception using
        errcode = 'P0001',
        message = 'MODEL_CONTROL_COMMERCIAL_DEPENDENCY_REMAINS';
    end if;
  end loop;

  select pg_catalog.pg_get_constraintdef(constraint_record.oid)
  into strict status_constraint
  from pg_catalog.pg_constraint as constraint_record
  join pg_catalog.pg_class as relation on relation.oid = constraint_record.conrelid
  join pg_catalog.pg_namespace as namespace on namespace.oid = relation.relnamespace
  where namespace.nspname = 'app_data_agent'
    and relation.relname = 'model_catalog_entries'
    and constraint_record.conname = 'model_catalog_entries_status_check';
  if pg_catalog.lower(status_constraint) like '%unbillable%'
    or status_constraint not like '%DRAFT%ACTIVE%DISABLED%'
  then
    raise exception using
      errcode = 'P0001',
      message = 'MODEL_CATALOG_STATUS_CONSTRAINT_NOT_RETIRED';
  end if;

  if pg_catalog.to_regprocedure('app_data_agent.authorize_model_billing(uuid,uuid,jsonb)') is not null
    or pg_catalog.to_regprocedure('app_data_agent.apply_credit_adjustment(uuid,uuid,jsonb)') is not null
    or pg_catalog.to_regprocedure('app_data_agent.submit_pricing_sync(uuid,uuid,jsonb)') is not null
    or pg_catalog.to_regprocedure('platform.get_billing_runtime_state(uuid,uuid)') is not null
    or pg_catalog.to_regprocedure('platform.list_credit_accounts(uuid,uuid)') is not null
    or pg_catalog.to_regprocedure('platform.list_model_price_candidates(uuid,uuid)') is not null
  then
    raise exception using
      errcode = 'P0001',
      message = 'COMMERCIAL_ARCHIVE_RPC_REMAINS';
  end if;
end
$postconditions$;
