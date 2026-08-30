-- Populated physical-clone regression. Requires a genuinely committed request@8.
begin;
select set_config('data_agent.app_id','00000000-0000-4000-8000-00000000da01',true),
  set_config('data_agent.tenant_id','00000000-0000-4000-8000-00000000e124',true),
  set_config('data_agent.environment','local',true),
  set_config('data_agent.principal_id','00000000-0000-4000-8000-00000000e125',true),
  set_config('data_agent.role','owner',true),
  set_config('data_agent.deployment_id','00000000-0000-4000-8000-000000000001',true),
  set_config('app.semantic_domain','falcon24',true);
set local role data_agent_u6_rpc_owner;
do $assertions$
declare stage app_data_agent.falcon24_llm_execution_certification_stage%rowtype;
  locked_count bigint;command jsonb;expected_result jsonb;actual_result jsonb;
begin
  select s.* into strict stage from app_data_agent.falcon24_llm_execution_certification_stage s
    join app_data_agent.falcon24_current_authority_epoch c
      on c.app_id=s.app_id and c.tenant_id=s.tenant_id and c.environment=s.environment
      and c.authority_epoch=s.target_authority_epoch and c.activation_attempt_id=s.activation_attempt_id
    where s.status='PROMOTED' and s.target_authority_epoch='E12';
  select count(*) into locked_count from (select artifact_id from app_data_agent.artifacts
    where artifact_id=stage.certification_artifact_id and run_id=stage.certification_run_id
      and revision=stage.certification_revision and content_hash=stage.certification_content_hash for update) locked;
  if locked_count<>1 then raise exception 'FALCON24_CURRENT_CERTIFICATION_LOCK_INVISIBLE'; end if;
  begin
    update app_data_agent.artifacts set is_active=false where artifact_id=stage.certification_artifact_id;
    raise exception 'FALCON24_REPLAY_LOCK_ALLOWED_DEACTIVATION';
  exception when sqlstate '42501' then null; end;
  begin
    update app_data_agent.artifacts set is_active=true where artifact_id=stage.certification_artifact_id;
    raise exception 'FALCON24_REPLAY_LOCK_ALLOWED_MUTATION';
  exception when sqlstate 'P0001' then
    if sqlerrm<>'DA_ARTIFACT_REVISION_IMMUTABLE' then raise; end if;
  end;
  begin
    update app_data_agent.artifacts set document_json=document_json||'{"extra":true}'::jsonb where artifact_id=stage.certification_artifact_id;
    raise exception 'FALCON24_REPLAY_LOCK_ALLOWED_PAYLOAD_UPDATE';
  exception when sqlstate 'P0001' then
    if sqlerrm<>'DA_ARTIFACT_REVISION_IMMUTABLE' then raise; end if;
  end;
  select command_document,result_document into strict command,expected_result
    from app_data_agent.falcon24_retained_recovery_activation_receipts
    where activation_attempt_id=stage.activation_attempt_id;
  actual_result:=app_data_agent.activate_falcon24_authority(command);
  if actual_result is distinct from expected_result then raise exception 'FALCON24_EXACT_REPLAY_RESULT_DRIFT'; end if;
  if not exists(select 1 from app_data_agent.artifacts where artifact_id=stage.certification_artifact_id and is_active)
    then raise exception 'FALCON24_REPLAY_MUTATED_CERTIFICATION'; end if;
  raise notice 'FALCON24_RECOVERY_REPLAY_AND_LOCK_BOUNDARIES_PASSED';
end
$assertions$;
rollback;
