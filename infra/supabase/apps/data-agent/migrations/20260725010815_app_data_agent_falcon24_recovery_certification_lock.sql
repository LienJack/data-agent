-- falcon24_recovery_certification_lock_migration_checksum: sha256:9db12283ff7d6c9c92ee6cc7b0a273a4e89668f749fd22d3613f59947ff85a1e
begin;
set local lock_timeout='2000ms';
set local statement_timeout='300000ms';
set local idle_in_transaction_session_timeout='60000ms';
select platform.acquire_migration_lock('app','00000000-0000-4000-8000-00000000da01'::uuid);

do $preflight$
begin
  if pg_catalog.current_setting('server_version_num')::integer not between 170000 and 179999
    or session_user<>'postgres' or current_user<>'postgres'
    or not exists(select 1 from platform.migration_ledger
      where owner_kind='app' and app_id='00000000-0000-4000-8000-00000000da01'::uuid
        and migration_version='20260725010814_app_data_agent_falcon24_four_layer_recovery'
        and migration_checksum='sha256:eb85edc9df631ab973357bfa242ed556e81aad63613503dd6cf9640823fdf520')
    or exists(select 1 from pg_catalog.pg_policy where polrelid='app_data_agent.artifacts'::regclass
      and polname='falcon24_recovery_active_certification_lock')
  then raise exception using errcode='P0001',message='FALCON24_RECOVERY_CERTIFICATION_LOCK_BASELINE_DRIFT'; end if;
  if not exists(select 1 from pg_catalog.pg_proc
      where oid='app_data_agent.activate_falcon24_authority(jsonb)'::regprocedure
        and pg_catalog.pg_get_userbyid(proowner)='data_agent_u6_rpc_owner' and prosecdef
        and pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(prosrc,'UTF8')),'hex')
          ='ade70237e02f49478714ea3e5a2abb78efabcd1185ee936affd80502aa941384')
    or not exists(select 1 from pg_catalog.pg_roles where rolname='data_agent_u6_rpc_owner'
      and not rolsuper and not rolcanlogin and not rolinherit and not rolbypassrls)
    or pg_catalog.pg_has_role('data_agent_u6_rpc_owner','data_agent_backend','MEMBER')
    or not pg_catalog.has_column_privilege('data_agent_u6_rpc_owner','app_data_agent.artifacts','is_active','UPDATE')
    or not exists(select 1 from pg_catalog.pg_proc
      where oid='app_data_agent.reject_artifact_payload_mutation()'::regprocedure
        and pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(prosrc,'UTF8')),'hex')
          ='faf781b516cfd42bf74bca16b107b0d84e139599e31dc7d38e7f020627fb2487')
  then raise exception using errcode='P0001',message='FALCON24_RECOVERY_CERTIFICATION_LOCK_SOURCE_DRIFT'; end if;
end
$preflight$;

create temporary table falcon24_10815_history_snapshot(
  relation_name text primary key,row_count bigint not null,row_digest text not null
) on commit drop;
do $snapshot$
declare relation record;row_count bigint;row_digest text;
begin
  for relation in select n.nspname,c.relname from pg_catalog.pg_class c
    join pg_catalog.pg_namespace n on n.oid=c.relnamespace
    where n.nspname in('app_data_agent','semantic','catalog','platform')
      and c.relkind in('r','p') and not(n.nspname='platform' and c.relname='migration_ledger')
    order by n.nspname,c.relname loop
    execute pg_catalog.format('lock table %I.%I in share mode',relation.nspname,relation.relname);
    execute pg_catalog.format(
      'select count(*)::bigint,app_data_agent.u2_canonical_sha256('
      ||'coalesce(jsonb_agg(to_jsonb(r) order by to_jsonb(r)::text),''[]''::jsonb)) from %I.%I r',
      relation.nspname,relation.relname) into strict row_count,row_digest;
    insert into falcon24_10815_history_snapshot values(
      pg_catalog.format('%I.%I',relation.nspname,relation.relname),row_count,row_digest);
  end loop;
end
$snapshot$;
create temporary table falcon24_10815_security_snapshot on commit drop as
select app_data_agent.u2_canonical_sha256(jsonb_build_object(
  'policies',(select jsonb_agg(to_jsonb(p) order by schemaname,tablename,policyname) from pg_policies p),
  'artifact_acl',(select to_jsonb(relacl) from pg_class where oid='app_data_agent.artifacts'::regclass),
  'artifact_guard',pg_get_functiondef('app_data_agent.reject_artifact_payload_mutation()'::regprocedure),
  'activation',pg_get_functiondef('app_data_agent.activate_falcon24_authority(jsonb)'::regprocedure)
)) as digest;
-- FOR UPDATE applies the UPDATE USING policy even when no mutation is attempted.
-- The E7 promotion policy intentionally exposes only inactive artifacts. Exact E12+
-- replay also needs to lock its already-active certification against revocation.
-- This adds row-lock visibility only: no grants, no relaxed mutation WITH CHECK.
-- Existing promotion CHECK requires new.is_active; the unchanged immutable trigger
-- rejects active no-op/payload updates. Deactivation still fails the combined CHECK.
create policy falcon24_recovery_active_certification_lock
on app_data_agent.artifacts for update to data_agent_u6_rpc_owner
using(artifact_type='ModelCertificationReceipt' and is_active
  and platform.backend_context_matches(app_id,tenant_id,environment,true)
  and exists(select 1 from app_data_agent.falcon24_llm_execution_certification_stage stage
    join app_data_agent.falcon24_current_authority_epoch current_epoch
      on current_epoch.app_id=stage.app_id and current_epoch.tenant_id=stage.tenant_id
      and current_epoch.environment=stage.environment
      and current_epoch.authority_epoch=stage.target_authority_epoch
      and current_epoch.activation_attempt_id=stage.activation_attempt_id
    join app_data_agent.falcon24_retained_recovery_activation_receipts recovery
      on recovery.app_id=current_epoch.app_id and recovery.tenant_id=current_epoch.tenant_id
      and recovery.environment=current_epoch.environment
      and recovery.activation_attempt_id=current_epoch.activation_attempt_id
      and recovery.principal_id=stage.principal_id
    where stage.app_id=artifacts.app_id and stage.tenant_id=artifacts.tenant_id
      and stage.environment=artifacts.environment and stage.certification_run_id=artifacts.run_id
      and stage.certification_artifact_id=artifacts.artifact_id
      and stage.certification_revision=artifacts.revision
      and stage.certification_content_hash=artifacts.content_hash
      and stage.principal_id=(select principal_id from platform.current_backend_authority(true))
      and stage.status='PROMOTED'
      and pg_catalog.substr(stage.target_authority_epoch,2)::numeric>=12
      and recovery.command_document#>>'{llm_execution_stage_ref,stage_id}'=stage.stage_id::text
      and recovery.command_document#>>'{llm_execution_stage_ref,proof_hash}'=stage.proof_hash))
with check(false);
do $postconditions$
declare before_row record;after_count bigint;after_digest text;security_digest text;
begin
  for before_row in select * from falcon24_10815_history_snapshot order by relation_name loop
    execute pg_catalog.format(
      'select count(*)::bigint,app_data_agent.u2_canonical_sha256('
      ||'coalesce(jsonb_agg(to_jsonb(r) order by to_jsonb(r)::text),''[]''::jsonb)) from %s r',
      before_row.relation_name) into strict after_count,after_digest;
    if after_count is distinct from before_row.row_count or after_digest is distinct from before_row.row_digest
    then raise exception using errcode='P0001',message='FALCON24_RECOVERY_CERTIFICATION_LOCK_HISTORY_DRIFT'; end if;
  end loop;
  select app_data_agent.u2_canonical_sha256(jsonb_build_object(
    'policies',(select jsonb_agg(to_jsonb(p) order by schemaname,tablename,policyname) from pg_policies p
      where not(schemaname='app_data_agent' and tablename='artifacts' and policyname='falcon24_recovery_active_certification_lock')),
    'artifact_acl',(select to_jsonb(relacl) from pg_class where oid='app_data_agent.artifacts'::regclass),
    'artifact_guard',pg_get_functiondef('app_data_agent.reject_artifact_payload_mutation()'::regprocedure),
    'activation',pg_get_functiondef('app_data_agent.activate_falcon24_authority(jsonb)'::regprocedure)
  )) into strict security_digest;
  if security_digest is distinct from (select digest from falcon24_10815_security_snapshot)
    or not exists(select 1 from pg_policy where polrelid='app_data_agent.artifacts'::regclass
      and polname='falcon24_recovery_active_certification_lock' and polcmd='w' and polpermissive
      and polroles=array['data_agent_u6_rpc_owner'::regrole::oid]
      and pg_get_expr(polwithcheck,polrelid)='false')
  then raise exception using errcode='P0001',message='FALCON24_RECOVERY_CERTIFICATION_LOCK_SECURITY_DRIFT'; end if;
end
$postconditions$;
select platform.assert_migration_checksum(
  'app','00000000-0000-4000-8000-00000000da01'::uuid,
  '20260725010815_app_data_agent_falcon24_recovery_certification_lock',
  'sha256:9db12283ff7d6c9c92ee6cc7b0a273a4e89668f749fd22d3613f59947ff85a1e');
commit;
