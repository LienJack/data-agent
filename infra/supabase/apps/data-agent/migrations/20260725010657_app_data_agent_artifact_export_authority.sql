-- artifact_export_migration_checksum: sha256:caae29f6bc66b0fe1d18f496454a778a248d16991ef1a42383df95002134ce0a
-- ============================================================
-- 10657: Artifact Export Receipt Authority
-- Forward-only, metadata/hash only; no data import or backfill.
-- ============================================================

begin;

do $bootstrap$
begin
  if pg_catalog.current_setting('server_version_num')::integer not between 170000 and 179999 then
    raise exception using errcode='0A000',message='ARTIFACT_EXPORT_POSTGRES_VERSION_UNSUPPORTED';
  end if;
  if session_user <> 'postgres' or current_user <> 'postgres' then
    raise exception using errcode='42501',message='ARTIFACT_EXPORT_MIGRATION_EXECUTOR_UNSAFE';
  end if;
  if not exists (
    select 1 from platform.migration_ledger
    where owner_kind='app'
      and app_id='00000000-0000-4000-8000-00000000da01'::uuid
      and migration_version='20260725010656_app_data_agent_semantic_bootstrap_release'
  ) then
    raise exception using errcode='P0001',message='ARTIFACT_EXPORT_BASELINE_10656_MISSING';
  end if;
  if pg_catalog.to_regclass('app_data_agent.artifacts') is null then
    raise exception using errcode='P0001',message='ARTIFACT_EXPORT_SOURCE_AUTHORITY_MISSING';
  end if;
  if not exists (select 1 from pg_catalog.pg_roles where rolname='data_agent_u7_artifact_export_owner') then
    create role data_agent_u7_artifact_export_owner
      nologin noinherit nosuperuser nocreatedb nocreaterole noreplication nobypassrls;
  end if;
end
$bootstrap$;

set local lock_timeout='2000ms';
set local statement_timeout='300000ms';
set local idle_in_transaction_session_timeout='60000ms';
select platform.acquire_migration_lock('app','00000000-0000-4000-8000-00000000da01'::uuid);
create table app_data_agent.artifact_export_receipts (
  app_id uuid not null check (app_id='00000000-0000-4000-8000-00000000da01'::uuid),
  tenant_id uuid not null,
  environment text not null check (environment ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$'),
  run_id uuid not null,
  receipt_id uuid not null,
  receipt_revision integer not null check (receipt_revision=1),
  receipt_hash text not null check (receipt_hash ~ '^sha256:[0-9a-f]{64}$'),
  source_artifact_id uuid not null,
  source_artifact_type text not null,
  source_revision integer not null check (source_revision>=1),
  source_content_hash text not null check (source_content_hash ~ '^sha256:[0-9a-f]{64}$'),
  export_format text not null check (export_format in ('CSV','XLSX')),
  idempotency_key text not null check (
    length(idempotency_key) between 8 and 128
    and idempotency_key ~ '^[A-Za-z0-9][A-Za-z0-9._:-]*$'
  ),
  request_hash text not null check (request_hash ~ '^sha256:[0-9a-f]{64}$'),
  output_hash text not null check (output_hash ~ '^sha256:[0-9a-f]{64}$'),
  mime_type text not null,
  attachment_filename text not null check (
    attachment_filename ~ '^[A-Za-z0-9][A-Za-z0-9._-]*\.(csv|xlsx)$'
    and attachment_filename not like '%..%'
  ),
  row_count integer not null check (row_count between 0 and 10000),
  column_count integer not null check (column_count between 1 and 256),
  receipt_json jsonb not null check (
    pg_catalog.jsonb_typeof(receipt_json)='object'
    and not app_data_agent.contains_potential_plaintext_secret(receipt_json)
  ),
  created_at timestamptz not null,
  primary key (app_id,tenant_id,environment,receipt_id),
  unique (app_id,tenant_id,environment,idempotency_key),
  unique (app_id,tenant_id,environment,run_id,receipt_id,receipt_revision,receipt_hash),
  foreign key (
    app_id,tenant_id,environment,run_id,source_artifact_id,source_artifact_type,
    source_revision,source_content_hash
  ) references app_data_agent.artifacts (
    app_id,tenant_id,environment,run_id,artifact_id,artifact_type,revision,content_hash
  ) on delete restrict
);

alter table app_data_agent.artifact_export_receipts enable row level security;
alter table app_data_agent.artifact_export_receipts force row level security;
alter table app_data_agent.artifact_export_receipts owner to data_agent_u7_artifact_export_owner;

create policy artifact_export_receipts_owner_all
on app_data_agent.artifact_export_receipts
for all to data_agent_u7_artifact_export_owner
using (platform.backend_context_matches(app_id,tenant_id,environment,false))
with check (platform.backend_context_matches(app_id,tenant_id,environment,true));

create function app_data_agent.reject_artifact_export_receipt_mutation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  raise exception using errcode='55000',message='ARTIFACT_EXPORT_RECEIPT_IMMUTABLE';
end
$function$;
alter function app_data_agent.reject_artifact_export_receipt_mutation()
  owner to data_agent_u7_artifact_export_owner;

create trigger artifact_export_receipts_immutable
before update or delete on app_data_agent.artifact_export_receipts
for each row execute function app_data_agent.reject_artifact_export_receipt_mutation();

grant select on app_data_agent.artifacts to data_agent_u7_artifact_export_owner;
create policy artifacts_u7_export_source_select
on app_data_agent.artifacts
as permissive for select to data_agent_u7_artifact_export_owner
using (platform.backend_run_object_matches(app_id,tenant_id,environment,run_id,false));
create function app_data_agent.create_artifact_export_receipt(
  requested_command jsonb,
  requested_receipt jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_source jsonb;
  v_receipt_ref jsonb;
  v_scope_app uuid;
  v_scope_tenant uuid;
  v_scope_environment text;
  v_request_hash text;
  v_receipt_hash text;
  v_existing app_data_agent.artifact_export_receipts%rowtype;
begin
  if not app_data_agent.provider_json_object_has_exact_keys(requested_command,array[
    'schema_version','source_ref','format','filename_stem','idempotency_key'
  ]) or not app_data_agent.provider_json_object_has_exact_keys(requested_receipt,array[
    'schema_version','receipt_ref','source_ref','format','renderer_version','exporter_version',
    'formula_policy_version','mime_type','attachment_filename','row_count','column_count',
    'request_hash','output_hash','created_at'
  ]) then
    raise exception using errcode='22023',message='DA_ARTIFACT_EXPORT_CONTRACT_INVALID';
  end if;
  v_source := requested_command -> 'source_ref';
  v_receipt_ref := requested_receipt -> 'receipt_ref';
  if not app_data_agent.provider_json_object_has_exact_keys(v_source,array[
    'artifact_id','artifact_type','app_id','tenant_id','environment','run_id','revision','content_hash'
  ]) or not app_data_agent.provider_json_object_has_exact_keys(v_receipt_ref,array[
    'artifact_id','artifact_type','app_id','tenant_id','environment','run_id','revision','content_hash'
  ]) then
    raise exception using errcode='22023',message='DA_ARTIFACT_EXPORT_CONTRACT_INVALID';
  end if;
  begin
    v_scope_app := (v_source ->> 'app_id')::uuid;
    v_scope_tenant := (v_source ->> 'tenant_id')::uuid;
    v_scope_environment := v_source ->> 'environment';
  exception when others then
    raise exception using errcode='22023',message='DA_ARTIFACT_EXPORT_CONTRACT_INVALID';
  end;
  if not platform.backend_context_matches(v_scope_app,v_scope_tenant,v_scope_environment,true) then
    raise exception using errcode='42501',message='DA_ARTIFACT_EXPORT_SCOPE_MISMATCH';
  end if;
  if requested_command ->> 'schema_version' <> 'artifact-export-command@1.0.0'
    or requested_receipt ->> 'schema_version' <> 'artifact-export-receipt@1.0.0'
    or requested_command -> 'source_ref' <> requested_receipt -> 'source_ref'
    or requested_command ->> 'format' not in ('CSV','XLSX')
    or requested_command ->> 'format' <> requested_receipt ->> 'format'
    or pg_catalog.length(requested_command ->> 'idempotency_key') not between 8 and 128
    or requested_command ->> 'idempotency_key' !~ '^[A-Za-z0-9][A-Za-z0-9._:-]*$'
    or pg_catalog.length(requested_command ->> 'filename_stem') not between 1 and 120
    or requested_command ->> 'filename_stem' !~ '^[A-Za-z0-9][A-Za-z0-9._-]*$'
    or requested_command ->> 'filename_stem' like '%..%'
    or v_receipt_ref ->> 'artifact_type' <> 'ArtifactExportReceipt'
    or (v_receipt_ref ->> 'revision')::integer <> 1
    or v_receipt_ref ->> 'app_id' <> v_source ->> 'app_id'
    or v_receipt_ref ->> 'tenant_id' <> v_source ->> 'tenant_id'
    or v_receipt_ref ->> 'environment' <> v_source ->> 'environment'
    or v_receipt_ref ->> 'run_id' <> v_source ->> 'run_id'
    or requested_receipt ->> 'renderer_version' <> 'artifact-workspace-renderer@1.0.0'
    or requested_receipt ->> 'exporter_version' <> 'artifact-workspace-exporter@1.0.0'
    or requested_receipt ->> 'formula_policy_version' <> 'spreadsheet-formula-neutralization@1.0.0'
  then
    raise exception using errcode='22023',message='DA_ARTIFACT_EXPORT_CONTRACT_INVALID';
  end if;

  v_request_hash := app_data_agent.u2_canonical_sha256(requested_command);
  if requested_receipt ->> 'request_hash' <> v_request_hash then
    raise exception using errcode='22023',message='DA_ARTIFACT_EXPORT_CONTRACT_INVALID';
  end if;
  select * into v_existing
  from app_data_agent.artifact_export_receipts
  where app_id=v_scope_app and tenant_id=v_scope_tenant and environment=v_scope_environment
    and idempotency_key=requested_command ->> 'idempotency_key'
  for share;
  if found then
    if v_existing.request_hash <> v_request_hash then
      raise exception using errcode='23505',message='DA_ARTIFACT_EXPORT_IDEMPOTENCY_CONFLICT';
    end if;
    return pg_catalog.jsonb_build_object(
      'schema_version','artifact-export-create-result@1.0.0',
      'disposition','REPLAYED','receipt',v_existing.receipt_json
    );
  end if;

  if not exists (
    select 1 from app_data_agent.artifacts
    where app_id=v_scope_app and tenant_id=v_scope_tenant and environment=v_scope_environment
      and run_id=(v_source ->> 'run_id')::uuid
      and artifact_id=(v_source ->> 'artifact_id')::uuid
      and artifact_type=v_source ->> 'artifact_type'
      and revision=(v_source ->> 'revision')::integer
      and content_hash=v_source ->> 'content_hash'
  ) then
    raise exception using errcode='23503',message='DA_ARTIFACT_EXPORT_SOURCE_NOT_COMMITTED';
  end if;

  v_receipt_hash := app_data_agent.u2_canonical_sha256(
    (requested_receipt - 'receipt_ref') || pg_catalog.jsonb_build_object(
      'receipt_ref',(requested_receipt -> 'receipt_ref') - 'content_hash'
    )
  );
  if v_receipt_ref ->> 'content_hash' <> v_receipt_hash
    or requested_receipt ->> 'output_hash' !~ '^sha256:[0-9a-f]{64}$'
    or pg_catalog.length(requested_receipt ->> 'attachment_filename') not between 5 and 130
    or requested_receipt ->> 'attachment_filename' !~ '^[A-Za-z0-9][A-Za-z0-9._-]*\.(csv|xlsx)$'
    or requested_receipt ->> 'attachment_filename' like '%..%'
    or (requested_receipt ->> 'row_count')::integer not between 0 and 10000
    or (requested_receipt ->> 'column_count')::integer not between 1 and 256
    or (
      requested_receipt ->> 'format'='CSV'
      and (requested_receipt ->> 'mime_type' <> 'text/csv; charset=utf-8'
        or requested_receipt ->> 'attachment_filename' !~ '\.csv$')
    ) or (
      requested_receipt ->> 'format'='XLSX'
      and (requested_receipt ->> 'mime_type' <> 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
        or requested_receipt ->> 'attachment_filename' !~ '\.xlsx$')
    )
  then
    raise exception using errcode='22023',message='DA_ARTIFACT_EXPORT_CONTRACT_INVALID';
  end if;

  insert into app_data_agent.artifact_export_receipts (
    app_id,tenant_id,environment,run_id,receipt_id,receipt_revision,receipt_hash,
    source_artifact_id,source_artifact_type,source_revision,source_content_hash,
    export_format,idempotency_key,request_hash,output_hash,mime_type,attachment_filename,
    row_count,column_count,receipt_json,created_at
  ) values (
    v_scope_app,v_scope_tenant,v_scope_environment,(v_source ->> 'run_id')::uuid,
    (v_receipt_ref ->> 'artifact_id')::uuid,1,v_receipt_hash,
    (v_source ->> 'artifact_id')::uuid,v_source ->> 'artifact_type',
    (v_source ->> 'revision')::integer,v_source ->> 'content_hash',
    requested_receipt ->> 'format',requested_command ->> 'idempotency_key',v_request_hash,
    requested_receipt ->> 'output_hash',requested_receipt ->> 'mime_type',
    requested_receipt ->> 'attachment_filename',(requested_receipt ->> 'row_count')::integer,
    (requested_receipt ->> 'column_count')::integer,requested_receipt,
    (requested_receipt ->> 'created_at')::timestamptz
  );
  return pg_catalog.jsonb_build_object(
    'schema_version','artifact-export-create-result@1.0.0',
    'disposition','CREATED','receipt',requested_receipt
  );
exception when invalid_text_representation or numeric_value_out_of_range or datetime_field_overflow then
  raise exception using errcode='22023',message='DA_ARTIFACT_EXPORT_CONTRACT_INVALID';
end
$function$;

create function app_data_agent.load_artifact_export_receipt(requested_command jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_ref jsonb;
  v_source jsonb;
  v_row app_data_agent.artifact_export_receipts%rowtype;
begin
  if not app_data_agent.provider_json_object_has_exact_keys(requested_command,array[
    'schema_version','receipt_ref','source_ref','output_hash'
  ]) then
    raise exception using errcode='22023',message='DA_ARTIFACT_EXPORT_CONTRACT_INVALID';
  end if;
  v_ref := requested_command -> 'receipt_ref';
  v_source := requested_command -> 'source_ref';
  if requested_command ->> 'schema_version' <> 'artifact-export-load@1.0.0'
    or not app_data_agent.provider_json_object_has_exact_keys(v_ref,array[
      'artifact_id','artifact_type','app_id','tenant_id','environment','run_id','revision','content_hash'
    ]) or not app_data_agent.provider_json_object_has_exact_keys(v_source,array[
      'artifact_id','artifact_type','app_id','tenant_id','environment','run_id','revision','content_hash'
    ]) or v_ref ->> 'artifact_type' <> 'ArtifactExportReceipt'
  then
    raise exception using errcode='22023',message='DA_ARTIFACT_EXPORT_CONTRACT_INVALID';
  end if;
  if not platform.backend_context_matches(
    (v_ref ->> 'app_id')::uuid,(v_ref ->> 'tenant_id')::uuid,v_ref ->> 'environment',false
  ) then
    raise exception using errcode='42501',message='DA_ARTIFACT_EXPORT_SCOPE_MISMATCH';
  end if;
  select * into v_row
  from app_data_agent.artifact_export_receipts
  where app_id=(v_ref ->> 'app_id')::uuid
    and tenant_id=(v_ref ->> 'tenant_id')::uuid
    and environment=v_ref ->> 'environment'
    and receipt_id=(v_ref ->> 'artifact_id')::uuid
    and receipt_revision=(v_ref ->> 'revision')::integer
    and receipt_hash=v_ref ->> 'content_hash'
    and run_id=(v_source ->> 'run_id')::uuid
    and source_artifact_id=(v_source ->> 'artifact_id')::uuid
    and source_artifact_type=v_source ->> 'artifact_type'
    and source_revision=(v_source ->> 'revision')::integer
    and source_content_hash=v_source ->> 'content_hash'
    and output_hash=requested_command ->> 'output_hash';
  return pg_catalog.jsonb_build_object(
    'schema_version','artifact-export-load-result@1.0.0',
    'receipt',case when found then v_row.receipt_json else null end
  );
exception when invalid_text_representation or numeric_value_out_of_range then
  raise exception using errcode='22023',message='DA_ARTIFACT_EXPORT_CONTRACT_INVALID';
end
$function$;

alter function app_data_agent.create_artifact_export_receipt(jsonb,jsonb)
  owner to data_agent_u7_artifact_export_owner;
alter function app_data_agent.load_artifact_export_receipt(jsonb)
  owner to data_agent_u7_artifact_export_owner;
revoke all on app_data_agent.artifact_export_receipts from public,data_agent_backend,anon,authenticated;
revoke all on function app_data_agent.reject_artifact_export_receipt_mutation() from public;
revoke all on function app_data_agent.create_artifact_export_receipt(jsonb,jsonb) from public,anon,authenticated;
revoke all on function app_data_agent.load_artifact_export_receipt(jsonb) from public,anon,authenticated;

grant usage on schema app_data_agent,platform
  to data_agent_u7_artifact_export_owner;
grant execute on function app_data_agent.create_artifact_export_receipt(jsonb,jsonb)
  to data_agent_backend;
grant execute on function app_data_agent.load_artifact_export_receipt(jsonb)
  to data_agent_backend;
grant execute on function platform.backend_context_matches(uuid,uuid,text,boolean),
  platform.backend_run_object_matches(uuid,uuid,text,uuid,boolean),
  app_data_agent.u2_canonical_sha256(jsonb),
  app_data_agent.provider_json_object_has_exact_keys(jsonb,text[]),
  app_data_agent.contains_potential_plaintext_secret(jsonb,text)
  to data_agent_u7_artifact_export_owner;

do $postconditions$
begin
  if exists (
    select 1 from pg_catalog.pg_roles
    where rolname='data_agent_u7_artifact_export_owner'
      and (rolcanlogin or rolsuper or rolcreatedb or rolcreaterole or rolreplication or rolinherit or rolbypassrls)
  ) then
    raise exception 'ARTIFACT_EXPORT_OWNER_FLAGS_UNSAFE';
  end if;
  if pg_catalog.has_table_privilege('data_agent_backend','app_data_agent.artifact_export_receipts','INSERT,UPDATE,DELETE')
    or not pg_catalog.has_function_privilege(
      'data_agent_backend','app_data_agent.create_artifact_export_receipt(jsonb,jsonb)','EXECUTE'
    ) or not pg_catalog.has_function_privilege(
      'data_agent_backend','app_data_agent.load_artifact_export_receipt(jsonb)','EXECUTE'
    )
  then
    raise exception 'ARTIFACT_EXPORT_GRANT_POSTCONDITION_FAILED';
  end if;
end
$postconditions$;
select platform.assert_migration_checksum(
  'app',
  '00000000-0000-4000-8000-00000000da01'::uuid,
  '20260725010657_app_data_agent_artifact_export_authority',
  'sha256:caae29f6bc66b0fe1d18f496454a778a248d16991ef1a42383df95002134ce0a'
);

commit;
