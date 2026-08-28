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
