\set ON_ERROR_STOP on

begin isolation level repeatable read read only;
do $surface$
declare
  definition text;
begin
  if not exists (
    select 1 from platform.migration_ledger
    where owner_kind='app'
      and app_id='00000000-0000-4000-8000-00000000da01'::uuid
      and migration_version='20260725010657_app_data_agent_artifact_export_authority'
  ) then
    raise exception 'ARTIFACT_EXPORT_LEDGER_ASSERTION_FAILED';
  end if;
  if not exists (
    select 1 from pg_catalog.pg_class relation
    join pg_catalog.pg_namespace namespace on namespace.oid=relation.relnamespace
    where namespace.nspname='app_data_agent'
      and relation.relname='artifact_export_receipts'
      and relation.relrowsecurity and relation.relforcerowsecurity
  ) or pg_catalog.has_table_privilege(
    'data_agent_backend','app_data_agent.artifact_export_receipts','INSERT,UPDATE,DELETE'
  ) then
    raise exception 'ARTIFACT_EXPORT_RLS_OR_DML_ASSERTION_FAILED';
  end if;
  if exists (
    select 1 from pg_catalog.pg_roles
    where rolname='data_agent_u7_artifact_export_owner'
      and (rolcanlogin or rolsuper or rolcreatedb or rolcreaterole or rolreplication or rolinherit or rolbypassrls)
  ) then
    raise exception 'ARTIFACT_EXPORT_OWNER_ASSERTION_FAILED';
  end if;
  select pg_catalog.pg_get_functiondef(procedure.oid) into strict definition
  from pg_catalog.pg_proc procedure
  join pg_catalog.pg_namespace namespace on namespace.oid=procedure.pronamespace
  where namespace.nspname='app_data_agent'
    and procedure.proname='create_artifact_export_receipt';
  if definition not like '%SECURITY DEFINER%'
    or definition not like '%SET search_path TO ''''%'
    or definition not like '%app_data_agent.u2_canonical_sha256(requested_command)%'
    or definition not like '%SOURCE_NOT_COMMITTED%'
    or definition not like '%IDEMPOTENCY_CONFLICT%'
  then
    raise exception 'ARTIFACT_EXPORT_CREATE_HARDENING_ASSERTION_FAILED';
  end if;
end
$surface$;
rollback;

do $greenfield$
begin
  if (select pg_catalog.count(*) from app_data_agent.artifact_export_receipts) <> 0 then
    raise exception 'ARTIFACT_EXPORT_GREENFIELD_NOT_EMPTY';
  end if;
end
$greenfield$;

begin;
insert into app_data_agent.workspaces (app_id,environment,workspace_id,slug,display_name)
values (
  '00000000-0000-4000-8000-00000000da01','local',
  '00000000-0000-4000-8000-000000007501','u7-artifact-export-fixture','U7 artifact export fixture'
);
insert into data_agent_auth."user" (
  "id","name","email","emailVerified","username","displayUsername"
)
values (
  '00000000-0000-4000-8000-000000007502','U7 fixture',
  'u7@example.invalid',true,'u7_fixture','u7_fixture'
);
insert into app_data_agent.app_users (
  app_id,environment,principal_id,auth_user_id,email,display_name,system_role
)
values (
  '00000000-0000-4000-8000-00000000da01','local',
  '00000000-0000-4000-8000-000000007502',
  '00000000-0000-4000-8000-000000007502',
  'u7@example.invalid','U7 fixture','USER'
);
insert into app_data_agent.memberships (
  app_id,tenant_id,environment,principal_id,membership_role
) values (
  '00000000-0000-4000-8000-00000000da01',
  '00000000-0000-4000-8000-000000007501','local',
  '00000000-0000-4000-8000-000000007502','owner'
);
insert into platform.deployment_mappings (deployment_id,app_id,environment,deployment_key_hash)
values (
  '00000000-0000-4000-8000-000000007503',
  '00000000-0000-4000-8000-00000000da01','local',
  'sha256:5353535353535353535353535353535353535353535353535353535353535353'
);
select test_support.activate_falcon24_e1_fixture(
  '00000000-0000-4000-8000-000000007501'::uuid,'local',
  '00000000-0000-4000-8000-000000007502'::uuid,
  '00000000-0000-4000-8000-000000007503'::uuid,false,6);
insert into app_data_agent.runs (
  app_id,tenant_id,environment,run_id,principal_id,status,active_fence,question
) values (
  '00000000-0000-4000-8000-00000000da01',
  '00000000-0000-4000-8000-000000007501','local',
  '00000000-0000-4000-8000-000000007504',
  '00000000-0000-4000-8000-000000007502','RUNNING',1,'U7 export fixture'
);
insert into app_data_agent.artifacts (
  app_id,tenant_id,environment,run_id,artifact_id,artifact_type,revision,content_hash,
  document_json,worker_fence,is_active,created_at
) values (
  '00000000-0000-4000-8000-00000000da01',
  '00000000-0000-4000-8000-000000007501','local',
  '00000000-0000-4000-8000-000000007504',
  '00000000-0000-4000-8000-000000007505','ArtifactWorkspaceDocument',1,
  'sha256:5151515151515151515151515151515151515151515151515151515151515151',
  '{"schema_version":"fixture@1.0.0"}',1,true,'2026-08-17T05:00:00.000Z'
);

do $cross_language_hash$
declare
  command jsonb;
begin
  command := pg_catalog.jsonb_build_object(
    'schema_version','artifact-export-command@1.0.0',
    'source_ref',pg_catalog.jsonb_build_object(
      'artifact_id','00000000-0000-4000-8000-000000007505','artifact_type','ArtifactWorkspaceDocument',
      'app_id','00000000-0000-4000-8000-00000000da01','tenant_id','00000000-0000-4000-8000-000000007501',
      'environment','local','run_id','00000000-0000-4000-8000-000000007504','revision',1,
      'content_hash','sha256:5151515151515151515151515151515151515151515151515151515151515151'
    ),
    'format','CSV','filename_stem','u7-results','idempotency_key','u7-export-0001'
  );
  if app_data_agent.u2_canonical_sha256(command)
    <> 'sha256:5f7576e1518c98aa257ccea5ce5515e66ce68b15c5a938455e74c939fecb8493'
  then
    raise exception 'ARTIFACT_EXPORT_CROSS_LANGUAGE_REQUEST_HASH_ASSERTION_FAILED';
  end if;
end
$cross_language_hash$;

create role data_agent_u7_backend_session login inherit;
grant data_agent_backend to data_agent_u7_backend_session with inherit true;
set session authorization data_agent_u7_backend_session;
select pg_catalog.set_config('data_agent.app_id','00000000-0000-4000-8000-00000000da01',true);
select pg_catalog.set_config('data_agent.tenant_id','00000000-0000-4000-8000-000000007501',true);
select pg_catalog.set_config('data_agent.environment','local',true);
select pg_catalog.set_config('data_agent.deployment_id','00000000-0000-4000-8000-000000007503',true);
select pg_catalog.set_config('data_agent.principal_id','00000000-0000-4000-8000-000000007502',true);
select pg_catalog.set_config('data_agent.role','owner',true);

do $behavior$
declare
  command jsonb;
  receipt jsonb;
  created jsonb;
  replayed jsonb;
begin
  command := pg_catalog.jsonb_build_object(
    'schema_version','artifact-export-command@1.0.0',
    'source_ref',pg_catalog.jsonb_build_object(
      'artifact_id','00000000-0000-4000-8000-000000007505','artifact_type','ArtifactWorkspaceDocument',
      'app_id','00000000-0000-4000-8000-00000000da01','tenant_id','00000000-0000-4000-8000-000000007501',
      'environment','local','run_id','00000000-0000-4000-8000-000000007504','revision',1,
      'content_hash','sha256:5151515151515151515151515151515151515151515151515151515151515151'
    ),
    'format','CSV','filename_stem','u7-results','idempotency_key','u7-export-0001'
  );
  receipt := pg_catalog.jsonb_build_object(
    'schema_version','artifact-export-receipt@1.0.0',
    'receipt_ref',pg_catalog.jsonb_build_object(
      'artifact_id','00000000-0000-4000-8000-000000007506','artifact_type','ArtifactExportReceipt',
      'app_id','00000000-0000-4000-8000-00000000da01','tenant_id','00000000-0000-4000-8000-000000007501',
      'environment','local','run_id','00000000-0000-4000-8000-000000007504','revision',1,
      'content_hash','sha256:1b004477b91335e0ebf3e9525aaddefee1be5b88e3f1831dbe2588edc6fcba6a'
    ),
    'source_ref',command -> 'source_ref','format','CSV',
    'renderer_version','artifact-workspace-renderer@1.0.0',
    'exporter_version','artifact-workspace-exporter@1.0.0',
    'formula_policy_version','spreadsheet-formula-neutralization@1.0.0',
    'mime_type','text/csv; charset=utf-8','attachment_filename','u7-results.csv',
    'row_count',1,'column_count',1,
    'request_hash','sha256:5f7576e1518c98aa257ccea5ce5515e66ce68b15c5a938455e74c939fecb8493',
    'output_hash','sha256:5252525252525252525252525252525252525252525252525252525252525252',
    'created_at','2026-08-17T05:01:00.000Z'
  );
  created := app_data_agent.create_artifact_export_receipt(command,receipt);
  replayed := app_data_agent.create_artifact_export_receipt(command,receipt);
  if created ->> 'disposition' <> 'CREATED'
    or replayed ->> 'disposition' <> 'REPLAYED'
    or created -> 'receipt' <> receipt
  then
    raise exception 'ARTIFACT_EXPORT_CREATE_REPLAY_ASSERTION_FAILED';
  end if;
end
$behavior$;

reset session authorization;
do $row_count$
begin
  if (select pg_catalog.count(*) from app_data_agent.artifact_export_receipts) <> 1 then
    raise exception 'ARTIFACT_EXPORT_CREATE_REPLAY_ROW_COUNT_ASSERTION_FAILED';
  end if;
end
$row_count$;
rollback;
