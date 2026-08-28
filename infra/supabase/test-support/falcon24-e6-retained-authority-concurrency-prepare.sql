begin;

select pg_catalog.set_config('data_agent.app_id','00000000-0000-4000-8000-00000000da01',true);
select pg_catalog.set_config('data_agent.tenant_id','00000000-0000-4000-8000-00000000e124',true);
select pg_catalog.set_config('data_agent.environment','local',true);
select pg_catalog.set_config('data_agent.deployment_id','00000000-0000-4000-8000-000000000001',true);
select pg_catalog.set_config('data_agent.principal_id','00000000-0000-4000-8000-00000000e125',true);
select pg_catalog.set_config('data_agent.role','owner',true);
select pg_catalog.set_config('app.semantic_domain','falcon24',true);

create schema if not exists falcon24_w2_test;
create table falcon24_w2_test.retained_activation_command(
  authority_epoch text primary key,
  command jsonb not null
);

do $fixture$
declare
  staging_id constant uuid:='00000000-0000-4000-8000-00000000e601';
  baseline_id constant uuid:='00000000-0000-4000-8000-00000000e602';
  attempt_id constant uuid:='00000000-0000-4000-8000-00000000e603';
  retained_hash constant text:='sha256:3333333333333333333333333333333333333333333333333333333333333333';
  proof_hash constant text:='sha256:4444444444444444444444444444444444444444444444444444444444444444';
  release_id_value constant uuid:='18472091-59b1-5d86-b399-9605ca627040';
  release_digest constant text:='sha256:9c53ca74db82181ff46a591ee4e2b88d63e5c9b4e6e3fa157f10fa085ca74dd6';
  datasource_id constant uuid:='37653002-af62-53c9-bf21-519468aa39ab';
  current_row app_data_agent.falcon24_current_authority_epoch%rowtype;
  pointer semantic.semantic_active_pointer%rowtype;
  runtime semantic.semantic_runtime_activation%rowtype;
  defaults_pointer app_data_agent.workspace_run_defaults%rowtype;
  command jsonb;receipt jsonb;baseline jsonb;receipt_hash text;component text;
  receipt_hashes jsonb:='{}'::jsonb;baseline_key text;
begin
  select * into strict current_row from app_data_agent.falcon24_current_authority_epoch
    where tenant_id='00000000-0000-4000-8000-00000000e124'::uuid and environment='local';
  select * into strict pointer from semantic.semantic_active_pointer
    where tenant_id=current_row.tenant_id and environment=current_row.environment
      and semantic_domain='falcon24';
  select * into strict runtime from semantic.semantic_runtime_activation
    where tenant_id=current_row.tenant_id and environment=current_row.environment
      and semantic_domain='falcon24';
  select * into strict defaults_pointer from app_data_agent.workspace_run_defaults
    where tenant_id=current_row.tenant_id and environment=current_row.environment;
  if current_row.authority_epoch<>'E5' or pointer.current_release_id<>release_id_value
    or pointer.current_release_generation<>2 or pointer.current_release_digest<>release_digest
    or runtime.current_release_id<>release_id_value or runtime.current_release_generation<>2
  then raise exception 'FALCON24_E6_FIXTURE_PRECONDITION_FAILED'; end if;

  command:=pg_catalog.jsonb_build_object(
    'schema_version','falcon24-staging-session@2.0.0','authority_epoch','E6',
    'staging_id',staging_id,'retained_assets_hash',retained_hash);
  command:=command||pg_catalog.jsonb_build_object('command_hash',app_data_agent.u2_canonical_sha256(command));
  perform app_data_agent.begin_falcon24_authority_staging_session(command);

  foreach component in array array[
    'DATASET','SEMANTIC_RELEASE','LLM_CONFIGURATION','AGENT_PROFILES',
    'OPERATOR_REGISTRY','SANDBOX_RUNTIME']::text[] loop
    baseline_key:=case component when 'DATASET' then 'dataset'
      when 'SEMANTIC_RELEASE' then 'semantic_release'
      when 'LLM_CONFIGURATION' then 'llm_configuration'
      when 'AGENT_PROFILES' then 'agent_profiles'
      when 'OPERATOR_REGISTRY' then 'operator_registry' else 'sandbox_runtime' end;
    receipt:=pg_catalog.jsonb_build_object(
      'schema_version','falcon24-staging-receipt@2.0.0','authority_epoch','E6',
      'staging_id',staging_id,'component',component,
      'subject_hash',case when component='SEMANTIC_RELEASE' then release_digest
        else 'sha256:'||pg_catalog.repeat(case component
          when 'DATASET' then '3' when 'LLM_CONFIGURATION' then '4'
          when 'AGENT_PROFILES' then '5' when 'OPERATOR_REGISTRY' then '6' else '7' end,64) end,
      'evidence_hash',case when component='SEMANTIC_RELEASE' then proof_hash
        else 'sha256:'||pg_catalog.repeat(case component
          when 'DATASET' then '8' when 'LLM_CONFIGURATION' then '9'
          when 'AGENT_PROFILES' then 'a' when 'OPERATOR_REGISTRY' then 'b' else 'c' end,64) end,
      'production_isolation_proven',false);
    receipt_hash:=app_data_agent.u2_canonical_sha256(receipt);
    receipt:=receipt||pg_catalog.jsonb_build_object('receipt_hash',receipt_hash);
    command:=pg_catalog.jsonb_build_object(
      'schema_version','falcon24-staging-receipt-record@2.0.0',
      'authority_epoch','E6','receipt',receipt);
    command:=command||pg_catalog.jsonb_build_object(
      'command_hash',app_data_agent.u2_canonical_sha256(command));
    perform app_data_agent.record_falcon24_authority_staging_receipt(command);
    receipt_hashes:=receipt_hashes||pg_catalog.jsonb_build_object(baseline_key,receipt_hash);
  end loop;

  baseline:=pg_catalog.jsonb_build_object(
    'schema_version','falcon24-authority-baseline@2.0.0','baseline_id',baseline_id,
    'authority_epoch','E6','source_commit',pg_catalog.repeat('b',40),
    'retained_assets_hash',retained_hash,
    'web_build_hash','sha256:'||pg_catalog.repeat('d',64),
    'staging_receipts',receipt_hashes,
    'acceptance_contracts',pg_catalog.jsonb_build_object(
      'oracle','sha256:'||pg_catalog.repeat('1',64),
      'qualification','sha256:'||pg_catalog.repeat('2',64),
      'campaign','sha256:'||pg_catalog.repeat('3',64),
      'qa_e2e','sha256:'||pg_catalog.repeat('4',64),
      'trace_ui','sha256:'||pg_catalog.repeat('5',64),
      'reclamation','sha256:'||pg_catalog.repeat('6',64)),
    'production_isolation_proven',false,'production_gate','HOLD');
  baseline:=baseline||pg_catalog.jsonb_build_object(
    'baseline_hash',app_data_agent.u2_canonical_sha256(baseline));
  command:=pg_catalog.jsonb_build_object(
    'schema_version','falcon24-stage-baseline-request@2.0.0','authority_epoch','E6',
    'staging_id',staging_id,'baseline',baseline);
  command:=command||pg_catalog.jsonb_build_object('command_hash',app_data_agent.u2_canonical_sha256(command));
  perform app_data_agent.stage_falcon24_authority_baseline(command);

  command:=pg_catalog.jsonb_build_object(
    'schema_version','falcon24-activation-request@2.0.0','authority_epoch','E6',
    'attempt_id',attempt_id,'baseline_id',baseline_id,
    'expected_baseline_hash',baseline->>'baseline_hash');
  command:=command||pg_catalog.jsonb_build_object('command_hash',app_data_agent.u2_canonical_sha256(command));
  perform app_data_agent.begin_falcon24_authority_activation_attempt(command);

  command:=pg_catalog.jsonb_build_object(
    'schema_version','falcon24-activation-request@3.0.0',
    'scope',pg_catalog.jsonb_build_object(
      'app_id',current_row.app_id,'tenant_id',current_row.tenant_id,
      'environment',current_row.environment,'semantic_domain','falcon24'),
    'authority_epoch','E6','attempt_id',attempt_id,'baseline_id',baseline_id,
    'expected_baseline_hash',baseline->>'baseline_hash',
    'expected_current_authority',app_data_agent.falcon24_authority_binding_document(current_row),
    'expected_semantic_release',pg_catalog.jsonb_build_object(
      'release_id',release_id_value,'generation',2,'release_digest',release_digest,
      'datasource_id',datasource_id),
    'expected_versions',pg_catalog.jsonb_build_object(
      'semantic_pointer',pointer.pointer_generation,
      'semantic_runtime',runtime.activation_generation,
      'workspace_defaults',defaults_pointer.defaults_revision),
    'retained_semantic_proof_hash',proof_hash);
  command:=command||pg_catalog.jsonb_build_object('command_hash',app_data_agent.u2_canonical_sha256(command));
  insert into falcon24_w2_test.retained_activation_command(authority_epoch,command)
  values('E6',command);
end
$fixture$;

commit;
