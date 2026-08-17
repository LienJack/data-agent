-- u14_extension_migration_checksum: sha256:85673af959d94737fc0893bda362960789607b9af29a321a2c46a7c38955ffae
begin;

do $bootstrap$
begin
  if pg_catalog.current_setting('server_version_num')::integer not between 170000 and 179999 then
    raise exception using errcode='0A000',message='U14_EXTENSION_POSTGRES_VERSION_UNSUPPORTED';
  end if;
  if session_user<>'postgres' or current_user<>'postgres' then
    raise exception using errcode='42501',message='U14_EXTENSION_MIGRATION_EXECUTOR_UNSAFE';
  end if;
  if not exists(select 1 from platform.migration_ledger where owner_kind='app'
    and app_id='00000000-0000-4000-8000-00000000da01'::uuid
    and migration_version='20260725010664_app_data_agent_resolved_context_text2sql')
  then raise exception using errcode='P0001',message='U14_EXTENSION_BASELINE_10664_MISSING'; end if;
  if not exists(select 1 from pg_catalog.pg_roles where rolname='data_agent_u14_extension_owner') then
    create role data_agent_u14_extension_owner nologin nosuperuser nocreatedb nocreaterole
      noinherit noreplication nobypassrls;
  end if;
end
$bootstrap$;

set local lock_timeout='2000ms';
set local statement_timeout='300000ms';
set local idle_in_transaction_session_timeout='60000ms';
select platform.acquire_migration_lock('app','00000000-0000-4000-8000-00000000da01'::uuid);
create table app_data_agent.mcp_server_revisions (
  app_id uuid not null,tenant_id uuid not null,environment text not null,
  server_id uuid not null,revision bigint not null check(revision>0),revision_hash text not null,
  approval_status text not null check(approval_status in ('APPROVED','QUARANTINED')),
  document_json jsonb not null,created_by uuid not null,created_at timestamptz not null,
  primary key(app_id,tenant_id,environment,server_id,revision),
  unique(app_id,tenant_id,environment,server_id,revision,revision_hash),
  check(revision_hash ~ '^sha256:[0-9a-f]{64}$'
    and revision_hash=app_data_agent.u2_canonical_sha256(document_json-'revision_hash')),
  check(document_json->>'schema_version'='mcp-server-revision@1.0.0'
    and (document_json->>'server_id')::uuid=server_id
    and (document_json->>'revision')::bigint=revision
    and document_json->>'approval_status'=approval_status),
  foreign key(app_id,tenant_id,environment)
    references app_data_agent.workspaces(app_id,workspace_id,environment) on delete restrict,
  foreign key(app_id,tenant_id,environment,created_by)
    references app_data_agent.memberships(app_id,tenant_id,environment,principal_id) on delete restrict
);
create table app_data_agent.mcp_server_heads (
  app_id uuid not null,tenant_id uuid not null,environment text not null,server_id uuid not null,
  active_revision bigint not null,active_revision_hash text not null,
  lifecycle text not null check(lifecycle in ('ENABLED','DISABLED','REVOKED')),
  version bigint not null check(version>0),updated_by uuid not null,updated_at timestamptz not null,
  primary key(app_id,tenant_id,environment,server_id),
  foreign key(app_id,tenant_id,environment,server_id,active_revision,active_revision_hash)
    references app_data_agent.mcp_server_revisions(app_id,tenant_id,environment,server_id,revision,revision_hash),
  foreign key(app_id,tenant_id,environment)
    references app_data_agent.workspaces(app_id,workspace_id,environment) on delete restrict,
  foreign key(app_id,tenant_id,environment,updated_by)
    references app_data_agent.memberships(app_id,tenant_id,environment,principal_id) on delete restrict
);
create table app_data_agent.skill_revisions (
  app_id uuid not null,tenant_id uuid not null,environment text not null,
  skill_id uuid not null,revision bigint not null check(revision>0),revision_hash text not null,
  signer_id uuid not null,approval_status text not null check(approval_status in ('APPROVED','QUARANTINED')),
  document_json jsonb not null,created_by uuid not null,created_at timestamptz not null,
  primary key(app_id,tenant_id,environment,skill_id,revision),
  unique(app_id,tenant_id,environment,skill_id,revision,revision_hash),
  check(revision_hash ~ '^sha256:[0-9a-f]{64}$'
    and revision_hash=app_data_agent.u2_canonical_sha256(document_json-'revision_hash')),
  check(document_json->>'schema_version'='skill-revision@1.0.0'
    and (document_json->>'skill_id')::uuid=skill_id
    and (document_json->>'revision')::bigint=revision
    and (document_json->>'signer_id')::uuid=signer_id
    and document_json->>'approval_status'=approval_status),
  foreign key(app_id,tenant_id,environment)
    references app_data_agent.workspaces(app_id,workspace_id,environment) on delete restrict,
  foreign key(app_id,tenant_id,environment,created_by)
    references app_data_agent.memberships(app_id,tenant_id,environment,principal_id) on delete restrict
);
create table app_data_agent.skill_heads (
  app_id uuid not null,tenant_id uuid not null,environment text not null,skill_id uuid not null,
  active_revision bigint not null,active_revision_hash text not null,
  lifecycle text not null check(lifecycle in ('ENABLED','DISABLED','QUARANTINED','REVOKED')),
  signer_revocation_version bigint not null default 0 check(signer_revocation_version>=0),
  version bigint not null check(version>0),updated_by uuid not null,updated_at timestamptz not null,
  primary key(app_id,tenant_id,environment,skill_id),
  foreign key(app_id,tenant_id,environment,skill_id,active_revision,active_revision_hash)
    references app_data_agent.skill_revisions(app_id,tenant_id,environment,skill_id,revision,revision_hash),
  foreign key(app_id,tenant_id,environment)
    references app_data_agent.workspaces(app_id,workspace_id,environment) on delete restrict,
  foreign key(app_id,tenant_id,environment,updated_by)
    references app_data_agent.memberships(app_id,tenant_id,environment,principal_id) on delete restrict
);
create table app_data_agent.skill_signer_revocations (
  app_id uuid not null,tenant_id uuid not null,environment text not null,signer_id uuid not null,
  revocation_version bigint not null check(revocation_version>0),reason_code text not null,
  revoked_by uuid not null,revoked_at timestamptz not null,
  primary key(app_id,tenant_id,environment,signer_id,revocation_version),
  foreign key(app_id,tenant_id,environment)
    references app_data_agent.workspaces(app_id,workspace_id,environment) on delete restrict,
  foreign key(app_id,tenant_id,environment,revoked_by)
    references app_data_agent.memberships(app_id,tenant_id,environment,principal_id) on delete restrict
);
create table app_data_agent.extension_operation_receipts (
  app_id uuid not null,tenant_id uuid not null,environment text not null,actor_principal_id uuid not null,
  operation_id uuid not null,idempotency_key text not null,input_hash text not null,result_json jsonb not null,
  committed_at timestamptz not null,
  primary key(app_id,tenant_id,environment,operation_id),
  unique(app_id,tenant_id,environment,actor_principal_id,idempotency_key),
  check(input_hash ~ '^sha256:[0-9a-f]{64}$'),
  foreign key(app_id,tenant_id,environment)
    references app_data_agent.workspaces(app_id,workspace_id,environment) on delete restrict,
  foreign key(app_id,tenant_id,environment,actor_principal_id)
    references app_data_agent.memberships(app_id,tenant_id,environment,principal_id) on delete restrict
);

create function app_data_agent.reject_extension_immutable_mutation()
returns trigger language plpgsql set search_path='' as $function$
begin raise exception using errcode='55000',message='EXTENSION_AUTHORITY_IMMUTABLE'; end
$function$;
create trigger mcp_server_revisions_immutable before update or delete on app_data_agent.mcp_server_revisions
for each row execute function app_data_agent.reject_extension_immutable_mutation();
create trigger skill_revisions_immutable before update or delete on app_data_agent.skill_revisions
for each row execute function app_data_agent.reject_extension_immutable_mutation();
create trigger skill_signer_revocations_immutable before update or delete on app_data_agent.skill_signer_revocations
for each row execute function app_data_agent.reject_extension_immutable_mutation();
create trigger extension_operation_receipts_immutable before update or delete on app_data_agent.extension_operation_receipts
for each row execute function app_data_agent.reject_extension_immutable_mutation();

alter table app_data_agent.mcp_server_revisions enable row level security;
alter table app_data_agent.mcp_server_revisions force row level security;
alter table app_data_agent.mcp_server_heads enable row level security;
alter table app_data_agent.mcp_server_heads force row level security;
alter table app_data_agent.skill_revisions enable row level security;
alter table app_data_agent.skill_revisions force row level security;
alter table app_data_agent.skill_heads enable row level security;
alter table app_data_agent.skill_heads force row level security;
alter table app_data_agent.skill_signer_revocations enable row level security;
alter table app_data_agent.skill_signer_revocations force row level security;
alter table app_data_agent.extension_operation_receipts enable row level security;
alter table app_data_agent.extension_operation_receipts force row level security;

create policy mcp_server_revisions_owner on app_data_agent.mcp_server_revisions for all to data_agent_u14_extension_owner
using(platform.backend_context_matches(app_id,tenant_id,environment,false))
with check(platform.backend_context_matches(app_id,tenant_id,environment,true));
create policy mcp_server_heads_owner on app_data_agent.mcp_server_heads for all to data_agent_u14_extension_owner
using(platform.backend_context_matches(app_id,tenant_id,environment,false))
with check(platform.backend_context_matches(app_id,tenant_id,environment,true));
create policy skill_revisions_owner on app_data_agent.skill_revisions for all to data_agent_u14_extension_owner
using(platform.backend_context_matches(app_id,tenant_id,environment,false))
with check(platform.backend_context_matches(app_id,tenant_id,environment,true));
create policy skill_heads_owner on app_data_agent.skill_heads for all to data_agent_u14_extension_owner
using(platform.backend_context_matches(app_id,tenant_id,environment,false))
with check(platform.backend_context_matches(app_id,tenant_id,environment,true));
create policy skill_signer_revocations_owner on app_data_agent.skill_signer_revocations for all to data_agent_u14_extension_owner
using(platform.backend_context_matches(app_id,tenant_id,environment,false))
with check(platform.backend_context_matches(app_id,tenant_id,environment,true));
create policy extension_operation_receipts_owner on app_data_agent.extension_operation_receipts for all to data_agent_u14_extension_owner
using(platform.backend_context_matches(app_id,tenant_id,environment,false))
with check(platform.backend_context_matches(app_id,tenant_id,environment,true));
create function app_data_agent.commit_extension_revision(command jsonb)
returns jsonb language plpgsql volatile security definer set search_path='' as $function$
declare
  authority record; existing_receipt app_data_agent.extension_operation_receipts%rowtype;
  existing_document jsonb; head_record record; result_document jsonb; now_at timestamptz;
  input_hash text; kind text; object_id uuid; revision_no bigint; revision_hash text;
  expected_version bigint; target_lifecycle text; approval_status text; signer_id_value uuid;
begin
  if not pg_catalog.pg_has_role(session_user,'data_agent_backend','USAGE') then
    raise exception using errcode='42501',message='DA_BACKEND_ROLE_REQUIRED'; end if;
  if command is null or not app_data_agent.resolved_context_exact_keys(command,array[
    'schema_version','operation_id','idempotency_key','kind','expected_head_version',
    'target_lifecycle','revision'
  ]::text[]) or command->>'schema_version'<>'extension-revision-commit@1.0.0'
    or command->>'kind' not in ('MCP_SERVER','SKILL')
    or pg_catalog.length(command->>'idempotency_key') not between 8 and 128
  then raise exception using errcode='22023',message='EXTENSION_COMMAND_INVALID'; end if;
  select * into authority from platform.current_backend_authority(true);
  if pg_catalog.lower(authority.membership_role)<>'owner' then
    raise exception using errcode='42501',message='EXTENSION_MANAGE_REQUIRED'; end if;
  if command#>'{revision,scope}'<>pg_catalog.jsonb_build_object(
    'app_id',authority.app_id,'tenant_id',authority.tenant_id,'environment',authority.environment)
  then raise exception using errcode='42501',message='EXTENSION_SCOPE_MISMATCH'; end if;
  input_hash:=app_data_agent.u2_canonical_sha256(command);
  select receipt.* into existing_receipt from app_data_agent.extension_operation_receipts receipt
  where receipt.app_id=authority.app_id and receipt.tenant_id=authority.tenant_id
    and receipt.environment=authority.environment and receipt.actor_principal_id=authority.principal_id
    and receipt.idempotency_key=command->>'idempotency_key' for share;
  if found then
    if existing_receipt.input_hash<>input_hash then
      raise exception using errcode='23505',message='EXTENSION_OPERATION_CONFLICT'; end if;
    return existing_receipt.result_json||pg_catalog.jsonb_build_object('disposition','REPLAYED');
  end if;
  kind:=command->>'kind';
  object_id:=case when kind='MCP_SERVER' then (command#>>'{revision,server_id}')::uuid
    else (command#>>'{revision,skill_id}')::uuid end;
  revision_no:=(command#>>'{revision,revision}')::bigint;
  revision_hash:=command#>>'{revision,revision_hash}';
  approval_status:=command#>>'{revision,approval_status}';
  expected_version:=nullif(command->>'expected_head_version','')::bigint;
  target_lifecycle:=command->>'target_lifecycle';
  if revision_hash<>app_data_agent.u2_canonical_sha256((command->'revision')-'revision_hash')
    or approval_status not in ('APPROVED','QUARANTINED')
    or (target_lifecycle='ENABLED' and approval_status<>'APPROVED')
  then raise exception using errcode='23514',message='EXTENSION_REVISION_INVALID'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    authority.app_id::text||':'||authority.tenant_id::text||':'||authority.environment||':'||kind||':'||object_id::text,0));
  now_at:=pg_catalog.clock_timestamp();
  if kind='MCP_SERVER' then
    insert into app_data_agent.mcp_server_revisions(
      app_id,tenant_id,environment,server_id,revision,revision_hash,approval_status,
      document_json,created_by,created_at)
    values(authority.app_id,authority.tenant_id,authority.environment,object_id,revision_no,
      revision_hash,approval_status,command->'revision',authority.principal_id,now_at)
    on conflict do nothing;
    select document_json into existing_document from app_data_agent.mcp_server_revisions
    where app_id=authority.app_id and tenant_id=authority.tenant_id and environment=authority.environment
      and server_id=object_id and revision=revision_no;
    if existing_document<>command->'revision' then
      raise exception using errcode='23505',message='EXTENSION_REVISION_CONFLICT'; end if;
    select * into head_record from app_data_agent.mcp_server_heads where app_id=authority.app_id
      and tenant_id=authority.tenant_id and environment=authority.environment and server_id=object_id for update;
    if found and head_record.version<>expected_version then
      raise exception using errcode='40001',message='EXTENSION_HEAD_VERSION_CONFLICT'; end if;
    if not found and expected_version is not null then
      raise exception using errcode='40001',message='EXTENSION_HEAD_VERSION_CONFLICT'; end if;
    insert into app_data_agent.mcp_server_heads(app_id,tenant_id,environment,server_id,
      active_revision,active_revision_hash,lifecycle,version,updated_by,updated_at)
    values(authority.app_id,authority.tenant_id,authority.environment,object_id,revision_no,
      revision_hash,target_lifecycle,1,authority.principal_id,now_at)
    on conflict(app_id,tenant_id,environment,server_id) do update set
      active_revision=excluded.active_revision,active_revision_hash=excluded.active_revision_hash,
      lifecycle=excluded.lifecycle,version=app_data_agent.mcp_server_heads.version+1,
      updated_by=excluded.updated_by,updated_at=excluded.updated_at;
  else
    signer_id_value:=(command#>>'{revision,signer_id}')::uuid;
    if target_lifecycle='ENABLED' and exists(select 1 from app_data_agent.skill_signer_revocations revocation
      where revocation.app_id=authority.app_id and revocation.tenant_id=authority.tenant_id
        and revocation.environment=authority.environment and revocation.signer_id=signer_id_value)
    then raise exception using errcode='42501',message='SKILL_SIGNER_REVOKED'; end if;
    insert into app_data_agent.skill_revisions(app_id,tenant_id,environment,skill_id,revision,
      revision_hash,signer_id,approval_status,document_json,created_by,created_at)
    values(authority.app_id,authority.tenant_id,authority.environment,object_id,revision_no,
      revision_hash,signer_id_value,approval_status,command->'revision',authority.principal_id,now_at)
    on conflict do nothing;
    select document_json into existing_document from app_data_agent.skill_revisions
    where app_id=authority.app_id and tenant_id=authority.tenant_id and environment=authority.environment
      and skill_id=object_id and revision=revision_no;
    if existing_document<>command->'revision' then
      raise exception using errcode='23505',message='EXTENSION_REVISION_CONFLICT'; end if;
    select * into head_record from app_data_agent.skill_heads where app_id=authority.app_id
      and tenant_id=authority.tenant_id and environment=authority.environment and skill_id=object_id for update;
    if found and head_record.version<>expected_version then
      raise exception using errcode='40001',message='EXTENSION_HEAD_VERSION_CONFLICT'; end if;
    if not found and expected_version is not null then
      raise exception using errcode='40001',message='EXTENSION_HEAD_VERSION_CONFLICT'; end if;
    insert into app_data_agent.skill_heads(app_id,tenant_id,environment,skill_id,active_revision,
      active_revision_hash,lifecycle,signer_revocation_version,version,updated_by,updated_at)
    values(authority.app_id,authority.tenant_id,authority.environment,object_id,revision_no,
      revision_hash,target_lifecycle,0,1,authority.principal_id,now_at)
    on conflict(app_id,tenant_id,environment,skill_id) do update set
      active_revision=excluded.active_revision,active_revision_hash=excluded.active_revision_hash,
      lifecycle=excluded.lifecycle,version=app_data_agent.skill_heads.version+1,
      updated_by=excluded.updated_by,updated_at=excluded.updated_at;
  end if;
  result_document:=pg_catalog.jsonb_build_object('schema_version','extension-revision-result@1.0.0',
    'disposition','COMMITTED','kind',kind,'object_id',object_id,'revision',revision_no,
    'revision_hash',revision_hash,'lifecycle',target_lifecycle,
    'head_version',coalesce(head_record.version,0)+1);
  insert into app_data_agent.extension_operation_receipts(app_id,tenant_id,environment,
    actor_principal_id,operation_id,idempotency_key,input_hash,result_json,committed_at)
  values(authority.app_id,authority.tenant_id,authority.environment,authority.principal_id,
    (command->>'operation_id')::uuid,command->>'idempotency_key',input_hash,result_document,now_at);
  return result_document;
exception when invalid_text_representation or numeric_value_out_of_range then
  raise exception using errcode='22023',message='EXTENSION_COMMAND_INVALID';
end
$function$;

create function app_data_agent.list_extension_revisions(requested_kind text,enabled_only boolean)
returns jsonb language plpgsql stable security definer set search_path='' as $function$
declare authority record; result jsonb;
begin
  if not pg_catalog.pg_has_role(session_user,'data_agent_backend','USAGE') then
    raise exception using errcode='42501',message='DA_BACKEND_ROLE_REQUIRED'; end if;
  if requested_kind not in ('MCP_SERVER','SKILL') then
    raise exception using errcode='22023',message='EXTENSION_KIND_INVALID'; end if;
  select * into authority from platform.current_backend_authority(false);
  if requested_kind='MCP_SERVER' then
    select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
      'schema_version','mcp-server-registry-item@1.0.0',
      'revision',revision.document_json,
      'head',pg_catalog.jsonb_build_object(
        'schema_version','mcp-server-head@1.0.0',
        'scope',pg_catalog.jsonb_build_object('app_id',head.app_id,'tenant_id',head.tenant_id,
          'environment',head.environment),
        'server_id',head.server_id,'active_revision',head.active_revision,
        'active_revision_hash',head.active_revision_hash,'lifecycle',head.lifecycle,
        'version',head.version,'updated_at',head.updated_at
      )) order by head.server_id),'[]'::jsonb)
    into result from app_data_agent.mcp_server_heads head join app_data_agent.mcp_server_revisions revision
      on revision.app_id=head.app_id and revision.tenant_id=head.tenant_id
      and revision.environment=head.environment and revision.server_id=head.server_id
      and revision.revision=head.active_revision and revision.revision_hash=head.active_revision_hash
    where head.app_id=authority.app_id and head.tenant_id=authority.tenant_id
      and head.environment=authority.environment
      and (not enabled_only or (head.lifecycle='ENABLED' and revision.approval_status='APPROVED'));
  else
    select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
      'schema_version','skill-registry-item@1.0.0',
      'revision',revision.document_json,
      'head',pg_catalog.jsonb_build_object(
        'schema_version','skill-head@1.0.0',
        'scope',pg_catalog.jsonb_build_object('app_id',head.app_id,'tenant_id',head.tenant_id,
          'environment',head.environment),
        'skill_id',head.skill_id,'active_revision',head.active_revision,
        'active_revision_hash',head.active_revision_hash,'lifecycle',head.lifecycle,
        'signer_revocation_version',head.signer_revocation_version,
        'version',head.version,'updated_at',head.updated_at
      )) order by head.skill_id),'[]'::jsonb)
    into result from app_data_agent.skill_heads head join app_data_agent.skill_revisions revision
      on revision.app_id=head.app_id and revision.tenant_id=head.tenant_id
      and revision.environment=head.environment and revision.skill_id=head.skill_id
      and revision.revision=head.active_revision and revision.revision_hash=head.active_revision_hash
    where head.app_id=authority.app_id and head.tenant_id=authority.tenant_id
      and head.environment=authority.environment
      and (not enabled_only or (head.lifecycle='ENABLED' and revision.approval_status='APPROVED'
        and not exists(select 1 from app_data_agent.skill_signer_revocations revocation
          where revocation.app_id=head.app_id and revocation.tenant_id=head.tenant_id
            and revocation.environment=head.environment and revocation.signer_id=revision.signer_id)));
  end if;
  return pg_catalog.jsonb_build_object('schema_version','extension-list@1.0.0',
    'kind',requested_kind,'items',result);
end
$function$;

create function app_data_agent.revoke_skill_signer(command jsonb)
returns jsonb language plpgsql volatile security definer set search_path='' as $function$
declare authority record; existing app_data_agent.extension_operation_receipts%rowtype;
  input_hash text; current_version bigint; next_version bigint; now_at timestamptz; result jsonb;
begin
  if not pg_catalog.pg_has_role(session_user,'data_agent_backend','USAGE') then
    raise exception using errcode='42501',message='DA_BACKEND_ROLE_REQUIRED'; end if;
  if command is null or not app_data_agent.resolved_context_exact_keys(command,array[
    'schema_version','operation_id','idempotency_key','signer_id','expected_revocation_version','reason_code'
  ]::text[]) or command->>'schema_version'<>'skill-signer-revoke@1.0.0'
    or command->>'reason_code' !~ '^[A-Z][A-Z0-9_]{0,127}$'
  then raise exception using errcode='22023',message='SKILL_SIGNER_REVOCATION_INVALID'; end if;
  select * into authority from platform.current_backend_authority(true);
  if pg_catalog.lower(authority.membership_role)<>'owner' then
    raise exception using errcode='42501',message='EXTENSION_MANAGE_REQUIRED'; end if;
  input_hash:=app_data_agent.u2_canonical_sha256(command);
  select receipt.* into existing from app_data_agent.extension_operation_receipts receipt
  where receipt.app_id=authority.app_id and receipt.tenant_id=authority.tenant_id
    and receipt.environment=authority.environment and receipt.actor_principal_id=authority.principal_id
    and receipt.idempotency_key=command->>'idempotency_key' for share;
  if found then
    if existing.input_hash<>input_hash then
      raise exception using errcode='23505',message='EXTENSION_OPERATION_CONFLICT'; end if;
    return existing.result_json||pg_catalog.jsonb_build_object('disposition','REPLAYED');
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    authority.app_id::text||':'||authority.tenant_id::text||':'||authority.environment||
    ':SIGNER:'||(command->>'signer_id'),0));
  select coalesce(pg_catalog.max(revocation.revocation_version),0) into current_version
  from app_data_agent.skill_signer_revocations revocation
  where revocation.app_id=authority.app_id and revocation.tenant_id=authority.tenant_id
    and revocation.environment=authority.environment and revocation.signer_id=(command->>'signer_id')::uuid;
  if current_version<>(command->>'expected_revocation_version')::bigint then
    raise exception using errcode='40001',message='SKILL_SIGNER_REVOCATION_VERSION_CONFLICT'; end if;
  next_version:=current_version+1; now_at:=pg_catalog.clock_timestamp();
  insert into app_data_agent.skill_signer_revocations(app_id,tenant_id,environment,signer_id,
    revocation_version,reason_code,revoked_by,revoked_at)
  values(authority.app_id,authority.tenant_id,authority.environment,(command->>'signer_id')::uuid,
    next_version,command->>'reason_code',authority.principal_id,now_at);
  update app_data_agent.skill_heads head set lifecycle='REVOKED',
    signer_revocation_version=next_version,version=head.version+1,updated_by=authority.principal_id,updated_at=now_at
  from app_data_agent.skill_revisions revision
  where revision.app_id=head.app_id and revision.tenant_id=head.tenant_id
    and revision.environment=head.environment and revision.skill_id=head.skill_id
    and revision.revision=head.active_revision and revision.revision_hash=head.active_revision_hash
    and head.app_id=authority.app_id and head.tenant_id=authority.tenant_id
    and head.environment=authority.environment and revision.signer_id=(command->>'signer_id')::uuid;
  result:=pg_catalog.jsonb_build_object('schema_version','skill-signer-revoke-result@1.0.0',
    'disposition','REVOKED','signer_id',command->>'signer_id','revocation_version',next_version);
  insert into app_data_agent.extension_operation_receipts(app_id,tenant_id,environment,
    actor_principal_id,operation_id,idempotency_key,input_hash,result_json,committed_at)
  values(authority.app_id,authority.tenant_id,authority.environment,authority.principal_id,
    (command->>'operation_id')::uuid,command->>'idempotency_key',input_hash,result,now_at);
  return result;
exception when invalid_text_representation or numeric_value_out_of_range then
  raise exception using errcode='22023',message='SKILL_SIGNER_REVOCATION_INVALID';
end
$function$;
create function app_data_agent.resolve_extension_config_reference(
  requested_kind text, requested_id uuid, requested_revision bigint, expected_hash text
)
returns jsonb language plpgsql stable security definer set search_path='' as $function$
declare
  revision_hash_value text; approval_status_value text; lifecycle_value text;
  active_revision_value bigint; active_hash_value text; signer_revoked boolean:=false;
begin
  if requested_kind not in ('MCP_SERVER','SKILL') or requested_revision<1
    or (expected_hash is not null and expected_hash !~ '^sha256:[0-9a-f]{64}$')
  then raise exception using errcode='22023',message='EXTENSION_CONFIG_REFERENCE_INVALID'; end if;
  if requested_kind='MCP_SERVER' then
    select revision.revision_hash,revision.approval_status,head.lifecycle,
      head.active_revision,head.active_revision_hash
    into revision_hash_value,approval_status_value,lifecycle_value,
      active_revision_value,active_hash_value
    from app_data_agent.mcp_server_revisions revision
    left join app_data_agent.mcp_server_heads head on head.app_id=revision.app_id
      and head.tenant_id=revision.tenant_id and head.environment=revision.environment
      and head.server_id=revision.server_id
    where revision.app_id=pg_catalog.current_setting('data_agent.app_id')::uuid
      and revision.tenant_id=pg_catalog.current_setting('data_agent.tenant_id')::uuid
      and revision.environment=pg_catalog.current_setting('data_agent.environment')
      and revision.server_id=requested_id and revision.revision=requested_revision;
  else
    select revision.revision_hash,revision.approval_status,head.lifecycle,
      head.active_revision,head.active_revision_hash,
      exists(select 1 from app_data_agent.skill_signer_revocations revocation
        where revocation.app_id=revision.app_id and revocation.tenant_id=revision.tenant_id
          and revocation.environment=revision.environment and revocation.signer_id=revision.signer_id)
    into revision_hash_value,approval_status_value,lifecycle_value,
      active_revision_value,active_hash_value,signer_revoked
    from app_data_agent.skill_revisions revision
    left join app_data_agent.skill_heads head on head.app_id=revision.app_id
      and head.tenant_id=revision.tenant_id and head.environment=revision.environment
      and head.skill_id=revision.skill_id
    where revision.app_id=pg_catalog.current_setting('data_agent.app_id')::uuid
      and revision.tenant_id=pg_catalog.current_setting('data_agent.tenant_id')::uuid
      and revision.environment=pg_catalog.current_setting('data_agent.environment')
      and revision.skill_id=requested_id and revision.revision=requested_revision;
  end if;
  if not found then
    return pg_catalog.jsonb_build_object('effective_resource',null,'availability','UNAVAILABLE',
      'unavailable_reason','RESOURCE_NOT_FOUND_OR_FORBIDDEN');
  end if;
  if expected_hash is not null and expected_hash<>revision_hash_value then
    return pg_catalog.jsonb_build_object('effective_resource',null,'availability','UNAVAILABLE',
      'unavailable_reason','RESOURCE_REVISION_MISMATCH');
  end if;
  if lifecycle_value='REVOKED' or signer_revoked then
    return pg_catalog.jsonb_build_object('effective_resource',null,'availability','UNAVAILABLE',
      'unavailable_reason','RESOURCE_REVOKED');
  end if;
  if active_revision_value is null or active_revision_value<>requested_revision
    or active_hash_value<>revision_hash_value
  then
    return pg_catalog.jsonb_build_object('effective_resource',null,'availability','UNAVAILABLE',
      'unavailable_reason','RESOURCE_REVISION_MISMATCH');
  end if;
  if lifecycle_value<>'ENABLED' or approval_status_value<>'APPROVED' then
    return pg_catalog.jsonb_build_object('effective_resource',null,'availability','UNAVAILABLE',
      'unavailable_reason','RESOURCE_DISABLED');
  end if;
  return pg_catalog.jsonb_build_object(
    'effective_resource',pg_catalog.jsonb_build_object('resource_id',requested_id,
      'resource_revision',requested_revision,'resource_hash',revision_hash_value),
    'availability','AVAILABLE','unavailable_reason',null);
end
$function$;

create or replace function app_data_agent.build_requested_optional_resource_bindings(request jsonb)
returns jsonb language sql stable security definer set search_path='' as $function$
  with overridden as (
    select kind.resource_kind,'OVERRIDE'::text as source,null::jsonb as mention_id,item.document
    from (values ('files','FILE'),('knowledge','KNOWLEDGE'),
      ('mcp_servers','MCP_SERVER'),('skills','SKILL')) kind(selection_name,resource_kind)
    cross join lateral pg_catalog.jsonb_array_elements(case
      when request #>> array['overrides',kind.selection_name,'mode']='RESOURCE_IDS'
        then request #> array['overrides',kind.selection_name,'resources']
      else '[]'::jsonb end) item(document)
  ), mentioned as (
    select mention.document->>'resource_kind' as resource_kind,'MENTION'::text as source,
      mention.document->'mention_id' as mention_id,mention.document
    from pg_catalog.jsonb_array_elements(request->'mentions') mention(document)
  ), candidates as (select * from overridden union all select * from mentioned), bindings as (
    select pg_catalog.jsonb_build_object(
      'resource_kind',candidate.resource_kind,'mention_id',candidate.mention_id,
      'requested_resource_id',candidate.document->'resource_id',
      'requested_revision',(candidate.document->>'expected_revision')::bigint,
      'effective_resource',case when resolution.document is null then null
        else resolution.document->'effective_resource' end,
      'source',candidate.source,
      'availability',coalesce(resolution.document->>'availability','UNAVAILABLE'),
      'unavailable_reason',case when resolution.document is null then 'RESOURCE_NOT_FOUND_OR_FORBIDDEN'
        else resolution.document->>'unavailable_reason' end) document
    from candidates candidate
    left join lateral (select app_data_agent.resolve_extension_config_reference(
      candidate.resource_kind,(candidate.document->>'resource_id')::uuid,
      (candidate.document->>'expected_revision')::bigint,null) document
      where candidate.resource_kind in ('MCP_SERVER','SKILL')) resolution on true
  )
  select coalesce(pg_catalog.jsonb_agg(bindings.document order by
    bindings.document->>'resource_kind',bindings.document->>'requested_resource_id',
    bindings.document->>'source',bindings.document->>'mention_id'),'[]'::jsonb) from bindings;
$function$;

create or replace function app_data_agent.build_inherited_optional_resource_bindings(
  request jsonb,defaults_document jsonb
)
returns jsonb language sql stable security definer set search_path='' as $function$
  with inherited_kind as (
    select selection_name,resource_kind,
      case when pg_catalog.jsonb_typeof(defaults_document->selection_name)='array'
        then defaults_document->selection_name else '[]'::jsonb end references
    from (values ('files','FILE'),('knowledge','KNOWLEDGE'),
      ('mcp_servers','MCP_SERVER'),('skills','SKILL')) kind(selection_name,resource_kind)
    where request #>> array['overrides',selection_name,'mode']='INHERIT_DEFAULT'
  ), projected as (
    select kind.resource_kind,item.document reference from inherited_kind kind
    cross join lateral pg_catalog.jsonb_array_elements(kind.references) item(document)
  ), bindings as (
    select pg_catalog.jsonb_build_object(
      'resource_kind',projected.resource_kind,'mention_id',null,
      'requested_resource_id',projected.reference->'resource_id',
      'requested_revision',(projected.reference->>'resource_revision')::bigint,
      'effective_resource',case when resolution.document is null then null
        else resolution.document->'effective_resource' end,
      'source','DEFAULT','availability',coalesce(resolution.document->>'availability','UNAVAILABLE'),
      'unavailable_reason',case when resolution.document is null then 'RESOURCE_NOT_FOUND_OR_FORBIDDEN'
        else resolution.document->>'unavailable_reason' end) document
    from projected
    left join lateral (select app_data_agent.resolve_extension_config_reference(
      projected.resource_kind,(projected.reference->>'resource_id')::uuid,
      (projected.reference->>'resource_revision')::bigint,projected.reference->>'resource_hash') document
      where projected.resource_kind in ('MCP_SERVER','SKILL')) resolution on true
  )
  select coalesce(pg_catalog.jsonb_agg(bindings.document order by
    bindings.document->>'resource_kind',bindings.document->>'requested_resource_id'),'[]'::jsonb)
  from bindings;
$function$;
create table app_data_agent.tool_effects (
  app_id uuid not null,tenant_id uuid not null,environment text not null,effect_id uuid not null,
  run_id uuid not null,principal_id uuid not null,attempt_id uuid not null,worker_fence bigint not null check(worker_fence>0),
  task_capability_hash text not null,projection_receipt_ref jsonb not null,
  server_id uuid not null,server_revision bigint not null,server_revision_hash text not null,tool_id text not null,
  effect_semantics text not null check(effect_semantics in ('READ_ONLY','IDEMPOTENT_REQUEST','OUTCOME_STATUS_QUERY')),
  remote_idempotency_key text,request_payload_hash text not null,policy_revision bigint not null,
  intent_hash text not null,state text not null check(state in (
    'INTENT_COMMITTED','DISPATCH_MARKED','RESPONSE_OBSERVED','COMPLETED','FAILED','TOOL_OUTCOME_UNKNOWN')),
  dispatch_hash text,response_hash text,current_transition_id uuid,current_transition_hash text,
  version bigint not null default 1 check(version>0),created_at timestamptz not null,updated_at timestamptz not null,
  primary key(app_id,tenant_id,environment,effect_id),
  unique(app_id,tenant_id,environment,run_id,remote_idempotency_key),
  foreign key(app_id,tenant_id,environment,server_id,server_revision,server_revision_hash)
    references app_data_agent.mcp_server_revisions(app_id,tenant_id,environment,server_id,revision,revision_hash),
  foreign key(app_id,tenant_id,environment)
    references app_data_agent.workspaces(app_id,workspace_id,environment) on delete restrict,
  foreign key(app_id,tenant_id,environment,principal_id)
    references app_data_agent.memberships(app_id,tenant_id,environment,principal_id) on delete restrict,
  check((effect_semantics='IDEMPOTENT_REQUEST')=(remote_idempotency_key is not null)),
  check(intent_hash ~ '^sha256:[0-9a-f]{64}$' and request_payload_hash ~ '^sha256:[0-9a-f]{64}$'),
  check((state='INTENT_COMMITTED' and dispatch_hash is null and response_hash is null)
    or (state in ('DISPATCH_MARKED','TOOL_OUTCOME_UNKNOWN') and dispatch_hash is not null and response_hash is null)
    or (state in ('RESPONSE_OBSERVED','COMPLETED','FAILED') and dispatch_hash is not null and response_hash is not null))
);
create table app_data_agent.tool_effect_transitions (
  app_id uuid not null,tenant_id uuid not null,environment text not null,effect_id uuid not null,
  transition_id uuid not null,sequence bigint not null check(sequence>0),expected_state text not null,target_state text not null,
  transition_hash text not null,transition_json jsonb not null,committed_at timestamptz not null,
  primary key(app_id,tenant_id,environment,effect_id,transition_id),
  unique(app_id,tenant_id,environment,effect_id,sequence),
  foreign key(app_id,tenant_id,environment,effect_id)
    references app_data_agent.tool_effects(app_id,tenant_id,environment,effect_id) on delete restrict,
  check(transition_hash ~ '^sha256:[0-9a-f]{64}$'
    and transition_hash=app_data_agent.u2_canonical_sha256(transition_json-'transition_hash'))
);
create trigger tool_effect_transitions_immutable before update or delete on app_data_agent.tool_effect_transitions
for each row execute function app_data_agent.reject_extension_immutable_mutation();
alter table app_data_agent.tool_effects enable row level security;
alter table app_data_agent.tool_effects force row level security;
alter table app_data_agent.tool_effect_transitions enable row level security;
alter table app_data_agent.tool_effect_transitions force row level security;
create policy tool_effects_owner on app_data_agent.tool_effects for all to data_agent_u14_extension_owner
using(platform.backend_context_matches(app_id,tenant_id,environment,false))
with check(platform.backend_context_matches(app_id,tenant_id,environment,true));
create policy tool_effect_transitions_owner on app_data_agent.tool_effect_transitions for all to data_agent_u14_extension_owner
using(platform.backend_context_matches(app_id,tenant_id,environment,false))
with check(platform.backend_context_matches(app_id,tenant_id,environment,true));

create function app_data_agent.begin_tool_effect(intent jsonb)
returns jsonb language plpgsql volatile security definer set search_path='' as $function$
declare authority record; existing app_data_agent.tool_effects%rowtype; head_record app_data_agent.mcp_server_heads%rowtype;
  revision_record app_data_agent.mcp_server_revisions%rowtype; tool_document jsonb; now_at timestamptz;
begin
  if not pg_catalog.pg_has_role(session_user,'data_agent_backend','USAGE') then
    raise exception using errcode='42501',message='DA_BACKEND_ROLE_REQUIRED'; end if;
  if intent is null or intent->>'schema_version' is distinct from 'tool-effect-intent@1.0.0'
    or intent->>'intent_hash' is distinct from app_data_agent.u2_canonical_sha256(intent-'intent_hash')
  then raise exception using errcode='22023',message='TOOL_EFFECT_INTENT_INVALID'; end if;
  select * into authority from platform.current_backend_authority(true);
  if intent->'scope'<>pg_catalog.jsonb_build_object('app_id',authority.app_id,
    'tenant_id',authority.tenant_id,'environment',authority.environment)
    or intent#>>'{projection_receipt_ref,run_id}'<>intent->>'run_id'
    or intent#>'{projection_receipt_ref}' is null
  then raise exception using errcode='42501',message='TOOL_EFFECT_SCOPE_MISMATCH'; end if;
  if app_data_agent.lock_owned_run_fence((intent->>'run_id')::uuid)<>(intent->>'worker_fence')::bigint then
    raise exception using errcode='40001',message='TOOL_EFFECT_WORKER_FENCE_STALE'; end if;
  select * into head_record from app_data_agent.mcp_server_heads head
  where head.app_id=authority.app_id and head.tenant_id=authority.tenant_id
    and head.environment=authority.environment and head.server_id=(intent->>'server_id')::uuid
    and head.active_revision=(intent->>'server_revision')::bigint
    and head.active_revision_hash=intent->>'server_revision_hash' and head.lifecycle='ENABLED' for share;
  if not found then raise exception using errcode='40001',message='MCP_SERVER_REVISION_STALE'; end if;
  select * into revision_record from app_data_agent.mcp_server_revisions revision
  where revision.app_id=head_record.app_id and revision.tenant_id=head_record.tenant_id
    and revision.environment=head_record.environment and revision.server_id=head_record.server_id
    and revision.revision=head_record.active_revision and revision.revision_hash=head_record.active_revision_hash
    and revision.approval_status='APPROVED' for share;
  select candidate.value into tool_document from pg_catalog.jsonb_array_elements(revision_record.document_json->'tools') candidate(value)
  where candidate.value->>'tool_id'=intent->>'tool_id'
    and candidate.value->>'effect_semantics'=intent->>'effect_semantics';
  if tool_document is null then raise exception using errcode='42501',message='MCP_TOOL_NOT_AUTHORIZED'; end if;
  now_at:=pg_catalog.clock_timestamp();
  insert into app_data_agent.tool_effects(app_id,tenant_id,environment,effect_id,run_id,principal_id,
    attempt_id,worker_fence,task_capability_hash,projection_receipt_ref,server_id,server_revision,
    server_revision_hash,tool_id,effect_semantics,remote_idempotency_key,request_payload_hash,
    policy_revision,intent_hash,state,created_at,updated_at)
  values(authority.app_id,authority.tenant_id,authority.environment,(intent->>'effect_id')::uuid,
    (intent->>'run_id')::uuid,authority.principal_id,(intent->>'attempt_id')::uuid,
    (intent->>'worker_fence')::bigint,intent->>'task_capability_hash',intent->'projection_receipt_ref',
    (intent->>'server_id')::uuid,(intent->>'server_revision')::bigint,intent->>'server_revision_hash',
    intent->>'tool_id',intent->>'effect_semantics',intent->>'remote_idempotency_key',
    intent->>'request_payload_hash',(intent->>'policy_revision')::bigint,intent->>'intent_hash',
    'INTENT_COMMITTED',now_at,now_at) on conflict do nothing;
  select * into existing from app_data_agent.tool_effects effect where effect.app_id=authority.app_id
    and effect.tenant_id=authority.tenant_id and effect.environment=authority.environment
    and effect.effect_id=(intent->>'effect_id')::uuid for share;
  if existing.intent_hash<>intent->>'intent_hash' then
    raise exception using errcode='23505',message='TOOL_EFFECT_IDEMPOTENCY_CONFLICT'; end if;
  return pg_catalog.jsonb_build_object('schema_version','tool-effect-result@1.0.0','disposition',
    case when existing.created_at=now_at then 'CREATED' else 'REPLAYED' end,
    'effect_id',existing.effect_id,'state',existing.state,'version',existing.version,'intent_hash',existing.intent_hash);
end
$function$;

create function app_data_agent.transition_tool_effect(transition jsonb)
returns jsonb language plpgsql volatile security definer set search_path='' as $function$
declare authority record; effect app_data_agent.tool_effects%rowtype; now_at timestamptz; next_sequence bigint;
begin
  if not pg_catalog.pg_has_role(session_user,'data_agent_backend','USAGE') then
    raise exception using errcode='42501',message='DA_BACKEND_ROLE_REQUIRED'; end if;
  if transition is null or transition->>'schema_version' is distinct from 'tool-effect-transition@1.0.0'
    or transition->>'transition_hash' is distinct from app_data_agent.u2_canonical_sha256(transition-'transition_hash')
  then raise exception using errcode='22023',message='TOOL_EFFECT_TRANSITION_INVALID'; end if;
  select * into authority from platform.current_backend_authority(true);
  select * into effect from app_data_agent.tool_effects candidate where candidate.app_id=authority.app_id
    and candidate.tenant_id=authority.tenant_id and candidate.environment=authority.environment
    and candidate.effect_id=(transition->>'effect_id')::uuid for update;
  if not found or effect.principal_id<>authority.principal_id then
    raise exception using errcode='42501',message='TOOL_EFFECT_NOT_FOUND'; end if;
  if effect.state<>transition->>'expected_state' then
    if effect.current_transition_hash=transition->>'transition_hash' then
      return pg_catalog.jsonb_build_object('schema_version','tool-effect-result@1.0.0',
        'disposition','REPLAYED','effect_id',effect.effect_id,'state',effect.state,'version',effect.version,
        'intent_hash',effect.intent_hash); end if;
    raise exception using errcode='40001',message='TOOL_EFFECT_STATE_CONFLICT';
  end if;
  if app_data_agent.lock_owned_run_fence(effect.run_id)<>effect.worker_fence then
    raise exception using errcode='40001',message='TOOL_EFFECT_WORKER_FENCE_STALE'; end if;
  if not ((effect.state='INTENT_COMMITTED' and transition->>'target_state' in ('DISPATCH_MARKED','FAILED'))
    or (effect.state='DISPATCH_MARKED' and transition->>'target_state' in ('RESPONSE_OBSERVED','TOOL_OUTCOME_UNKNOWN'))
    or (effect.state='RESPONSE_OBSERVED' and transition->>'target_state' in ('COMPLETED','FAILED'))
    or (effect.state='TOOL_OUTCOME_UNKNOWN' and transition->>'target_state' in ('COMPLETED','FAILED')))
  then raise exception using errcode='23514',message='TOOL_EFFECT_TRANSITION_INVALID'; end if;
  if (effect.state='TOOL_OUTCOME_UNKNOWN')<>(transition->>'reconciliation_of' is not null) then
    raise exception using errcode='23514',message='TOOL_EFFECT_RECONCILIATION_REQUIRED'; end if;
  now_at:=pg_catalog.clock_timestamp(); next_sequence:=effect.version;
  update app_data_agent.tool_effects current_effect set state=transition->>'target_state',
    dispatch_hash=coalesce(transition->>'dispatch_hash',dispatch_hash),
    response_hash=coalesce(transition->>'response_hash',response_hash),
    current_transition_id=(transition->>'transition_id')::uuid,
    current_transition_hash=transition->>'transition_hash',version=version+1,updated_at=now_at
  where current_effect.app_id=effect.app_id and current_effect.tenant_id=effect.tenant_id
    and current_effect.environment=effect.environment and current_effect.effect_id=effect.effect_id;
  insert into app_data_agent.tool_effect_transitions(app_id,tenant_id,environment,effect_id,
    transition_id,sequence,expected_state,target_state,transition_hash,transition_json,committed_at)
  values(effect.app_id,effect.tenant_id,effect.environment,effect.effect_id,
    (transition->>'transition_id')::uuid,next_sequence,transition->>'expected_state',
    transition->>'target_state',transition->>'transition_hash',transition,now_at);
  return pg_catalog.jsonb_build_object('schema_version','tool-effect-result@1.0.0','disposition','APPLIED',
    'effect_id',effect.effect_id,'state',transition->>'target_state','version',effect.version+1,
    'intent_hash',effect.intent_hash);
end
$function$;
alter table app_data_agent.mcp_server_revisions owner to data_agent_u14_extension_owner;
alter table app_data_agent.mcp_server_heads owner to data_agent_u14_extension_owner;
alter table app_data_agent.skill_revisions owner to data_agent_u14_extension_owner;
alter table app_data_agent.skill_heads owner to data_agent_u14_extension_owner;
alter table app_data_agent.skill_signer_revocations owner to data_agent_u14_extension_owner;
alter table app_data_agent.extension_operation_receipts owner to data_agent_u14_extension_owner;
alter table app_data_agent.tool_effects owner to data_agent_u14_extension_owner;
alter table app_data_agent.tool_effect_transitions owner to data_agent_u14_extension_owner;
alter function app_data_agent.reject_extension_immutable_mutation() owner to data_agent_u14_extension_owner;
alter function app_data_agent.commit_extension_revision(jsonb) owner to data_agent_u14_extension_owner;
alter function app_data_agent.list_extension_revisions(text,boolean) owner to data_agent_u14_extension_owner;
alter function app_data_agent.revoke_skill_signer(jsonb) owner to data_agent_u14_extension_owner;
alter function app_data_agent.resolve_extension_config_reference(text,uuid,bigint,text)
  owner to data_agent_u14_extension_owner;
alter function app_data_agent.build_requested_optional_resource_bindings(jsonb)
  owner to data_agent_u14_extension_owner;
alter function app_data_agent.build_inherited_optional_resource_bindings(jsonb,jsonb)
  owner to data_agent_u14_extension_owner;
alter function app_data_agent.begin_tool_effect(jsonb) owner to data_agent_u14_extension_owner;
alter function app_data_agent.transition_tool_effect(jsonb) owner to data_agent_u14_extension_owner;
grant usage on schema app_data_agent,platform to data_agent_u14_extension_owner;
grant execute on function platform.current_backend_authority(boolean),
  platform.backend_context_matches(uuid,uuid,text,boolean),app_data_agent.u2_canonical_sha256(jsonb),
  app_data_agent.resolved_context_exact_keys(jsonb,text[]) to data_agent_u14_extension_owner;
grant execute on function app_data_agent.lock_owned_run_fence(uuid) to data_agent_u14_extension_owner;
grant execute on function app_data_agent.resolve_extension_config_reference(text,uuid,bigint,text)
  to data_agent_u14_extension_owner;
revoke all on app_data_agent.mcp_server_revisions,app_data_agent.mcp_server_heads,
  app_data_agent.skill_revisions,app_data_agent.skill_heads,app_data_agent.skill_signer_revocations,
  app_data_agent.extension_operation_receipts from public,anon,authenticated,service_role,data_agent_backend;
revoke all on app_data_agent.tool_effects,app_data_agent.tool_effect_transitions
  from public,anon,authenticated,service_role,data_agent_backend;
revoke all on function app_data_agent.commit_extension_revision(jsonb),
  app_data_agent.list_extension_revisions(text,boolean)
  ,app_data_agent.revoke_skill_signer(jsonb),app_data_agent.begin_tool_effect(jsonb),
  app_data_agent.transition_tool_effect(jsonb),
  app_data_agent.resolve_extension_config_reference(text,uuid,bigint,text),
  app_data_agent.build_requested_optional_resource_bindings(jsonb),
  app_data_agent.build_inherited_optional_resource_bindings(jsonb,jsonb)
  from public,anon,authenticated,service_role,data_agent_backend;
grant execute on function app_data_agent.build_requested_optional_resource_bindings(jsonb),
  app_data_agent.build_inherited_optional_resource_bindings(jsonb,jsonb)
  to data_agent_effective_config_rpc_owner;
grant execute on function app_data_agent.commit_extension_revision(jsonb),
  app_data_agent.list_extension_revisions(text,boolean),app_data_agent.revoke_skill_signer(jsonb)
  to data_agent_backend;
grant execute on function app_data_agent.begin_tool_effect(jsonb),
  app_data_agent.transition_tool_effect(jsonb) to data_agent_backend;

do $postconditions$
begin
  if exists(select 1 from pg_catalog.pg_class relation join pg_catalog.pg_namespace namespace
    on namespace.oid=relation.relnamespace where namespace.nspname='app_data_agent'
      and relation.relname in ('mcp_server_revisions','mcp_server_heads','skill_revisions','skill_heads',
        'skill_signer_revocations','extension_operation_receipts','tool_effects','tool_effect_transitions')
      and (not relation.relrowsecurity or not relation.relforcerowsecurity
        or relation.relowner<>(select oid from pg_catalog.pg_roles where rolname='data_agent_u14_extension_owner')))
  then raise exception using errcode='P0001',message='U14_EXTENSION_RLS_OR_OWNER_UNSAFE'; end if;
  if not exists(select 1 from pg_catalog.pg_roles where rolname='data_agent_u14_extension_owner'
    and not rolcanlogin and not rolsuper and not rolinherit and not rolbypassrls)
  then raise exception using errcode='P0001',message='U14_EXTENSION_OWNER_FLAGS_UNSAFE'; end if;
end
$postconditions$;
select platform.assert_migration_checksum(
  'app','00000000-0000-4000-8000-00000000da01'::uuid,
  '20260725010665_app_data_agent_extension_registry','sha256:85673af959d94737fc0893bda362960789607b9af29a321a2c46a7c38955ffae');
commit;
