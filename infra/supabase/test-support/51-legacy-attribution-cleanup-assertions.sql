\set ON_ERROR_STOP on

begin;

-- Even a temporary EXECUTE grant cannot bypass the session-user guard.
grant usage on schema app_data_agent to authenticated;
grant execute on function app_data_agent.execute_legacy_attribution_cleanup(jsonb)
  to authenticated;
set session authorization authenticated;
do $non_postgres_executor$
begin
  begin
    perform app_data_agent.execute_legacy_attribution_cleanup('{}'::jsonb);
    raise exception 'U51 non-postgres executor unexpectedly accepted';
  exception when insufficient_privilege then
    if sqlerrm <> 'LEGACY_ATTRIBUTION_CLEANUP_EXECUTOR_UNSAFE' then raise; end if;
  end;
end
$non_postgres_executor$;
reset session authorization;
revoke execute on function app_data_agent.execute_legacy_attribution_cleanup(jsonb)
  from authenticated;

create function pg_temp.u51_cleanup_command(
  inventory jsonb,
  operation_id uuid,
  backup_created_at timestamptz default pg_catalog.clock_timestamp()
) returns jsonb language sql volatile set search_path='' as $function$
  select pg_catalog.jsonb_build_object(
    'schema_version','legacy-attribution-cleanup-command@1.0.0',
    'operation_id',operation_id,
    'deployment_id',inventory->>'deployment_id',
    'app_id',inventory->>'app_id',
    'environment',inventory->>'environment',
    'database_name',inventory->>'database_name',
    'system_identifier',inventory->>'system_identifier',
    'inventory_digest',inventory->>'inventory_digest',
    'backup',pg_catalog.jsonb_build_object(
      'schema_version','legacy-attribution-backup-manifest@1.0.0',
      'database_name',inventory->>'database_name',
      'system_identifier',inventory->>'system_identifier',
      'inventory_digest',inventory->>'inventory_digest',
      'backup_sha256','sha256:'||pg_catalog.repeat('a',64),
      'backup_bytes',1,
      'restore_list_verified',true,
      'created_at',backup_created_at),
    'approval','DELETE_LEGACY_ATTRIBUTION_AUTHORITY_ROWS_ONLY',
    'expected_counts',(select pg_catalog.jsonb_object_agg(
      target->>'table_name',(target->>'row_count')::bigint order by target->>'table_name')
      from pg_catalog.jsonb_array_elements(inventory->'targets') target),
    'expected_total',(inventory->>'total_rows')::bigint,
    'hold_attestation','NO_HOLDS',
    'retirement_commit','16f2734',
    'requested_at',pg_catalog.clock_timestamp())
$function$;

create temporary table u51_shared_before as
select
  (select pg_catalog.count(*) from app_data_agent.runs) as run_count,
  (select pg_catalog.count(*) from app_data_agent.artifacts) as artifact_count,
  (select pg_catalog.count(*) from app_data_agent.qa_conversations) as conversation_count,
  (select pg_catalog.count(*) from platform.migration_ledger) as migration_count;

do $cleanup_acceptance$
declare
  app_id constant uuid:='00000000-0000-4000-8000-00000000da01';
  tenant_id constant uuid:='00000000-0000-4000-8000-00000000aa51';
  deployment_id constant uuid:='00000000-0000-4000-8000-000000000001';
  operation_with_rows constant uuid:='00000000-0000-4051-8051-000000000001';
  operation_noop constant uuid:='00000000-0000-4051-8051-000000000002';
  failed_operation constant uuid:='00000000-0000-4051-8051-000000000003';
  inventory jsonb;
  command jsonb;
  changed jsonb;
  receipt jsonb;
  replay jsonb;
  post_inventory jsonb;
  shared u51_shared_before%rowtype;
  target_names text[];
begin
  select app_data_agent.legacy_attribution_cleanup_target_tables() into target_names;
  if target_names<>array[
    'attribution_active_pointer','attribution_capability_directory',
    'attribution_conclusion_policy','attribution_eligibility_decision',
    'attribution_nonce_ledger','attribution_owner_map_release',
    'attribution_profile_projection','attribution_profile_request',
    'attribution_relationship_promotion_receipt','attribution_safety_verdict',
    'attribution_signer_assignment','attribution_verification_key_revision'
  ]::text[] then raise exception 'U51 cleanup allowlist drifted'; end if;

  insert into app_data_agent.attribution_active_pointer(
    app_id,tenant_id,environment,pointer_type,active_id)
  values(app_id,tenant_id,'local','OWNER_MAP','00000000-0000-4051-8051-000000000101');
  insert into app_data_agent.attribution_capability_directory(
    app_id,tenant_id,environment,directory_hash,capabilities)
  values(app_id,tenant_id,'local','sha256:'||pg_catalog.repeat('1',64),'{}'::jsonb);
  insert into app_data_agent.attribution_conclusion_policy(
    app_id,tenant_id,environment,policy,status)
  values(app_id,tenant_id,'local','{}'::jsonb,'PROVISIONED');
  insert into app_data_agent.attribution_eligibility_decision(
    app_id,tenant_id,environment,request_id,subject_id,eligibility_criteria,
    overall_eligible,decision,decided_by,frozen_question_hash)
  values(app_id,tenant_id,'local','00000000-0000-4051-8051-000000000102',
    'u51-subject','{}'::jsonb,false,'DEFERRED','u51','sha256:'||pg_catalog.repeat('2',64));
  insert into app_data_agent.attribution_nonce_ledger(
    app_id,tenant_id,environment,nonce,purpose,expires_at)
  values(app_id,tenant_id,'local','u51-nonce','cleanup-smoke',
    pg_catalog.clock_timestamp()+pg_catalog.make_interval(days=>1));
  insert into app_data_agent.attribution_owner_map_release(
    app_id,tenant_id,environment,owner_map,status)
  values(app_id,tenant_id,'local','{}'::jsonb,'PROVISIONED');
  insert into app_data_agent.attribution_owner_map_release(
    app_id,tenant_id,environment,owner_map,status)
  values(app_id,tenant_id,'test','{"u51_scope":"must-survive"}'::jsonb,'PROVISIONED');
  insert into app_data_agent.attribution_profile_projection(
    app_id,tenant_id,environment,source_release_id,profile_name,profile_version,
    lowering_rule_set,contribution_endpoints)
  values(app_id,tenant_id,'local','00000000-0000-4051-8051-000000000103',
    'u51-profile','1','{}'::jsonb,'{}'::jsonb);
  insert into app_data_agent.attribution_profile_request(
    app_id,tenant_id,environment,subject_id,requester,request_type,status)
  values(app_id,tenant_id,'local','u51-subject','u51','PROFILE_ACCESS','DRAFT');
  insert into app_data_agent.attribution_relationship_promotion_receipt(
    app_id,tenant_id,environment,source_release_id,target_release_id,promotion_type,status)
  values(app_id,tenant_id,'local','00000000-0000-4051-8051-000000000104',
    '00000000-0000-4051-8051-000000000105','PROMOTE','COMMITTED');
  insert into app_data_agent.attribution_safety_verdict(
    app_id,tenant_id,environment,run_id,evidence_id,verdict,verdict_reason,
    verdict_dimensions,determined_by,evidence_hash)
  values(app_id,tenant_id,'local','00000000-0000-4051-8051-000000000106',
    '00000000-0000-4051-8051-000000000107','HOLD','cleanup smoke',
    '{}'::jsonb,'u51','sha256:'||pg_catalog.repeat('3',64));
  insert into app_data_agent.attribution_signer_assignment(
    app_id,tenant_id,environment,policy_id,signer_role,required_signers,status)
  values(app_id,tenant_id,'local','00000000-0000-4051-8051-000000000108',
    'u51-signer',1,'PROVISIONED');
  insert into app_data_agent.attribution_verification_key_revision(
    app_id,tenant_id,environment,key_algorithm,public_key,status)
  values(app_id,tenant_id,'local','u51-test','u51-public-key','STAGED');

  inventory:=app_data_agent.legacy_attribution_cleanup_inventory(deployment_id);
  if inventory->>'schema_version'<>'legacy-attribution-cleanup-inventory@1.0.0'
    or (inventory->>'total_rows')::bigint<>12
    or (inventory->>'external_fk_count')::integer<>0
    or (inventory->>'hold_column_count')::integer<>0
    or pg_catalog.jsonb_array_length(inventory->'targets')<>12
    or inventory#>>'{migration_attestation,published_f9_10621_legacy_ledger_checksum}'
      <>'sha256:'||pg_catalog.repeat('0',64)
  then raise exception 'U51 authoritative inventory was incomplete'; end if;

  command:=pg_temp.u51_cleanup_command(inventory,failed_operation);
  changed:=pg_catalog.jsonb_set(command,'{inventory_digest}',
    pg_catalog.to_jsonb('sha256:'||pg_catalog.repeat('f',64)),false);
  begin
    perform app_data_agent.execute_legacy_attribution_cleanup(changed);
    raise exception 'U51 forged digest was accepted';
  exception when raise_exception then
    if sqlerrm<>'LEGACY_ATTRIBUTION_CLEANUP_PREFLIGHT_MISMATCH' then raise; end if;
  end;
  changed:=pg_catalog.jsonb_set(command,'{approval}',pg_catalog.to_jsonb('WRONG'::text),false);
  begin
    perform app_data_agent.execute_legacy_attribution_cleanup(changed);
    raise exception 'U51 wrong approval was accepted';
  exception when invalid_parameter_value then
    if sqlerrm<>'LEGACY_ATTRIBUTION_CLEANUP_COMMAND_INVALID' then raise; end if;
  end;
  changed:=pg_catalog.jsonb_set(command,'{backup,created_at}',
    pg_catalog.to_jsonb(pg_catalog.clock_timestamp()-pg_catalog.make_interval(days=>2)),false);
  begin
    perform app_data_agent.execute_legacy_attribution_cleanup(changed);
    raise exception 'U51 stale backup was accepted';
  exception when invalid_parameter_value then
    if sqlerrm<>'LEGACY_ATTRIBUTION_CLEANUP_BACKUP_STALE' then raise; end if;
  end;
  changed:=pg_catalog.jsonb_set(command,'{expected_total}','11'::jsonb,false);
  begin
    perform app_data_agent.execute_legacy_attribution_cleanup(changed);
    raise exception 'U51 wrong count was accepted';
  exception when raise_exception then
    if sqlerrm<>'LEGACY_ATTRIBUTION_CLEANUP_PREFLIGHT_MISMATCH' then raise; end if;
  end;
  if (select pg_catalog.count(*) from app_data_agent.legacy_attribution_cleanup_receipts
      where operation_id=failed_operation)<>0
    or (app_data_agent.legacy_attribution_cleanup_inventory(deployment_id)->>'total_rows')::bigint<>12
  then raise exception 'U51 failed preflight left a side effect'; end if;

  create table app_data_agent.u51_external_fk_probe(
    pointer_id uuid references app_data_agent.attribution_active_pointer(id));
  inventory:=app_data_agent.legacy_attribution_cleanup_inventory(deployment_id);
  if (inventory->>'external_fk_count')::integer<>1 then
    raise exception 'U51 external FK inventory was not detected';
  end if;
  begin
    perform app_data_agent.execute_legacy_attribution_cleanup(
      pg_temp.u51_cleanup_command(inventory,'00000000-0000-4051-8051-000000000004'));
    raise exception 'U51 external FK was accepted';
  exception when raise_exception then
    if sqlerrm<>'LEGACY_ATTRIBUTION_CLEANUP_PREFLIGHT_MISMATCH' then raise; end if;
  end;
  drop table app_data_agent.u51_external_fk_probe;

  alter table app_data_agent.attribution_active_pointer add column u51_retirement_hold boolean;
  inventory:=app_data_agent.legacy_attribution_cleanup_inventory(deployment_id);
  if (inventory->>'hold_column_count')::integer<>1 then
    raise exception 'U51 hold inventory was not detected';
  end if;
  begin
    perform app_data_agent.execute_legacy_attribution_cleanup(
      pg_temp.u51_cleanup_command(inventory,'00000000-0000-4051-8051-000000000005'));
    raise exception 'U51 hold column was accepted';
  exception when raise_exception then
    if sqlerrm<>'LEGACY_ATTRIBUTION_CLEANUP_PREFLIGHT_MISMATCH' then raise; end if;
  end;
  alter table app_data_agent.attribution_active_pointer drop column u51_retirement_hold;

  inventory:=app_data_agent.legacy_attribution_cleanup_inventory(deployment_id);
  command:=pg_temp.u51_cleanup_command(inventory,operation_with_rows);
  receipt:=app_data_agent.execute_legacy_attribution_cleanup(command);
  replay:=app_data_agent.execute_legacy_attribution_cleanup(command);
  if receipt<>replay or receipt->>'terminal'<>'COMPLETED'
    or receipt->>'reason_code'<>'LEGACY_ATTRIBUTION_AUTHORITY_ROWS_DELETED'
    or (receipt->>'total_deleted')::bigint<>12
    or (select pg_catalog.count(*) from pg_catalog.jsonb_each_text(receipt->'deleted_counts') entry
      where entry.value::bigint=1)<>12
  then raise exception 'U51 row cleanup or idempotent replay failed'; end if;

  changed:=pg_catalog.jsonb_set(command,'{retirement_commit}',
    pg_catalog.to_jsonb('b1eda88'::text),false);
  begin
    perform app_data_agent.execute_legacy_attribution_cleanup(changed);
    raise exception 'U51 operation payload conflict was accepted';
  exception when raise_exception then
    if sqlerrm<>'LEGACY_ATTRIBUTION_CLEANUP_OPERATION_CONFLICT' then raise; end if;
  end;
  begin
    update app_data_agent.legacy_attribution_cleanup_receipts set terminal='NOOP'
      where operation_id=operation_with_rows;
    raise exception 'U51 receipt mutation was accepted';
  exception when object_not_in_prerequisite_state then
    if sqlerrm<>'LEGACY_ATTRIBUTION_CLEANUP_RECEIPT_IMMUTABLE' then raise; end if;
  end;

  post_inventory:=app_data_agent.legacy_attribution_cleanup_inventory(deployment_id);
  if (post_inventory->>'total_rows')::bigint<>0
    or exists(select 1 from pg_catalog.jsonb_array_elements(post_inventory->'targets') target
      where (target->>'row_count')::bigint<>0)
    or (select pg_catalog.count(*)
      from app_data_agent.attribution_owner_map_release preserved
      where preserved.app_id='00000000-0000-4000-8000-00000000da01'::uuid
        and preserved.environment='test'
        and preserved.owner_map='{"u51_scope":"must-survive"}'::jsonb)<>1
  then raise exception 'U51 cleanup postcondition was not zero'; end if;
  receipt:=app_data_agent.execute_legacy_attribution_cleanup(
    pg_temp.u51_cleanup_command(post_inventory,operation_noop));
  if receipt->>'terminal'<>'NOOP'
    or receipt->>'reason_code'<>'LEGACY_ATTRIBUTION_NO_ROWS_FOUND'
    or (receipt->>'total_deleted')::bigint<>0
  then raise exception 'U51 empty cleanup did not persist a truthful NOOP'; end if;

  select * into strict shared from u51_shared_before;
  if shared.run_count<>(select pg_catalog.count(*) from app_data_agent.runs)
    or shared.artifact_count<>(select pg_catalog.count(*) from app_data_agent.artifacts)
    or shared.conversation_count<>(select pg_catalog.count(*) from app_data_agent.qa_conversations)
    or shared.migration_count<>(select pg_catalog.count(*) from platform.migration_ledger)
  then raise exception 'U51 shared authority changed during cleanup'; end if;
  if pg_catalog.to_regprocedure(
      'app_data_agent.commit_agent_dispatch_deferred(text,text,jsonb)') is null
    or pg_catalog.to_regclass('app_data_agent.runs') is null
    or pg_catalog.to_regclass('app_data_agent.artifacts') is null
  then raise exception 'U51 preserved runtime authority is missing'; end if;
end
$cleanup_acceptance$;

rollback;

select 'U51_LEGACY_ATTRIBUTION_CLEANUP_ASSERTIONS_PASSED' as result;
