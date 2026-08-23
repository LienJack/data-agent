-- commercial_archive_retirement_migration_checksum: sha256:5358dc4a6ad3b6bd0637a1350b1a6671b59b1a937e45f6525fbde51126c2d947
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
create table app_data_agent.model_control_operations (
  app_id uuid not null,
  environment text not null,
  operation_id uuid not null,
  actor_principal_id uuid not null,
  idempotency_key text not null check (pg_catalog.length(idempotency_key) between 8 and 128),
  operation_kind text not null check (operation_kind in (
    'UPSERT_MODEL','SET_MODEL_STATUS','UPSERT_PROVIDER','ARCHIVE_PROVIDER','SELECT_PROVIDER_MODELS'
  )),
  input_hash text not null check (input_hash ~ '^sha256:[0-9a-f]{64}$'),
  result_payload jsonb not null check (pg_catalog.jsonb_typeof(result_payload) = 'object'),
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  primary key (app_id, environment, actor_principal_id, idempotency_key),
  unique (app_id, environment, operation_id)
);

create table app_data_agent.model_control_audit_log (
  app_id uuid not null,
  environment text not null,
  audit_id uuid not null default pg_catalog.gen_random_uuid(),
  operation_id uuid not null,
  actor_principal_id uuid not null,
  action text not null,
  resource_type text not null,
  resource_id text not null,
  reason text not null,
  details jsonb not null check (pg_catalog.jsonb_typeof(details) = 'object'),
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  primary key (app_id, environment, audit_id),
  foreign key (app_id, environment, operation_id)
    references app_data_agent.model_control_operations (app_id, environment, operation_id)
    on delete restrict
);

create function app_data_agent.reject_model_control_history_mutation()
returns trigger language plpgsql volatile set search_path = '' as $function$
begin
  raise exception using errcode = '55000', message = 'MODEL_CONTROL_HISTORY_IMMUTABLE';
end
$function$;

drop trigger model_config_versions_immutable on app_data_agent.model_config_versions;
create trigger model_config_versions_immutable
before update or delete on app_data_agent.model_config_versions
for each row execute function app_data_agent.reject_model_control_history_mutation();

drop trigger model_provider_connection_versions_immutable
on app_data_agent.model_provider_connection_versions;
create trigger model_provider_connection_versions_immutable
before update or delete on app_data_agent.model_provider_connection_versions
for each row execute function app_data_agent.reject_model_control_history_mutation();

create trigger model_control_operations_immutable
before update or delete on app_data_agent.model_control_operations
for each row execute function app_data_agent.reject_model_control_history_mutation();
create trigger model_control_audit_log_immutable
before update or delete on app_data_agent.model_control_audit_log
for each row execute function app_data_agent.reject_model_control_history_mutation();

alter table app_data_agent.model_control_operations owner to data_agent_identity_rpc_owner;
alter table app_data_agent.model_control_audit_log owner to data_agent_identity_rpc_owner;
alter function app_data_agent.reject_model_control_history_mutation()
  owner to data_agent_identity_rpc_owner;

revoke all on table
  app_data_agent.model_control_operations,
  app_data_agent.model_control_audit_log
from public, anon, authenticated, service_role, data_agent_backend;
revoke all on function app_data_agent.reject_model_control_history_mutation() from public;

alter table app_data_agent.model_catalog_entries
  drop constraint model_catalog_entries_status_check;
alter table app_data_agent.model_catalog_entries
  add constraint model_catalog_entries_status_check
  check (status in ('DRAFT','ACTIVE','DISABLED')) not valid;
do $rewrite_model_commands$
declare
  target regprocedure;
  definition text;
  repaired text;
begin
  foreach target in array array[
    'app_data_agent.apply_model_catalog_command(uuid,uuid,jsonb)'::regprocedure,
    'app_data_agent.apply_model_provider_connection_command(uuid,uuid,jsonb)'::regprocedure,
    'app_data_agent.apply_model_provider_selection(uuid,uuid,jsonb)'::regprocedure
  ] loop
    definition := pg_catalog.pg_get_functiondef(target);
    repaired := pg_catalog.replace(
      pg_catalog.replace(
        pg_catalog.replace(definition,
          'app_data_agent.pricing_control_operations',
          'app_data_agent.model_control_operations'),
        'app_data_agent.pricing_audit_log',
        'app_data_agent.model_control_audit_log'),
      'PRICING_OPERATION_CONFLICT',
      'MODEL_CONTROL_OPERATION_CONFLICT'
    );

    if target = 'app_data_agent.apply_model_catalog_command(uuid,uuid,jsonb)'::regprocedure then
      repaired := pg_catalog.replace(repaired, $old$
    if command ->> 'status' = 'ACTIVE' and not app_data_agent.model_price_chain_is_complete(
      scope_record.app_id, scope_record.environment, command ->> 'provider', command ->> 'model_id',
      nullif(command -> 'credential_ref', 'null'::jsonb)
    ) then
      raise exception using errcode = '55000', message = 'MODEL_PRICE_CHAIN_INCOMPLETE';
    end if;$old$, '');
      repaired := pg_catalog.replace(repaired, $old$
    if command ->> 'status' = 'ACTIVE' and not app_data_agent.model_price_chain_is_complete(
      scope_record.app_id, scope_record.environment, existing_catalog.provider,
      existing_catalog.model_id, existing_catalog.credential_ref
    ) then
      raise exception using errcode = '55000', message = 'MODEL_PRICE_CHAIN_INCOMPLETE';
    end if;$old$, '');
    elsif target = 'app_data_agent.apply_model_provider_selection(uuid,uuid,jsonb)'::regprocedure then
      repaired := pg_catalog.replace(repaired, $old$    target_status := case
      when not (model_item ->> 'enabled')::boolean then 'DISABLED'
      when app_data_agent.model_price_chain_is_complete(
        scope_record.app_id, scope_record.environment, connection.runtime_provider,
        model_item ->> 'model_id', connection.credential_ref
      ) then 'ACTIVE'
      else 'UNBILLABLE'
    end;$old$, $new$    target_status := case
      when not (model_item ->> 'enabled')::boolean then 'DISABLED'
      else 'ACTIVE'
    end;$new$);
    end if;

    if repaired = definition
      or pg_catalog.lower(repaired) like '%pricing_control_operations%'
      or pg_catalog.lower(repaired) like '%pricing_audit_log%'
      or pg_catalog.lower(repaired) like '%model_price_chain_is_complete%'
      or pg_catalog.lower(repaired) like '%unbillable%'
    then
      raise exception using
        errcode = 'P0001',
        message = 'MODEL_CONTROL_COMMAND_REWRITE_INCOMPLETE';
    end if;
    execute repaired;
  end loop;
end
$rewrite_model_commands$;

create or replace function platform.list_active_model_catalog(
  requested_deployment_id uuid,
  requested_principal_id uuid
)
returns setof app_data_agent.model_catalog_entries
language plpgsql stable security definer set search_path = '' as $function$
begin
  if not pg_catalog.pg_has_role(session_user, 'data_agent_backend', 'USAGE') then
    raise exception using errcode = '42501', message = 'DA_BACKEND_ROLE_REQUIRED';
  end if;
  return query
  select catalog.*
  from platform.deployment_mappings as deployment
  join platform.app_environment_lifecycle as lifecycle
    on lifecycle.app_id = deployment.app_id and lifecycle.environment = deployment.environment
  join app_data_agent.app_users as app_user
    on app_user.app_id = deployment.app_id
   and app_user.environment = deployment.environment
   and app_user.principal_id = requested_principal_id
  join app_data_agent.model_catalog_entries as catalog
    on catalog.app_id = deployment.app_id and catalog.environment = deployment.environment
  where deployment.deployment_id = requested_deployment_id
    and deployment.is_active
    and lifecycle.lifecycle_state = 'ACTIVE'
    and app_user.status = 'ACTIVE'
    and catalog.status = 'ACTIVE'
  order by catalog.is_system_default desc, catalog.provider, catalog.model_id;
end
$function$;

do $rewrite_environment_sync$
declare
  definition text;
  repaired text;
begin
  definition := pg_catalog.pg_get_functiondef(
    'platform.sync_environment_model_catalog_unlocked(uuid,uuid,jsonb)'::regprocedure
  );
  repaired := pg_catalog.replace(definition, E'  runtime_mode text;\n', '');
  repaired := pg_catalog.replace(repaired, $old$
  insert into app_data_agent.billing_runtime_state (app_id, environment, deployment_id)
  values (scope_record.app_id, scope_record.environment, requested_deployment_id)
  on conflict (app_id, environment, deployment_id) do nothing;
  select billing_runtime.mode into strict runtime_mode
  from app_data_agent.billing_runtime_state as billing_runtime
  where billing_runtime.app_id = scope_record.app_id
    and billing_runtime.environment = scope_record.environment
    and billing_runtime.deployment_id = requested_deployment_id;
$old$, E'\n');
  repaired := pg_catalog.replace(
    repaired,
    '    target_status := case when runtime_mode = ''SHADOW'' then ''ACTIVE'' else ''UNBILLABLE'' end;',
    '    target_status := ''ACTIVE'';'
  );
  if repaired = definition
    or pg_catalog.lower(repaired) like '%billing_runtime_state%'
    or pg_catalog.lower(repaired) like '%runtime_mode%'
    or pg_catalog.lower(repaired) like '%unbillable%'
  then
    raise exception using
      errcode = 'P0001',
      message = 'ENVIRONMENT_MODEL_SYNC_REWRITE_INCOMPLETE';
  end if;
  execute repaired;
end
$rewrite_environment_sync$;

do $rewrite_model_authentication$
declare
  definition text;
  repaired text;
begin
  definition := pg_catalog.pg_get_functiondef(
    'platform.record_model_api_authentication(uuid,uuid,jsonb)'::regprocedure
  );
  repaired := pg_catalog.replace(
    definition,
    'catalog.status not in (''ACTIVE'',''UNBILLABLE'')',
    'catalog.status <> ''ACTIVE'''
  );
  if repaired = definition or pg_catalog.lower(repaired) like '%unbillable%' then
    raise exception using
      errcode = 'P0001',
      message = 'MODEL_AUTHENTICATION_REWRITE_INCOMPLETE';
  end if;
  execute repaired;
end
$rewrite_model_authentication$;

create or replace function platform.read_operations_health(
  requested_deployment_id uuid,
  requested_actor_principal_id uuid
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
  scope_record record;
  identity_count bigint;
  identity_last timestamptz;
begin
  select * into strict scope_record
  from platform.resolve_super_admin_scope(
    requested_deployment_id,
    requested_actor_principal_id
  );

  select pg_catalog.count(*), pg_catalog.max(operation.created_at)
  into identity_count, identity_last
  from app_data_agent.identity_operations as operation
  where operation.app_id = scope_record.app_id
    and operation.environment = scope_record.environment
    and operation.status in ('PENDING', 'RETRY_REQUIRED');

  return pg_catalog.jsonb_build_object(
    'schema_version', 'operations-health@1.0.0',
    'generated_at', pg_catalog.clock_timestamp(),
    'gates', pg_catalog.jsonb_build_array(
      pg_catalog.jsonb_build_object(
        'key', 'IDENTITY_SIDE_EFFECTS',
        'status', case when identity_count > 0 then 'BLOCKED' else 'PASS' end,
        'count', identity_count,
        'reason_code', case
          when identity_count > 0 then 'IDENTITY_SIDE_EFFECTS_PENDING'
          else 'IDENTITY_SIDE_EFFECTS_CLEAR'
        end,
        'last_observed_at', identity_last
      )
    )
  );
end
$function$;

alter function platform.list_active_model_catalog(uuid,uuid)
  owner to data_agent_identity_rpc_owner;
alter function platform.sync_environment_model_catalog_unlocked(uuid,uuid,jsonb)
  owner to data_agent_identity_rpc_owner;
alter function platform.read_operations_health(uuid,uuid)
  owner to data_agent_identity_rpc_owner;
revoke all on function platform.list_active_model_catalog(uuid,uuid) from public;
revoke all on function platform.read_operations_health(uuid,uuid) from public;
grant execute on function platform.list_active_model_catalog(uuid,uuid) to data_agent_backend;
grant execute on function platform.read_operations_health(uuid,uuid) to data_agent_backend;
drop trigger app_users_ensure_credit_account on app_data_agent.app_users;

drop trigger model_price_versions_immutable on app_data_agent.model_price_versions;
drop trigger model_price_components_immutable on app_data_agent.model_price_components;
drop trigger fx_rate_versions_immutable on app_data_agent.fx_rate_versions;
drop trigger pricing_audit_log_immutable on app_data_agent.pricing_audit_log;
drop trigger credit_accounts_projection_guard on app_data_agent.credit_accounts;
drop trigger credit_holds_projection_guard on app_data_agent.credit_holds;
drop trigger credit_ledger_immutable on app_data_agent.credit_ledger_entries;
drop trigger credit_hold_events_immutable on app_data_agent.credit_hold_events;
drop trigger billing_operations_immutable on app_data_agent.billing_operations;
drop trigger billing_audit_immutable on app_data_agent.billing_audit_log;
drop trigger billing_runtime_state_projection_guard on app_data_agent.billing_runtime_state;
drop trigger model_bills_projection_guard on app_data_agent.model_bills;
drop trigger model_bill_price_components_immutable on app_data_agent.model_bill_price_components;
drop trigger model_bill_events_immutable on app_data_agent.model_bill_events;
drop trigger model_billing_operations_immutable on app_data_agent.model_billing_operations;
drop trigger billing_reconciliation_findings_immutable
on app_data_agent.billing_reconciliation_findings;

create function app_data_agent.reject_commercial_archive_mutation()
returns trigger language plpgsql volatile set search_path = '' as $function$
begin
  raise exception using errcode = '55000', message = 'COMMERCIAL_ARCHIVE_READ_ONLY';
end
$function$;

do $archive_triggers$
declare relation_name text;
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
      'create trigger %I before insert or update or delete on app_data_agent.%I for each row execute function app_data_agent.reject_commercial_archive_mutation()',
      relation_name || '_archive_read_only',
      relation_name
    );
  end loop;
end
$archive_triggers$;

revoke all on table
  app_data_agent.pricing_control_state,
  app_data_agent.pricing_sync_operations,
  app_data_agent.model_price_candidates,
  app_data_agent.model_price_candidate_components,
  app_data_agent.model_price_versions,
  app_data_agent.model_price_components,
  app_data_agent.fx_rate_candidates,
  app_data_agent.fx_rate_versions,
  app_data_agent.pricing_control_operations,
  app_data_agent.pricing_audit_log,
  app_data_agent.credit_accounts,
  app_data_agent.credit_ledger_entries,
  app_data_agent.credit_holds,
  app_data_agent.credit_hold_events,
  app_data_agent.billing_operations,
  app_data_agent.billing_audit_log,
  app_data_agent.billing_runtime_state,
  app_data_agent.model_bills,
  app_data_agent.model_bill_price_components,
  app_data_agent.model_bill_events,
  app_data_agent.model_billing_operations,
  app_data_agent.billing_reconciliation_findings
from public, anon, authenticated, service_role, data_agent_backend;
revoke all on sequence app_data_agent.billing_audit_log_audit_id_seq
from public, anon, authenticated, service_role, data_agent_backend;

drop function platform.list_model_price_candidates(uuid,uuid);
drop function platform.list_fx_rate_candidates(uuid,uuid);
drop function app_data_agent.submit_pricing_sync(uuid,uuid,jsonb);
drop function app_data_agent.record_pricing_sync_failure(uuid,uuid,jsonb);
drop function app_data_agent.decide_pricing_candidate(uuid,uuid,text,jsonb);
drop function app_data_agent.model_price_chain_is_complete(uuid,text,text,text,jsonb);

drop function platform.get_own_credit_account(uuid,uuid);
drop function platform.list_own_credit_ledger(uuid,uuid);
drop function platform.list_credit_accounts(uuid,uuid);
drop function platform.list_credit_ledger(uuid,uuid,uuid);
drop function platform.list_billing_audit(uuid,uuid);
drop function app_data_agent.apply_credit_adjustment(uuid,uuid,jsonb);
drop function app_data_agent.reserve_credit_hold(uuid,uuid,jsonb);
drop function app_data_agent.release_credit_hold(uuid,uuid,jsonb);
drop function app_data_agent.rebuild_credit_account_projection(uuid,uuid,jsonb);
drop function app_data_agent.reconcile_credit_account(uuid,uuid,uuid);
drop function app_data_agent.credit_account_payload(app_data_agent.credit_accounts);
drop function app_data_agent.credit_hold_payload(app_data_agent.credit_holds);
drop function platform.resolve_credit_user_scope(uuid,uuid);
drop function app_data_agent.ensure_credit_account_for_app_user();

drop function platform.get_billing_runtime_state(uuid,uuid);
drop function platform.list_own_model_bills(uuid,uuid);
drop function platform.list_model_bills(uuid,uuid,text);
drop function platform.list_model_billing_costs(uuid,uuid);
drop function app_data_agent.authorize_model_billing(uuid,uuid,jsonb);
drop function app_data_agent.finalize_model_billing(uuid,uuid,jsonb);
drop function app_data_agent.review_model_billing(uuid,uuid,jsonb);
drop function app_data_agent.reconcile_model_billing(uuid,uuid);
drop function app_data_agent.decide_billing_mode(uuid,uuid,jsonb);
drop function app_data_agent.resolve_model_billing_reservation_authority(
  uuid,uuid,text,uuid,uuid,uuid
);
drop function app_data_agent.require_model_billing_run_binding(
  uuid,uuid,text,uuid,uuid,uuid,uuid
);
drop function app_data_agent.resolve_model_billing_terminal_authority(
  uuid,uuid,text,uuid,uuid,uuid,uuid,uuid
);
drop function app_data_agent.list_model_billing_terminal_invocations(uuid,uuid,text);
drop function app_data_agent.calculate_model_bill_cost(uuid,text,uuid,jsonb,text);
drop function app_data_agent.model_bill_payload(app_data_agent.model_bills);

drop function app_data_agent.guard_billing_projection_mutation();
drop function app_data_agent.guard_model_billing_projection_mutation();
drop function app_data_agent.reject_billing_fact_mutation();
drop function app_data_agent.reject_pricing_history_mutation();
drop function app_data_agent.close_pricing_version_interval();

alter function app_data_agent.reject_commercial_archive_mutation()
  owner to data_agent_identity_rpc_owner;
revoke all on function app_data_agent.reject_commercial_archive_mutation() from public;
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
select platform.assert_migration_checksum(
  'app',
  '00000000-0000-4000-8000-00000000da01'::uuid,
  '20260725010703_app_data_agent_commercial_archive_retirement',
  'sha256:5358dc4a6ad3b6bd0637a1350b1a6671b59b1a937e45f6525fbde51126c2d947'
);

commit;
