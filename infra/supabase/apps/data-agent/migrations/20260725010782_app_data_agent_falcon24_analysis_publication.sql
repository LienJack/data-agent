-- falcon24_analysis_publication_migration_checksum: sha256:1fa3697c0d4aaa87c3892dcd353041ef6f281d054a6b3ff7e63b247309504735
begin;

select platform.acquire_migration_lock(
  'app','00000000-0000-4000-8000-00000000da01'::uuid);

do $preflight$
declare definition text;
begin
  if pg_catalog.current_setting('server_version_num')::integer not between 170000 and 179999
    or not exists(select 1 from platform.migration_ledger
      where owner_kind='app'
        and app_id='00000000-0000-4000-8000-00000000da01'::uuid
        and migration_version='20260725010781_app_data_agent_falcon24_e2_authority')
    or pg_catalog.to_regprocedure(
      'app_data_agent.commit_e1_analysis_publication(jsonb)') is null
    or pg_catalog.to_regprocedure(
      'app_data_agent.commit_falcon24_analysis_publication(jsonb)') is not null
    or pg_catalog.to_regclass('app_data_agent.falcon24_analysis_publications') is null
    or pg_catalog.to_regclass('app_data_agent.falcon24_analysis_publication_artifacts') is null
    or pg_catalog.to_regclass('app_data_agent.falcon24_analysis_publication_current') is null
    or pg_catalog.to_regclass('app_data_agent.falcon24_analysis_publication_outbox') is null
  then raise exception using errcode='P0001',
    message='FALCON24_ANALYSIS_PUBLICATION_BASELINE_DRIFT'; end if;
  select procedure.prosrc into strict definition from pg_catalog.pg_proc procedure
    where procedure.oid=
      'app_data_agent.commit_e1_analysis_publication(jsonb)'::regprocedure;
  if pg_catalog.strpos(definition,'e1_analysis_publications')=0
    or pg_catalog.strpos(definition,'e1-analysis-publication@1.0.0')=0
    or pg_catalog.strpos(definition,'append_analysis_context_journal')=0
  then raise exception using errcode='P0001',
    message='FALCON24_ANALYSIS_PUBLICATION_PREDECESSOR_DRIFT'; end if;
end
$preflight$;
do $install_generic_publication_rpc$
declare predecessor_definition text;generic_definition text;
  replaced_definition text;replacement_count integer:=0;
begin
  select pg_catalog.pg_get_functiondef(procedure.oid) into strict predecessor_definition
  from pg_catalog.pg_proc procedure
  where procedure.oid='app_data_agent.commit_e1_analysis_publication(jsonb)'::regprocedure;

  generic_definition:=pg_catalog.replace(predecessor_definition,
    'e1_analysis_publication','falcon24_analysis_publication');
  generic_definition:=pg_catalog.replace(generic_definition,
    'E1_ANALYSIS_PUBLICATION','FALCON24_ANALYSIS_PUBLICATION');
  generic_definition:=pg_catalog.replace(generic_definition,
    'e1-analysis-publication-receipt@1.0.0',
    'falcon24-analysis-publication-receipt@2.0.0');
  generic_definition:=pg_catalog.replace(generic_definition,
    'e1-analysis-publication@1.0.0','falcon24-analysis-publication@2.0.0');

  replaced_definition:=pg_catalog.replace(generic_definition,
    $$report_json jsonb;stage_record record;oracle_record record;explanation_record record;$$,
    $$report_json jsonb;requested_authority_json jsonb;stage_record record;
  authority_binding record;oracle_record record;explanation_record record;$$);
  if replaced_definition=generic_definition then raise exception using errcode='P0001',
    message='FALCON24_ANALYSIS_PUBLICATION_REWRITE_MISSED'; end if;
  generic_definition:=replaced_definition;replacement_count:=replacement_count+1;

  replaced_definition:=pg_catalog.replace(generic_definition,
    $$command_json:=envelope_json->'command';scope_json:=command_json->'scope';$$,
    $$command_json:=envelope_json->'command';scope_json:=command_json->'scope';
  requested_authority_json:=command_json->'authority';$$);
  if replaced_definition=generic_definition then raise exception using errcode='P0001',
    message='FALCON24_ANALYSIS_PUBLICATION_REWRITE_MISSED'; end if;
  generic_definition:=replaced_definition;replacement_count:=replacement_count+1;

  replaced_definition:=pg_catalog.replace(generic_definition,
    $$'chart_documents','report_document','public_event_id','publication_hash']::text[])$$,
    $$'chart_documents','report_document','public_event_id','authority','publication_hash']::text[])$$);
  if replaced_definition=generic_definition then raise exception using errcode='P0001',
    message='FALCON24_ANALYSIS_PUBLICATION_REWRITE_MISSED'; end if;
  generic_definition:=replaced_definition;replacement_count:=replacement_count+1;

  replaced_definition:=pg_catalog.replace(generic_definition,
    $$or command_json->>'schema_version' is distinct from 'falcon24-analysis-publication@2.0.0'$$,
    $$or command_json->>'schema_version' is distinct from 'falcon24-analysis-publication@2.0.0'
    or pg_catalog.jsonb_typeof(requested_authority_json) is distinct from 'object'
    or app_data_agent.provider_json_object_has_exact_keys(requested_authority_json,array[
      'schema_version','authority_epoch','baseline_id','baseline_hash',
      'activation_attempt_id']::text[]) is distinct from true
    or requested_authority_json->>'schema_version' is distinct from
      'falcon24-authority-binding@2.0.0'
    or app_data_agent.falcon24_authority_epoch_is_canonical(
      requested_authority_json->>'authority_epoch') is distinct from true
    or requested_authority_json->>'authority_epoch'='E1'
    or app_data_agent.canonical_uuid_json_string_is_valid(
      requested_authority_json->'baseline_id') is distinct from true
    or requested_authority_json->>'baseline_hash'!~'^sha256:[0-9a-f]{64}$'
    or app_data_agent.canonical_uuid_json_string_is_valid(
      requested_authority_json->'activation_attempt_id') is distinct from true$$);
  if replaced_definition=generic_definition then raise exception using errcode='P0001',
    message='FALCON24_ANALYSIS_PUBLICATION_REWRITE_MISSED'; end if;
  generic_definition:=replaced_definition;replacement_count:=replacement_count+1;

  replaced_definition:=pg_catalog.replace(generic_definition,
    $$  perform app_data_agent.assert_analysis_lifecycle_fence(envelope_json,command_json);$$,
    $$  select run.authority_epoch as run_authority_epoch,
    run.authority_baseline_id as run_baseline_id,
    run.authority_baseline_hash as run_baseline_hash,
    run.authority_activation_attempt_id as run_activation_attempt_id,
    current_epoch.authority_epoch as current_authority_epoch,
    current_epoch.baseline_id as current_baseline_id,
    current_epoch.baseline_hash as current_baseline_hash,
    current_epoch.activation_attempt_id as current_activation_attempt_id
  into authority_binding from app_data_agent.runs run
  join app_data_agent.falcon24_current_authority_epoch current_epoch
    on current_epoch.app_id=run.app_id and current_epoch.tenant_id=run.tenant_id
      and current_epoch.environment=run.environment
  where run.app_id=(scope_json->>'app_id')::uuid
    and run.tenant_id=(scope_json->>'tenant_id')::uuid
    and run.environment=scope_json->>'environment'
    and run.run_id=(command_json->>'run_id')::uuid
    and run.principal_id=(command_json->>'principal_id')::uuid
  for share of run,current_epoch;
  if not found
    or authority_binding.run_authority_epoch<>authority_binding.current_authority_epoch
    or authority_binding.run_baseline_id<>authority_binding.current_baseline_id
    or authority_binding.run_baseline_hash<>authority_binding.current_baseline_hash
    or authority_binding.run_activation_attempt_id<>authority_binding.current_activation_attempt_id
    or requested_authority_json->>'authority_epoch'<>authority_binding.run_authority_epoch
    or (requested_authority_json->>'baseline_id')::uuid<>authority_binding.run_baseline_id
    or requested_authority_json->>'baseline_hash'<>authority_binding.run_baseline_hash
    or (requested_authority_json->>'activation_attempt_id')::uuid<>
      authority_binding.run_activation_attempt_id
  then return pg_catalog.jsonb_build_object('ok',false,
    'error_code','FALCON24_ANALYSIS_PUBLICATION_AUTHORITY_MISMATCH'); end if;

  perform app_data_agent.assert_analysis_lifecycle_fence(envelope_json,command_json);$$);
  if replaced_definition=generic_definition then raise exception using errcode='P0001',
    message='FALCON24_ANALYSIS_PUBLICATION_REWRITE_MISSED'; end if;
  generic_definition:=replaced_definition;replacement_count:=replacement_count+1;

  if replacement_count<>5
    or generic_definition=predecessor_definition
    or pg_catalog.strpos(generic_definition,'commit_falcon24_analysis_publication')=0
    or pg_catalog.strpos(generic_definition,'falcon24_analysis_publications')=0
    or pg_catalog.strpos(generic_definition,'falcon24-analysis-publication@2.0.0')=0
    or pg_catalog.strpos(generic_definition,'FALCON24_ANALYSIS_PUBLICATION_AUTHORITY_MISMATCH')=0
  then raise exception using errcode='P0001',
    message='FALCON24_ANALYSIS_PUBLICATION_REWRITE_INCOMPLETE'; end if;
  execute generic_definition;
end
$install_generic_publication_rpc$;
alter function app_data_agent.commit_falcon24_analysis_publication(jsonb)
  owner to data_agent_u6_rpc_owner;
revoke all on function app_data_agent.commit_falcon24_analysis_publication(jsonb) from public;
grant execute on function app_data_agent.commit_falcon24_analysis_publication(jsonb)
  to data_agent_backend;
revoke execute on function app_data_agent.commit_e1_analysis_publication(jsonb)
  from public,data_agent_backend;
do $postconditions$
declare definition text;
begin
  if pg_catalog.to_regprocedure(
      'app_data_agent.commit_falcon24_analysis_publication(jsonb)') is null
  then raise exception using errcode='P0001',
    message='FALCON24_ANALYSIS_PUBLICATION_RPC_MISSING'; end if;
  select procedure.prosrc into strict definition from pg_catalog.pg_proc procedure
    where procedure.oid=
      'app_data_agent.commit_falcon24_analysis_publication(jsonb)'::regprocedure;
  if pg_catalog.strpos(definition,'falcon24-analysis-publication@2.0.0')=0
    or pg_catalog.strpos(definition,'falcon24-authority-binding@2.0.0')=0
    or pg_catalog.strpos(definition,'falcon24_analysis_publications')=0
    or pg_catalog.strpos(definition,'falcon24_analysis_publication_outbox')=0
    or pg_catalog.strpos(definition,'FALCON24_ANALYSIS_PUBLICATION_AUTHORITY_MISMATCH')=0
    or pg_catalog.strpos(definition,'append_analysis_context_journal')=0
    or pg_catalog.strpos(definition,'e1_analysis_publications')>0
  then raise exception using errcode='P0001',
    message='FALCON24_ANALYSIS_PUBLICATION_DEFINITION_DRIFT'; end if;
  if not pg_catalog.has_function_privilege('data_agent_backend',
      'app_data_agent.commit_falcon24_analysis_publication(jsonb)','EXECUTE')
    or pg_catalog.has_function_privilege('public',
      'app_data_agent.commit_falcon24_analysis_publication(jsonb)','EXECUTE')
    or pg_catalog.has_function_privilege('data_agent_backend',
      'app_data_agent.commit_e1_analysis_publication(jsonb)','EXECUTE')
    or (select role.rolname from pg_catalog.pg_proc procedure
      join pg_catalog.pg_roles role on role.oid=procedure.proowner
      where procedure.oid=
        'app_data_agent.commit_falcon24_analysis_publication(jsonb)'::regprocedure)
      <>'data_agent_u6_rpc_owner'
  then raise exception using errcode='P0001',
    message='FALCON24_ANALYSIS_PUBLICATION_SECURITY_DRIFT'; end if;
end
$postconditions$;

select platform.assert_migration_checksum(
  'app','00000000-0000-4000-8000-00000000da01'::uuid,
  '20260725010782_app_data_agent_falcon24_analysis_publication',
  'sha256:1fa3697c0d4aaa87c3892dcd353041ef6f281d054a6b3ff7e63b247309504735');
commit;
