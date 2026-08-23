-- subagent_harness_runtime_repair_migration_checksum: sha256:4ed26320816c7bd3a06133c5c67322e5d8d0cf26c84e3198754660af7482faaa
-- 10698 repairs the installed Root Harness runtime without rewriting applied migration history.
begin;
do $bootstrap$
declare installed_10696_checksum text;
begin
  if session_user<>'postgres' or current_user<>'postgres' then
    raise exception using errcode='42501',message='SUBAGENT_HARNESS_RUNTIME_REPAIR_EXECUTOR_UNSAFE'; end if;
  if pg_catalog.current_setting('server_version_num')::integer not between 170000 and 179999 then
    raise exception using errcode='P0001',message='SUBAGENT_HARNESS_RUNTIME_REPAIR_POSTGRES_17_REQUIRED'; end if;
  if not exists(select 1 from platform.migration_ledger where owner_kind='app'
    and app_id='00000000-0000-4000-8000-00000000da01'::uuid
    and migration_version='20260725010697_app_data_agent_agent_team_trace_content')
  then raise exception using errcode='P0001',message='SUBAGENT_HARNESS_RUNTIME_REPAIR_BASELINE_10697_MISSING'; end if;
  select migration_checksum into installed_10696_checksum from platform.migration_ledger
  where owner_kind='app' and app_id='00000000-0000-4000-8000-00000000da01'::uuid
    and migration_version='20260725010696_app_data_agent_model_driven_subagent_harness';
  if installed_10696_checksum is distinct from
    'sha256:8e74cfd247270428117ffed554f6020ba0c752881d19012d3ad64438acecdac2'
  then raise exception using errcode='P0001',message='SUBAGENT_HARNESS_RUNTIME_REPAIR_BASELINE_10696_DRIFT'; end if;
end
$bootstrap$;
set local lock_timeout='2000ms';
set local statement_timeout='300000ms';
select platform.acquire_migration_lock('app','00000000-0000-4000-8000-00000000da01'::uuid);
create or replace function app_data_agent.list_agent_profile_revisions_v2(enabled_only boolean)
returns jsonb language plpgsql stable security definer set search_path='' as $function$
declare authority record; items jsonb;
begin
  if not pg_catalog.pg_has_role(session_user,'data_agent_backend','USAGE') then
    raise exception using errcode='42501',message='DA_BACKEND_ROLE_REQUIRED'; end if;
  select * into authority from platform.current_backend_authority(false);
  select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
    'schema_version','agent-product-profile-registry-item@2.0.0','revision',revision.document_json,
    'head',pg_catalog.jsonb_build_object(
      'schema_version','agent-product-profile-head@2.0.0',
      'scope',pg_catalog.jsonb_build_object('app_id',head.app_id,'tenant_id',head.tenant_id,
        'environment',head.environment),'profile_id',head.profile_id,
      'active_revision',head.active_revision,'active_revision_hash',head.active_revision_hash,
      'lifecycle',head.lifecycle,'version',head.version,'updated_at',head.updated_at))
    order by head.profile_id),'[]'::jsonb) into items
  from app_data_agent.agent_product_profile_heads head
  join app_data_agent.agent_product_profile_revisions revision
    on revision.app_id=head.app_id and revision.tenant_id=head.tenant_id
    and revision.environment=head.environment and revision.profile_id=head.profile_id
    and revision.revision=head.active_revision and revision.revision_hash=head.active_revision_hash
  where head.app_id=authority.app_id and head.tenant_id=authority.tenant_id
    and head.environment=authority.environment
    and revision.document_json->>'schema_version'='agent-product-profile-revision@2.0.0'
    and (not enabled_only or (head.lifecycle='ENABLED' and revision.approval_status='APPROVED'
      and not exists(
        select 1 from pg_catalog.jsonb_array_elements(revision.document_json->'skill_refs') skill_ref(document)
        where not exists(
          select 1 from app_data_agent.skill_revisions skill
          join app_data_agent.skill_heads skill_head on skill_head.app_id=skill.app_id
            and skill_head.tenant_id=skill.tenant_id and skill_head.environment=skill.environment
            and skill_head.skill_id=skill.skill_id and skill_head.active_revision=skill.revision
            and skill_head.active_revision_hash=skill.revision_hash
          where skill.app_id=revision.app_id and skill.tenant_id=revision.tenant_id
            and skill.environment=revision.environment
            and skill.skill_id=(skill_ref.document->>'skill_id')::uuid
            and skill.revision=(skill_ref.document->>'revision')::bigint
            and skill.revision_hash=skill_ref.document->>'revision_hash'
            and skill.approval_status='APPROVED' and skill_head.lifecycle='ENABLED'
            and not exists(select 1 from app_data_agent.skill_signer_revocations revocation
              where revocation.app_id=skill.app_id and revocation.tenant_id=skill.tenant_id
                and revocation.environment=skill.environment and revocation.signer_id=skill.signer_id)))));
  return pg_catalog.jsonb_build_object(
    'schema_version','agent-product-profile-list-result@2.0.0','items',items);
end
$function$;

alter function app_data_agent.list_agent_profile_revisions_v2(boolean)
  owner to data_agent_u20_profile_owner;
do $patch_root_harness_visible_messages$
declare definition text; repaired text; old_payload_branch text; new_payload_branch text;
  old_acceptance text; new_acceptance text;
begin
  select pg_catalog.pg_get_functiondef('app_data_agent.command_payload_is_valid(jsonb)'::regprocedure)
    into definition;
  old_payload_branch:=E'  if requested_payload ?& array[''schema_version'',''kind'',''executor_version'',''effective_config_ref'',''catalog_snapshot'']\n    and (select pg_catalog.count(*)=5 from pg_catalog.jsonb_object_keys(requested_payload))\n    and requested_payload->>''schema_version''=''effective-config-team-lease@3.0.0''\n    and requested_payload->>''kind''=''START_DATA_AGENT_TEAM''\n    and requested_payload->>''executor_version''=''ROOT_HARNESS@1''\n    and app_data_agent.subagent_catalog_snapshot_is_valid(requested_payload->''catalog_snapshot'',requested_payload#>>''{catalog_snapshot,run_id}'')\n  then return true; end if;';
  new_payload_branch:=E'  if requested_payload ?& array[''schema_version'',''kind'',''executor_version'',''effective_config_ref'',''catalog_snapshot'',''visible_message_refs'']\n    and (select pg_catalog.count(*)=6 from pg_catalog.jsonb_object_keys(requested_payload))\n    and requested_payload->>''schema_version''=''effective-config-team-lease@3.0.0''\n    and requested_payload->>''kind''=''START_DATA_AGENT_TEAM''\n    and requested_payload->>''executor_version''=''ROOT_HARNESS@1''\n    and pg_catalog.jsonb_typeof(requested_payload->''visible_message_refs'')=''array''\n    and pg_catalog.jsonb_array_length(requested_payload->''visible_message_refs'') between 1 and 64\n    and app_data_agent.subagent_catalog_snapshot_is_valid(requested_payload->''catalog_snapshot'',requested_payload#>>''{catalog_snapshot,run_id}'')\n  then return true; end if;';
  repaired:=pg_catalog.replace(definition,old_payload_branch,new_payload_branch);
  if repaired=definition then
    raise exception using errcode='P0001',message='SUBAGENT_HARNESS_RUNTIME_REPAIR_COMMAND_DRIFT'; end if;
  execute repaired;

  select pg_catalog.pg_get_functiondef(
    'app_data_agent.accept_question_run_with_effective_config(jsonb,jsonb)'::regprocedure)
    into definition;
  old_acceptance:=E'  if requested_command ? ''subagent_catalog_snapshot'' then\n    perform app_data_agent.commit_subagent_catalog_snapshot_internal(requested_idempotency_key,requested_command->''subagent_catalog_snapshot'');\n    accepted_payload := pg_catalog.jsonb_build_object(\n      ''schema_version'',''effective-config-team-lease@3.0.0'',''kind'',''START_DATA_AGENT_TEAM'',\n      ''executor_version'',''ROOT_HARNESS@1'',''effective_config_ref'',config_ref,\n      ''catalog_snapshot'',requested_command->''subagent_catalog_snapshot'');\n    accepted_command := (requested_command-''subagent_catalog_snapshot''::text) || pg_catalog.jsonb_build_object(''payload'',accepted_payload);';
  new_acceptance:=E'  if requested_command ? ''subagent_catalog_snapshot'' then\n    perform app_data_agent.commit_subagent_catalog_snapshot_internal(requested_idempotency_key,requested_command->''subagent_catalog_snapshot'');\n    accepted_payload := pg_catalog.jsonb_build_object(\n      ''schema_version'',''effective-config-team-lease@3.0.0'',''kind'',''START_DATA_AGENT_TEAM'',\n      ''executor_version'',''ROOT_HARNESS@1'',''effective_config_ref'',config_ref,\n      ''catalog_snapshot'',requested_command->''subagent_catalog_snapshot'',\n      ''visible_message_refs'',pg_catalog.jsonb_build_array(requested_command->>''event_id''));\n    accepted_command := (requested_command-''subagent_catalog_snapshot''::text) || pg_catalog.jsonb_build_object(''payload'',accepted_payload);';
  repaired:=pg_catalog.replace(definition,old_acceptance,new_acceptance);
  if repaired=definition then
    raise exception using errcode='P0001',message='SUBAGENT_HARNESS_RUNTIME_REPAIR_ACCEPTANCE_DRIFT'; end if;
  execute repaired;
end
$patch_root_harness_visible_messages$;
alter function app_data_agent.subagent_catalog_snapshot_is_valid(jsonb,text)
  owner to data_agent_u19_team_owner;
revoke all on function app_data_agent.subagent_catalog_snapshot_is_valid(jsonb,text)
  from public,data_agent_backend,data_agent_effective_config_rpc_owner;
grant execute on function app_data_agent.subagent_catalog_snapshot_is_valid(jsonb,text)
  to data_agent_effective_config_rpc_owner;

do $postconditions$
begin
  if not exists(select 1 from platform.migration_ledger where owner_kind='app'
      and app_id='00000000-0000-4000-8000-00000000da01'::uuid
      and migration_version='20260725010696_app_data_agent_model_driven_subagent_harness'
      and migration_checksum='sha256:8e74cfd247270428117ffed554f6020ba0c752881d19012d3ad64438acecdac2')
    or (select pg_catalog.pg_get_userbyid(proowner) from pg_catalog.pg_proc
      where oid='app_data_agent.subagent_catalog_snapshot_is_valid(jsonb,text)'::regprocedure)
      <>'data_agent_u19_team_owner'
    or not pg_catalog.has_function_privilege('data_agent_effective_config_rpc_owner',
      'app_data_agent.subagent_catalog_snapshot_is_valid(jsonb,text)','EXECUTE')
    or pg_catalog.has_function_privilege('data_agent_backend',
      'app_data_agent.subagent_catalog_snapshot_is_valid(jsonb,text)','EXECUTE')
    or pg_catalog.has_function_privilege('public',
      'app_data_agent.subagent_catalog_snapshot_is_valid(jsonb,text)','EXECUTE')
    or pg_catalog.strpos(pg_catalog.pg_get_functiondef(
      'app_data_agent.list_agent_profile_revisions_v2(boolean)'::regprocedure),
      'skill_signer_revocations')=0
    or pg_catalog.strpos(pg_catalog.pg_get_functiondef(
      'app_data_agent.command_payload_is_valid(jsonb)'::regprocedure),
      'visible_message_refs')=0
    or pg_catalog.strpos(pg_catalog.pg_get_functiondef(
      'app_data_agent.accept_question_run_with_effective_config(jsonb,jsonb)'::regprocedure),
      'visible_message_refs')=0
  then raise exception using errcode='P0001',message='SUBAGENT_HARNESS_RUNTIME_REPAIR_POSTCONDITION_FAILED'; end if;
end
$postconditions$;
select platform.assert_migration_checksum(
  'app','00000000-0000-4000-8000-00000000da01'::uuid,
  '20260725010698_app_data_agent_subagent_harness_runtime_repair',
  'sha256:4ed26320816c7bd3a06133c5c67322e5d8d0cf26c84e3198754660af7482faaa'
);
commit;
