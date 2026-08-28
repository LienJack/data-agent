-- falcon24_successor_activation_closure_migration_checksum: sha256:c5afa3d4b8babc91b61b2bd3d6f3edc18324502254270d08e8d63049dc18e984
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
          '20260725010796_app_data_agent_semantic_successor_smoke_revalidation'
        and migration_checksum=
          'sha256:4b3541be45d3e117510a497910de45f918b7a12111c338348b7bbd1de8217286')
  then raise exception using errcode='P0001',
    message='FALCON24_SUCCESSOR_ACTIVATION_CLOSURE_BASELINE_DRIFT'; end if;

  if pg_catalog.to_regprocedure(
      'app_data_agent.activate_falcon24_authority_with_semantic_successor(jsonb)') is null
    or pg_catalog.to_regprocedure('semantic.lock_semantic_authority_fence(uuid,uuid,text,text)')
      is null
    or pg_catalog.to_regprocedure('platform.current_backend_authority(boolean)') is null
    or pg_catalog.to_regprocedure('app_data_agent.u2_canonical_sha256(jsonb)') is null
    or pg_catalog.to_regclass('semantic.semantic_successor_release_stage') is null
    or pg_catalog.to_regclass('semantic.semantic_successor_projection_stage') is null
    or pg_catalog.to_regclass('semantic.semantic_successor_stage_receipt') is null
    or pg_catalog.to_regclass('semantic.semantic_source_revision') is null
    or pg_catalog.to_regclass('semantic.semantic_candidate') is null
    or pg_catalog.to_regclass('semantic.semantic_candidate_revision') is null
    or pg_catalog.to_regclass('semantic.semantic_publish_attempt') is null
    or pg_catalog.to_regclass('semantic.semantic_review_task') is null
    or pg_catalog.to_regclass('semantic.semantic_successor_review_preparation') is null
    or pg_catalog.to_regclass('semantic.semantic_successor_review_decision_document') is null
    or pg_catalog.to_regclass('app_data_agent.falcon24_authority_staging_sessions') is null
    or pg_catalog.to_regclass('app_data_agent.falcon24_authority_staging_receipts') is null
    or pg_catalog.to_regclass('app_data_agent.falcon24_authority_baselines') is null
    or pg_catalog.to_regclass('app_data_agent.falcon24_authority_activation_attempts') is null
  then raise exception using errcode='P0001',
    message='FALCON24_SUCCESSOR_ACTIVATION_CLOSURE_INVENTORY_DRIFT'; end if;
end
$preflight$;

create temporary table falcon24_10797_authority_history_snapshot(
  relation_name text primary key,
  row_count bigint not null,
  row_digest text not null
) on commit drop;

do $snapshot$
declare relation_name text; schema_name text; table_name text;
  before_count bigint; before_digest text;
begin
  foreach relation_name in array array[
    'semantic.semantic_successor_release_stage',
    'semantic.semantic_successor_projection_stage',
    'semantic.semantic_successor_stage_receipt',
    'app_data_agent.falcon24_authority_staging_sessions',
    'app_data_agent.falcon24_authority_staging_receipts',
    'app_data_agent.falcon24_authority_baselines',
    'app_data_agent.falcon24_authority_activation_attempts',
    'semantic.semantic_source_revision',
    'semantic.semantic_candidate',
    'semantic.semantic_candidate_revision',
    'semantic.semantic_publish_attempt',
    'semantic.semantic_review_task',
    'semantic.semantic_successor_review_preparation',
    'semantic.semantic_successor_review_decision_document'
  ]::text[] loop
    schema_name:=pg_catalog.split_part(relation_name,'.',1);
    table_name:=pg_catalog.split_part(relation_name,'.',2);
    execute pg_catalog.format(
      'select pg_catalog.count(*)::bigint, app_data_agent.u2_canonical_sha256('
      ||'coalesce(pg_catalog.jsonb_agg(to_jsonb(row_value) order by '
      ||'to_jsonb(row_value)::text),''[]''::jsonb)) from %I.%I as row_value',
      schema_name,table_name)
      into strict before_count,before_digest;
    insert into falcon24_10797_authority_history_snapshot(
      relation_name,row_count,row_digest)
    values(relation_name,before_count,before_digest);
  end loop;
end
$snapshot$;

set local lock_timeout='2000ms';
set local statement_timeout='300000ms';
set local idle_in_transaction_session_timeout='60000ms';
create or replace function app_data_agent.activate_falcon24_authority_with_semantic_successor(command jsonb)
returns jsonb language plpgsql volatile security definer set search_path='' as $function$
#variable_conflict use_variable
declare authority record; stage_scope record;
  pointer semantic.semantic_active_pointer%rowtype;
  runtime semantic.semantic_runtime_activation%rowtype;
  defaults_pointer app_data_agent.workspace_run_defaults%rowtype;
  defaults_revision app_data_agent.workspace_run_default_revisions%rowtype;
  current_epoch app_data_agent.falcon24_current_authority_epoch%rowtype;
  stage semantic.semantic_successor_release_stage%rowtype;
  validation_receipt semantic.semantic_successor_stage_receipt%rowtype;
  smoke_receipt semantic.semantic_successor_stage_receipt%rowtype;
  promotion_receipt semantic.semantic_successor_stage_receipt%rowtype;
  baseline app_data_agent.falcon24_authority_baselines%rowtype;
  attempt app_data_agent.falcon24_authority_activation_attempts%rowtype;
  session app_data_agent.falcon24_authority_staging_sessions%rowtype;
  semantic_receipt app_data_agent.falcon24_authority_staging_receipts%rowtype;
  publish_attempt semantic.semantic_publish_attempt%rowtype;
  review_task semantic.semantic_review_task%rowtype;
  dependency semantic.semantic_dependency_pointer%rowtype;
  projection_row record; graph_payload jsonb; graph_projection_id uuid;
  node_value jsonb; edge_value jsonb;
  scope_json jsonb; expected_authority jsonb; expected_predecessor jsonb;
  stage_ref jsonb; smoke_ref jsonb; baseline_ref jsonb; attempt_ref jsonb; versions jsonb;
  new_defaults_json jsonb; new_revision_document jsonb; new_defaults_hash text;
  now_at timestamptz:=pg_catalog.clock_timestamp();
  outbox_payload jsonb; outbox_digest text; receipt jsonb; receipt_hash text;
  semantic_proof jsonb; expected_semantic_proof_hash text;
  transaction_id_value text; defaults_revision_id uuid;
begin
  if command is null or pg_catalog.jsonb_typeof(command) is distinct from 'object'
    or app_data_agent.provider_json_object_has_exact_keys(command,array[
      'schema_version','command_id','idempotency_key','scope','authority_epoch',
      'expected_current_authority','expected_semantic_predecessor','stage_ref',
      'smoke_receipt_ref','baseline_ref','activation_attempt_ref','expected_versions',
      'command_hash']::text[]) is distinct from true
    or command->>'schema_version' is distinct from
      'combined-falcon24-semantic-activation-command@1.0.0'
    or app_data_agent.canonical_uuid_json_string_is_valid(command->'command_id') is distinct from true
    or pg_catalog.length(command->>'idempotency_key') not between 1 and 256
    or pg_catalog.btrim(command->>'idempotency_key') is distinct from command->>'idempotency_key'
    or command->>'authority_epoch' is distinct from 'E4'
    or command->>'command_hash' is distinct from app_data_agent.u2_canonical_sha256(
      pg_catalog.jsonb_build_object(
        'hash_domain','combined-falcon24-semantic-activation-command@1.0.0',
        'command',command-'command_hash'))
    or app_data_agent.contains_potential_plaintext_secret(command)
  then raise exception using errcode='22023',
    message='FALCON24_COMBINED_ACTIVATION_COMMAND_INVALID'; end if;
  scope_json:=command->'scope';expected_authority:=command->'expected_current_authority';
  expected_predecessor:=command->'expected_semantic_predecessor';stage_ref:=command->'stage_ref';
  smoke_ref:=command->'smoke_receipt_ref';baseline_ref:=command->'baseline_ref';
  attempt_ref:=command->'activation_attempt_ref';versions:=command->'expected_versions';
  if app_data_agent.provider_json_object_has_exact_keys(scope_json,array[
      'app_id','tenant_id','environment','semantic_domain']::text[]) is distinct from true
    or app_data_agent.provider_json_object_has_exact_keys(expected_authority,array[
      'schema_version','authority_epoch','baseline_id','baseline_hash',
      'activation_attempt_id']::text[]) is distinct from true
    or expected_authority->>'schema_version' is distinct from 'falcon24-authority-binding@2.0.0'
    or expected_authority->>'authority_epoch' is distinct from 'E3'
    or app_data_agent.provider_json_object_has_exact_keys(expected_predecessor,array[
      'release_id','generation','release_digest','datasource_id']::text[]) is distinct from true
    or app_data_agent.provider_json_object_has_exact_keys(stage_ref,array[
      'stage_id','stage_digest']::text[]) is distinct from true
    or app_data_agent.provider_json_object_has_exact_keys(smoke_ref,array[
      'schema_version','receipt_id','smoke_receipt_hash']::text[]) is distinct from true
    or smoke_ref->>'schema_version' is distinct from 'semantic-runtime-smoke-receipt@1.0.0'
    or app_data_agent.provider_json_object_has_exact_keys(baseline_ref,array[
      'baseline_id','baseline_hash']::text[]) is distinct from true
    or app_data_agent.provider_json_object_has_exact_keys(attempt_ref,array[
      'activation_attempt_id']::text[]) is distinct from true
    or app_data_agent.provider_json_object_has_exact_keys(versions,array[
      'semantic_pointer','semantic_runtime','workspace_defaults']::text[]) is distinct from true
    or app_data_agent.canonical_uuid_json_string_is_valid(scope_json->'app_id') is distinct from true
    or app_data_agent.canonical_uuid_json_string_is_valid(scope_json->'tenant_id') is distinct from true
    or pg_catalog.length(scope_json->>'environment') not between 1 and 128
    or pg_catalog.btrim(scope_json->>'environment') is distinct from scope_json->>'environment'
    or pg_catalog.length(scope_json->>'semantic_domain') not between 1 and 128
    or pg_catalog.btrim(scope_json->>'semantic_domain') is distinct from
      scope_json->>'semantic_domain'
    or app_data_agent.canonical_uuid_json_string_is_valid(
      expected_authority->'baseline_id') is distinct from true
    or app_data_agent.canonical_uuid_json_string_is_valid(
      expected_authority->'activation_attempt_id') is distinct from true
    or expected_authority->>'baseline_hash'!~'^sha256:[0-9a-f]{64}$'
    or app_data_agent.canonical_uuid_json_string_is_valid(
      expected_predecessor->'release_id') is distinct from true
    or app_data_agent.canonical_uuid_json_string_is_valid(
      expected_predecessor->'datasource_id') is distinct from true
    or expected_predecessor->>'release_digest'!~'^sha256:[0-9a-f]{64}$'
    or pg_catalog.jsonb_typeof(expected_predecessor->'generation') is distinct from 'number'
    or expected_predecessor->>'generation'!~'^(0|[1-9][0-9]{0,18})$'
    or pg_catalog.pg_input_is_valid(
      expected_predecessor->>'generation','bigint') is distinct from true
    or app_data_agent.canonical_uuid_json_string_is_valid(stage_ref->'stage_id') is distinct from true
    or stage_ref->>'stage_digest'!~'^sha256:[0-9a-f]{64}$'
    or app_data_agent.canonical_uuid_json_string_is_valid(smoke_ref->'receipt_id') is distinct from true
    or smoke_ref->>'smoke_receipt_hash'!~'^sha256:[0-9a-f]{64}$'
    or app_data_agent.canonical_uuid_json_string_is_valid(baseline_ref->'baseline_id')
      is distinct from true
    or baseline_ref->>'baseline_hash'!~'^sha256:[0-9a-f]{64}$'
    or app_data_agent.canonical_uuid_json_string_is_valid(
      attempt_ref->'activation_attempt_id') is distinct from true
    or exists(select 1 from pg_catalog.jsonb_each(versions) item
      where pg_catalog.jsonb_typeof(item.value) is distinct from 'number'
        or item.value#>>'{}'!~'^(0|[1-9][0-9]{0,18})$'
        or pg_catalog.pg_input_is_valid(item.value#>>'{}','bigint') is distinct from true)
  then raise exception using errcode='22023',
    message='FALCON24_COMBINED_ACTIVATION_COMMAND_INVALID'; end if;
  if (expected_predecessor->>'generation')::bigint<>1
    or (versions->>'semantic_pointer')::bigint<0
    or (versions->>'semantic_runtime')::bigint<0
    or (versions->>'workspace_defaults')::bigint<0
  then raise exception using errcode='22023',
    message='FALCON24_COMBINED_ACTIVATION_COMMAND_INVALID'; end if;

  select * into strict authority from platform.current_backend_authority(true);
  if scope_json->>'app_id' is distinct from authority.app_id::text
    or scope_json->>'tenant_id' is distinct from authority.tenant_id::text
    or scope_json->>'environment' is distinct from authority.environment
    or scope_json->>'semantic_domain' is distinct from
      nullif(pg_catalog.current_setting('app.semantic_domain',true),'')
  then raise exception using errcode='42501',
    message='FALCON24_COMBINED_ACTIVATION_SCOPE_FORBIDDEN'; end if;
  select row.app_id,row.tenant_id,row.environment,row.semantic_domain into stage_scope
    from semantic.semantic_successor_release_stage row
    where row.app_id=authority.app_id and row.tenant_id=authority.tenant_id
      and row.environment=authority.environment and row.stage_id=(stage_ref->>'stage_id')::uuid;
  if not found or stage_scope.semantic_domain is distinct from scope_json->>'semantic_domain'
  then raise exception using errcode='02000',message='SEMANTIC_SUCCESSOR_STAGE_NOT_FOUND'; end if;

  -- Global lock order: semantic fence -> Falcon scope -> semantic pointer/runtime ->
  -- workspace defaults -> Falcon current -> stage/smoke -> baseline/attempt/session.
  perform semantic.lock_semantic_authority_fence(
    authority.app_id,authority.tenant_id,authority.environment,scope_json->>'semantic_domain');
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'falcon24-authority-activation:'||authority.app_id::text||':'||authority.tenant_id::text||':'||
      authority.environment,0));
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
  if found then
    select * into defaults_revision from app_data_agent.workspace_run_default_revisions row
      where row.app_id=defaults_pointer.app_id and row.tenant_id=defaults_pointer.tenant_id
        and row.environment=defaults_pointer.environment
        and row.defaults_id=defaults_pointer.defaults_id
        and row.defaults_revision=defaults_pointer.defaults_revision
        and row.revision_id=defaults_pointer.revision_id
        and row.defaults_hash=defaults_pointer.defaults_hash for update;
  end if;
  select * into current_epoch from app_data_agent.falcon24_current_authority_epoch row
    where row.app_id=authority.app_id and row.tenant_id=authority.tenant_id
      and row.environment=authority.environment for update;
  select * into stage from semantic.semantic_successor_release_stage row
    where row.app_id=authority.app_id and row.tenant_id=authority.tenant_id
      and row.environment=authority.environment and row.semantic_domain=scope_json->>'semantic_domain'
      and row.stage_id=(stage_ref->>'stage_id')::uuid for update;
  select * into smoke_receipt from semantic.semantic_successor_stage_receipt row
    where row.app_id=stage.app_id and row.tenant_id=stage.tenant_id
      and row.environment=stage.environment and row.semantic_domain=stage.semantic_domain
      and row.stage_id=stage.stage_id and row.receipt_kind='SMOKE'
      and row.receipt_id=(smoke_ref->>'receipt_id')::uuid for share;
  select * into validation_receipt from semantic.semantic_successor_stage_receipt row
    where row.app_id=stage.app_id and row.tenant_id=stage.tenant_id
      and row.environment=stage.environment and row.semantic_domain=stage.semantic_domain
      and row.stage_id=stage.stage_id and row.receipt_kind='VALIDATION'
      and row.receipt_hash=stage.validation_receipt_hash for share;
  select * into baseline from app_data_agent.falcon24_authority_baselines row
    where row.app_id=authority.app_id and row.tenant_id=authority.tenant_id
      and row.environment=authority.environment
      and row.baseline_id=(baseline_ref->>'baseline_id')::uuid for update;
  if found then
    select * into attempt from app_data_agent.falcon24_authority_activation_attempts row
      where row.app_id=baseline.app_id and row.tenant_id=baseline.tenant_id
        and row.environment=baseline.environment
        and row.attempt_id=(attempt_ref->>'activation_attempt_id')::uuid for update;
    select * into session from app_data_agent.falcon24_authority_staging_sessions row
      where row.app_id=baseline.app_id and row.tenant_id=baseline.tenant_id
        and row.environment=baseline.environment and row.staging_id=baseline.staging_id
        and row.authority_epoch='E4' for update;
    perform 1 from app_data_agent.falcon24_authority_staging_receipts row
      where row.app_id=baseline.app_id and row.tenant_id=baseline.tenant_id
        and row.environment=baseline.environment and row.staging_id=baseline.staging_id
        and row.authority_epoch='E4' order by row.component for share;
    select * into semantic_receipt from app_data_agent.falcon24_authority_staging_receipts row
      where row.app_id=baseline.app_id and row.tenant_id=baseline.tenant_id
        and row.environment=baseline.environment and row.staging_id=baseline.staging_id
        and row.authority_epoch='E4' and row.component='SEMANTIC_RELEASE';
  end if;

  if stage.status='PROMOTED' then
    select * into promotion_receipt from semantic.semantic_successor_stage_receipt row
      where row.app_id=stage.app_id and row.tenant_id=stage.tenant_id
        and row.environment=stage.environment and row.semantic_domain=stage.semantic_domain
        and row.stage_id=stage.stage_id and row.receipt_kind='PROMOTION';
    if not found or promotion_receipt.operation_digest is distinct from command->>'command_hash'
    then raise exception using errcode='23505',
      message='FALCON24_COMBINED_ACTIVATION_IDEMPOTENCY_CONFLICT'; end if;
    return promotion_receipt.receipt_json;
  end if;

  if current_epoch.authority_epoch is distinct from 'E3'
    or current_epoch.authority_epoch is distinct from expected_authority->>'authority_epoch'
    or current_epoch.baseline_id is distinct from (expected_authority->>'baseline_id')::uuid
    or current_epoch.baseline_hash is distinct from expected_authority->>'baseline_hash'
    or current_epoch.activation_attempt_id is distinct from
      (expected_authority->>'activation_attempt_id')::uuid
    or pointer.current_release_id is distinct from (expected_predecessor->>'release_id')::uuid
    or pointer.current_release_generation<>1
    or pointer.current_release_digest is distinct from expected_predecessor->>'release_digest'
    or stage.predecessor_release_id is distinct from pointer.current_release_id
    or stage.predecessor_generation is distinct from pointer.current_release_generation
    or stage.predecessor_release_digest is distinct from pointer.current_release_digest
    or stage.datasource_id is distinct from (expected_predecessor->>'datasource_id')::uuid
  then raise exception using errcode='40001',
    message='FALCON24_COMBINED_ACTIVATION_PREDECESSOR_MISMATCH'; end if;
  if pointer.pointer_generation is distinct from (versions->>'semantic_pointer')::bigint
    or runtime.activation_generation is distinct from (versions->>'semantic_runtime')::bigint
    or defaults_pointer.defaults_revision is distinct from (versions->>'workspace_defaults')::bigint
    or stage.expected_pointer_version is distinct from (versions->>'semantic_pointer')::bigint
    or runtime.current_release_id is distinct from pointer.current_release_id
    or runtime.current_release_generation is distinct from pointer.current_release_generation
  then raise exception using errcode='40001',
    message='FALCON24_COMBINED_ACTIVATION_DEFAULTS_STALE'; end if;
  if defaults_revision.defaults_json#>>'{semantic_release,resource_id}'
      is distinct from pointer.current_release_id::text
    or (defaults_revision.defaults_json#>>'{semantic_release,resource_revision}')::bigint
      is distinct from pointer.current_release_generation
    or defaults_revision.defaults_json#>>'{semantic_release,resource_hash}'
      is distinct from pointer.current_release_digest
  then raise exception using errcode='40001',
    message='FALCON24_COMBINED_ACTIVATION_DEFAULTS_STALE'; end if;
  if stage.status<>'SMOKE_PASSED'
    or stage.stage_digest is distinct from stage_ref->>'stage_digest'
    or stage.target_generation<>2
    or smoke_receipt.receipt_hash is distinct from smoke_ref->>'smoke_receipt_hash'
    or smoke_receipt.receipt_json->>'outcome'<>'PASS'
    or smoke_receipt.receipt_json->>'stage_digest' is distinct from stage.stage_digest
    or validation_receipt.receipt_hash is distinct from stage.validation_receipt_hash
    or validation_receipt.receipt_json->>'outcome'<>'PASS'
    or validation_receipt.receipt_json->>'stage_digest' is distinct from stage.stage_digest
  then raise exception using errcode='55000',
    message='FALCON24_COMBINED_ACTIVATION_SMOKE_REQUIRED'; end if;

  semantic_proof:=pg_catalog.jsonb_build_object(
    'schema_version','falcon24-semantic-release-authority-proof@2.0.0',
    'authority_epoch','E4',
    'predecessor_release',pg_catalog.jsonb_build_object(
      'release_id',stage.predecessor_release_id,
      'generation',stage.predecessor_generation,
      'release_digest',stage.predecessor_release_digest,
      'datasource_id',stage.datasource_id),
    'candidate_release',stage.stage_document->'candidate_release',
    'projections',stage.stage_document->'projection_refs',
    'change_set_ref',stage.stage_document->'change_set_ref',
    'review_ref',stage.stage_document->'review_ref',
    'source_snapshot_ref',stage.stage_document->'source_snapshot_ref',
    'compiler_bundle_ref',stage.stage_document->'compiler_bundle_ref',
    'validation_receipt_ref',pg_catalog.jsonb_build_object(
      'schema_version','semantic-runtime-closure-validation-receipt@1.0.0',
      'receipt_id',validation_receipt.receipt_id,
      'validation_receipt_hash',validation_receipt.receipt_hash),
    'smoke_receipt_ref',smoke_ref,
    'expected_versions',versions);
  expected_semantic_proof_hash:=app_data_agent.u2_canonical_sha256(
    pg_catalog.jsonb_build_object(
      'hash_domain','falcon24-semantic-release-authority-proof@2.0.0',
      'proof',semantic_proof));
  if baseline.status<>'STAGED' or baseline.authority_epoch<>'E4'
    or baseline.baseline_hash is distinct from baseline_ref->>'baseline_hash'
    or attempt.status<>'OPEN' or attempt.authority_epoch<>'E4'
    or attempt.baseline_id is distinct from baseline.baseline_id
    or attempt.expected_baseline_hash is distinct from baseline.baseline_hash
    or session.status<>'STAGED' or session.authority_epoch<>'E4'
    or semantic_receipt.subject_hash is distinct from stage.candidate_release_digest
    or semantic_receipt.evidence_hash is distinct from expected_semantic_proof_hash
    or baseline.baseline_document#>>'{staging_receipts,semantic_release}'
      is distinct from semantic_receipt.receipt_hash
    or (select pg_catalog.count(*) from app_data_agent.falcon24_authority_staging_receipts row
      where row.app_id=baseline.app_id and row.tenant_id=baseline.tenant_id
        and row.environment=baseline.environment and row.staging_id=baseline.staging_id
        and row.authority_epoch='E4')<>6
  then raise exception using errcode='55000',
    message='FALCON24_COMBINED_ACTIVATION_BASELINE_MISMATCH'; end if;

  if exists(select 1 from app_data_agent.runs row where row.app_id=authority.app_id
      and row.tenant_id=authority.tenant_id and row.environment=authority.environment
      and row.authority_epoch='E4')
    or exists(select 1 from app_data_agent.effective_run_config_receipts row
      where row.app_id=authority.app_id and row.tenant_id=authority.tenant_id
        and row.environment=authority.environment and row.authority_epoch='E4')
    or exists(select 1 from app_data_agent.artifacts row where row.app_id=authority.app_id
      and row.tenant_id=authority.tenant_id and row.environment=authority.environment
      and row.authority_epoch='E4')
    or exists(select 1 from app_data_agent.falcon24_qualifications row
      where row.app_id=authority.app_id and row.tenant_id=authority.tenant_id
        and row.environment=authority.environment and row.authority_epoch='E4')
    or exists(select 1 from app_data_agent.falcon24_acceptance_campaigns row
      where row.app_id=authority.app_id and row.tenant_id=authority.tenant_id
        and row.environment=authority.environment and row.authority_epoch='E4')
    or exists(select 1 from app_data_agent.falcon24_gate_attempt_history row
      where row.app_id=authority.app_id and row.tenant_id=authority.tenant_id
        and row.environment=authority.environment and row.authority_epoch='E4')
    or exists(select 1 from app_data_agent.falcon24_ui_receipts row
      where row.app_id=authority.app_id and row.tenant_id=authority.tenant_id
        and row.environment=authority.environment and row.authority_epoch='E4')
  then raise exception using errcode='55000',message='FALCON24_E4_AUTHORITY_POLLUTED'; end if;

  select * into publish_attempt from semantic.semantic_publish_attempt row
    where row.app_id=stage.app_id and row.tenant_id=stage.tenant_id
      and row.environment=stage.environment and row.semantic_domain=stage.semantic_domain
      and row.attempt_id=stage.publish_attempt_id for update;
  select * into review_task from semantic.semantic_review_task row
    where row.app_id=stage.app_id and row.tenant_id=stage.tenant_id
      and row.environment=stage.environment and row.semantic_domain=stage.semantic_domain
      and row.packet_id=stage.review_id for share;
  select * into dependency from semantic.semantic_dependency_pointer row
    where row.app_id=stage.app_id and row.tenant_id=stage.tenant_id
      and row.environment=stage.environment and row.semantic_domain=stage.semantic_domain for share;
  if publish_attempt.attempt_state is distinct from 'PREPARED'
    or publish_attempt.target_generation is distinct from stage.target_generation
    or publish_attempt.candidate_id is distinct from stage.change_set_id
    or publish_attempt.packet_id is distinct from stage.review_id
    or publish_attempt.compiler_bundle_digest is distinct from stage.compiler_bundle_hash
    or review_task.decision_window_status is distinct from 'CLOSED'
    or review_task.review_outcome is distinct from 'APPROVED'
    or review_task.candidate_id is distinct from stage.change_set_id
    or dependency.current_closure_policy_digest is null
    or not exists(select 1 from semantic.semantic_source_revision row
      where row.app_id=stage.app_id and row.tenant_id=stage.tenant_id
        and row.environment=stage.environment and row.semantic_domain=stage.semantic_domain
        and row.revision_id=stage.source_revision_id
        and row.source_digest=stage.change_set_hash)
    or not exists(select 1 from semantic.semantic_candidate_revision row
      where row.app_id=stage.app_id and row.tenant_id=stage.tenant_id
        and row.environment=stage.environment and row.semantic_domain=stage.semantic_domain
        and row.candidate_id=stage.change_set_id
        and row.revision_id=stage.candidate_revision_id
        and row.source_revision_id=stage.source_revision_id
        and row.revision_digest=stage.change_set_hash)
    or not exists(select 1 from semantic.semantic_candidate row
      where row.app_id=stage.app_id and row.tenant_id=stage.tenant_id
        and row.environment=stage.environment and row.semantic_domain=stage.semantic_domain
        and row.candidate_id=stage.change_set_id and row.current_revision_id=stage.candidate_revision_id
        and row.candidate_status='PUBLISHING')
    or (select pg_catalog.count(*) from semantic.semantic_successor_projection_stage row
      where row.app_id=stage.app_id and row.tenant_id=stage.tenant_id
        and row.environment=stage.environment and row.semantic_domain=stage.semantic_domain
        and row.stage_id=stage.stage_id)<>4
  then raise exception using errcode='55000',
    message='FALCON24_COMBINED_ACTIVATION_BASELINE_MISMATCH'; end if;

  insert into semantic.semantic_source_release(
    app_id,tenant_id,environment,semantic_domain,release_id,release_generation,attempt_id,
    packet_id,candidate_id,release_digest,compiler_bundle_digest,executable_projection_ref,
    executable_projection_hash,relationship_projection_ref,relationship_projection_hash,
    runtime_restriction_projection_ref,runtime_restriction_projection_hash,
    profile_child_manifest,quorum_snapshot,decision_set_digest,published_at,published_by,approval_mode)
  values(stage.app_id,stage.tenant_id,stage.environment,stage.semantic_domain,
    stage.candidate_release_id,stage.target_generation,stage.publish_attempt_id,stage.review_id,
    stage.change_set_id,stage.candidate_release_digest,stage.compiler_bundle_hash,
    (stage.stage_document#>>'{projection_refs,executable,projection_id}')::uuid,
    stage.stage_document#>>'{projection_refs,executable,projection_digest}',
    (stage.stage_document#>>'{projection_refs,relationship,projection_id}')::uuid,
    stage.stage_document#>>'{projection_refs,relationship,projection_digest}',
    (stage.stage_document#>>'{projection_refs,runtime_restriction,projection_id}')::uuid,
    stage.stage_document#>>'{projection_refs,runtime_restriction,projection_digest}',
    pg_catalog.jsonb_build_object(
      'graph_projection_id',stage.stage_document#>>'{projection_refs,graph,projection_id}',
      'graph_projection_digest',stage.stage_document#>>'{projection_refs,graph,projection_digest}',
      'binding_impact_hashes',stage.binding_impact_hashes),
    review_task.quorum_rules_snapshot,stage.review_hash,now_at,authority.principal_id::text,'HUMAN_REVIEW');

  select * into projection_row from semantic.semantic_successor_projection_stage row
    where row.app_id=stage.app_id and row.tenant_id=stage.tenant_id
      and row.environment=stage.environment and row.semantic_domain=stage.semantic_domain
      and row.stage_id=stage.stage_id and row.projection_kind='EXECUTABLE';
  insert into semantic.semantic_executable_projection(
    app_id,tenant_id,environment,semantic_domain,projection_id,release_id,
    projection_digest,projection_payload)
  values(stage.app_id,stage.tenant_id,stage.environment,stage.semantic_domain,
    projection_row.projection_id,stage.candidate_release_id,
    projection_row.projection_digest,projection_row.projection_payload);

  select * into projection_row from semantic.semantic_successor_projection_stage row
    where row.app_id=stage.app_id and row.tenant_id=stage.tenant_id
      and row.environment=stage.environment and row.semantic_domain=stage.semantic_domain
      and row.stage_id=stage.stage_id and row.projection_kind='RELATIONSHIP';
  insert into semantic.semantic_relationship_projection(
    app_id,tenant_id,environment,semantic_domain,projection_id,release_id,datasource_id,
    catalog_epoch,projection_digest,projection_payload)
  values(stage.app_id,stage.tenant_id,stage.environment,stage.semantic_domain,
    projection_row.projection_id,stage.candidate_release_id,stage.datasource_id,
    publish_attempt.catalog_fence_epoch,projection_row.projection_digest,
    projection_row.projection_payload);

  select * into projection_row from semantic.semantic_successor_projection_stage row
    where row.app_id=stage.app_id and row.tenant_id=stage.tenant_id
      and row.environment=stage.environment and row.semantic_domain=stage.semantic_domain
      and row.stage_id=stage.stage_id and row.projection_kind='RUNTIME_RESTRICTION';
  insert into semantic.semantic_runtime_restriction_projection(
    app_id,tenant_id,environment,semantic_domain,projection_id,release_id,projection_digest,
    platform_policy_digest,compiler_bundle_digest,pointer_generation,restriction_payload)
  values(stage.app_id,stage.tenant_id,stage.environment,stage.semantic_domain,
    projection_row.projection_id,stage.candidate_release_id,projection_row.projection_digest,
    dependency.current_closure_policy_digest,stage.compiler_bundle_hash,
    pointer.pointer_generation+1,projection_row.projection_payload);

  select projection_id,projection_payload into graph_projection_id,graph_payload
    from semantic.semantic_successor_projection_stage row
    where row.app_id=stage.app_id and row.tenant_id=stage.tenant_id
      and row.environment=stage.environment and row.semantic_domain=stage.semantic_domain
      and row.stage_id=stage.stage_id and row.projection_kind='GRAPH';
  insert into semantic.semantic_graph_projection(
    app_id,tenant_id,environment,semantic_domain,projection_id,graph_id,source_revision_id,
    source_revision_digest,source_digest,registry_digest,compiler_version,projection_payload,
    projection_storage_digest,node_count,edge_count,created_by,created_at)
  values(stage.app_id,stage.tenant_id,stage.environment,stage.semantic_domain,graph_projection_id,
    (graph_payload->>'graph_id')::uuid,stage.source_revision_id,stage.source_snapshot_hash,
    graph_payload->>'source_digest',graph_payload->>'registry_digest',
    graph_payload->>'compiler_version',graph_payload,
    stage.stage_document#>>'{projection_refs,graph,projection_digest}',
    (graph_payload->>'node_count')::integer,(graph_payload->>'edge_count')::integer,
    authority.principal_id,now_at);
  for node_value in select value from pg_catalog.jsonb_array_elements(graph_payload->'nodes') loop
    insert into semantic.semantic_graph_node_projection(
      app_id,tenant_id,environment,semantic_domain,projection_id,node_id,node_type,
      node_version,lifecycle,intrinsic_payload,entry_storage_digest)
    values(stage.app_id,stage.tenant_id,stage.environment,stage.semantic_domain,graph_projection_id,
      node_value->>'node_id',node_value->>'node_type',(node_value->>'node_version')::integer,
      node_value->>'lifecycle',node_value,app_data_agent.u2_canonical_sha256(node_value));
  end loop;
  for edge_value in select value from pg_catalog.jsonb_array_elements(graph_payload->'edges') loop
    insert into semantic.semantic_graph_edge_projection(
      app_id,tenant_id,environment,semantic_domain,projection_id,edge_id,edge_type,edge_family,
      source_node_id,target_node_id,edge_version,lifecycle,edge_payload,entry_storage_digest)
    values(stage.app_id,stage.tenant_id,stage.environment,stage.semantic_domain,graph_projection_id,
      edge_value->>'edge_id',edge_value->>'edge_type',edge_value->>'family',
      edge_value->>'source_node_id',edge_value->>'target_node_id',
      (edge_value->>'edge_version')::integer,edge_value->>'lifecycle',edge_value,
      app_data_agent.u2_canonical_sha256(edge_value));
  end loop;
  insert into semantic.semantic_source_release_graph_projection(
    app_id,tenant_id,environment,semantic_domain,release_id,projection_id,source_revision_id,
    source_revision_digest,source_digest,projection_storage_digest,bound_by,bound_at)
  values(stage.app_id,stage.tenant_id,stage.environment,stage.semantic_domain,
    stage.candidate_release_id,graph_projection_id,stage.source_revision_id,
    stage.source_snapshot_hash,graph_payload->>'source_digest',
    stage.stage_document#>>'{projection_refs,graph,projection_digest}',authority.principal_id,now_at);

  update semantic.semantic_publish_attempt set attempt_state='COMMITTED',
    executable_projection_ref=(stage.stage_document#>>'{projection_refs,executable,projection_id}')::uuid,
    executable_projection_hash=stage.stage_document#>>'{projection_refs,executable,projection_digest}',
    relationship_projection_ref=(stage.stage_document#>>'{projection_refs,relationship,projection_id}')::uuid,
    relationship_projection_hash=stage.stage_document#>>'{projection_refs,relationship,projection_digest}',
    runtime_restriction_projection_ref=
      (stage.stage_document#>>'{projection_refs,runtime_restriction,projection_id}')::uuid,
    runtime_restriction_projection_hash=
      stage.stage_document#>>'{projection_refs,runtime_restriction,projection_digest}',
    committed_release_ref=stage.candidate_release_id,updated_at=now_at
    where app_id=stage.app_id and tenant_id=stage.tenant_id and environment=stage.environment
      and semantic_domain=stage.semantic_domain and attempt_id=stage.publish_attempt_id
      and attempt_state='PREPARED';
  if not found then raise exception using errcode='40001',
    message='FALCON24_COMBINED_ACTIVATION_PREDECESSOR_MISMATCH'; end if;
  update semantic.semantic_candidate set candidate_status='PUBLISHED',updated_at=now_at
    where app_id=stage.app_id and tenant_id=stage.tenant_id and environment=stage.environment
      and semantic_domain=stage.semantic_domain and candidate_id=stage.change_set_id
      and candidate_status='PUBLISHING';
  if not found then raise exception using errcode='40001',
    message='FALCON24_COMBINED_ACTIVATION_PREDECESSOR_MISMATCH'; end if;

  defaults_revision_id:=(command->>'command_id')::uuid;
  new_defaults_json:=pg_catalog.jsonb_set(defaults_revision.defaults_json,'{semantic_release}',
    pg_catalog.jsonb_build_object('resource_id',stage.candidate_release_id,
      'resource_revision',stage.target_generation,'resource_hash',stage.candidate_release_digest));
  new_revision_document:=pg_catalog.jsonb_build_object(
    'schema_version','workspace-defaults-revision@1.0.0','scope',
      pg_catalog.jsonb_build_object('app_id',authority.app_id,'tenant_id',authority.tenant_id,
        'environment',authority.environment,'workspace_id',authority.tenant_id),
    'defaults_id',defaults_pointer.defaults_id,
    'defaults_revision',defaults_pointer.defaults_revision+1,
    'parent_revision',defaults_pointer.defaults_revision,'parent_hash',defaults_pointer.defaults_hash,
    'defaults',new_defaults_json,'created_by_principal_id',authority.principal_id,
    'created_at',app_data_agent.runtime_iso_timestamp(now_at));
  new_defaults_hash:=app_data_agent.u2_canonical_sha256(new_revision_document);
  insert into app_data_agent.workspace_run_default_revisions(
    app_id,tenant_id,environment,defaults_id,defaults_revision,revision_id,principal_id,
    idempotency_key,request_hash,defaults_json,revision_document,defaults_hash,
    membership_version,user_authz_epoch,workspace_lifecycle_version,app_epoch,committed_at)
  values(authority.app_id,authority.tenant_id,authority.environment,defaults_pointer.defaults_id,
    defaults_pointer.defaults_revision+1,defaults_revision_id,authority.principal_id,
    'combined-e4:'||(command->>'command_id'),command->>'command_hash',new_defaults_json,
    new_revision_document,new_defaults_hash,authority.membership_version,
    defaults_revision.user_authz_epoch,defaults_revision.workspace_lifecycle_version,
    authority.app_epoch,now_at);
  update app_data_agent.workspace_run_defaults pointer_row set
    defaults_revision=defaults_pointer.defaults_revision+1,revision_id=defaults_revision_id,
    defaults_hash=new_defaults_hash,updated_by_principal_id=authority.principal_id,updated_at=now_at
    where pointer_row.app_id=authority.app_id and pointer_row.tenant_id=authority.tenant_id
      and pointer_row.environment=authority.environment
      and pointer_row.defaults_revision=defaults_pointer.defaults_revision
      and pointer_row.revision_id=defaults_pointer.revision_id
      and pointer_row.defaults_hash=defaults_pointer.defaults_hash;
  if not found then raise exception using errcode='40001',
    message='FALCON24_COMBINED_ACTIVATION_DEFAULTS_STALE'; end if;

  update semantic.semantic_active_pointer set current_release_id=stage.candidate_release_id,
    current_release_generation=stage.target_generation,
    current_release_digest=stage.candidate_release_digest,
    pointer_generation=pointer.pointer_generation+1,updated_at=now_at,
    updated_by=authority.principal_id::text
    where app_id=stage.app_id and tenant_id=stage.tenant_id and environment=stage.environment
      and semantic_domain=stage.semantic_domain and current_release_id=pointer.current_release_id
      and current_release_generation=pointer.current_release_generation
      and pointer_generation=pointer.pointer_generation;
  if not found then raise exception using errcode='40001',
    message='FALCON24_COMBINED_ACTIVATION_PREDECESSOR_MISMATCH'; end if;
  update semantic.semantic_runtime_activation set current_release_id=stage.candidate_release_id,
    current_release_generation=stage.target_generation,
    activation_generation=runtime.activation_generation+1,updated_at=now_at
    where app_id=stage.app_id and tenant_id=stage.tenant_id and environment=stage.environment
      and semantic_domain=stage.semantic_domain
      and current_release_id=runtime.current_release_id
      and current_release_generation=runtime.current_release_generation
      and activation_generation=runtime.activation_generation;
  if not found then raise exception using errcode='40001',
    message='FALCON24_COMBINED_ACTIVATION_PREDECESSOR_MISMATCH'; end if;

  update app_data_agent.falcon24_authority_activation_attempts set
    status='ACTIVATED',decided_at=now_at
    where app_id=attempt.app_id and tenant_id=attempt.tenant_id
      and environment=attempt.environment and attempt_id=attempt.attempt_id and status='OPEN';
  if not found then raise exception using errcode='40001',
    message='FALCON24_COMBINED_ACTIVATION_BASELINE_MISMATCH'; end if;
  update app_data_agent.falcon24_authority_baselines set
    status='ACTIVE',activation_attempt_id=attempt.attempt_id,activated_at=now_at
    where app_id=baseline.app_id and tenant_id=baseline.tenant_id
      and environment=baseline.environment and baseline_id=baseline.baseline_id and status='STAGED';
  if not found then raise exception using errcode='40001',
    message='FALCON24_COMBINED_ACTIVATION_BASELINE_MISMATCH'; end if;
  update app_data_agent.falcon24_authority_staging_sessions set status='CONSUMED',updated_at=now_at
    where app_id=session.app_id and tenant_id=session.tenant_id and environment=session.environment
      and staging_id=session.staging_id and authority_epoch='E4' and status='STAGED';
  if not found then raise exception using errcode='40001',
    message='FALCON24_COMBINED_ACTIVATION_BASELINE_MISMATCH'; end if;
  update app_data_agent.falcon24_current_authority_epoch set authority_epoch='E4',
    baseline_id=baseline.baseline_id,baseline_hash=baseline.baseline_hash,
    activation_attempt_id=attempt.attempt_id,activated_at=now_at
    where app_id=current_epoch.app_id and tenant_id=current_epoch.tenant_id
      and environment=current_epoch.environment and authority_epoch='E3'
    returning * into strict current_epoch;

  outbox_payload:=pg_catalog.jsonb_build_object(
    'schema_version','semantic-successor-activated-event@1.0.0','stage_id',stage.stage_id,
    'release_id',stage.candidate_release_id,'release_digest',stage.candidate_release_digest,
    'release_generation',stage.target_generation,'authority_epoch','E4',
    'baseline_id',baseline.baseline_id,'smoke_receipt_hash',smoke_receipt.receipt_hash);
  outbox_digest:=app_data_agent.u2_canonical_sha256(outbox_payload);
  insert into semantic.semantic_outbox(
    app_id,tenant_id,environment,semantic_domain,event_id,event_type,counter_kind,
    axis_generation,observed_release_generation,event_payload,event_digest,created_at)
  values(stage.app_id,stage.tenant_id,stage.environment,stage.semantic_domain,stage.outbox_event_id,
    'SOURCE_RELEASE_ACTIVATED','RELEASE',stage.target_generation,stage.target_generation,
    outbox_payload,outbox_digest,now_at);

  transaction_id_value:='xid:'||pg_catalog.pg_current_xact_id()::text;
  receipt:=pg_catalog.jsonb_build_object(
    'schema_version','combined-falcon24-semantic-activation-receipt@1.0.0',
    'command_id',command->>'command_id','command_hash',command->>'command_hash',
    'scope',scope_json,'authority',app_data_agent.falcon24_authority_binding_document(current_epoch),
    'semantic_release',stage.stage_document->'candidate_release','workspace_defaults',
      pg_catalog.jsonb_build_object('version',defaults_pointer.defaults_revision+1,
        'semantic_release',stage.stage_document->'candidate_release'),
    'stage_ref',stage_ref,'smoke_receipt_ref',smoke_ref,
    'outbox_event_id',stage.outbox_event_id,'transaction_id',transaction_id_value);
  receipt_hash:=app_data_agent.u2_canonical_sha256(pg_catalog.jsonb_build_object(
    'hash_domain','combined-falcon24-semantic-activation-receipt@1.0.0','receipt',receipt));
  receipt:=receipt||pg_catalog.jsonb_build_object('activation_receipt_hash',receipt_hash);
  insert into semantic.semantic_successor_stage_receipt(
    app_id,tenant_id,environment,semantic_domain,stage_id,receipt_kind,receipt_id,
    receipt_schema_version,operation_idempotency_key,operation_digest,
    receipt_json,receipt_hash,created_at)
  values(stage.app_id,stage.tenant_id,stage.environment,stage.semantic_domain,stage.stage_id,
    'PROMOTION',(command->>'command_id')::uuid,receipt->>'schema_version',
    command->>'idempotency_key',command->>'command_hash',receipt,receipt_hash,now_at);
  update semantic.semantic_successor_release_stage set status='PROMOTED',promoted_at=now_at
    where app_id=stage.app_id and tenant_id=stage.tenant_id and environment=stage.environment
      and semantic_domain=stage.semantic_domain and stage_id=stage.stage_id
      and status='SMOKE_PASSED';
  if not found then raise exception using errcode='40001',
    message='FALCON24_COMBINED_ACTIVATION_SMOKE_REQUIRED'; end if;
  return receipt;
end
$function$;
alter function app_data_agent.activate_falcon24_authority_with_semantic_successor(jsonb)
  owner to data_agent_u6_rpc_owner;

revoke all on function app_data_agent.activate_falcon24_authority_with_semantic_successor(jsonb)
  from public,anon,authenticated,service_role,data_agent_backend;
grant execute on function app_data_agent.activate_falcon24_authority_with_semantic_successor(jsonb)
  to data_agent_backend;
do $postconditions$
declare snapshot record; schema_name text; table_name text;
  after_count bigint; after_digest text; rpc record; rpc_definition text;
begin
  for snapshot in select * from falcon24_10797_authority_history_snapshot loop
    schema_name:=pg_catalog.split_part(snapshot.relation_name,'.',1);
    table_name:=pg_catalog.split_part(snapshot.relation_name,'.',2);
    execute pg_catalog.format(
      'select pg_catalog.count(*)::bigint, app_data_agent.u2_canonical_sha256('
      ||'coalesce(pg_catalog.jsonb_agg(to_jsonb(row_value) order by '
      ||'to_jsonb(row_value)::text),''[]''::jsonb)) from %I.%I as row_value',
      schema_name,table_name)
      into strict after_count,after_digest;
    if snapshot.row_count is distinct from after_count
      or snapshot.row_digest is distinct from after_digest
    then raise exception using errcode='P0001',
      message='FALCON24_SUCCESSOR_ACTIVATION_CLOSURE_HISTORY_DRIFT'; end if;
  end loop;

  select procedure.provolatile,procedure.prosecdef,procedure.proconfig,
    pg_catalog.pg_get_userbyid(procedure.proowner) as owner_name,
    pg_catalog.pg_get_functiondef(procedure.oid)
    into strict rpc
    from pg_catalog.pg_proc as procedure
    where procedure.oid=
      'app_data_agent.activate_falcon24_authority_with_semantic_successor(jsonb)'::regprocedure;
  rpc_definition:=rpc.pg_get_functiondef;

  if rpc.provolatile is distinct from 'v'
    or rpc.prosecdef is distinct from true
    or rpc.owner_name is distinct from 'data_agent_u6_rpc_owner'
    or not (rpc.proconfig @> array['search_path=""']::text[])
    or pg_catalog.strpos(
      rpc_definition,'row.source_digest=stage.source_snapshot_hash')<>0
    or pg_catalog.strpos(
      rpc_definition,'row.source_digest=stage.change_set_hash')=0
    or pg_catalog.strpos(
      rpc_definition,'row.revision_id=stage.candidate_revision_id')=0
    or pg_catalog.strpos(
      rpc_definition,'row.source_revision_id=stage.source_revision_id')=0
    or pg_catalog.strpos(
      rpc_definition,'row.revision_digest=stage.change_set_hash')=0
    or pg_catalog.strpos(
      rpc_definition,'row.current_revision_id=stage.candidate_revision_id')=0
    or pg_catalog.strpos(
      rpc_definition,'row.candidate_status=''PUBLISHING''')=0
    or pg_catalog.has_function_privilege(
      'public',
      'app_data_agent.activate_falcon24_authority_with_semantic_successor(jsonb)',
      'EXECUTE')
    or not pg_catalog.has_function_privilege(
      'data_agent_backend',
      'app_data_agent.activate_falcon24_authority_with_semantic_successor(jsonb)',
      'EXECUTE')
  then raise exception using errcode='P0001',
    message='FALCON24_SUCCESSOR_ACTIVATION_CLOSURE_POSTCONDITION_FAILED'; end if;
end
$postconditions$;
select platform.assert_migration_checksum(
  'app','00000000-0000-4000-8000-00000000da01'::uuid,
  '20260725010797_app_data_agent_falcon24_successor_activation_closure',
  'sha256:c5afa3d4b8babc91b61b2bd3d6f3edc18324502254270d08e8d63049dc18e984');

commit;
