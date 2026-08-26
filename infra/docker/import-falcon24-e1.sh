#!/bin/sh
set -eu

DB_URL="${DATABASE_URL:-postgres://postgres:postgres@localhost:5432/data_agent}"
BUNDLE_DIR="${FALCON_BUNDLE_DIR:-/falcon/v1}"
RETAINED_DIR="${FALCON24_E1_RETAINED_DIR:-/falcon/e1}"
READER_PASSWORD="${FALCON_READER_PASSWORD:-data-agent-falcon-demo-change-me}"
VERIFY_ONLY="${FALCON24_E1_VERIFY_ONLY:-NO}"
EXPECTED_CATALOG_INVENTORY_HASH="sha256:85dc4e7f64a0b0944ac653b95d446c253b44995e0e2574b3d393f3fb3d2cde87"

APP_ID="00000000-0000-4000-8000-00000000da01"
WORKSPACE_ID="${FALCON24_E1_WORKSPACE_ID:-00000000-0000-4000-8000-00000000e124}"
PRINCIPAL_ID="${FALCON24_E1_PRINCIPAL_ID:-00000000-0000-4000-8000-00000000e125}"
AUTH_USER_ID="${FALCON24_E1_AUTH_USER_ID:-00000000-0000-4000-8000-00000000e126}"
DATASOURCE_ID="${FALCON24_E1_DATASOURCE_ID:-37653002-af62-53c9-bf21-519468aa39ab}"
DATASOURCE_SECRET_REF_ID="${FALCON24_E1_DATASOURCE_SECRET_REF_ID:-00000000-0000-4000-8000-00000000e128}"
DATASOURCE_CREDENTIAL_REF_ID="${FALCON24_E1_DATASOURCE_CREDENTIAL_REF_ID:-00000000-0000-4000-8000-00000000e129}"
STAGING_ID="${FALCON24_E1_STAGING_ID:-00000000-0000-4000-8000-00000000e130}"
DEPLOYMENT_ID="${FALCON24_E1_DEPLOYMENT_ID:-00000000-0000-4000-8000-000000000001}"
ENVIRONMENT="${FALCON24_E1_ENVIRONMENT:-local}"
READER_HOST="${FALCON24_E1_READER_HOST:-postgres}"
READER_PORT="${FALCON24_E1_READER_PORT:-5432}"

SOURCE_MANIFEST_PATH="$BUNDLE_DIR/source-manifest.json"
RETAINED_MANIFEST_PATH="$RETAINED_DIR/retained-assets-manifest.json"
BUNDLE_PATH="$BUNDLE_DIR/bundles/falcon_db_24.sql.gz"

if [ ! -f "$SOURCE_MANIFEST_PATH" ] || [ ! -f "$RETAINED_MANIFEST_PATH" ] \
  || [ ! -f "$BUNDLE_PATH" ]; then
  echo "FALCON24_E1_RETAINED_INPUT_MISSING" >&2
  exit 1
fi
if [ "$VERIFY_ONLY" != "YES" ] && [ "$VERIFY_ONLY" != "NO" ]; then
  echo "FALCON24_E1_VERIFY_ONLY_INVALID" >&2
  exit 1
fi
for identifier in "$WORKSPACE_ID" "$PRINCIPAL_ID" "$AUTH_USER_ID" "$DATASOURCE_ID" \
  "$DATASOURCE_SECRET_REF_ID" "$DATASOURCE_CREDENTIAL_REF_ID" "$STAGING_ID" "$DEPLOYMENT_ID"; do
  if ! printf '%s\n' "$identifier" | grep -Eq \
    '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'; then
    echo "FALCON24_E1_IDENTITY_INVALID" >&2
    exit 1
  fi
done
if ! printf '%s\n' "$ENVIRONMENT" | grep -Eq '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$' \
  || ! printf '%s\n' "$READER_PORT" | grep -Eq '^[0-9]{1,5}$'; then
  echo "FALCON24_E1_SCOPE_INVALID" >&2
  exit 1
fi

SOURCE_MANIFEST_JSON="$(tr -d '\n' < "$SOURCE_MANIFEST_PATH")"
RETAINED_MANIFEST_JSON="$(tr -d '\n' < "$RETAINED_MANIFEST_PATH")"
SOURCE_MANIFEST_RAW_HASH="sha256:$(sha256sum "$SOURCE_MANIFEST_PATH" | awk '{print $1}')"
OBSERVED_BUNDLE_HASH="sha256:$(sha256sum "$BUNDLE_PATH" | awk '{print $1}')"

EXPECTED_ROW="$(
  psql -X -q -A -t "$DB_URL" -v ON_ERROR_STOP=1 -F '|' \
    -v source_manifest_json="$SOURCE_MANIFEST_JSON" \
    -v retained_manifest_json="$RETAINED_MANIFEST_JSON" <<'SQL'
with source_manifest as (
  select :'source_manifest_json'::jsonb as value
), retained_manifest as (
  select :'retained_manifest_json'::jsonb as value
), database_file as (
  select file.value
  from source_manifest,
    pg_catalog.jsonb_array_elements(source_manifest.value->'files') as file(value)
  where (file.value->>'db_id')::integer=24
)
select source_manifest.value->>'source_commit',source_manifest.value->>'dataset_version',
  database_file.value->>'source_sqlite_sha256',database_file.value->>'bundle_sha256',
  database_file.value->>'content_digest',database_file.value->>'table_count',
  database_file.value->>'column_count',database_file.value->>'row_count',
  database_file.value->>'null_count',retained_manifest.value->>'manifest_hash',
  retained_manifest.value#>>'{upstream,manifest_hash}'
from source_manifest,retained_manifest,database_file
where source_manifest.value->>'manifest_version'='falcon-source-manifest@1.0.0'
  and retained_manifest.value->>'schema_version'='falcon24-retained-assets@1.0.0'
  and retained_manifest.value->>'authority_epoch'='E1'
  and retained_manifest.value#>>'{active_dataset,database_id}'='falcon_db_24'
  and retained_manifest.value#>>'{active_dataset,bundle_sha256}'=
    database_file.value->>'bundle_sha256'
  and retained_manifest.value#>>'{active_dataset,content_digest}'=
    database_file.value->>'content_digest'
  and retained_manifest.value#>>'{active_dataset,seed_hash}'=
    database_file.value->>'source_sqlite_sha256'
  and retained_manifest.value->>'manifest_hash'=
    app_data_agent.u2_canonical_sha256(retained_manifest.value-'manifest_hash');
SQL
)"

if [ -z "$EXPECTED_ROW" ]; then
  echo "FALCON24_E1_RETAINED_MANIFEST_INVALID" >&2
  exit 1
fi
IFS='|' read -r SOURCE_COMMIT DATASET_VERSION SOURCE_SQLITE_HASH EXPECTED_BUNDLE_HASH \
  EXPECTED_CONTENT_DIGEST EXPECTED_TABLE_COUNT EXPECTED_COLUMN_COUNT EXPECTED_ROW_COUNT \
  EXPECTED_NULL_COUNT RETAINED_ASSETS_HASH EXPECTED_SOURCE_MANIFEST_HASH <<EOF
$EXPECTED_ROW
EOF

if [ "$SOURCE_MANIFEST_RAW_HASH" != "$EXPECTED_SOURCE_MANIFEST_HASH" ]; then
  echo "FALCON24_E1_SOURCE_MANIFEST_DIGEST_MISMATCH" >&2
  exit 1
fi
if [ "$OBSERVED_BUNDLE_HASH" != "$EXPECTED_BUNDLE_HASH" ]; then
  echo "FALCON24_E1_DB24_BUNDLE_DIGEST_MISMATCH" >&2
  exit 1
fi

if [ "$VERIFY_ONLY" = "NO" ]; then
  echo "Importing falcon_db_24 for authority epoch E1" >&2
  gzip -dc "$BUNDLE_PATH" | psql -X -q "$DB_URL" -v ON_ERROR_STOP=1 >/dev/null
fi

BOOTSTRAP_RESULT="$(
  psql -X -q -A -t "$DB_URL" -v ON_ERROR_STOP=1 -F '|' \
    -v app_id="$APP_ID" -v workspace_id="$WORKSPACE_ID" -v principal_id="$PRINCIPAL_ID" \
    -v auth_user_id="$AUTH_USER_ID" -v datasource_id="$DATASOURCE_ID" \
    -v datasource_secret_ref_id="$DATASOURCE_SECRET_REF_ID" \
    -v datasource_credential_ref_id="$DATASOURCE_CREDENTIAL_REF_ID" \
    -v staging_id="$STAGING_ID" -v deployment_id="$DEPLOYMENT_ID" \
    -v environment="$ENVIRONMENT" -v reader_host="$READER_HOST" \
    -v reader_port="$READER_PORT" -v retained_assets_hash="$RETAINED_ASSETS_HASH" \
    -v source_commit="$SOURCE_COMMIT" -v dataset_version="$DATASET_VERSION" \
    -v source_sqlite_hash="$SOURCE_SQLITE_HASH" -v expected_bundle_hash="$EXPECTED_BUNDLE_HASH" \
    -v observed_bundle_hash="$OBSERVED_BUNDLE_HASH" \
    -v expected_content_digest="$EXPECTED_CONTENT_DIGEST" \
    -v expected_inventory_hash="$EXPECTED_CATALOG_INVENTORY_HASH" \
    -v expected_table_count="$EXPECTED_TABLE_COUNT" \
    -v expected_column_count="$EXPECTED_COLUMN_COUNT" \
    -v expected_row_count="$EXPECTED_ROW_COUNT" -v expected_null_count="$EXPECTED_NULL_COUNT" \
    -v reader_password="$READER_PASSWORD" <<'SQL'
begin;
set local data_agent.allow_falcon_bootstrap='true';
select app_data_agent.configure_falcon_demo_reader(:'reader_password') \g /dev/null
revoke all on schema falcon_db_24 from public;
revoke all on all tables in schema falcon_db_24 from public;
grant usage on schema falcon_db_24 to falcon_demo_reader;
grant select on all tables in schema falcon_db_24 to falcon_demo_reader;

create temporary table falcon24_e1_bootstrap_config(
  app_id uuid not null,workspace_id uuid not null,principal_id uuid not null,
  auth_user_id uuid not null,datasource_id uuid not null,staging_id uuid not null,
  datasource_secret_ref_id uuid not null,datasource_credential_ref_id uuid not null,
  reader_host text not null,reader_port integer not null,
  deployment_id uuid not null,environment text not null,retained_assets_hash text not null,
  source_commit text not null,dataset_version text not null,source_sqlite_hash text not null,
  expected_bundle_hash text not null,observed_bundle_hash text not null,
  expected_content_digest text not null,expected_inventory_hash text not null,
  expected_table_count bigint not null,
  expected_column_count bigint not null,expected_row_count bigint not null,
  expected_null_count bigint not null
) on commit drop;
insert into falcon24_e1_bootstrap_config values(
  :'app_id'::uuid,:'workspace_id'::uuid,:'principal_id'::uuid,:'auth_user_id'::uuid,
  :'datasource_id'::uuid,:'staging_id'::uuid,:'datasource_secret_ref_id'::uuid,
  :'datasource_credential_ref_id'::uuid,:'reader_host',:'reader_port'::integer,
  :'deployment_id'::uuid,:'environment',
  :'retained_assets_hash',:'source_commit',:'dataset_version',:'source_sqlite_hash',
  :'expected_bundle_hash',:'observed_bundle_hash',:'expected_content_digest',
  :'expected_inventory_hash',
  :'expected_table_count'::bigint,:'expected_column_count'::bigint,
  :'expected_row_count'::bigint,:'expected_null_count'::bigint);

do $exclusive_scope$
begin
  if (select pg_catalog.count(*) from pg_catalog.pg_namespace
      where nspname~'^falcon_db_(0[1-9]|1[0-9]|2[0-8])$')<>1
    or pg_catalog.to_regnamespace('falcon_db_24') is null
  then raise exception using errcode='55000',message='FALCON24_E1_IMPORT_SCOPE_DRIFT'; end if;
  if exists(select 1 from app_data_agent.falcon_import_receipts)
  then raise exception using errcode='55000',message='FALCON24_E1_LEGACY_IMPORT_RECEIPT_PRESENT'; end if;
end
$exclusive_scope$;

insert into data_agent_auth."user"(
  "id","name","email","emailVerified","updatedAt","role","banned","username","displayUsername")
values(:'auth_user_id'::uuid,'Falcon24 E1 Bootstrap','falcon24-e1@data-agent.local',true,
  pg_catalog.clock_timestamp(),'admin',false,'falcon24_e1','falcon24_e1')
on conflict("id") do nothing;

insert into app_data_agent.app_users(
  app_id,environment,principal_id,auth_user_id,email,display_name,system_role,status)
values(:'app_id'::uuid,:'environment',:'principal_id'::uuid,:'auth_user_id'::uuid,
  'falcon24-e1@data-agent.local','Falcon24 E1 Bootstrap','SUPER_ADMIN','ACTIVE')
on conflict(app_id,environment,principal_id) do nothing;

insert into app_data_agent.workspaces(
  app_id,environment,workspace_id,slug,display_name,created_by_principal_id)
values(:'app_id'::uuid,:'environment',:'workspace_id'::uuid,'falcon24-e1',
  'Falcon24 E1 Fresh Workspace',:'principal_id'::uuid)
on conflict(app_id,workspace_id,environment) do nothing;

insert into app_data_agent.memberships(
  app_id,tenant_id,environment,principal_id,membership_role,workspace_role,
  membership_source,system_override)
values(:'app_id'::uuid,:'workspace_id'::uuid,:'environment',:'principal_id'::uuid,
  'owner','WORKSPACE_ADMIN','EXPLICIT',false)
on conflict(app_id,tenant_id,environment,principal_id) do nothing;

insert into app_data_agent.secret_refs(
  app_id,tenant_id,environment,secret_ref_id,owner_principal_id,secret_name,
  provider_ref_hash,version,status)
values(:'app_id'::uuid,:'workspace_id'::uuid,:'environment',
  :'datasource_secret_ref_id'::uuid,:'principal_id'::uuid,'Falcon24E1Reader',
  app_data_agent.u2_canonical_sha256(pg_catalog.to_jsonb('env:FALCON_READER_PASSWORD'::text)),
  1,'ACTIVE')
on conflict(app_id,tenant_id,environment,secret_ref_id) do nothing;

insert into app_data_agent.datasource_connections(
  app_id,tenant_id,environment,datasource_id,name,datasource_type,host,port,
  database_name,username,credential_ref_id,secret_ref_id,secret_version,rotation_state,
  ssl_mode,schema_name,status,last_tested_at,created_by_principal_id)
values(:'app_id'::uuid,:'workspace_id'::uuid,:'environment',:'datasource_id'::uuid,
  'Falcon24 E1 db24','postgresql',:'reader_host',:'reader_port'::integer,
  'data_agent','falcon_demo_reader',:'datasource_credential_ref_id'::uuid,
  :'datasource_secret_ref_id'::uuid,1,'ACTIVE','disable','falcon_db_24','ACTIVE',
  pg_catalog.clock_timestamp(),:'principal_id'::uuid)
on conflict(app_id,tenant_id,environment,datasource_id) do nothing;

do $identity_closure$
declare config record;
begin
  select * into strict config from falcon24_e1_bootstrap_config;
  if not exists(select 1 from platform.deployment_mappings deployment
      join platform.app_environment_lifecycle lifecycle using(app_id,environment)
      where deployment.deployment_id=config.deployment_id
        and deployment.app_id=config.app_id and deployment.environment=config.environment
        and deployment.is_active and lifecycle.lifecycle_state='ACTIVE')
    or not exists(select 1 from data_agent_auth."user"
      where "id"=config.auth_user_id and "name"='Falcon24 E1 Bootstrap'
        and "email"='falcon24-e1@data-agent.local' and "emailVerified"
        and "role"='admin' and not "banned" and "username"='falcon24_e1'
        and "displayUsername"='falcon24_e1')
    or not exists(select 1 from app_data_agent.app_users
      where app_id=config.app_id and environment=config.environment
        and principal_id=config.principal_id and auth_user_id=config.auth_user_id
        and email='falcon24-e1@data-agent.local' and display_name='Falcon24 E1 Bootstrap'
        and system_role='SUPER_ADMIN' and status='ACTIVE')
    or not exists(select 1 from app_data_agent.workspaces
      where app_id=config.app_id and environment=config.environment
        and workspace_id=config.workspace_id and slug='falcon24-e1'
        and display_name='Falcon24 E1 Fresh Workspace'
        and created_by_principal_id=config.principal_id and lifecycle='ACTIVE')
    or not exists(select 1 from app_data_agent.memberships
      where app_id=config.app_id and tenant_id=config.workspace_id
        and environment=config.environment and principal_id=config.principal_id
        and membership_role='owner' and workspace_role='WORKSPACE_ADMIN'
        and membership_source='EXPLICIT' and not system_override and revoked_at is null)
    or not exists(select 1 from app_data_agent.secret_refs
      where app_id=config.app_id and tenant_id=config.workspace_id
        and environment=config.environment and secret_ref_id=config.datasource_secret_ref_id
        and owner_principal_id=config.principal_id and secret_name='Falcon24E1Reader'
        and provider_ref_hash=app_data_agent.u2_canonical_sha256(
          pg_catalog.to_jsonb('env:FALCON_READER_PASSWORD'::text))
        and version=1 and status='ACTIVE')
    or not exists(select 1 from app_data_agent.datasource_connections
      where app_id=config.app_id and tenant_id=config.workspace_id
        and environment=config.environment and datasource_id=config.datasource_id
        and name='Falcon24 E1 db24' and datasource_type='postgresql'
        and host=config.reader_host and port=config.reader_port and database_name='data_agent'
        and username='falcon_demo_reader'
        and credential_ref_id=config.datasource_credential_ref_id
        and secret_ref_id=config.datasource_secret_ref_id and secret_version=1
        and rotation_state='ACTIVE' and ssl_mode='disable'
        and schema_name='falcon_db_24' and status='ACTIVE'
        and created_by_principal_id=config.principal_id)
  then raise exception using errcode='55000',message='FALCON24_E1_BOOTSTRAP_IDENTITY_CONFLICT'; end if;
end
$identity_closure$;

create temporary table falcon24_e1_catalog_tables(
  table_name text primary key,columns jsonb not null,row_count bigint not null,
  null_count bigint not null
) on commit drop;
create temporary table falcon24_e1_digest_rows(
  table_name text not null,row_ordinal bigint not null,row_canonical text not null
) on commit drop;

do $catalog_inventory$
declare table_row record;canonical_columns text;null_expression text;
  observed_rows bigint;observed_nulls bigint;
begin
  for table_row in
    select class.relname as table_name
    from pg_catalog.pg_class class
    join pg_catalog.pg_namespace namespace on namespace.oid=class.relnamespace
    where namespace.nspname='falcon_db_24' and class.relkind='r'
    order by class.relname
  loop
    select pg_catalog.string_agg(
      case when attribute.atttypid in('real'::pg_catalog.regtype,'double precision'::pg_catalog.regtype)
        then pg_catalog.format(
          'case when row_value.%1$I is null then ''null'' '
          'when row_value.%1$I::text in(''NaN'',''Infinity'',''-Infinity'') '
          'then pg_catalog.to_json(row_value.%1$I)::text '
          'when row_value.%1$I::text!~''[.eE]'' then row_value.%1$I::text||''.0'' '
          'else row_value.%1$I::text end',attribute.attname)
        else pg_catalog.format(
          'coalesce(pg_catalog.to_json(row_value.%I)::text,''null'')',
          attribute.attname)
      end,'||'',''||' order by attribute.attnum),
      pg_catalog.string_agg(pg_catalog.format('(row_value.%I is null)::integer',
        attribute.attname),'+' order by attribute.attnum)
    into strict canonical_columns,null_expression
    from pg_catalog.pg_attribute attribute
    where attribute.attrelid=pg_catalog.format('%I.%I','falcon_db_24',table_row.table_name)::regclass
      and attribute.attnum>0 and not attribute.attisdropped;
    execute pg_catalog.format('select pg_catalog.count(*),coalesce(pg_catalog.sum(%s),0) '
      'from %I.%I row_value',null_expression,'falcon_db_24',table_row.table_name)
      into strict observed_rows,observed_nulls;
    insert into falcon24_e1_catalog_tables(table_name,columns,row_count,null_count)
    select table_row.table_name,
      pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
        'ordinal',attribute.attnum,'column_name',attribute.attname,
        'data_type',pg_catalog.format_type(attribute.atttypid,attribute.atttypmod),
        'is_nullable',not attribute.attnotnull) order by attribute.attnum),
      observed_rows,observed_nulls
    from pg_catalog.pg_attribute attribute
    where attribute.attrelid=pg_catalog.format('%I.%I','falcon_db_24',table_row.table_name)::regclass
      and attribute.attnum>0 and not attribute.attisdropped;
    execute pg_catalog.format(
      'insert into falcon24_e1_digest_rows(table_name,row_ordinal,row_canonical) '
      'select %L,pg_catalog.row_number() over(order by row_value.ctid),'
      '''[''||%s||'']'' from %I.%I row_value order by row_value.ctid',
      table_row.table_name,canonical_columns,'falcon_db_24',table_row.table_name);
  end loop;
end
$catalog_inventory$;

create temporary table falcon24_e1_import_document(document jsonb not null) on commit drop;
do $receipt$
declare inventory_material jsonb;inventory jsonb;receipt_material jsonb;
  content_digest text;failure_codes text[];config record;
begin
  select * into strict config from falcon24_e1_bootstrap_config;
  select 'sha256:'||pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(
    '['||pg_catalog.string_agg(
      '['||pg_catalog.to_json(table_name)::text||','||row_canonical||']',
      ',' order by table_name,row_ordinal)||']','UTF8')),'hex')
  into strict content_digest
  from falcon24_e1_digest_rows;
  select pg_catalog.jsonb_build_object(
    'schema_name','falcon_db_24',
    'tables',pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
      'table_name',table_name,'columns',columns,'row_count',row_count,'null_count',null_count)
      order by table_name),
    'table_count',pg_catalog.count(*),
    'column_count',pg_catalog.sum(pg_catalog.jsonb_array_length(columns)),
    'row_count',pg_catalog.sum(row_count),'null_count',pg_catalog.sum(null_count),
    'content_digest',content_digest)
  into strict inventory_material from falcon24_e1_catalog_tables;
  inventory:=inventory_material||pg_catalog.jsonb_build_object(
    'inventory_hash',app_data_agent.u2_canonical_sha256(inventory_material));
  failure_codes:=pg_catalog.array_remove(array[
    case when config.observed_bundle_hash<>config.expected_bundle_hash
      then 'BUNDLE_HASH_MISMATCH' end,
    case when (inventory->>'column_count')::bigint<>config.expected_column_count
      then 'COLUMN_COUNT_MISMATCH' end,
    case when inventory->>'content_digest'<>config.expected_content_digest
      then 'CONTENT_DIGEST_MISMATCH' end,
    case when inventory->>'inventory_hash'<>config.expected_inventory_hash
      then 'INVENTORY_HASH_INVALID' end,
    case when (inventory->>'null_count')::bigint<>config.expected_null_count
      then 'NULL_COUNT_MISMATCH' end,
    case when (inventory->>'row_count')::bigint<>config.expected_row_count
      then 'ROW_COUNT_MISMATCH' end,
    case when (inventory->>'table_count')::bigint<>config.expected_table_count
      then 'TABLE_COUNT_MISMATCH' end
  ]::text[],null);
  select pg_catalog.array_agg(code order by code) into failure_codes
  from pg_catalog.unnest(failure_codes) code;
  failure_codes:=coalesce(failure_codes,array[]::text[]);
  receipt_material:=pg_catalog.jsonb_build_object(
    'receipt_version','falcon24-e1-database-import@1.0.0','authority_epoch','E1',
    'dataset_version',config.dataset_version,'source_commit',config.source_commit,'db_id',24,
    'schema_name','falcon_db_24','target_database','data_agent',
    'reader_role','falcon_demo_reader','source_sqlite_sha256',config.source_sqlite_hash,
    'expected_bundle_sha256',config.expected_bundle_hash,
    'observed_bundle_sha256',config.observed_bundle_hash,
    'expected_content_digest',config.expected_content_digest,'catalog_inventory',inventory,
    'expected_inventory_hash',config.expected_inventory_hash,
    'status',case when pg_catalog.cardinality(failure_codes)=0 then 'READY' else 'HOLD' end,
    'failure_codes',pg_catalog.to_jsonb(failure_codes));
  insert into falcon24_e1_import_document(document) values(receipt_material||
    pg_catalog.jsonb_build_object('receipt_hash',app_data_agent.u2_canonical_sha256(receipt_material)));
end
$receipt$;

create temporary table falcon24_e1_staging_documents(
  session_command jsonb not null,receipt_command jsonb not null
) on commit drop;
do $prepare_stage$
declare import_receipt jsonb;command jsonb;staging_receipt jsonb;config record;
begin
  select * into strict config from falcon24_e1_bootstrap_config;
  select document into strict import_receipt from falcon24_e1_import_document;
  if import_receipt->>'status'<>'READY' then return; end if;
  command:=pg_catalog.jsonb_build_object(
    'schema_version','falcon24-e1-staging-session-begin@1.0.0',
    'staging_id',config.staging_id,'retained_assets_hash',config.retained_assets_hash);
  command:=command||pg_catalog.jsonb_build_object(
    'command_hash',app_data_agent.u2_canonical_sha256(command));
  staging_receipt:=pg_catalog.jsonb_build_object(
    'schema_version','falcon24-e1-staging-receipt@1.0.0','staging_id',config.staging_id,
    'component','DATASET','subject_hash',import_receipt->>'receipt_hash',
    'evidence_hash',import_receipt#>>'{catalog_inventory,inventory_hash}',
    'production_isolation_proven',false);
  staging_receipt:=staging_receipt||pg_catalog.jsonb_build_object(
    'receipt_hash',app_data_agent.u2_canonical_sha256(staging_receipt));
  insert into falcon24_e1_staging_documents(session_command,receipt_command)
  select command,receipt_command||pg_catalog.jsonb_build_object(
    'command_hash',app_data_agent.u2_canonical_sha256(receipt_command))
  from (select pg_catalog.jsonb_build_object(
    'schema_version','falcon24-e1-staging-receipt-record@1.0.0',
    'receipt',staging_receipt) as receipt_command) prepared;
end
$prepare_stage$;

select pg_catalog.set_config('data_agent.app_id',:'app_id',true) \g /dev/null
select pg_catalog.set_config('data_agent.tenant_id',:'workspace_id',true) \g /dev/null
select pg_catalog.set_config('data_agent.environment',:'environment',true) \g /dev/null
select pg_catalog.set_config('data_agent.principal_id',:'principal_id',true) \g /dev/null
select pg_catalog.set_config('data_agent.role','owner',true) \g /dev/null
select pg_catalog.set_config('data_agent.deployment_id',:'deployment_id',true) \g /dev/null
grant select on falcon24_e1_staging_documents to data_agent_backend;
set local role data_agent_backend;

do $stage$
declare session_command jsonb;receipt_command jsonb;
begin
  select document.session_command,document.receipt_command
  into session_command,receipt_command from falcon24_e1_staging_documents document;
  if not found then return; end if;
  perform app_data_agent.begin_falcon24_e1_staging_session(session_command);
  perform app_data_agent.record_falcon24_e1_staging_receipt(receipt_command);
end
$stage$;

reset role;
select document->>'status',document::text from falcon24_e1_import_document;
commit;
SQL
)"

IMPORT_STATUS="${BOOTSTRAP_RESULT%%|*}"
IMPORT_RECEIPT="${BOOTSTRAP_RESULT#*|}"
if [ "$IMPORT_STATUS" != "READY" ]; then
  printf '%s\n' "$IMPORT_RECEIPT" >&2
  exit 1
fi

printf '%s\n' "$IMPORT_RECEIPT"
