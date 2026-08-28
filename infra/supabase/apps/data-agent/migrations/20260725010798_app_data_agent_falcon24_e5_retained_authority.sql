-- falcon24_e5_retained_authority_migration_checksum: sha256:18b91331ab0c3820aa016aa985e125ed7b4140820050bb1ac7efc6fb563f346a
begin;

select platform.acquire_migration_lock(
  'app','00000000-0000-4000-8000-00000000da01'::uuid);

do $preflight$
begin
  if pg_catalog.current_setting('server_version_num')::integer not between 170000 and 179999
    or not exists(select 1 from platform.migration_ledger
      where owner_kind='app'
        and app_id='00000000-0000-4000-8000-00000000da01'::uuid
        and migration_version=
          '20260725010797_app_data_agent_falcon24_successor_activation_closure')
    or pg_catalog.to_regprocedure('app_data_agent.activate_falcon24_authority(jsonb)') is null
    or pg_catalog.to_regprocedure('app_data_agent.begin_falcon24_diagnostic(jsonb)') is null
    or pg_catalog.to_regprocedure('app_data_agent.complete_falcon24_diagnostic(jsonb)') is null
    or pg_catalog.to_regprocedure('app_data_agent.begin_falcon24_qualification(jsonb)') is null
    or pg_catalog.to_regprocedure('semantic.lock_semantic_authority_fence(uuid,uuid,text,text)') is null
    or pg_catalog.to_regclass('semantic.semantic_active_pointer') is null
    or pg_catalog.to_regclass('semantic.semantic_runtime_activation') is null
    or pg_catalog.to_regclass('app_data_agent.workspace_run_defaults') is null
    or pg_catalog.to_regclass('app_data_agent.workspace_run_default_revisions') is null
    or pg_catalog.to_regclass('app_data_agent.falcon24_diagnostic_attempts') is null
    or pg_catalog.to_regclass('app_data_agent.falcon24_diagnostic_receipts') is null
  then raise exception using errcode='P0001',
    message='FALCON24_E5_RETAINED_AUTHORITY_BASELINE_DRIFT'; end if;
end
$preflight$;

create temporary table falcon24_10798_history_snapshot(
  relation_name text primary key,row_count bigint not null,row_digest text not null
) on commit drop;

do $snapshot$
declare relation_name text;schema_name text;table_name text;before_count bigint;before_digest text;
begin
  foreach relation_name in array array[
    'semantic.semantic_source_release','semantic.semantic_executable_projection',
    'semantic.semantic_relationship_projection','semantic.semantic_runtime_restriction_projection',
    'semantic.semantic_graph_projection','semantic.semantic_source_release_graph_projection',
    'semantic.semantic_active_pointer','semantic.semantic_runtime_activation',
    'app_data_agent.workspace_run_defaults','app_data_agent.workspace_run_default_revisions',
    'app_data_agent.falcon24_current_authority_epoch',
    'app_data_agent.falcon24_authority_staging_sessions',
    'app_data_agent.falcon24_authority_staging_receipts',
    'app_data_agent.falcon24_authority_baselines',
    'app_data_agent.falcon24_authority_activation_attempts',
    'app_data_agent.falcon24_diagnostic_attempts','app_data_agent.falcon24_diagnostic_receipts',
    'app_data_agent.falcon24_qualifications','app_data_agent.falcon24_acceptance_campaigns'
  ]::text[] loop
    schema_name:=pg_catalog.split_part(relation_name,'.',1);
    table_name:=pg_catalog.split_part(relation_name,'.',2);
    execute pg_catalog.format(
      'select pg_catalog.count(*)::bigint,app_data_agent.u2_canonical_sha256('
      ||'coalesce(pg_catalog.jsonb_agg(to_jsonb(row_value) order by to_jsonb(row_value)::text),'
      ||'''[]''::jsonb)) from %I.%I as row_value',schema_name,table_name)
      into strict before_count,before_digest;
    insert into falcon24_10798_history_snapshot values(relation_name,before_count,before_digest);
  end loop;
end
$snapshot$;

set local lock_timeout='2000ms';
set local statement_timeout='300000ms';
set local idle_in_transaction_session_timeout='60000ms';
alter table app_data_agent.falcon24_diagnostic_attempts
  drop constraint falcon24_diagnostic_attempts_authority_epoch_check,
  drop constraint falcon24_diagnostic_attempts_semantic_release_generation_check;

alter table app_data_agent.falcon24_diagnostic_attempts
  add constraint falcon24_diagnostic_attempts_authority_epoch_check check(
    app_data_agent.falcon24_authority_epoch_is_canonical(authority_epoch)
    and pg_catalog.substr(authority_epoch,2)::numeric>=4),
  add constraint falcon24_diagnostic_attempts_semantic_release_generation_check check(
    semantic_release_generation=2),
  add constraint falcon24_diagnostic_attempts_manifest_epoch_check check(
    (authority_epoch='E4'
      and manifest_document->>'schema_version'='falcon24-diagnostic-attempt@1.0.0')
    or (pg_catalog.substr(authority_epoch,2)::numeric>=5
      and manifest_document->>'schema_version'='falcon24-diagnostic-attempt@2.0.0'));

alter table app_data_agent.falcon24_diagnostic_receipts
  drop constraint falcon24_diagnostic_receipts_receipt_document_check1;

alter table app_data_agent.falcon24_diagnostic_receipts
  add constraint falcon24_diagnostic_receipts_receipt_document_version_check check(
    receipt_document->>'schema_version' in(
      'falcon24-diagnostic-receipt@1.0.0','falcon24-diagnostic-receipt@2.0.0'));
alter function app_data_agent.activate_falcon24_authority(jsonb)
  rename to activate_falcon24_authority_pre_retained;

create function app_data_agent.activate_falcon24_authority(command jsonb)
returns jsonb language plpgsql volatile security definer set search_path='' as $function$
#variable_conflict use_variable
declare authority record;scope_json jsonb;expected_authority jsonb;expected_release jsonb;versions jsonb;
  current_epoch app_data_agent.falcon24_current_authority_epoch%rowtype;
  pointer semantic.semantic_active_pointer%rowtype;
  runtime semantic.semantic_runtime_activation%rowtype;
  defaults_pointer app_data_agent.workspace_run_defaults%rowtype;
  defaults_revision app_data_agent.workspace_run_default_revisions%rowtype;
  source_release semantic.semantic_source_release%rowtype;
  baseline app_data_agent.falcon24_authority_baselines%rowtype;
  attempt app_data_agent.falcon24_authority_activation_attempts%rowtype;
  session app_data_agent.falcon24_authority_staging_sessions%rowtype;
  semantic_receipt app_data_agent.falcon24_authority_staging_receipts%rowtype;
  requested_epoch text;now_at timestamptz;is_replay boolean:=false;
begin
  if command->>'schema_version'='falcon24-activation-request@2.0.0' then
    if command->>'authority_epoch' not in('E2','E3')
    then raise exception using errcode='22023',message='FALCON24_AUTHORITY_ACTIVATION_INVALID'; end if;
    return app_data_agent.activate_falcon24_authority_pre_retained(command);
  end if;
  if command is null or pg_catalog.jsonb_typeof(command) is distinct from 'object'
    or app_data_agent.provider_json_object_has_exact_keys(command,array[
      'schema_version','scope','authority_epoch','attempt_id','baseline_id','expected_baseline_hash',
      'expected_current_authority','expected_semantic_release','expected_versions',
      'retained_semantic_proof_hash','command_hash']::text[]) is distinct from true
    or command->>'schema_version'<>'falcon24-activation-request@3.0.0'
    or app_data_agent.falcon24_authority_epoch_is_canonical(command->>'authority_epoch')
      is distinct from true
    or pg_catalog.substr(command->>'authority_epoch',2)::numeric<5
    or app_data_agent.canonical_uuid_json_string_is_valid(command->'attempt_id') is distinct from true
    or app_data_agent.canonical_uuid_json_string_is_valid(command->'baseline_id') is distinct from true
    or command->>'expected_baseline_hash'!~'^sha256:[0-9a-f]{64}$'
    or command->>'retained_semantic_proof_hash'!~'^sha256:[0-9a-f]{64}$'
    or command->>'command_hash' is distinct from app_data_agent.u2_canonical_sha256(command-'command_hash')
    or pg_catalog.jsonb_typeof(command->'scope') is distinct from 'object'
    or pg_catalog.jsonb_typeof(command->'expected_current_authority') is distinct from 'object'
    or pg_catalog.jsonb_typeof(command->'expected_semantic_release') is distinct from 'object'
    or pg_catalog.jsonb_typeof(command->'expected_versions') is distinct from 'object'
  then raise exception using errcode='22023',message='FALCON24_RETAINED_ACTIVATION_INVALID'; end if;
  scope_json:=command->'scope';expected_authority:=command->'expected_current_authority';
  expected_release:=command->'expected_semantic_release';versions:=command->'expected_versions';
  if app_data_agent.provider_json_object_has_exact_keys(scope_json,array[
      'app_id','tenant_id','environment','semantic_domain']::text[]) is distinct from true
    or app_data_agent.canonical_uuid_json_string_is_valid(scope_json->'app_id') is distinct from true
    or app_data_agent.canonical_uuid_json_string_is_valid(scope_json->'tenant_id') is distinct from true
    or scope_json->>'environment'!~'^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$'
    or scope_json->>'semantic_domain'!~'^[A-Za-z_][A-Za-z0-9_]{0,63}$'
    or app_data_agent.provider_json_object_has_exact_keys(expected_authority,array[
      'schema_version','authority_epoch','baseline_id','baseline_hash','activation_attempt_id']::text[])
      is distinct from true
    or expected_authority->>'schema_version'<>'falcon24-authority-binding@2.0.0'
    or app_data_agent.falcon24_authority_epoch_is_canonical(expected_authority->>'authority_epoch')
      is distinct from true
    or pg_catalog.substr(command->>'authority_epoch',2)::numeric
      <>pg_catalog.substr(expected_authority->>'authority_epoch',2)::numeric+1
    or app_data_agent.canonical_uuid_json_string_is_valid(expected_authority->'baseline_id')
      is distinct from true
    or expected_authority->>'baseline_hash'!~'^sha256:[0-9a-f]{64}$'
    or app_data_agent.canonical_uuid_json_string_is_valid(expected_authority->'activation_attempt_id')
      is distinct from true
    or app_data_agent.provider_json_object_has_exact_keys(expected_release,array[
      'release_id','generation','release_digest','datasource_id']::text[]) is distinct from true
    or app_data_agent.canonical_uuid_json_string_is_valid(expected_release->'release_id')
      is distinct from true
    or expected_release->>'generation'<>'2'
    or expected_release->>'release_digest'!~'^sha256:[0-9a-f]{64}$'
    or app_data_agent.canonical_uuid_json_string_is_valid(expected_release->'datasource_id')
      is distinct from true
    or app_data_agent.provider_json_object_has_exact_keys(versions,array[
      'semantic_pointer','semantic_runtime','workspace_defaults']::text[]) is distinct from true
    or exists(select 1 from pg_catalog.jsonb_each(versions) entry
      where pg_catalog.jsonb_typeof(entry.value)<>'number' or entry.value#>>'{}'!~'^[1-9][0-9]*$')
  then raise exception using errcode='22023',message='FALCON24_RETAINED_ACTIVATION_INVALID'; end if;

  requested_epoch:=command->>'authority_epoch';
  select * into strict authority from platform.current_backend_authority(true);
  if scope_json->>'app_id' is distinct from authority.app_id::text
    or scope_json->>'tenant_id' is distinct from authority.tenant_id::text
    or scope_json->>'environment' is distinct from authority.environment
    or scope_json->>'semantic_domain' is distinct from
      nullif(pg_catalog.current_setting('app.semantic_domain',true),'')
  then raise exception using errcode='42501',message='FALCON24_RETAINED_ACTIVATION_SCOPE_FORBIDDEN'; end if;

  -- Global lock order: semantic fence -> Falcon activation -> Falcon current -> semantic
  -- pointer/runtime -> workspace defaults pointer/revision -> E5 baseline/attempt/session -> receipts.
  perform semantic.lock_semantic_authority_fence(
    authority.app_id,authority.tenant_id,authority.environment,scope_json->>'semantic_domain');
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'falcon24-authority-activation:'||authority.app_id::text||':'||authority.tenant_id::text||':'||
      authority.environment,0));
  select * into current_epoch from app_data_agent.falcon24_current_authority_epoch row
    where row.app_id=authority.app_id and row.tenant_id=authority.tenant_id
      and row.environment=authority.environment for update;
  select * into pointer from semantic.semantic_active_pointer row
    where row.app_id=authority.app_id and row.tenant_id=authority.tenant_id
      and row.environment=authority.environment and row.semantic_domain=scope_json->>'semantic_domain'
    for update;
  select * into runtime from semantic.semantic_runtime_activation row
    where row.app_id=authority.app_id and row.tenant_id=authority.tenant_id
      and row.environment=authority.environment and row.semantic_domain=scope_json->>'semantic_domain'
    for update;
  select * into defaults_pointer from app_data_agent.workspace_run_defaults row
    where row.app_id=authority.app_id and row.tenant_id=authority.tenant_id
      and row.environment=authority.environment for update;
  select * into defaults_revision from app_data_agent.workspace_run_default_revisions row
    where row.app_id=defaults_pointer.app_id and row.tenant_id=defaults_pointer.tenant_id
      and row.environment=defaults_pointer.environment and row.defaults_id=defaults_pointer.defaults_id
      and row.defaults_revision=defaults_pointer.defaults_revision
      and row.revision_id=defaults_pointer.revision_id and row.defaults_hash=defaults_pointer.defaults_hash
    for update;
  select * into baseline from app_data_agent.falcon24_authority_baselines row
    where row.app_id=authority.app_id and row.tenant_id=authority.tenant_id
      and row.environment=authority.environment and row.baseline_id=(command->>'baseline_id')::uuid
      and row.authority_epoch=requested_epoch for update;
  select * into attempt from app_data_agent.falcon24_authority_activation_attempts row
    where row.app_id=authority.app_id and row.tenant_id=authority.tenant_id
      and row.environment=authority.environment and row.attempt_id=(command->>'attempt_id')::uuid
      and row.authority_epoch=requested_epoch for update;
  select * into session from app_data_agent.falcon24_authority_staging_sessions row
    where row.app_id=authority.app_id and row.tenant_id=authority.tenant_id
      and row.environment=authority.environment and row.staging_id=baseline.staging_id
      and row.authority_epoch=requested_epoch for update;
  perform 1 from app_data_agent.falcon24_authority_staging_receipts row
    where row.app_id=authority.app_id and row.tenant_id=authority.tenant_id
      and row.environment=authority.environment and row.staging_id=baseline.staging_id
      and row.authority_epoch=requested_epoch order by row.component for share;
  select * into semantic_receipt from app_data_agent.falcon24_authority_staging_receipts row
    where row.app_id=authority.app_id and row.tenant_id=authority.tenant_id
      and row.environment=authority.environment and row.staging_id=baseline.staging_id
      and row.authority_epoch=requested_epoch and row.component='SEMANTIC_RELEASE';

  is_replay:=current_epoch.authority_epoch=requested_epoch
    and current_epoch.baseline_id=(command->>'baseline_id')::uuid
    and current_epoch.baseline_hash=command->>'expected_baseline_hash'
    and current_epoch.activation_attempt_id=(command->>'attempt_id')::uuid
    and attempt.status='ACTIVATED' and baseline.status='ACTIVE' and session.status='CONSUMED';
  if is_replay and not exists(
    select 1 from app_data_agent.falcon24_authority_baselines predecessor_baseline
    join app_data_agent.falcon24_authority_activation_attempts predecessor_attempt
      on predecessor_attempt.app_id=predecessor_baseline.app_id
      and predecessor_attempt.tenant_id=predecessor_baseline.tenant_id
      and predecessor_attempt.environment=predecessor_baseline.environment
      and predecessor_attempt.authority_epoch=predecessor_baseline.authority_epoch
      and predecessor_attempt.attempt_id=predecessor_baseline.activation_attempt_id
    where predecessor_baseline.app_id=authority.app_id
      and predecessor_baseline.tenant_id=authority.tenant_id
      and predecessor_baseline.environment=authority.environment
      and predecessor_baseline.authority_epoch=expected_authority->>'authority_epoch'
      and predecessor_baseline.baseline_id=(expected_authority->>'baseline_id')::uuid
      and predecessor_baseline.baseline_hash=expected_authority->>'baseline_hash'
      and predecessor_baseline.activation_attempt_id=
        (expected_authority->>'activation_attempt_id')::uuid
      and predecessor_baseline.status='ACTIVE' and predecessor_attempt.status='ACTIVATED')
  then raise exception using errcode='55000',
    message='FALCON24_RETAINED_ACTIVATION_REPLAY_CONFLICT'; end if;

  if not is_replay and (current_epoch.authority_epoch is distinct from
      expected_authority->>'authority_epoch'
    or current_epoch.baseline_id is distinct from (expected_authority->>'baseline_id')::uuid
    or current_epoch.baseline_hash is distinct from expected_authority->>'baseline_hash'
    or current_epoch.activation_attempt_id is distinct from
      (expected_authority->>'activation_attempt_id')::uuid
    or pg_catalog.substr(requested_epoch,2)::numeric
      <>pg_catalog.substr(current_epoch.authority_epoch,2)::numeric+1)
  then raise exception using errcode='40001',message='FALCON24_RETAINED_ACTIVATION_PREDECESSOR_MISMATCH'; end if;
  if pointer.pointer_generation is distinct from (versions->>'semantic_pointer')::bigint
    or runtime.activation_generation is distinct from (versions->>'semantic_runtime')::bigint
    or defaults_pointer.defaults_revision is distinct from (versions->>'workspace_defaults')::bigint
    or pointer.current_release_id is distinct from (expected_release->>'release_id')::uuid
    or pointer.current_release_generation is distinct from 2
    or pointer.current_release_digest is distinct from expected_release->>'release_digest'
    or runtime.current_release_id is distinct from pointer.current_release_id
    or runtime.current_release_generation is distinct from pointer.current_release_generation
    or defaults_revision.defaults_json#>>'{semantic_release,resource_id}'
      is distinct from pointer.current_release_id::text
    or defaults_revision.defaults_json#>>'{semantic_release,resource_revision}' is distinct from '2'
    or defaults_revision.defaults_json#>>'{semantic_release,resource_hash}'
      is distinct from pointer.current_release_digest
  then raise exception using errcode='40001',message='FALCON24_RETAINED_SEMANTIC_CLOSURE_STALE'; end if;
  select * into source_release from semantic.semantic_source_release row
    where row.app_id=authority.app_id and row.tenant_id=authority.tenant_id
      and row.environment=authority.environment and row.semantic_domain=scope_json->>'semantic_domain'
      and row.release_id=pointer.current_release_id;
  if source_release.release_generation is distinct from 2
    or source_release.release_digest is distinct from pointer.current_release_digest
    or not exists(select 1 from semantic.semantic_executable_projection row
      where row.app_id=source_release.app_id and row.tenant_id=source_release.tenant_id
        and row.environment=source_release.environment and row.semantic_domain=source_release.semantic_domain
        and row.release_id=source_release.release_id
        and row.projection_id=source_release.executable_projection_ref
        and row.projection_digest=source_release.executable_projection_hash)
    or not exists(select 1 from semantic.semantic_relationship_projection row
      where row.app_id=source_release.app_id and row.tenant_id=source_release.tenant_id
        and row.environment=source_release.environment and row.semantic_domain=source_release.semantic_domain
        and row.release_id=source_release.release_id
        and row.projection_id=source_release.relationship_projection_ref
        and row.projection_digest=source_release.relationship_projection_hash
        and row.datasource_id=(expected_release->>'datasource_id')::uuid)
    or not exists(select 1 from semantic.semantic_runtime_restriction_projection row
      where row.app_id=source_release.app_id and row.tenant_id=source_release.tenant_id
        and row.environment=source_release.environment and row.semantic_domain=source_release.semantic_domain
        and row.release_id=source_release.release_id
        and row.projection_id=source_release.runtime_restriction_projection_ref
        and row.projection_digest=source_release.runtime_restriction_projection_hash)
    or not exists(select 1 from semantic.semantic_source_release_graph_projection row
      join semantic.semantic_graph_projection graph
        on graph.app_id=row.app_id and graph.tenant_id=row.tenant_id
        and graph.environment=row.environment and graph.semantic_domain=row.semantic_domain
        and graph.projection_id=row.projection_id
      where row.app_id=source_release.app_id and row.tenant_id=source_release.tenant_id
        and row.environment=source_release.environment and row.semantic_domain=source_release.semantic_domain
        and row.release_id=source_release.release_id
        and graph.projection_storage_digest=row.projection_storage_digest)
  then raise exception using errcode='55000',message='FALCON24_RETAINED_SEMANTIC_CLOSURE_INVALID'; end if;
  if baseline.baseline_hash is distinct from command->>'expected_baseline_hash'
    or attempt.baseline_id is distinct from baseline.baseline_id
    or attempt.expected_baseline_hash is distinct from baseline.baseline_hash
    or semantic_receipt.subject_hash is distinct from expected_release->>'release_digest'
    or semantic_receipt.evidence_hash is distinct from command->>'retained_semantic_proof_hash'
    or baseline.baseline_document#>>'{staging_receipts,semantic_release}'
      is distinct from semantic_receipt.receipt_hash
    or (select pg_catalog.count(*) from app_data_agent.falcon24_authority_staging_receipts row
      where row.app_id=baseline.app_id and row.tenant_id=baseline.tenant_id
        and row.environment=baseline.environment and row.staging_id=baseline.staging_id
        and row.authority_epoch=requested_epoch)<>6
    or (is_replay and (baseline.status<>'ACTIVE' or session.status<>'CONSUMED'
      or attempt.status<>'ACTIVATED'))
    or (not is_replay and (baseline.status<>'STAGED' or session.status<>'STAGED'
      or attempt.status<>'OPEN'))
  then
    if is_replay then raise exception using errcode='55000',
      message='FALCON24_RETAINED_ACTIVATION_REPLAY_CONFLICT'; end if;
    raise exception using errcode='55000',message='FALCON24_RETAINED_ACTIVATION_BASELINE_MISMATCH';
  end if;
  if is_replay then return app_data_agent.falcon24_authority_binding_document(current_epoch); end if;
  if exists(select 1 from app_data_agent.runs row where row.app_id=authority.app_id
      and row.tenant_id=authority.tenant_id and row.environment=authority.environment
      and row.authority_epoch=requested_epoch)
    or exists(select 1 from app_data_agent.effective_run_config_receipts row
      where row.app_id=authority.app_id and row.tenant_id=authority.tenant_id
        and row.environment=authority.environment and row.authority_epoch=requested_epoch)
    or exists(select 1 from app_data_agent.artifacts row where row.app_id=authority.app_id
      and row.tenant_id=authority.tenant_id and row.environment=authority.environment
      and row.authority_epoch=requested_epoch)
    or exists(select 1 from app_data_agent.falcon24_diagnostic_attempts row
      where row.app_id=authority.app_id and row.tenant_id=authority.tenant_id
        and row.environment=authority.environment and row.authority_epoch=requested_epoch)
    or exists(select 1 from app_data_agent.falcon24_qualifications row
      where row.app_id=authority.app_id and row.tenant_id=authority.tenant_id
        and row.environment=authority.environment and row.authority_epoch=requested_epoch)
    or exists(select 1 from app_data_agent.falcon24_acceptance_campaigns row
      where row.app_id=authority.app_id and row.tenant_id=authority.tenant_id
        and row.environment=authority.environment and row.authority_epoch=requested_epoch)
    or exists(select 1 from app_data_agent.falcon24_gate_attempt_history row
      where row.app_id=authority.app_id and row.tenant_id=authority.tenant_id
        and row.environment=authority.environment and row.authority_epoch=requested_epoch)
    or exists(select 1 from app_data_agent.falcon24_ui_receipts row
      where row.app_id=authority.app_id and row.tenant_id=authority.tenant_id
        and row.environment=authority.environment and row.authority_epoch=requested_epoch)
  then raise exception using errcode='55000',message='FALCON24_RETAINED_AUTHORITY_POLLUTED'; end if;

  now_at:=pg_catalog.clock_timestamp();
  update app_data_agent.falcon24_authority_activation_attempts set
    status='ACTIVATED',decided_at=now_at
    where app_id=authority.app_id and tenant_id=authority.tenant_id
      and environment=authority.environment and attempt_id=attempt.attempt_id and status='OPEN';
  if not found then raise exception using errcode='40001',message='FALCON24_RETAINED_ACTIVATION_RACE'; end if;
  update app_data_agent.falcon24_authority_baselines set
    status='ACTIVE',activation_attempt_id=attempt.attempt_id,activated_at=now_at
    where app_id=authority.app_id and tenant_id=authority.tenant_id
      and environment=authority.environment and baseline_id=baseline.baseline_id and status='STAGED';
  if not found then raise exception using errcode='40001',message='FALCON24_RETAINED_ACTIVATION_RACE'; end if;
  update app_data_agent.falcon24_authority_staging_sessions set status='CONSUMED',updated_at=now_at
    where app_id=authority.app_id and tenant_id=authority.tenant_id
      and environment=authority.environment and staging_id=session.staging_id
      and authority_epoch=requested_epoch and status='STAGED';
  if not found then raise exception using errcode='40001',message='FALCON24_RETAINED_ACTIVATION_RACE'; end if;
  update app_data_agent.falcon24_current_authority_epoch set
    authority_epoch=requested_epoch,baseline_id=baseline.baseline_id,
    baseline_hash=baseline.baseline_hash,activation_attempt_id=attempt.attempt_id,activated_at=now_at
    where app_id=authority.app_id and tenant_id=authority.tenant_id
      and environment=authority.environment and authority_epoch=current_epoch.authority_epoch
    returning * into strict current_epoch;
  return app_data_agent.falcon24_authority_binding_document(current_epoch);
exception when invalid_text_representation or numeric_value_out_of_range then
  raise exception using errcode='22023',message='FALCON24_RETAINED_ACTIVATION_INVALID';
end
$function$;
alter function app_data_agent.begin_falcon24_diagnostic(jsonb)
  rename to begin_falcon24_diagnostic_e4_history;
alter function app_data_agent.complete_falcon24_diagnostic(jsonb)
  rename to complete_falcon24_diagnostic_e4_history;

create function app_data_agent.begin_falcon24_diagnostic(command jsonb)
returns jsonb language plpgsql volatile security definer set search_path='' as $function$
#variable_conflict use_variable
declare authority record;manifest jsonb;semantic_release jsonb;semantic_domain_value text;
  current_epoch app_data_agent.falcon24_current_authority_epoch%rowtype;
  baseline app_data_agent.falcon24_authority_baselines%rowtype;
  pointer semantic.semantic_active_pointer%rowtype;runtime semantic.semantic_runtime_activation%rowtype;
  defaults_pointer app_data_agent.workspace_run_defaults%rowtype;
  defaults_revision app_data_agent.workspace_run_default_revisions%rowtype;
  source_release semantic.semantic_source_release%rowtype;
  existing app_data_agent.falcon24_diagnostic_attempts%rowtype;
begin
  if command->>'schema_version'='falcon24-diagnostic-begin@1.0.0'
  then return app_data_agent.begin_falcon24_diagnostic_e4_history(command); end if;
  if command is null or pg_catalog.jsonb_typeof(command) is distinct from 'object'
    or app_data_agent.provider_json_object_has_exact_keys(command,array[
      'schema_version','manifest','command_hash']::text[]) is distinct from true
    or command->>'schema_version'<>'falcon24-diagnostic-begin@2.0.0'
    or command->>'command_hash' is distinct from app_data_agent.u2_canonical_sha256(command-'command_hash')
    or pg_catalog.jsonb_typeof(command->'manifest') is distinct from 'object'
  then raise exception using errcode='22023',message='FALCON24_DIAGNOSTIC_COMMAND_INVALID'; end if;
  manifest:=command->'manifest';semantic_release:=manifest->'semantic_release';
  if app_data_agent.provider_json_object_has_exact_keys(manifest,array[
      'schema_version','attempt_id','run_id','authority','semantic_release','source_commit',
      'source_fingerprint','web_build','worker_build','runtime_attestation_hash','question',
      'question_hash','manifest_hash']::text[]) is distinct from true
    or manifest->>'schema_version'<>'falcon24-diagnostic-attempt@2.0.0'
    or app_data_agent.canonical_uuid_json_string_is_valid(manifest->'attempt_id') is distinct from true
    or app_data_agent.canonical_uuid_json_string_is_valid(manifest->'run_id') is distinct from true
    or app_data_agent.provider_json_object_has_exact_keys(manifest->'authority',array[
      'schema_version','authority_epoch','baseline_id','baseline_hash','activation_attempt_id']::text[])
      is distinct from true
    or manifest#>>'{authority,schema_version}'<>'falcon24-authority-binding@2.0.0'
    or app_data_agent.falcon24_authority_epoch_is_canonical(
      manifest#>>'{authority,authority_epoch}') is distinct from true
    or pg_catalog.substr(manifest#>>'{authority,authority_epoch}',2)::numeric<5
    or app_data_agent.canonical_uuid_json_string_is_valid(manifest#>'{authority,baseline_id}')
      is distinct from true
    or manifest#>>'{authority,baseline_hash}'!~'^sha256:[0-9a-f]{64}$'
    or app_data_agent.canonical_uuid_json_string_is_valid(
      manifest#>'{authority,activation_attempt_id}') is distinct from true
    or app_data_agent.provider_json_object_has_exact_keys(semantic_release,array[
      'release_id','generation','release_digest','datasource_id']::text[]) is distinct from true
    or app_data_agent.canonical_uuid_json_string_is_valid(semantic_release->'release_id')
      is distinct from true
    or semantic_release->>'generation'<>'2'
    or semantic_release->>'release_digest'!~'^sha256:[0-9a-f]{64}$'
    or app_data_agent.canonical_uuid_json_string_is_valid(semantic_release->'datasource_id')
      is distinct from true
    or manifest->>'source_commit'!~'^[0-9a-f]{40}$'
    or manifest->>'source_fingerprint'!~'^sha256:[0-9a-f]{64}$'
    or app_data_agent.provider_json_object_has_exact_keys(manifest->'web_build',array[
      'build_id','generation_id']::text[]) is distinct from true
    or app_data_agent.provider_json_object_has_exact_keys(manifest->'worker_build',array[
      'build_id','generation_id']::text[]) is distinct from true
    or exists(select 1 from pg_catalog.unnest(array[
      manifest#>>'{web_build,build_id}',manifest#>>'{web_build,generation_id}',
      manifest#>>'{worker_build,build_id}',manifest#>>'{worker_build,generation_id}',
      manifest->>'runtime_attestation_hash']::text[]) value
      where value!~'^sha256:[0-9a-f]{64}$')
    or manifest->>'question'<>'最近 12 个完整月的订单收入趋势如何？请按月展示，并生成折线图。'
    or manifest->>'question_hash' is distinct from
      app_data_agent.u2_canonical_sha256(pg_catalog.to_jsonb(manifest->>'question'))
    or manifest->>'manifest_hash' is distinct from
      app_data_agent.u2_canonical_sha256(manifest-'manifest_hash')
  then raise exception using errcode='22023',message='FALCON24_DIAGNOSTIC_MANIFEST_INVALID'; end if;

  select * into strict authority from platform.current_backend_authority(true);
  semantic_domain_value:=nullif(pg_catalog.current_setting('app.semantic_domain',true),'');
  if semantic_domain_value is null
  then raise exception using errcode='42501',message='FALCON24_DIAGNOSTIC_AUTHORITY_MISMATCH'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'falcon24-diagnostic:'||authority.app_id::text||':'||authority.tenant_id::text||':'||
      authority.environment,0));
  select * into current_epoch from app_data_agent.falcon24_current_authority_epoch row
    where row.app_id=authority.app_id and row.tenant_id=authority.tenant_id
      and row.environment=authority.environment for share;
  select * into baseline from app_data_agent.falcon24_authority_baselines row
    where row.app_id=authority.app_id and row.tenant_id=authority.tenant_id
      and row.environment=authority.environment and row.baseline_id=current_epoch.baseline_id
      and row.baseline_hash=current_epoch.baseline_hash
      and row.authority_epoch=current_epoch.authority_epoch for share;
  select * into pointer from semantic.semantic_active_pointer row
    where row.app_id=authority.app_id and row.tenant_id=authority.tenant_id
      and row.environment=authority.environment and row.semantic_domain=semantic_domain_value for share;
  select * into runtime from semantic.semantic_runtime_activation row
    where row.app_id=authority.app_id and row.tenant_id=authority.tenant_id
      and row.environment=authority.environment and row.semantic_domain=semantic_domain_value for share;
  select * into defaults_pointer from app_data_agent.workspace_run_defaults row
    where row.app_id=authority.app_id and row.tenant_id=authority.tenant_id
      and row.environment=authority.environment for share;
  select * into defaults_revision from app_data_agent.workspace_run_default_revisions row
    where row.app_id=defaults_pointer.app_id and row.tenant_id=defaults_pointer.tenant_id
      and row.environment=defaults_pointer.environment and row.defaults_id=defaults_pointer.defaults_id
      and row.defaults_revision=defaults_pointer.defaults_revision
      and row.revision_id=defaults_pointer.revision_id and row.defaults_hash=defaults_pointer.defaults_hash
    for share;
  select * into source_release from semantic.semantic_source_release row
    where row.app_id=authority.app_id and row.tenant_id=authority.tenant_id
      and row.environment=authority.environment and row.semantic_domain=semantic_domain_value
      and row.release_id=(semantic_release->>'release_id')::uuid;
  if current_epoch.authority_epoch is distinct from manifest#>>'{authority,authority_epoch}'
    or pg_catalog.substr(current_epoch.authority_epoch,2)::numeric<5
    or current_epoch.baseline_id is distinct from (manifest#>>'{authority,baseline_id}')::uuid
    or current_epoch.baseline_hash is distinct from manifest#>>'{authority,baseline_hash}'
    or current_epoch.activation_attempt_id is distinct from
      (manifest#>>'{authority,activation_attempt_id}')::uuid
    or baseline.status is distinct from 'ACTIVE'
    or baseline.source_commit is distinct from manifest->>'source_commit'
    or baseline.web_build_hash is distinct from manifest#>>'{web_build,build_id}'
  then raise exception using errcode='55000',message='FALCON24_DIAGNOSTIC_AUTHORITY_MISMATCH'; end if;
  if source_release.release_generation is distinct from 2
    or source_release.release_digest is distinct from semantic_release->>'release_digest'
    or pointer.current_release_id is distinct from source_release.release_id
    or pointer.current_release_generation is distinct from 2
    or pointer.current_release_digest is distinct from source_release.release_digest
    or runtime.current_release_id is distinct from source_release.release_id
    or runtime.current_release_generation is distinct from 2
    or defaults_revision.defaults_json#>>'{semantic_release,resource_id}'
      is distinct from source_release.release_id::text
    or defaults_revision.defaults_json#>>'{semantic_release,resource_revision}' is distinct from '2'
    or defaults_revision.defaults_json#>>'{semantic_release,resource_hash}'
      is distinct from source_release.release_digest
    or not exists(select 1 from semantic.semantic_relationship_projection row
      where row.app_id=source_release.app_id and row.tenant_id=source_release.tenant_id
        and row.environment=source_release.environment and row.semantic_domain=source_release.semantic_domain
        and row.release_id=source_release.release_id
        and row.datasource_id=(semantic_release->>'datasource_id')::uuid)
  then raise exception using errcode='55000',
    message='FALCON24_DIAGNOSTIC_SEMANTIC_RELEASE_MISMATCH'; end if;
  if exists(select 1 from app_data_agent.falcon24_qualifications row
      where row.app_id=authority.app_id and row.tenant_id=authority.tenant_id
        and row.environment=authority.environment and row.authority_epoch=current_epoch.authority_epoch)
  then raise exception using errcode='55000',
    message='FALCON24_DIAGNOSTIC_FORMAL_GATE_ALREADY_STARTED'; end if;
  select * into existing from app_data_agent.falcon24_diagnostic_attempts row
    where row.app_id=authority.app_id and row.tenant_id=authority.tenant_id
      and row.environment=authority.environment and row.attempt_id=(manifest->>'attempt_id')::uuid;
  if found then
    if existing.manifest_hash=manifest->>'manifest_hash' then return pg_catalog.to_jsonb(existing); end if;
    raise exception using errcode='55000',message='FALCON24_DIAGNOSTIC_ATTEMPT_IMMUTABLE';
  end if;
  if exists(select 1 from app_data_agent.falcon24_diagnostic_attempts row
      where row.app_id=authority.app_id and row.tenant_id=authority.tenant_id
        and row.environment=authority.environment and row.authority_baseline_id=current_epoch.baseline_id
        and row.semantic_release_id=source_release.release_id and row.status='ACTIVE')
  then raise exception using errcode='55000',message='FALCON24_DIAGNOSTIC_ACTIVE_ATTEMPT_EXISTS'; end if;
  insert into app_data_agent.falcon24_diagnostic_attempts(
    app_id,tenant_id,environment,principal_id,attempt_id,run_id,authority_epoch,
    authority_baseline_id,authority_baseline_hash,authority_activation_attempt_id,
    semantic_domain,semantic_release_id,semantic_release_generation,semantic_release_digest,
    datasource_id,source_commit,source_fingerprint,web_build_id,web_generation_id,
    worker_build_id,worker_generation_id,runtime_attestation_hash,question_hash,
    manifest_hash,manifest_document,status)
  values(authority.app_id,authority.tenant_id,authority.environment,authority.principal_id,
    (manifest->>'attempt_id')::uuid,(manifest->>'run_id')::uuid,current_epoch.authority_epoch,
    current_epoch.baseline_id,current_epoch.baseline_hash,current_epoch.activation_attempt_id,
    semantic_domain_value,source_release.release_id,2,source_release.release_digest,
    (semantic_release->>'datasource_id')::uuid,manifest->>'source_commit',
    manifest->>'source_fingerprint',manifest#>>'{web_build,build_id}',
    manifest#>>'{web_build,generation_id}',manifest#>>'{worker_build,build_id}',
    manifest#>>'{worker_build,generation_id}',manifest->>'runtime_attestation_hash',
    manifest->>'question_hash',manifest->>'manifest_hash',manifest,'ACTIVE')
  returning * into strict existing;
  return pg_catalog.to_jsonb(existing);
exception when invalid_text_representation or numeric_value_out_of_range then
  raise exception using errcode='22023',message='FALCON24_DIAGNOSTIC_MANIFEST_INVALID';
end
$function$;

create function app_data_agent.complete_falcon24_diagnostic(command jsonb)
returns jsonb language plpgsql volatile security definer set search_path='' as $function$
#variable_conflict use_variable
declare authority record;current_epoch record;pointer record;runtime record;run_row record;
  attempt app_data_agent.falcon24_diagnostic_attempts%rowtype;
  existing app_data_agent.falcon24_diagnostic_receipts%rowtype;
  qa_receipt app_data_agent.falcon24_ui_receipts%rowtype;
  trace_receipt app_data_agent.falcon24_ui_receipts%rowtype;
  outcome_value text;now_at timestamptz;pass_evidence jsonb;receipt jsonb;receipt_hash_value text;
  failure_class_value text;failure_code_value text;reference jsonb;artifact_count integer;
  reclamation jsonb;receipt_version text;
begin
  if command is null or pg_catalog.jsonb_typeof(command) is distinct from 'object'
    or command->>'schema_version'<>'falcon24-diagnostic-complete@1.0.0'
    or app_data_agent.canonical_uuid_json_string_is_valid(command->'attempt_id') is distinct from true
    or command->>'command_hash' is distinct from app_data_agent.u2_canonical_sha256(command-'command_hash')
    or command->>'outcome' not in('PASS','FAIL')
  then raise exception using errcode='22023',message='FALCON24_DIAGNOSTIC_COMMAND_INVALID'; end if;
  outcome_value:=command->>'outcome';
  if (outcome_value='PASS' and app_data_agent.provider_json_object_has_exact_keys(command,array[
      'schema_version','attempt_id','outcome','viewport_width','observed_execution_path',
      'sandbox_reclamation_receipt','command_hash']::text[]) is distinct from true)
    or (outcome_value='FAIL' and app_data_agent.provider_json_object_has_exact_keys(command,array[
      'schema_version','attempt_id','outcome','failure_class','failure_code','command_hash']::text[])
      is distinct from true)
  then raise exception using errcode='22023',message='FALCON24_DIAGNOSTIC_COMMAND_INVALID'; end if;
  select * into strict authority from platform.current_backend_authority(true);
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'falcon24-diagnostic:'||authority.app_id::text||':'||authority.tenant_id::text||':'||
      authority.environment,0));
  select * into attempt from app_data_agent.falcon24_diagnostic_attempts row
    where row.app_id=authority.app_id and row.tenant_id=authority.tenant_id
      and row.environment=authority.environment and row.principal_id=authority.principal_id
      and row.attempt_id=(command->>'attempt_id')::uuid for update;
  if not found then raise exception using errcode='02000',message='FALCON24_DIAGNOSTIC_ATTEMPT_NOT_FOUND'; end if;
  if attempt.manifest_document->>'schema_version'='falcon24-diagnostic-attempt@1.0.0'
  then return app_data_agent.complete_falcon24_diagnostic_e4_history(command); end if;
  select * into existing from app_data_agent.falcon24_diagnostic_receipts row
    where row.app_id=attempt.app_id and row.tenant_id=attempt.tenant_id
      and row.environment=attempt.environment and row.attempt_id=attempt.attempt_id;
  if found then
    if existing.completion_command_hash=command->>'command_hash'
    then return existing.receipt_document; end if;
    raise exception using errcode='55000',message='FALCON24_DIAGNOSTIC_REPLAY_MISMATCH';
  end if;
  if attempt.status<>'ACTIVE'
  then raise exception using errcode='55000',message='FALCON24_DIAGNOSTIC_ATTEMPT_IMMUTABLE'; end if;
  select * into current_epoch from app_data_agent.falcon24_current_authority_epoch row
    where row.app_id=attempt.app_id and row.tenant_id=attempt.tenant_id
      and row.environment=attempt.environment for share;
  select * into pointer from semantic.semantic_active_pointer row
    where row.app_id=attempt.app_id and row.tenant_id=attempt.tenant_id
      and row.environment=attempt.environment and row.semantic_domain=attempt.semantic_domain for share;
  select * into runtime from semantic.semantic_runtime_activation row
    where row.app_id=attempt.app_id and row.tenant_id=attempt.tenant_id
      and row.environment=attempt.environment and row.semantic_domain=attempt.semantic_domain for share;
  if current_epoch.authority_epoch is distinct from attempt.authority_epoch
    or current_epoch.baseline_id is distinct from attempt.authority_baseline_id
    or current_epoch.baseline_hash is distinct from attempt.authority_baseline_hash
    or current_epoch.activation_attempt_id is distinct from attempt.authority_activation_attempt_id
  then raise exception using errcode='55000',message='FALCON24_DIAGNOSTIC_AUTHORITY_MISMATCH'; end if;
  if pointer.current_release_id is distinct from attempt.semantic_release_id
    or pointer.current_release_generation is distinct from attempt.semantic_release_generation
    or pointer.current_release_digest is distinct from attempt.semantic_release_digest
    or runtime.current_release_id is distinct from attempt.semantic_release_id
    or runtime.current_release_generation is distinct from attempt.semantic_release_generation
  then raise exception using errcode='55000',
    message='FALCON24_DIAGNOSTIC_SEMANTIC_RELEASE_MISMATCH'; end if;
  pass_evidence:=null;failure_class_value:=null;failure_code_value:=null;
  if outcome_value='FAIL' then
    failure_class_value:=command->>'failure_class';failure_code_value:=command->>'failure_code';
    if failure_class_value not in('FROZEN_CLOSURE_CHANGE_REQUIRED','EXTERNAL_DEPENDENCY')
      or failure_code_value!~'^[A-Z][A-Z0-9_]{2,127}$'
    then raise exception using errcode='22023',message='FALCON24_DIAGNOSTIC_COMMAND_INVALID'; end if;
  else
    reclamation:=command->'sandbox_reclamation_receipt';
    if pg_catalog.jsonb_typeof(command->'viewport_width') is distinct from 'number'
      or command->>'viewport_width' not in('390','1440')
      or command->'observed_execution_path' is distinct from
        '["SEMANTIC","TEXT2SQL","SQL","QUERY_EVIDENCE","TYPED_ARROW","PYTHON_OPERATOR","ANALYSIS_REPORT","CHART"]'::jsonb
      or pg_catalog.jsonb_typeof(reclamation) is distinct from 'object'
      or reclamation->>'schema_version'<>'falcon24-sandbox-reclamation-receipt@3.0.0'
      or reclamation->>'authority_epoch'<>attempt.authority_epoch
      or reclamation->>'campaign_id'<>attempt.authority_epoch||'-Q1'
      or reclamation->>'run_id'<>attempt.run_id::text or reclamation->>'residual'<>'0'
      or reclamation->>'runtime_attestation_hash'<>attempt.runtime_attestation_hash
      or reclamation->>'receipt_hash' is distinct from
        app_data_agent.u2_canonical_sha256(reclamation-'receipt_hash')
    then raise exception using errcode='22023',message='FALCON24_DIAGNOSTIC_COMMAND_INVALID'; end if;
    select * into run_row from app_data_agent.runs row
      where row.app_id=attempt.app_id and row.tenant_id=attempt.tenant_id
        and row.environment=attempt.environment and row.run_id=attempt.run_id
        and row.principal_id=attempt.principal_id and row.status='SUCCEEDED' for share;
    if not found or run_row.question<>'最近 12 个完整月的订单收入趋势如何？请按月展示，并生成折线图。'
      or run_row.authority_epoch is distinct from attempt.authority_epoch
      or run_row.authority_baseline_id is distinct from attempt.authority_baseline_id
      or run_row.authority_baseline_hash is distinct from attempt.authority_baseline_hash
      or run_row.authority_activation_attempt_id is distinct from attempt.authority_activation_attempt_id
    then raise exception using errcode='55000',message='FALCON24_DIAGNOSTIC_RUN_NOT_READY'; end if;
    select * into qa_receipt from app_data_agent.falcon24_ui_receipts row
      where row.app_id=attempt.app_id and row.tenant_id=attempt.tenant_id
        and row.environment=attempt.environment and row.run_id=attempt.run_id
        and row.receipt_kind='QA_E2E' and row.viewport_width=(command->>'viewport_width')::integer;
    select * into trace_receipt from app_data_agent.falcon24_ui_receipts row
      where row.app_id=attempt.app_id and row.tenant_id=attempt.tenant_id
        and row.environment=attempt.environment and row.run_id=attempt.run_id
        and row.receipt_kind='TRACE_UI' and row.viewport_width=(command->>'viewport_width')::integer;
    if qa_receipt.receipt_hash is null or trace_receipt.receipt_hash is null
      or qa_receipt.authority_epoch is distinct from attempt.authority_epoch
      or qa_receipt.baseline_id is distinct from attempt.authority_baseline_id
      or qa_receipt.baseline_hash is distinct from attempt.authority_baseline_hash
      or qa_receipt.activation_attempt_id is distinct from attempt.authority_activation_attempt_id
      or qa_receipt.web_build_hash is distinct from attempt.web_build_id
      or trace_receipt.authority_epoch is distinct from qa_receipt.authority_epoch
      or trace_receipt.baseline_id is distinct from qa_receipt.baseline_id
      or trace_receipt.baseline_hash is distinct from qa_receipt.baseline_hash
      or trace_receipt.activation_attempt_id is distinct from qa_receipt.activation_attempt_id
      or trace_receipt.web_build_hash is distinct from attempt.web_build_id
      or qa_receipt.receipt_json->>'question_hash' is distinct from attempt.question_hash
      or trace_receipt.receipt_json->>'trace_hash' is null
      or pg_catalog.jsonb_array_length(trace_receipt.receipt_json->'opened_artifact_refs')<>5
    then raise exception using errcode='55000',
      message='FALCON24_DIAGNOSTIC_UI_RECEIPT_PAIR_REQUIRED'; end if;
    if (select pg_catalog.array_agg(item->>'artifact_type' order by item->>'artifact_type')
        from pg_catalog.jsonb_array_elements(trace_receipt.receipt_json->'opened_artifact_refs') item)
      is distinct from array['AnalysisReport','ArtifactWorkspaceDocument',
        'DerivedAnalysisEvidence','QueryEvidence','SqlArtifact']::text[]
    then raise exception using errcode='55000',
      message='FALCON24_DIAGNOSTIC_ARTIFACT_CLOSURE_INVALID'; end if;
    artifact_count:=0;
    for reference in select item from pg_catalog.jsonb_array_elements(
        trace_receipt.receipt_json->'opened_artifact_refs') item loop
      if not exists(select 1 from app_data_agent.artifacts row
        where row.app_id=attempt.app_id and row.tenant_id=attempt.tenant_id
          and row.environment=attempt.environment and row.run_id=attempt.run_id
          and row.artifact_id=(reference->>'artifact_id')::uuid
          and row.artifact_type=reference->>'artifact_type'
          and row.revision=(reference->>'revision')::integer
          and row.content_hash=reference->>'content_hash' and row.is_active
          and row.authority_epoch=attempt.authority_epoch
          and row.authority_baseline_id=attempt.authority_baseline_id
          and row.authority_baseline_hash=attempt.authority_baseline_hash
          and row.authority_activation_attempt_id=attempt.authority_activation_attempt_id)
      then raise exception using errcode='55000',
        message='FALCON24_DIAGNOSTIC_ARTIFACT_CLOSURE_INVALID'; end if;
      artifact_count:=artifact_count+1;
    end loop;
    if artifact_count<>5 then raise exception using errcode='55000',
      message='FALCON24_DIAGNOSTIC_ARTIFACT_CLOSURE_INVALID'; end if;
    pass_evidence:=pg_catalog.jsonb_build_object(
      'qa_e2e_receipt_hash',qa_receipt.receipt_hash,
      'trace_ui_receipt_hash',trace_receipt.receipt_hash,
      'trace_hash',trace_receipt.receipt_json->>'trace_hash',
      'opened_artifact_refs',trace_receipt.receipt_json->'opened_artifact_refs',
      'observed_execution_path',command->'observed_execution_path',
      'sandbox_reclamation_receipt_hash',reclamation->>'receipt_hash','residual',0);
  end if;
  now_at:=pg_catalog.clock_timestamp();receipt_version:='falcon24-diagnostic-receipt@2.0.0';
  receipt:=pg_catalog.jsonb_build_object(
    'schema_version',receipt_version,'attempt_id',attempt.attempt_id,'run_id',attempt.run_id,
    'attempt_manifest_hash',attempt.manifest_hash,'authority',attempt.manifest_document->'authority',
    'semantic_release',attempt.manifest_document->'semantic_release','outcome',outcome_value,
    'pass_evidence',pass_evidence,'failure_class',failure_class_value,
    'failure_code',failure_code_value,'completed_at',app_data_agent.runtime_iso_timestamp(now_at));
  receipt_hash_value:=app_data_agent.u2_canonical_sha256(receipt);
  receipt:=receipt||pg_catalog.jsonb_build_object('receipt_hash',receipt_hash_value);
  insert into app_data_agent.falcon24_diagnostic_receipts(
    app_id,tenant_id,environment,attempt_id,run_id,outcome,completion_command_hash,
    receipt_hash,receipt_document,created_at)
  values(attempt.app_id,attempt.tenant_id,attempt.environment,attempt.attempt_id,attempt.run_id,
    outcome_value,command->>'command_hash',receipt_hash_value,receipt,now_at);
  update app_data_agent.falcon24_diagnostic_attempts set
    status=case when outcome_value='PASS' then 'PASSED' else 'FAILED' end,
    failure_class=failure_class_value,failure_code=failure_code_value,
    terminal_receipt_hash=receipt_hash_value,completed_at=now_at
    where app_id=attempt.app_id and tenant_id=attempt.tenant_id
      and environment=attempt.environment and attempt_id=attempt.attempt_id and status='ACTIVE';
  if not found then raise exception using errcode='55000',
    message='FALCON24_DIAGNOSTIC_ATTEMPT_IMMUTABLE'; end if;
  return receipt;
exception when invalid_text_representation or numeric_value_out_of_range then
  raise exception using errcode='22023',message='FALCON24_DIAGNOSTIC_COMMAND_INVALID';
end
$function$;
alter function app_data_agent.begin_falcon24_qualification(jsonb)
  rename to begin_falcon24_qualification_e4_diagnostic;

create function app_data_agent.begin_falcon24_qualification(command jsonb)
returns jsonb language plpgsql volatile security definer set search_path='' as $function$
#variable_conflict use_variable
declare authority record;manifest jsonb;legacy_manifest jsonb;legacy_command jsonb;
  epoch_value text;qualification_id_value text;diagnostic_ref jsonb;
  diagnostic app_data_agent.falcon24_diagnostic_attempts%rowtype;
  diagnostic_receipt app_data_agent.falcon24_diagnostic_receipts%rowtype;
  existing app_data_agent.falcon24_qualifications%rowtype;created jsonb;
begin
  if command->>'schema_version' in(
      'falcon24-qualification-begin@2.0.0','falcon24-qualification-begin@3.0.0') then
    manifest:=command->'manifest';
    if (command->>'schema_version'='falcon24-qualification-begin@2.0.0'
        and pg_catalog.substr(manifest->>'authority_epoch',2)::numeric>=4)
      or (command->>'schema_version'='falcon24-qualification-begin@3.0.0'
        and manifest->>'authority_epoch'<>'E4')
    then raise exception using errcode='22023',message='FALCON24_QUALIFICATION_MANIFEST_INVALID'; end if;
    return app_data_agent.begin_falcon24_qualification_e4_diagnostic(command);
  end if;
  if command is null or pg_catalog.jsonb_typeof(command) is distinct from 'object'
    or app_data_agent.provider_json_object_has_exact_keys(command,array[
      'schema_version','manifest','command_hash']::text[]) is distinct from true
    or command->>'schema_version'<>'falcon24-qualification-begin@4.0.0'
    or command->>'command_hash' is distinct from app_data_agent.u2_canonical_sha256(command-'command_hash')
    or pg_catalog.jsonb_typeof(command->'manifest') is distinct from 'object'
  then raise exception using errcode='22023',message='FALCON24_QUALIFICATION_COMMAND_INVALID'; end if;
  manifest:=command->'manifest';epoch_value:=manifest->>'authority_epoch';
  qualification_id_value:=manifest->>'qualification_id';
  if app_data_agent.provider_json_object_has_exact_keys(manifest,array[
      'schema_version','authority_epoch','qualification_id','attempt_id','authority_baseline_hash',
      'source_commit','source_fingerprint','frozen_contract_hash','semantic_release_hash',
      'schema_snapshot_hash','operator_registry_digest','model_config_hash','web_build_hash',
      'runtime_attestation_hash','model_provider','model_id','slots','diagnostic_receipt_ref',
      'manifest_hash']::text[]) is distinct from true
    or manifest->>'schema_version'<>'falcon24-qualification-manifest@4.0.0'
    or app_data_agent.falcon24_authority_epoch_is_canonical(epoch_value) is distinct from true
    or pg_catalog.substr(epoch_value,2)::numeric<5
    or qualification_id_value is distinct from epoch_value||'-Q1'
    or manifest->>'manifest_hash' is distinct from
      app_data_agent.u2_canonical_sha256(manifest-'manifest_hash')
    or pg_catalog.jsonb_typeof(manifest->'diagnostic_receipt_ref') is distinct from 'object'
    or app_data_agent.provider_json_object_has_exact_keys(manifest->'diagnostic_receipt_ref',array[
      'attempt_id','run_id','receipt_hash']::text[]) is distinct from true
    or app_data_agent.canonical_uuid_json_string_is_valid(
      manifest#>'{diagnostic_receipt_ref,attempt_id}') is distinct from true
    or app_data_agent.canonical_uuid_json_string_is_valid(
      manifest#>'{diagnostic_receipt_ref,run_id}') is distinct from true
    or manifest#>>'{diagnostic_receipt_ref,receipt_hash}'!~'^sha256:[0-9a-f]{64}$'
  then raise exception using errcode='22023',message='FALCON24_QUALIFICATION_MANIFEST_INVALID'; end if;
  diagnostic_ref:=manifest->'diagnostic_receipt_ref';
  select * into strict authority from platform.current_backend_authority(true);
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'data-agent:'||qualification_id_value||':'||authority.app_id::text||':'||
      authority.tenant_id::text||':'||authority.environment||':'||authority.principal_id::text,0));
  select * into diagnostic from app_data_agent.falcon24_diagnostic_attempts row
    where row.app_id=authority.app_id and row.tenant_id=authority.tenant_id
      and row.environment=authority.environment
      and row.attempt_id=(diagnostic_ref->>'attempt_id')::uuid for share;
  select * into diagnostic_receipt from app_data_agent.falcon24_diagnostic_receipts row
    where row.app_id=authority.app_id and row.tenant_id=authority.tenant_id
      and row.environment=authority.environment
      and row.attempt_id=(diagnostic_ref->>'attempt_id')::uuid
      and row.run_id=(diagnostic_ref->>'run_id')::uuid
      and row.receipt_hash=diagnostic_ref->>'receipt_hash';
  if diagnostic.status is distinct from 'PASSED'
    or diagnostic.principal_id is distinct from authority.principal_id
    or diagnostic.authority_epoch is distinct from epoch_value
    or diagnostic.authority_baseline_hash is distinct from manifest->>'authority_baseline_hash'
    or diagnostic.source_commit is distinct from manifest->>'source_commit'
    or diagnostic.source_fingerprint is distinct from manifest->>'source_fingerprint'
    or diagnostic.semantic_release_digest is distinct from manifest->>'semantic_release_hash'
    or diagnostic.web_build_id is distinct from manifest->>'web_build_hash'
    or diagnostic.runtime_attestation_hash is distinct from manifest->>'runtime_attestation_hash'
    or diagnostic.terminal_receipt_hash is distinct from diagnostic_ref->>'receipt_hash'
    or diagnostic_receipt.outcome is distinct from 'PASS'
    or diagnostic_receipt.receipt_document->>'schema_version'
      is distinct from 'falcon24-diagnostic-receipt@2.0.0'
    or diagnostic_receipt.receipt_document#>>'{pass_evidence,residual}' is distinct from '0'
  then raise exception using errcode='55000',
    message='FALCON24_QUALIFICATION_DIAGNOSTIC_REQUIRED'; end if;
  select * into existing from app_data_agent.falcon24_qualifications row
    where row.app_id=authority.app_id and row.tenant_id=authority.tenant_id
      and row.environment=authority.environment and row.principal_id=authority.principal_id
      and row.qualification_id=qualification_id_value for update;
  if found then
    if existing.attempt_id=(manifest->>'attempt_id')::uuid
      and existing.manifest_hash=manifest->>'manifest_hash'
      and existing.diagnostic_attempt_id=(diagnostic_ref->>'attempt_id')::uuid
      and existing.diagnostic_run_id=(diagnostic_ref->>'run_id')::uuid
      and existing.diagnostic_receipt_hash=diagnostic_ref->>'receipt_hash'
    then return pg_catalog.to_jsonb(existing); end if;
    raise exception using errcode='55000',message='FALCON24_GATE_ATTEMPT_IMMUTABLE';
  end if;
  legacy_manifest:=(manifest-'diagnostic_receipt_ref')
    ||pg_catalog.jsonb_build_object('schema_version','falcon24-qualification-manifest@2.0.0');
  legacy_manifest:=legacy_manifest||pg_catalog.jsonb_build_object(
    'manifest_hash',app_data_agent.u2_canonical_sha256(legacy_manifest-'manifest_hash'));
  legacy_command:=pg_catalog.jsonb_build_object(
    'schema_version','falcon24-qualification-begin@2.0.0','manifest',legacy_manifest);
  legacy_command:=legacy_command||pg_catalog.jsonb_build_object(
    'command_hash',app_data_agent.u2_canonical_sha256(legacy_command));
  created:=app_data_agent.begin_falcon24_qualification_pre_diagnostic(legacy_command);
  update app_data_agent.falcon24_qualifications row set
    manifest_hash=manifest->>'manifest_hash',
    diagnostic_attempt_id=(diagnostic_ref->>'attempt_id')::uuid,
    diagnostic_run_id=(diagnostic_ref->>'run_id')::uuid,
    diagnostic_receipt_hash=diagnostic_ref->>'receipt_hash'
    where app_id=authority.app_id and tenant_id=authority.tenant_id
      and environment=authority.environment and principal_id=authority.principal_id
      and qualification_id=qualification_id_value and attempt_id=(manifest->>'attempt_id')::uuid
    returning pg_catalog.to_jsonb(row) into strict created;
  return created;
exception when invalid_text_representation or numeric_value_out_of_range then
  raise exception using errcode='22023',message='FALCON24_QUALIFICATION_BEGIN_INVALID';
end
$function$;
alter function app_data_agent.activate_falcon24_authority_pre_retained(jsonb)
  owner to data_agent_u6_rpc_owner;
alter function app_data_agent.activate_falcon24_authority(jsonb)
  owner to data_agent_u6_rpc_owner;
alter function app_data_agent.begin_falcon24_diagnostic_e4_history(jsonb)
  owner to data_agent_u6_rpc_owner;
alter function app_data_agent.begin_falcon24_diagnostic(jsonb)
  owner to data_agent_u6_rpc_owner;
alter function app_data_agent.complete_falcon24_diagnostic_e4_history(jsonb)
  owner to data_agent_u6_rpc_owner;
alter function app_data_agent.complete_falcon24_diagnostic(jsonb)
  owner to data_agent_u6_rpc_owner;
alter function app_data_agent.begin_falcon24_qualification_e4_diagnostic(jsonb)
  owner to data_agent_u6_rpc_owner;
alter function app_data_agent.begin_falcon24_qualification(jsonb)
  owner to data_agent_u6_rpc_owner;

create policy semantic_retained_release_select_rpc on semantic.semantic_source_release
for select to data_agent_u6_rpc_owner
using(platform.backend_context_matches(app_id,tenant_id,environment,false)
  and semantic_domain=nullif(pg_catalog.current_setting('app.semantic_domain',true),''));
create policy semantic_retained_executable_select_rpc on semantic.semantic_executable_projection
for select to data_agent_u6_rpc_owner
using(platform.backend_context_matches(app_id,tenant_id,environment,false)
  and semantic_domain=nullif(pg_catalog.current_setting('app.semantic_domain',true),''));
create policy semantic_retained_relationship_select_rpc on semantic.semantic_relationship_projection
for select to data_agent_u6_rpc_owner
using(platform.backend_context_matches(app_id,tenant_id,environment,false)
  and semantic_domain=nullif(pg_catalog.current_setting('app.semantic_domain',true),''));
create policy semantic_retained_restriction_select_rpc
on semantic.semantic_runtime_restriction_projection for select to data_agent_u6_rpc_owner
using(platform.backend_context_matches(app_id,tenant_id,environment,false)
  and semantic_domain=nullif(pg_catalog.current_setting('app.semantic_domain',true),''));
create policy semantic_retained_graph_select_rpc on semantic.semantic_graph_projection
for select to data_agent_u6_rpc_owner
using(platform.backend_context_matches(app_id,tenant_id,environment,false)
  and semantic_domain=nullif(pg_catalog.current_setting('app.semantic_domain',true),''));
create policy semantic_retained_graph_binding_select_rpc
on semantic.semantic_source_release_graph_projection for select to data_agent_u6_rpc_owner
using(platform.backend_context_matches(app_id,tenant_id,environment,false)
  and semantic_domain=nullif(pg_catalog.current_setting('app.semantic_domain',true),''));

grant select on table semantic.semantic_source_release,semantic.semantic_executable_projection,
  semantic.semantic_relationship_projection,semantic.semantic_runtime_restriction_projection,
  semantic.semantic_graph_projection,semantic.semantic_source_release_graph_projection
  to data_agent_u6_rpc_owner;

revoke all on function app_data_agent.activate_falcon24_authority_pre_retained(jsonb)
  from public,anon,authenticated,service_role,data_agent_backend;
revoke all on function app_data_agent.begin_falcon24_diagnostic_e4_history(jsonb)
  from public,anon,authenticated,service_role,data_agent_backend;
revoke all on function app_data_agent.complete_falcon24_diagnostic_e4_history(jsonb)
  from public,anon,authenticated,service_role,data_agent_backend;
revoke all on function app_data_agent.begin_falcon24_qualification_e4_diagnostic(jsonb)
  from public,anon,authenticated,service_role,data_agent_backend;

revoke all on function app_data_agent.activate_falcon24_authority(jsonb)
  from public,anon,authenticated,service_role,data_agent_backend;
revoke all on function app_data_agent.begin_falcon24_diagnostic(jsonb)
  from public,anon,authenticated,service_role,data_agent_backend;
revoke all on function app_data_agent.complete_falcon24_diagnostic(jsonb)
  from public,anon,authenticated,service_role,data_agent_backend;
revoke all on function app_data_agent.begin_falcon24_qualification(jsonb)
  from public,anon,authenticated,service_role,data_agent_backend;

grant execute on function app_data_agent.activate_falcon24_authority(jsonb),
  app_data_agent.begin_falcon24_diagnostic(jsonb),
  app_data_agent.complete_falcon24_diagnostic(jsonb),
  app_data_agent.begin_falcon24_qualification(jsonb) to data_agent_backend;
do $postconditions$
declare snapshot record;schema_name text;table_name text;after_count bigint;after_digest text;
  routine_name text;routine record;definition text;
begin
  for snapshot in select * from falcon24_10798_history_snapshot loop
    schema_name:=pg_catalog.split_part(snapshot.relation_name,'.',1);
    table_name:=pg_catalog.split_part(snapshot.relation_name,'.',2);
    execute pg_catalog.format(
      'select pg_catalog.count(*)::bigint,app_data_agent.u2_canonical_sha256('
      ||'coalesce(pg_catalog.jsonb_agg(to_jsonb(row_value) order by to_jsonb(row_value)::text),'
      ||'''[]''::jsonb)) from %I.%I as row_value',schema_name,table_name)
      into strict after_count,after_digest;
    if snapshot.row_count is distinct from after_count or snapshot.row_digest is distinct from after_digest
    then raise exception using errcode='P0001',message='FALCON24_E5_RETAINED_HISTORY_DRIFT'; end if;
  end loop;
  foreach routine_name in array array[
    'app_data_agent.activate_falcon24_authority(jsonb)',
    'app_data_agent.begin_falcon24_diagnostic(jsonb)',
    'app_data_agent.complete_falcon24_diagnostic(jsonb)',
    'app_data_agent.begin_falcon24_qualification(jsonb)']::text[] loop
    select procedure.provolatile,procedure.prosecdef,procedure.proconfig,
      pg_catalog.pg_get_userbyid(procedure.proowner) owner_name,
      pg_catalog.pg_get_functiondef(procedure.oid) function_definition into strict routine
      from pg_catalog.pg_proc procedure where procedure.oid=routine_name::regprocedure;
    definition:=routine.function_definition;
    if routine.provolatile is distinct from 'v' or routine.prosecdef is distinct from true
      or routine.owner_name is distinct from 'data_agent_u6_rpc_owner'
      or not (routine.proconfig @> array['search_path=""']::text[])
      or pg_catalog.has_function_privilege('public',routine_name,'EXECUTE')
      or not pg_catalog.has_function_privilege('data_agent_backend',routine_name,'EXECUTE')
    then raise exception using errcode='P0001',
      message='FALCON24_E5_RETAINED_AUTHORITY_POSTCONDITION_FAILED'; end if;
  end loop;
  select pg_catalog.pg_get_functiondef(
    'app_data_agent.activate_falcon24_authority(jsonb)'::regprocedure) into strict definition;
  if pg_catalog.strpos(definition,'falcon24-activation-request@3.0.0')=0
    or pg_catalog.strpos(definition,'semantic.lock_semantic_authority_fence')=0
    or pg_catalog.strpos(definition,'FALCON24_RETAINED_AUTHORITY_POLLUTED')=0
    or pg_catalog.strpos(definition,'update semantic.semantic_active_pointer')<>0
    or pg_catalog.strpos(definition,'update semantic.semantic_runtime_activation')<>0
    or pg_catalog.strpos(definition,'update app_data_agent.workspace_run_defaults')<>0
  then raise exception using errcode='P0001',
    message='FALCON24_E5_RETAINED_ACTIVATION_POSTCONDITION_FAILED'; end if;
  if not exists(select 1 from pg_catalog.pg_constraint
      where conrelid='app_data_agent.falcon24_diagnostic_attempts'::regclass
        and conname='falcon24_diagnostic_attempts_manifest_epoch_check')
    or not exists(select 1 from pg_catalog.pg_constraint
      where conrelid='app_data_agent.falcon24_diagnostic_receipts'::regclass
        and conname='falcon24_diagnostic_receipts_receipt_document_version_check')
  then raise exception using errcode='P0001',
    message='FALCON24_E5_DIAGNOSTIC_STORAGE_POSTCONDITION_FAILED'; end if;
end
$postconditions$;
select platform.assert_migration_checksum(
  'app','00000000-0000-4000-8000-00000000da01'::uuid,
  '20260725010798_app_data_agent_falcon24_e5_retained_authority',
  'sha256:18b91331ab0c3820aa016aa985e125ed7b4140820050bb1ac7efc6fb563f346a');

commit;
