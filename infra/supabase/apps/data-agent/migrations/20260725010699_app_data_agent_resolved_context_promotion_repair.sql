-- resolved_context_promotion_repair_migration_checksum: sha256:3cf34801f371a7b3172aee10d9f399dfea24da34946936558eaf54b4fdddb560
-- 10699 repairs Resolved Context model visibility and promotes stale same-domain defaults.
begin;
do $bootstrap$ begin
  if session_user<>'postgres' or current_user<>'postgres' then
    raise exception using errcode='42501',message='RESOLVED_CONTEXT_PROMOTION_REPAIR_EXECUTOR_UNSAFE'; end if;
  if not exists(select 1 from platform.migration_ledger where owner_kind='app'
    and app_id='00000000-0000-4000-8000-00000000da01'::uuid
    and migration_version='20260725010698_app_data_agent_semantic_text2sql_promotion')
  then raise exception using errcode='P0001',message='RESOLVED_CONTEXT_PROMOTION_REPAIR_BASELINE_10698_MISSING'; end if;
end $bootstrap$;
set local lock_timeout='2000ms';
set local statement_timeout='300000ms';
select platform.acquire_migration_lock('app','00000000-0000-4000-8000-00000000da01'::uuid);
grant select on app_data_agent.model_catalog_entries to data_agent_u12_context_owner;
create policy model_catalog_resolved_context_select on app_data_agent.model_catalog_entries
  for select to data_agent_u12_context_owner
  using (app_id=(nullif(pg_catalog.current_setting('data_agent.app_id',true),''))::uuid
    and environment=nullif(pg_catalog.current_setting('data_agent.environment',true),''));
create or replace function semantic.promote_active_semantic_release_to_workspace_defaults()
returns trigger language plpgsql volatile security definer set search_path='' as $function$
declare defaults_record app_data_agent.workspace_run_defaults%rowtype;
  revision_record app_data_agent.workspace_run_default_revisions%rowtype;
  selection_value jsonb; command_value jsonb; idempotency_key_value text;
begin
  if new.current_release_id is null or old.current_release_id is null
    or new.current_release_id=old.current_release_id
    or not pg_catalog.pg_has_role(session_user,'data_agent_backend','USAGE')
  then return new; end if;
  select current_defaults.* into defaults_record from app_data_agent.workspace_run_defaults current_defaults
  where current_defaults.app_id=new.app_id and current_defaults.tenant_id=new.tenant_id
    and current_defaults.environment=new.environment;
  if not found then return new; end if;
  select revision.* into revision_record from app_data_agent.workspace_run_default_revisions revision
  where revision.app_id=defaults_record.app_id and revision.tenant_id=defaults_record.tenant_id
    and revision.environment=defaults_record.environment and revision.defaults_id=defaults_record.defaults_id
    and revision.defaults_revision=defaults_record.defaults_revision
    and revision.defaults_hash=defaults_record.defaults_hash;
  if not found or revision_record.defaults_json->'semantic_release'='null'::jsonb
    or revision_record.defaults_json#>>'{semantic_release,resource_id}'=new.current_release_id::text
    or not exists(select 1 from semantic.semantic_source_release release
      where release.app_id=new.app_id and release.tenant_id=new.tenant_id
        and release.environment=new.environment and release.semantic_domain=new.semantic_domain
        and release.release_id=(revision_record.defaults_json#>>'{semantic_release,resource_id}')::uuid)
  then return new; end if;

  selection_value:=pg_catalog.jsonb_build_object(
    'model',case when revision_record.defaults_json->'model'='null'::jsonb then 'null'::jsonb else
      pg_catalog.jsonb_build_object('resource_id',revision_record.defaults_json#>>'{model,resource_id}',
        'expected_revision',(revision_record.defaults_json#>>'{model,resource_revision}')::bigint) end,
    'datasource',case when revision_record.defaults_json->'datasource'='null'::jsonb then 'null'::jsonb else
      pg_catalog.jsonb_build_object('resource_id',revision_record.defaults_json#>>'{datasource,resource_id}',
        'expected_revision',(revision_record.defaults_json#>>'{datasource,resource_revision}')::bigint) end,
    'files',coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
      'resource_id',item.value->>'resource_id','expected_revision',(item.value->>'resource_revision')::bigint)
      order by item.value->>'resource_id') from pg_catalog.jsonb_array_elements(
        coalesce(revision_record.defaults_json->'files','[]'::jsonb)) item(value)),'[]'::jsonb),
    'knowledge',coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
      'resource_id',item.value->>'resource_id','expected_revision',(item.value->>'resource_revision')::bigint)
      order by item.value->>'resource_id') from pg_catalog.jsonb_array_elements(
        coalesce(revision_record.defaults_json->'knowledge','[]'::jsonb)) item(value)),'[]'::jsonb),
    'mcp_servers',coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
      'resource_id',item.value->>'resource_id','expected_revision',(item.value->>'resource_revision')::bigint)
      order by item.value->>'resource_id') from pg_catalog.jsonb_array_elements(
        coalesce(revision_record.defaults_json->'mcp_servers','[]'::jsonb)) item(value)),'[]'::jsonb),
    'skills',coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
      'resource_id',item.value->>'resource_id','expected_revision',(item.value->>'resource_revision')::bigint)
      order by item.value->>'resource_id') from pg_catalog.jsonb_array_elements(
        coalesce(revision_record.defaults_json->'skills','[]'::jsonb)) item(value)),'[]'::jsonb),
    'semantic_release',pg_catalog.jsonb_build_object(
      'resource_id',new.current_release_id,'expected_revision',new.current_release_generation),
    'schema_snapshot',case when revision_record.defaults_json->'schema_snapshot'='null'::jsonb then 'null'::jsonb else
      pg_catalog.jsonb_build_object('resource_id',revision_record.defaults_json#>>'{schema_snapshot,resource_id}',
        'expected_revision',(revision_record.defaults_json#>>'{schema_snapshot,resource_revision}')::bigint) end,
    'context_policy',pg_catalog.jsonb_build_object(
      'resource_id',revision_record.defaults_json#>>'{context_policy,resource_id}',
      'expected_revision',(revision_record.defaults_json#>>'{context_policy,resource_revision}')::bigint),
    'egress_policy',pg_catalog.jsonb_build_object(
      'resource_id',revision_record.defaults_json#>>'{egress_policy,resource_id}',
      'expected_revision',(revision_record.defaults_json#>>'{egress_policy,resource_revision}')::bigint),
    'execution_safety_policy',pg_catalog.jsonb_build_object(
      'resource_id',revision_record.defaults_json#>>'{execution_safety_policy,resource_id}',
      'expected_revision',(revision_record.defaults_json#>>'{execution_safety_policy,resource_revision}')::bigint)
  );
  idempotency_key_value:='semantic-publish:'||new.current_release_id::text;
  command_value:=pg_catalog.jsonb_build_object(
    'schema_version','workspace-defaults-cas-update@1.0.0','operation_id',extensions.gen_random_uuid(),
    'workspace_id',new.tenant_id,'expected_defaults_revision',defaults_record.defaults_revision,
    'idempotency_key',idempotency_key_value,'defaults',selection_value
  );
  command_value:=command_value||pg_catalog.jsonb_build_object(
    'request_hash',app_data_agent.u2_canonical_sha256(command_value));
  perform app_data_agent.update_workspace_run_defaults(command_value);
  return new;
end
$function$;
do $postconditions$ begin
  if not pg_catalog.has_table_privilege(
      'data_agent_u12_context_owner','app_data_agent.model_catalog_entries','SELECT')
    or not exists(select 1 from pg_catalog.pg_policy policy
      where policy.polrelid='app_data_agent.model_catalog_entries'::regclass
        and policy.polname='model_catalog_resolved_context_select')
    or pg_catalog.strpos(pg_catalog.pg_get_functiondef(
      'semantic.promote_active_semantic_release_to_workspace_defaults()'::regprocedure),
      'semantic.semantic_source_release release')=0
  then raise exception using errcode='P0001',message='RESOLVED_CONTEXT_PROMOTION_REPAIR_POSTCONDITION_FAILED'; end if;
end $postconditions$;
select platform.assert_migration_checksum(
  'app','00000000-0000-4000-8000-00000000da01'::uuid,
  '20260725010699_app_data_agent_resolved_context_promotion_repair',
  'sha256:3cf34801f371a7b3172aee10d9f399dfea24da34946936558eaf54b4fdddb560'
);
commit;
