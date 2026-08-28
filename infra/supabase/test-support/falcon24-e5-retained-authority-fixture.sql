begin;

select pg_catalog.set_config('data_agent.app_id','00000000-0000-4000-8000-00000000da01',true);
select pg_catalog.set_config('data_agent.tenant_id','00000000-0000-4000-8000-00000000e124',true);
select pg_catalog.set_config('data_agent.environment','local',true);
select pg_catalog.set_config('data_agent.deployment_id','00000000-0000-4000-8000-000000000001',true);
select pg_catalog.set_config('data_agent.principal_id','00000000-0000-4000-8000-00000000e125',true);
select pg_catalog.set_config('data_agent.role','owner',true);
select pg_catalog.set_config('app.semantic_domain','falcon24',true);

do $fixture$
declare
  staging_id constant uuid:='00000000-0000-4000-8000-00000000e501';
  baseline_id constant uuid:='00000000-0000-4000-8000-00000000e502';
  attempt_id constant uuid:='00000000-0000-4000-8000-00000000e503';
  retained_hash constant text:='sha256:1111111111111111111111111111111111111111111111111111111111111111';
  proof_hash constant text:='sha256:2222222222222222222222222222222222222222222222222222222222222222';
  release_id_value constant uuid:='18472091-59b1-5d86-b399-9605ca627040';
  release_digest constant text:='sha256:9c53ca74db82181ff46a591ee4e2b88d63e5c9b4e6e3fa157f10fa085ca74dd6';
  datasource_id constant uuid:='37653002-af62-53c9-bf21-519468aa39ab';
  current_row app_data_agent.falcon24_current_authority_epoch%rowtype;
  pointer semantic.semantic_active_pointer%rowtype;
  runtime semantic.semantic_runtime_activation%rowtype;
  defaults_pointer app_data_agent.workspace_run_defaults%rowtype;
  command jsonb;stale_command jsonb;replay_conflict_command jsonb;
  receipt jsonb;baseline jsonb;receipt_hash text;component text;
  receipt_hashes jsonb:='{}'::jsonb;baseline_key text;before_semantic text;after_semantic text;
  diagnostic_manifest jsonb;diagnostic_receipt jsonb;diagnostic_receipt_hash text;
  qualification_manifest jsonb;qualification_slots jsonb;qualification_result jsonb;
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
  if current_row.authority_epoch<>'E4' or pointer.current_release_id<>release_id_value
    or pointer.current_release_generation<>2 or pointer.current_release_digest<>release_digest
    or runtime.current_release_id<>release_id_value or runtime.current_release_generation<>2
  then raise exception 'FALCON24_E5_FIXTURE_PRECONDITION_FAILED'; end if;
  select app_data_agent.u2_canonical_sha256(pg_catalog.jsonb_build_object(
    'source_release',(select pg_catalog.to_jsonb(row) from semantic.semantic_source_release row
      where row.release_id=release_id_value and row.tenant_id=current_row.tenant_id),
    'pointer',pg_catalog.to_jsonb(pointer),'runtime',pg_catalog.to_jsonb(runtime),
    'defaults',(select pg_catalog.to_jsonb(row) from app_data_agent.workspace_run_defaults row
      where row.tenant_id=current_row.tenant_id and row.environment=current_row.environment),
    'defaults_revision',(select pg_catalog.to_jsonb(row)
      from app_data_agent.workspace_run_default_revisions row
      where row.tenant_id=current_row.tenant_id and row.environment=current_row.environment
        and row.defaults_revision=defaults_pointer.defaults_revision))) into before_semantic;

  command:=pg_catalog.jsonb_build_object(
    'schema_version','falcon24-staging-session@2.0.0','authority_epoch','E5',
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
      'schema_version','falcon24-staging-receipt@2.0.0','authority_epoch','E5',
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
      'authority_epoch','E5','receipt',receipt);
    command:=command||pg_catalog.jsonb_build_object(
      'command_hash',app_data_agent.u2_canonical_sha256(command));
    perform app_data_agent.record_falcon24_authority_staging_receipt(command);
    receipt_hashes:=receipt_hashes||pg_catalog.jsonb_build_object(baseline_key,receipt_hash);
  end loop;
  baseline:=pg_catalog.jsonb_build_object(
    'schema_version','falcon24-authority-baseline@2.0.0','baseline_id',baseline_id,
    'authority_epoch','E5','source_commit',pg_catalog.repeat('a',40),
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
    'schema_version','falcon24-stage-baseline-request@2.0.0','authority_epoch','E5',
    'staging_id',staging_id,'baseline',baseline);
  command:=command||pg_catalog.jsonb_build_object('command_hash',app_data_agent.u2_canonical_sha256(command));
  perform app_data_agent.stage_falcon24_authority_baseline(command);
  command:=pg_catalog.jsonb_build_object(
    'schema_version','falcon24-activation-request@2.0.0','authority_epoch','E5',
    'attempt_id',attempt_id,'baseline_id',baseline_id,
    'expected_baseline_hash',baseline->>'baseline_hash');
  command:=command||pg_catalog.jsonb_build_object('command_hash',app_data_agent.u2_canonical_sha256(command));
  perform app_data_agent.begin_falcon24_authority_activation_attempt(command);

  command:=pg_catalog.jsonb_build_object(
    'schema_version','falcon24-activation-request@3.0.0',
    'scope',pg_catalog.jsonb_build_object(
      'app_id',current_row.app_id,'tenant_id',current_row.tenant_id,
      'environment',current_row.environment,'semantic_domain','falcon24'),
    'authority_epoch','E5','attempt_id',attempt_id,'baseline_id',baseline_id,
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
  begin
    stale_command:=pg_catalog.jsonb_set(command-'command_hash','{expected_versions,semantic_pointer}',
      pg_catalog.to_jsonb(pointer.pointer_generation+1),false);
    stale_command:=stale_command||pg_catalog.jsonb_build_object(
      'command_hash',app_data_agent.u2_canonical_sha256(stale_command));
    perform app_data_agent.activate_falcon24_authority(stale_command);
    raise exception 'FALCON24_E5_STALE_VERSION_ACCEPTED';
  exception when others then
    if sqlerrm<>'FALCON24_RETAINED_SEMANTIC_CLOSURE_STALE'
    then raise; end if;
  end;
  if (select authority_epoch from app_data_agent.falcon24_current_authority_epoch
      where tenant_id=current_row.tenant_id and environment=current_row.environment)<>'E4'
  then raise exception 'FALCON24_E5_FAILURE_INJECTION_NOT_ALL_OLD'; end if;
  perform app_data_agent.activate_falcon24_authority(command);
  perform app_data_agent.activate_falcon24_authority(command);
  begin
    replay_conflict_command:=pg_catalog.jsonb_set(
      command-'command_hash','{retained_semantic_proof_hash}',
      pg_catalog.to_jsonb('sha256:'||pg_catalog.repeat('f',64)),false);
    replay_conflict_command:=replay_conflict_command||pg_catalog.jsonb_build_object(
      'command_hash',app_data_agent.u2_canonical_sha256(replay_conflict_command));
    perform app_data_agent.activate_falcon24_authority(replay_conflict_command);
    raise exception 'FALCON24_E5_REPLAY_CONFLICT_ACCEPTED';
  exception when others then
    if sqlerrm<>'FALCON24_RETAINED_ACTIVATION_REPLAY_CONFLICT'
    then raise; end if;
  end;
  if (select authority_epoch from app_data_agent.falcon24_current_authority_epoch
      where tenant_id=current_row.tenant_id and environment=current_row.environment)<>'E5'
  then raise exception 'FALCON24_E5_ACTIVATION_FAILED'; end if;

  select * into strict current_row from app_data_agent.falcon24_current_authority_epoch
    where tenant_id=current_row.tenant_id and environment=current_row.environment;
  diagnostic_manifest:=pg_catalog.jsonb_build_object(
    'schema_version','falcon24-diagnostic-attempt@2.0.0',
    'attempt_id','00000000-0000-4000-8000-00000000e504',
    'run_id','00000000-0000-4000-8000-00000000e505',
    'authority',app_data_agent.falcon24_authority_binding_document(current_row),
    'semantic_release',pg_catalog.jsonb_build_object(
      'release_id',release_id_value,'generation',2,'release_digest',release_digest,
      'datasource_id',datasource_id),
    'source_commit',pg_catalog.repeat('a',40),'source_fingerprint','sha256:'||pg_catalog.repeat('e',64),
    'web_build',pg_catalog.jsonb_build_object(
      'build_id','sha256:'||pg_catalog.repeat('d',64),
      'generation_id','sha256:'||pg_catalog.repeat('1',64)),
    'worker_build',pg_catalog.jsonb_build_object(
      'build_id','sha256:'||pg_catalog.repeat('2',64),
      'generation_id','sha256:'||pg_catalog.repeat('3',64)),
    'runtime_attestation_hash','sha256:'||pg_catalog.repeat('4',64),
    'question','最近 12 个完整月的订单收入趋势如何？请按月展示，并生成折线图。',
    'question_hash',app_data_agent.u2_canonical_sha256(
      pg_catalog.to_jsonb('最近 12 个完整月的订单收入趋势如何？请按月展示，并生成折线图。'::text)));
  diagnostic_manifest:=diagnostic_manifest||pg_catalog.jsonb_build_object(
    'manifest_hash',app_data_agent.u2_canonical_sha256(diagnostic_manifest));
  command:=pg_catalog.jsonb_build_object(
    'schema_version','falcon24-diagnostic-begin@2.0.0','manifest',diagnostic_manifest);
  command:=command||pg_catalog.jsonb_build_object('command_hash',app_data_agent.u2_canonical_sha256(command));
  perform app_data_agent.begin_falcon24_diagnostic(command);

  diagnostic_receipt:=pg_catalog.jsonb_build_object(
    'schema_version','falcon24-diagnostic-receipt@2.0.0',
    'attempt_id',diagnostic_manifest->>'attempt_id','run_id',diagnostic_manifest->>'run_id',
    'attempt_manifest_hash',diagnostic_manifest->>'manifest_hash',
    'authority',diagnostic_manifest->'authority','semantic_release',diagnostic_manifest->'semantic_release',
    'outcome','PASS','pass_evidence',pg_catalog.jsonb_build_object('residual',0),
    'failure_class',null,'failure_code',null,
    'completed_at','2026-08-29T00:00:00.000Z');
  diagnostic_receipt_hash:=app_data_agent.u2_canonical_sha256(diagnostic_receipt);
  diagnostic_receipt:=diagnostic_receipt||pg_catalog.jsonb_build_object(
    'receipt_hash',diagnostic_receipt_hash);
  insert into app_data_agent.falcon24_diagnostic_receipts(
    app_id,tenant_id,environment,attempt_id,run_id,outcome,completion_command_hash,
    receipt_hash,receipt_document,created_at)
  values(current_row.app_id,current_row.tenant_id,current_row.environment,
    (diagnostic_manifest->>'attempt_id')::uuid,(diagnostic_manifest->>'run_id')::uuid,
    'PASS','sha256:'||pg_catalog.repeat('5',64),diagnostic_receipt_hash,diagnostic_receipt,
    '2026-08-29T00:00:00.000Z');
  update app_data_agent.falcon24_diagnostic_attempts diagnostic set status='PASSED',
    terminal_receipt_hash=diagnostic_receipt_hash,completed_at='2026-08-29T00:00:00.000Z'
    where diagnostic.attempt_id=(diagnostic_manifest->>'attempt_id')::uuid
      and diagnostic.status='ACTIVE';

  diagnostic_manifest:=(diagnostic_manifest-array['attempt_id','run_id','manifest_hash'])
    ||pg_catalog.jsonb_build_object(
      'attempt_id','00000000-0000-4000-8000-00000000e506',
      'run_id','00000000-0000-4000-8000-00000000e507');
  diagnostic_manifest:=diagnostic_manifest||pg_catalog.jsonb_build_object(
    'manifest_hash',app_data_agent.u2_canonical_sha256(diagnostic_manifest));
  command:=pg_catalog.jsonb_build_object(
    'schema_version','falcon24-diagnostic-begin@2.0.0','manifest',diagnostic_manifest);
  command:=command||pg_catalog.jsonb_build_object('command_hash',app_data_agent.u2_canonical_sha256(command));
  perform app_data_agent.begin_falcon24_diagnostic(command);
  command:=pg_catalog.jsonb_build_object(
    'schema_version','falcon24-diagnostic-complete@1.0.0',
    'attempt_id',diagnostic_manifest->>'attempt_id','outcome','FAIL',
    'failure_class','EXTERNAL_DEPENDENCY','failure_code','FIXTURE_EXTERNAL_DEPENDENCY');
  command:=command||pg_catalog.jsonb_build_object('command_hash',app_data_agent.u2_canonical_sha256(command));
  receipt:=app_data_agent.complete_falcon24_diagnostic(command);
  if receipt->>'schema_version'<>'falcon24-diagnostic-receipt@2.0.0'
    or receipt->>'outcome'<>'FAIL'
  then raise exception 'FALCON24_E5_DIAGNOSTIC_V2_FAILED'; end if;

  select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
    'ordinal',slot.ordinal,
    'run_id',('00000000-0000-4000-8000-'||pg_catalog.lpad((600+slot.ordinal)::text,12,'0'))::uuid,
    'slot_id',slot.slot_id,'stage',slot.stage,'case_id',slot.case_id,
    'prompt',slot.prompt,'prompt_hash',slot.prompt_hash,'run_variant',slot.run_variant,
    'expected_path',slot.expected_path) order by slot.ordinal) into strict qualification_slots
    from app_data_agent.falcon24_qualification_slots slot
    where slot.tenant_id=current_row.tenant_id and slot.environment=current_row.environment
      and slot.qualification_id='E3-Q1';
  qualification_manifest:=pg_catalog.jsonb_build_object(
    'schema_version','falcon24-qualification-manifest@4.0.0','authority_epoch','E5',
    'qualification_id','E5-Q1','attempt_id','00000000-0000-4000-8000-00000000e508',
    'authority_baseline_hash',current_row.baseline_hash,
    'source_commit',pg_catalog.repeat('a',40),'source_fingerprint','sha256:'||pg_catalog.repeat('e',64),
    'frozen_contract_hash','sha256:'||pg_catalog.repeat('6',64),
    'semantic_release_hash',release_digest,'schema_snapshot_hash','sha256:'||pg_catalog.repeat('7',64),
    'operator_registry_digest','sha256:'||pg_catalog.repeat('8',64),
    'model_config_hash','sha256:'||pg_catalog.repeat('9',64),
    'web_build_hash','sha256:'||pg_catalog.repeat('d',64),
    'runtime_attestation_hash','sha256:'||pg_catalog.repeat('4',64),
    'model_provider','deepseek','model_id','deepseek-v4-flash','slots',qualification_slots,
    'diagnostic_receipt_ref',pg_catalog.jsonb_build_object(
      'attempt_id','00000000-0000-4000-8000-00000000e504',
      'run_id','00000000-0000-4000-8000-00000000e505',
      'receipt_hash',diagnostic_receipt_hash));
  qualification_manifest:=qualification_manifest||pg_catalog.jsonb_build_object(
    'manifest_hash',app_data_agent.u2_canonical_sha256(qualification_manifest));
  command:=pg_catalog.jsonb_build_object(
    'schema_version','falcon24-qualification-begin@4.0.0','manifest',qualification_manifest);
  command:=command||pg_catalog.jsonb_build_object('command_hash',app_data_agent.u2_canonical_sha256(command));
  qualification_result:=app_data_agent.begin_falcon24_qualification(command);
  if qualification_result->>'authority_epoch'<>'E5'
    or qualification_result->>'qualification_id'<>'E5-Q1'
    or qualification_result->>'diagnostic_receipt_hash'<>diagnostic_receipt_hash
  then raise exception 'FALCON24_E5_QUALIFICATION_V4_FAILED'; end if;

  select app_data_agent.u2_canonical_sha256(pg_catalog.jsonb_build_object(
    'source_release',(select pg_catalog.to_jsonb(row) from semantic.semantic_source_release row
      where row.release_id=release_id_value and row.tenant_id=current_row.tenant_id),
    'pointer',(select pg_catalog.to_jsonb(row) from semantic.semantic_active_pointer row
      where row.tenant_id=current_row.tenant_id and row.environment=current_row.environment
        and row.semantic_domain='falcon24'),
    'runtime',(select pg_catalog.to_jsonb(row) from semantic.semantic_runtime_activation row
      where row.tenant_id=current_row.tenant_id and row.environment=current_row.environment
        and row.semantic_domain='falcon24'),
    'defaults',(select pg_catalog.to_jsonb(row) from app_data_agent.workspace_run_defaults row
      where row.tenant_id=current_row.tenant_id and row.environment=current_row.environment),
    'defaults_revision',(select pg_catalog.to_jsonb(row)
      from app_data_agent.workspace_run_default_revisions row
      where row.tenant_id=current_row.tenant_id and row.environment=current_row.environment
        and row.defaults_revision=defaults_pointer.defaults_revision))) into after_semantic;
  if before_semantic is distinct from after_semantic
  then raise exception 'FALCON24_E5_SEMANTIC_BYTES_DRIFT'; end if;
end
$fixture$;

\if :{?commit_fixture}
commit;
\else
rollback;
\endif
