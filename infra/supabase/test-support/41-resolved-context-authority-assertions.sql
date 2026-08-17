\set ON_ERROR_STOP on

do $assertions$
declare
  package_identity jsonb;
  package_key text;
begin
  if pg_catalog.to_regclass('app_data_agent.resolved_context_receipts') is null then
    raise exception 'U12 resolved context receipt table missing';
  end if;
  if not exists (
    select 1 from pg_catalog.pg_class relation join pg_catalog.pg_namespace namespace on namespace.oid=relation.relnamespace
    where namespace.nspname='app_data_agent' and relation.relname='resolved_context_receipts'
      and relation.relrowsecurity and relation.relforcerowsecurity
  ) then raise exception 'U12 receipt authority must force RLS'; end if;
  if not exists (select 1 from pg_catalog.pg_roles where rolname='data_agent_u12_context_owner'
    and not rolcanlogin and not rolsuper and not rolinherit and not rolbypassrls)
  then raise exception 'U12 owner flags unsafe'; end if;
  if pg_catalog.to_regprocedure('app_data_agent.load_resolved_context_authority_snapshot(jsonb)') is null
    or pg_catalog.to_regprocedure('app_data_agent.commit_resolved_context_package(jsonb)') is null
    or pg_catalog.to_regprocedure('app_data_agent.assert_resolved_context_integrity()') is null
    or pg_catalog.to_regprocedure('app_data_agent.resolved_context_package_key_hash(jsonb)') is null
    or pg_catalog.to_regprocedure('app_data_agent.resolved_context_uuid_v8_from_hash(text)') is null
  then raise exception 'U12 narrow RPC closure missing'; end if;
  if pg_catalog.has_table_privilege('data_agent_backend','app_data_agent.resolved_context_receipts','INSERT,UPDATE,DELETE')
    or not pg_catalog.has_function_privilege('data_agent_backend','app_data_agent.load_resolved_context_authority_snapshot(jsonb)','EXECUTE')
    or not pg_catalog.has_function_privilege('data_agent_backend','app_data_agent.commit_resolved_context_package(jsonb)','EXECUTE')
  then raise exception 'U12 direct DML or RPC grant unsafe'; end if;
  if not exists (
    select 1 from pg_catalog.pg_attribute attribute
    where attribute.attrelid='app_data_agent.resolved_context_receipts'::pg_catalog.regclass
      and attribute.attname='request_hash' and not attribute.attisdropped
  ) or not exists (
    select 1 from pg_catalog.pg_attribute attribute
    where attribute.attrelid='app_data_agent.resolved_context_receipts'::pg_catalog.regclass
      and attribute.attname='package_key_hash' and not attribute.attisdropped
  ) then raise exception 'U12 request/package identity columns missing'; end if;
  if exists (
    select 1 from pg_catalog.pg_proc procedure join pg_catalog.pg_namespace namespace on namespace.oid=procedure.pronamespace
    where namespace.nspname='app_data_agent'
      and procedure.proname in ('load_resolved_context_authority_snapshot','commit_resolved_context_package')
      and pg_catalog.lower(procedure.prosrc) ~ '(falcon|provider_invocation|semantic_candidate_revision)'
  ) then raise exception 'U12 runtime reads forbidden authority'; end if;
  if not exists (
    select 1 from platform.migration_ledger
    where owner_kind='app' and app_id='00000000-0000-4000-8000-00000000da01'::uuid
      and migration_version='20260725010663_app_data_agent_resolved_context'
  ) then raise exception 'U12 ledger entry missing'; end if;

  perform app_data_agent.assert_resolved_context_request(
    '{"schema_version":"resolved-context-request@1.0.0","request_id":"00000000-0000-4000-8000-000000000008","scope":{"app_id":"00000000-0000-4000-8000-00000000da01","tenant_id":"00000000-0000-4000-8000-000000000001","environment":"test"},"question":"Gross Revenue","basis":{"consumer":"PREVIEW","defaults_ref":{"defaults_id":"00000000-0000-4000-8000-000000000002","defaults_revision":1,"defaults_hash":"sha256:2222222222222222222222222222222222222222222222222222222222222222"}},"request_hash":"sha256:386866f797c07ec4dc51b9ae9444112694074386016606fc5a444f39380a3d07"}'::jsonb
  );

  package_identity:=pg_catalog.jsonb_build_object(
    'scope',pg_catalog.jsonb_build_object('app_id','00000000-0000-4000-8000-00000000da01','tenant_id','00000000-0000-4000-8000-000000000001','environment','test'),
    'question_hash','sha256:1111111111111111111111111111111111111111111111111111111111111111',
    'defaults_ref',pg_catalog.jsonb_build_object('defaults_id','00000000-0000-4000-8000-000000000002','defaults_revision',1,'defaults_hash','sha256:2222222222222222222222222222222222222222222222222222222222222222'),
    'semantic_release',pg_catalog.jsonb_build_object('resource_id','00000000-0000-4000-8000-000000000003','resource_revision',1,'resource_hash','sha256:3333333333333333333333333333333333333333333333333333333333333333','datasource_id','00000000-0000-4000-8000-000000000004','semantic_generation',1,'publication_status','PUBLISHED'),
    'schema_snapshot',pg_catalog.jsonb_build_object('resource_id','00000000-0000-4000-8000-000000000005','resource_revision',1,'resource_hash','sha256:4444444444444444444444444444444444444444444444444444444444444444','datasource_id','00000000-0000-4000-8000-000000000004','semantic_release_id','00000000-0000-4000-8000-000000000003','semantic_generation',1),
    'context_policy',pg_catalog.jsonb_build_object('resource_id','00000000-0000-4000-8000-000000000006','resource_revision',1,'resource_hash','sha256:5555555555555555555555555555555555555555555555555555555555555555','max_context_tokens',4096,'max_resource_bindings',64),
    'egress_policy',pg_catalog.jsonb_build_object('resource_id','00000000-0000-4000-8000-000000000007','resource_revision',1,'resource_hash','sha256:6666666666666666666666666666666666666666666666666666666666666666','allowed_providers',pg_catalog.jsonb_build_array('deepseek'),'allowed_audiences',pg_catalog.jsonb_build_array('PRIVATE'),'classification','INTERNAL'),
    'provider','deepseek',
    'authority_snapshot_hash','sha256:7777777777777777777777777777777777777777777777777777777777777777'
  );
  package_key:=app_data_agent.resolved_context_package_key_hash(package_identity);
  if package_key<>'sha256:47f7093f71b26f7203983832d59c508917848e7402c488771da38c4127852a21'
    or app_data_agent.resolved_context_uuid_v8_from_hash(package_key)<>'47f7093f-71b2-8f72-8398-3832d59c5089'::uuid
  then raise exception 'U12 package key or derived package id vector drift'; end if;
  if not exists (
    select 1 from pg_catalog.pg_proc procedure
    where procedure.oid='app_data_agent.commit_resolved_context_package(jsonb)'::pg_catalog.regprocedure
      and pg_catalog.lower(procedure.prosrc) like '%resolved_context_package_key_hash%'
      and pg_catalog.lower(procedure.prosrc) like '%resolved_context_uuid_v8_from_hash%'
      and pg_catalog.lower(procedure.prosrc) like '%request_hash%'
  ) then raise exception 'U12 commit identity revalidation missing'; end if;
end
$assertions$;

select app_data_agent.assert_resolved_context_integrity();
select 'U12_RESOLVED_CONTEXT_ASSERTIONS_PASSED' as result;
