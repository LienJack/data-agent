-- u20_agent_profile_migration_checksum: sha256:d917fcd4aa24928fcda7b83d8879a0a435a329d91331aa38d90c05a7949c9a9d
begin;

do $bootstrap$
begin
  if pg_catalog.current_setting('server_version_num')::integer not between 170000 and 179999 then
    raise exception using errcode='0A000',message='U20_AGENT_PROFILE_POSTGRES_VERSION_UNSUPPORTED';
  end if;
  if session_user<>'postgres' or current_user<>'postgres' then
    raise exception using errcode='42501',message='U20_AGENT_PROFILE_MIGRATION_EXECUTOR_UNSAFE';
  end if;
  if not exists(select 1 from platform.migration_ledger where owner_kind='app'
    and app_id='00000000-0000-4000-8000-00000000da01'::uuid
    and migration_version='20260725010666_app_data_agent_session_recovery')
  then raise exception using errcode='P0001',message='U20_AGENT_PROFILE_BASELINE_10666_MISSING'; end if;
  if not exists(select 1 from pg_catalog.pg_roles where rolname='data_agent_u20_profile_owner') then
    create role data_agent_u20_profile_owner nologin nosuperuser nocreatedb nocreaterole
      noinherit noreplication nobypassrls;
  end if;
end
$bootstrap$;

set local lock_timeout='2000ms';
set local statement_timeout='300000ms';
set local idle_in_transaction_session_timeout='60000ms';
select platform.acquire_migration_lock('app','00000000-0000-4000-8000-00000000da01'::uuid);
create table app_data_agent.agent_product_profile_revisions (
  app_id uuid not null,tenant_id uuid not null,environment text not null,
  profile_id text not null check(profile_id in (
    'governed-text2sql-agent','report-writing-agent','semantic-management-agent')),
  revision bigint not null check(revision>0),revision_hash text not null,
  approval_status text not null check(approval_status in ('APPROVED','QUARANTINED')),
  document_json jsonb not null,created_by uuid not null,created_at timestamptz not null,
  primary key(app_id,tenant_id,environment,profile_id,revision),
  unique(app_id,tenant_id,environment,profile_id,revision,revision_hash),
  check(revision_hash ~ '^sha256:[0-9a-f]{64}$'
    and revision_hash=app_data_agent.u2_canonical_sha256(document_json-'revision_hash')),
  check(document_json->>'schema_version'='agent-product-profile-revision@1.0.0'
    and document_json->>'profile_id'=profile_id
    and (document_json->>'revision')::bigint=revision
    and document_json->>'approval_status'=approval_status),
  foreign key(app_id,tenant_id,environment)
    references app_data_agent.workspaces(app_id,workspace_id,environment) on delete restrict,
  foreign key(app_id,tenant_id,environment,created_by)
    references app_data_agent.memberships(app_id,tenant_id,environment,principal_id) on delete restrict
);
create table app_data_agent.agent_product_profile_heads (
  app_id uuid not null,tenant_id uuid not null,environment text not null,profile_id text not null,
  active_revision bigint not null,active_revision_hash text not null,
  lifecycle text not null check(lifecycle in ('ENABLED','DISABLED','QUARANTINED','REVOKED')),
  version bigint not null check(version>0),updated_by uuid not null,updated_at timestamptz not null,
  primary key(app_id,tenant_id,environment,profile_id),
  foreign key(app_id,tenant_id,environment,profile_id,active_revision,active_revision_hash)
    references app_data_agent.agent_product_profile_revisions(
      app_id,tenant_id,environment,profile_id,revision,revision_hash),
  foreign key(app_id,tenant_id,environment)
    references app_data_agent.workspaces(app_id,workspace_id,environment) on delete restrict,
  foreign key(app_id,tenant_id,environment,updated_by)
    references app_data_agent.memberships(app_id,tenant_id,environment,principal_id) on delete restrict
);
create table app_data_agent.agent_product_profile_operation_receipts (
  app_id uuid not null,tenant_id uuid not null,environment text not null,actor_principal_id uuid not null,
  operation_id uuid not null,idempotency_key text not null,command_hash text not null,result_json jsonb not null,
  committed_at timestamptz not null,
  primary key(app_id,tenant_id,environment,operation_id),
  unique(app_id,tenant_id,environment,actor_principal_id,idempotency_key),
  check(command_hash ~ '^sha256:[0-9a-f]{64}$'),
  foreign key(app_id,tenant_id,environment)
    references app_data_agent.workspaces(app_id,workspace_id,environment) on delete restrict,
  foreign key(app_id,tenant_id,environment,actor_principal_id)
    references app_data_agent.memberships(app_id,tenant_id,environment,principal_id) on delete restrict
);

create function app_data_agent.reject_agent_profile_immutable_mutation()
returns trigger language plpgsql set search_path='' as $function$
begin raise exception using errcode='55000',message='AGENT_PROFILE_AUTHORITY_IMMUTABLE'; end
$function$;
create trigger agent_product_profile_revisions_immutable before update or delete
on app_data_agent.agent_product_profile_revisions for each row
execute function app_data_agent.reject_agent_profile_immutable_mutation();
create trigger agent_product_profile_operation_receipts_immutable before update or delete
on app_data_agent.agent_product_profile_operation_receipts for each row
execute function app_data_agent.reject_agent_profile_immutable_mutation();

alter table app_data_agent.agent_product_profile_revisions enable row level security;
alter table app_data_agent.agent_product_profile_revisions force row level security;
alter table app_data_agent.agent_product_profile_heads enable row level security;
alter table app_data_agent.agent_product_profile_heads force row level security;
alter table app_data_agent.agent_product_profile_operation_receipts enable row level security;
alter table app_data_agent.agent_product_profile_operation_receipts force row level security;
create policy agent_product_profile_revisions_owner on app_data_agent.agent_product_profile_revisions
for all to data_agent_u20_profile_owner
using(platform.backend_context_matches(app_id,tenant_id,environment,false))
with check(platform.backend_context_matches(app_id,tenant_id,environment,true));
create policy agent_product_profile_heads_owner on app_data_agent.agent_product_profile_heads
for all to data_agent_u20_profile_owner
using(platform.backend_context_matches(app_id,tenant_id,environment,false))
with check(platform.backend_context_matches(app_id,tenant_id,environment,true));
create policy agent_product_profile_receipts_owner on app_data_agent.agent_product_profile_operation_receipts
for all to data_agent_u20_profile_owner
using(platform.backend_context_matches(app_id,tenant_id,environment,false))
with check(platform.backend_context_matches(app_id,tenant_id,environment,true));

create policy skill_revisions_profile_owner_read on app_data_agent.skill_revisions
for select to data_agent_u20_profile_owner
using(platform.backend_context_matches(app_id,tenant_id,environment,false));
create policy skill_heads_profile_owner_read on app_data_agent.skill_heads
for select to data_agent_u20_profile_owner
using(platform.backend_context_matches(app_id,tenant_id,environment,false));
create policy skill_revocations_profile_owner_read on app_data_agent.skill_signer_revocations
for select to data_agent_u20_profile_owner
using(platform.backend_context_matches(app_id,tenant_id,environment,false));
create function app_data_agent.commit_agent_profile_revision(command jsonb)
returns jsonb language plpgsql volatile security definer set search_path='' as $function$
declare
  authority record; existing_receipt app_data_agent.agent_product_profile_operation_receipts%rowtype;
  existing_document jsonb; head_record app_data_agent.agent_product_profile_heads%rowtype;
  revision_document jsonb; profile_id_value text; revision_value bigint; revision_hash_value text;
  expected_version bigint; target_lifecycle_value text; now_at timestamptz; result_document jsonb;
  skill_ref jsonb; skill_valid boolean;
begin
  if not pg_catalog.pg_has_role(session_user,'data_agent_backend','USAGE') then
    raise exception using errcode='42501',message='DA_BACKEND_ROLE_REQUIRED'; end if;
  if command is null or not app_data_agent.resolved_context_exact_keys(command,array[
    'schema_version','operation_id','idempotency_key','actor_principal_id','revision',
    'expected_head_version','target_lifecycle','command_hash']::text[])
    or command->>'schema_version'<>'agent-product-profile-commit-command@1.0.0'
    or command->>'command_hash'<>app_data_agent.u2_canonical_sha256(command-'command_hash')
    or pg_catalog.length(command->>'idempotency_key') not between 8 and 128
  then raise exception using errcode='22023',message='AGENT_PROFILE_COMMAND_INVALID'; end if;
  select * into authority from platform.current_backend_authority(true);
  if pg_catalog.lower(authority.membership_role)<>'owner'
    or (command->>'actor_principal_id')::uuid<>authority.principal_id
  then raise exception using errcode='42501',message='AGENT_PROFILE_MANAGE_REQUIRED'; end if;
  revision_document:=command->'revision';
  if revision_document#>'{scope}'<>pg_catalog.jsonb_build_object(
    'app_id',authority.app_id,'tenant_id',authority.tenant_id,'environment',authority.environment)
  then raise exception using errcode='42501',message='AGENT_PROFILE_SCOPE_MISMATCH'; end if;
  profile_id_value:=revision_document->>'profile_id';
  revision_value:=(revision_document->>'revision')::bigint;
  revision_hash_value:=revision_document->>'revision_hash';
  expected_version:=(command->>'expected_head_version')::bigint;
  target_lifecycle_value:=command->>'target_lifecycle';
  if profile_id_value not in ('governed-text2sql-agent','report-writing-agent','semantic-management-agent')
    or revision_document->>'schema_version'<>'agent-product-profile-revision@1.0.0'
    or revision_document#>>'{runtime_profile_ref,profile_id}'<>profile_id_value
    or revision_hash_value<>app_data_agent.u2_canonical_sha256(revision_document-'revision_hash')
    or revision_document->>'approval_status' not in ('APPROVED','QUARANTINED')
    or target_lifecycle_value not in ('ENABLED','DISABLED','QUARANTINED')
    or (target_lifecycle_value='ENABLED' and revision_document->>'approval_status'<>'APPROVED')
    or pg_catalog.jsonb_array_length(revision_document->'skill_refs')<1
    or not exists(select 1 from app_data_agent.agent_profile_revisions runtime_profile
      where runtime_profile.profile_id=profile_id_value
        and runtime_profile.profile_revision=
          (revision_document#>>'{runtime_profile_ref,revision}')::integer
        and runtime_profile.profile_hash=revision_document#>>'{runtime_profile_ref,profile_hash}'
        and runtime_profile.profile_json->'direct_tool_allowlist'=
          revision_document->'direct_tool_allowlist'
        and runtime_profile.profile_json->'expected_output_artifact_types'=
          revision_document->'expected_output_artifact_types'
        and app_data_agent.u2_canonical_sha256(runtime_profile.profile_json->'verifier')=
          revision_document->>'verifier_contract_hash')
  then raise exception using errcode='23514',message='AGENT_PROFILE_REVISION_INVALID'; end if;
  for skill_ref in select value from pg_catalog.jsonb_array_elements(revision_document->'skill_refs') loop
    select exists(select 1 from app_data_agent.skill_revisions revision
      join app_data_agent.skill_heads head on head.app_id=revision.app_id
        and head.tenant_id=revision.tenant_id and head.environment=revision.environment
        and head.skill_id=revision.skill_id and head.active_revision=revision.revision
        and head.active_revision_hash=revision.revision_hash
      where revision.app_id=authority.app_id and revision.tenant_id=authority.tenant_id
        and revision.environment=authority.environment
        and revision.skill_id=(skill_ref->>'skill_id')::uuid
        and revision.revision=(skill_ref->>'revision')::bigint
        and revision.revision_hash=skill_ref->>'revision_hash'
        and revision.approval_status='APPROVED' and head.lifecycle='ENABLED'
        and not exists(select 1 from pg_catalog.jsonb_array_elements_text(
          revision.document_json->'capabilities') capability(value)
          where not (revision_document->'direct_tool_allowlist') ? capability.value)
        and not exists(select 1 from app_data_agent.skill_signer_revocations revocation
          where revocation.app_id=revision.app_id and revocation.tenant_id=revision.tenant_id
            and revocation.environment=revision.environment and revocation.signer_id=revision.signer_id))
    into skill_valid;
    if not skill_valid then
      raise exception using errcode='42501',message='AGENT_PROFILE_SKILL_NOT_AVAILABLE'; end if;
  end loop;
  select * into existing_receipt from app_data_agent.agent_product_profile_operation_receipts receipt
  where receipt.app_id=authority.app_id and receipt.tenant_id=authority.tenant_id
    and receipt.environment=authority.environment and receipt.actor_principal_id=authority.principal_id
    and receipt.idempotency_key=command->>'idempotency_key' for share;
  if found then
    if existing_receipt.command_hash<>command->>'command_hash' then
      raise exception using errcode='23505',message='AGENT_PROFILE_OPERATION_CONFLICT'; end if;
    return pg_catalog.jsonb_set(existing_receipt.result_json,'{disposition}','"REPLAYED"'::jsonb,false);
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    authority.app_id::text||':'||authority.tenant_id::text||':'||authority.environment||
    ':AGENT_PROFILE:'||profile_id_value,0));
  now_at:=pg_catalog.clock_timestamp();
  insert into app_data_agent.agent_product_profile_revisions(app_id,tenant_id,environment,
    profile_id,revision,revision_hash,approval_status,document_json,created_by,created_at)
  values(authority.app_id,authority.tenant_id,authority.environment,profile_id_value,revision_value,
    revision_hash_value,revision_document->>'approval_status',revision_document,authority.principal_id,now_at)
  on conflict do nothing;
  select document_json into existing_document from app_data_agent.agent_product_profile_revisions
  where app_id=authority.app_id and tenant_id=authority.tenant_id and environment=authority.environment
    and profile_id=profile_id_value and revision=revision_value;
  if existing_document<>revision_document then
    raise exception using errcode='23505',message='AGENT_PROFILE_REVISION_CONFLICT'; end if;
  select * into head_record from app_data_agent.agent_product_profile_heads head
  where head.app_id=authority.app_id and head.tenant_id=authority.tenant_id
    and head.environment=authority.environment and head.profile_id=profile_id_value for update;
  if (found and head_record.version<>expected_version) or (not found and expected_version<>0) then
    raise exception using errcode='40001',message='AGENT_PROFILE_HEAD_VERSION_CONFLICT'; end if;
  insert into app_data_agent.agent_product_profile_heads(app_id,tenant_id,environment,profile_id,
    active_revision,active_revision_hash,lifecycle,version,updated_by,updated_at)
  values(authority.app_id,authority.tenant_id,authority.environment,profile_id_value,revision_value,
    revision_hash_value,target_lifecycle_value,1,authority.principal_id,now_at)
  on conflict(app_id,tenant_id,environment,profile_id) do update set
    active_revision=excluded.active_revision,active_revision_hash=excluded.active_revision_hash,
    lifecycle=excluded.lifecycle,version=app_data_agent.agent_product_profile_heads.version+1,
    updated_by=excluded.updated_by,updated_at=excluded.updated_at;
  select * into head_record from app_data_agent.agent_product_profile_heads head
  where head.app_id=authority.app_id and head.tenant_id=authority.tenant_id
    and head.environment=authority.environment and head.profile_id=profile_id_value;
  result_document:=pg_catalog.jsonb_build_object(
    'schema_version','agent-product-profile-commit-result@1.0.0','disposition','COMMITTED',
    'operation_id',command->>'operation_id','command_hash',command->>'command_hash',
    'item',pg_catalog.jsonb_build_object(
      'schema_version','agent-product-profile-registry-item@1.0.0','revision',revision_document,
      'head',pg_catalog.jsonb_build_object(
        'schema_version','agent-product-profile-head@1.0.0',
        'scope',pg_catalog.jsonb_build_object('app_id',head_record.app_id,
          'tenant_id',head_record.tenant_id,'environment',head_record.environment),
        'profile_id',head_record.profile_id,'active_revision',head_record.active_revision,
        'active_revision_hash',head_record.active_revision_hash,'lifecycle',head_record.lifecycle,
        'version',head_record.version,'updated_at',head_record.updated_at)));
  insert into app_data_agent.agent_product_profile_operation_receipts(app_id,tenant_id,environment,
    actor_principal_id,operation_id,idempotency_key,command_hash,result_json,committed_at)
  values(authority.app_id,authority.tenant_id,authority.environment,authority.principal_id,
    (command->>'operation_id')::uuid,command->>'idempotency_key',command->>'command_hash',result_document,now_at);
  return result_document;
exception when invalid_text_representation or numeric_value_out_of_range then
  raise exception using errcode='22023',message='AGENT_PROFILE_COMMAND_INVALID';
end
$function$;

create function app_data_agent.list_agent_profile_revisions(enabled_only boolean)
returns jsonb language plpgsql stable security definer set search_path='' as $function$
declare authority record; items jsonb;
begin
  if not pg_catalog.pg_has_role(session_user,'data_agent_backend','USAGE') then
    raise exception using errcode='42501',message='DA_BACKEND_ROLE_REQUIRED'; end if;
  select * into authority from platform.current_backend_authority(false);
  select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
    'schema_version','agent-product-profile-registry-item@1.0.0','revision',revision.document_json,
    'head',pg_catalog.jsonb_build_object(
      'schema_version','agent-product-profile-head@1.0.0',
      'scope',pg_catalog.jsonb_build_object('app_id',head.app_id,'tenant_id',head.tenant_id,
        'environment',head.environment),'profile_id',head.profile_id,
      'active_revision',head.active_revision,'active_revision_hash',head.active_revision_hash,
      'lifecycle',head.lifecycle,'version',head.version,'updated_at',head.updated_at))
    order by head.profile_id),'[]'::jsonb) into items
  from app_data_agent.agent_product_profile_heads head
  join app_data_agent.agent_product_profile_revisions revision
    on revision.app_id=head.app_id and revision.tenant_id=head.tenant_id
    and revision.environment=head.environment and revision.profile_id=head.profile_id
    and revision.revision=head.active_revision and revision.revision_hash=head.active_revision_hash
  where head.app_id=authority.app_id and head.tenant_id=authority.tenant_id
    and head.environment=authority.environment
    and (not enabled_only or (head.lifecycle='ENABLED' and revision.approval_status='APPROVED'
      and not exists(
        select 1 from pg_catalog.jsonb_array_elements(revision.document_json->'skill_refs') skill_ref(document)
        where not exists(
          select 1 from app_data_agent.skill_revisions skill
          join app_data_agent.skill_heads skill_head on skill_head.app_id=skill.app_id
            and skill_head.tenant_id=skill.tenant_id and skill_head.environment=skill.environment
            and skill_head.skill_id=skill.skill_id and skill_head.active_revision=skill.revision
            and skill_head.active_revision_hash=skill.revision_hash
          where skill.app_id=revision.app_id and skill.tenant_id=revision.tenant_id
            and skill.environment=revision.environment
            and skill.skill_id=(skill_ref.document->>'skill_id')::uuid
            and skill.revision=(skill_ref.document->>'revision')::bigint
            and skill.revision_hash=skill_ref.document->>'revision_hash'
            and skill.approval_status='APPROVED' and skill_head.lifecycle='ENABLED'
            and not exists(select 1 from app_data_agent.skill_signer_revocations revocation
              where revocation.app_id=skill.app_id and revocation.tenant_id=skill.tenant_id
                and revocation.environment=skill.environment and revocation.signer_id=skill.signer_id)))));
  return pg_catalog.jsonb_build_object('schema_version','agent-product-profile-list-result@1.0.0',
    'items',items);
end
$function$;
create or replace function app_data_agent.command_payload_is_valid(requested_payload jsonb)
returns boolean language plpgsql immutable set search_path='' as $function$
declare item jsonb; payload_kind text; expected_profiles text[]:=array[
  'governed-text2sql-agent','report-writing-agent','semantic-management-agent']; profile_index integer:=1;
begin
  if requested_payload is null or pg_catalog.jsonb_typeof(requested_payload)<>'object'
    or app_data_agent.contains_potential_plaintext_secret(requested_payload) then return false; end if;
  if requested_payload ?& array['kind','effective_config_ref']
    and (select pg_catalog.count(*)=2 from pg_catalog.jsonb_object_keys(requested_payload))
    and requested_payload->>'kind'='START_L2_RESEARCH'
    and pg_catalog.jsonb_typeof(requested_payload->'effective_config_ref')='object'
    and (requested_payload->'effective_config_ref') ?& array['config_id','config_revision','config_hash']
    and (select pg_catalog.count(*)=3 from pg_catalog.jsonb_object_keys(
      requested_payload->'effective_config_ref'))
    and app_data_agent.canonical_uuid_json_string_is_valid(
      requested_payload#>'{effective_config_ref,config_id}')
    and requested_payload#>>'{effective_config_ref,config_revision}' ~ '^[1-9][0-9]*$'
    and requested_payload#>>'{effective_config_ref,config_hash}' ~ '^sha256:[0-9a-f]{64}$'
  then return true; end if;
  if requested_payload ?& array['kind','effective_config_ref','profile_refs']
    and (select pg_catalog.count(*)=3 from pg_catalog.jsonb_object_keys(requested_payload))
    and requested_payload->>'kind'='START_DATA_AGENT_TEAM'
    and pg_catalog.jsonb_typeof(requested_payload->'effective_config_ref')='object'
    and (requested_payload->'effective_config_ref') ?& array['config_id','config_revision','config_hash']
    and (select pg_catalog.count(*)=3 from pg_catalog.jsonb_object_keys(
      requested_payload->'effective_config_ref'))
    and app_data_agent.canonical_uuid_json_string_is_valid(
      requested_payload#>'{effective_config_ref,config_id}')
    and requested_payload#>>'{effective_config_ref,config_revision}' ~ '^[1-9][0-9]*$'
    and requested_payload#>>'{effective_config_ref,config_hash}' ~ '^sha256:[0-9a-f]{64}$'
    and pg_catalog.jsonb_typeof(requested_payload->'profile_refs')='array'
    and pg_catalog.jsonb_array_length(requested_payload->'profile_refs')=3
  then
    for item in select value from pg_catalog.jsonb_array_elements(requested_payload->'profile_refs') loop
      if (select pg_catalog.count(*)<>3 from pg_catalog.jsonb_object_keys(item))
        or not item ?& array['profile_id','revision','revision_hash']
        or item->>'profile_id'<>expected_profiles[profile_index]
        or item->>'revision' !~ '^[1-9][0-9]*$'
        or item->>'revision_hash' !~ '^sha256:[0-9a-f]{64}$'
      then return false; end if;
      profile_index:=profile_index+1;
    end loop;
    return true;
  end if;
  payload_kind:=requested_payload->>'kind';
  if payload_kind not in ('START_L2_RESEARCH','START_QA_ANALYSIS') then return false; end if;
  if exists(select 1 from pg_catalog.jsonb_object_keys(requested_payload) payload_key(key)
    where payload_key.key not in ('kind','mode','question_version','dataset_id','secret_refs',
      'datasource_id','conversation_id','message_id','model_profile_id','model_config_version',
      'provider','model_id','datasource_binding_hash')) then return false; end if;
  if payload_kind='START_QA_ANALYSIS' and not (requested_payload ?& array[
    'datasource_id','conversation_id','message_id','model_profile_id','model_config_version',
    'provider','model_id','datasource_binding_hash']) then return false; end if;
  if requested_payload ? 'mode' and requested_payload->>'mode'<>'L2' then return false; end if;
  if requested_payload ? 'secret_refs' then
    if pg_catalog.jsonb_typeof(requested_payload->'secret_refs')<>'array'
      or pg_catalog.jsonb_array_length(requested_payload->'secret_refs') not between 1 and 32
    then return false; end if;
    for item in select value from pg_catalog.jsonb_array_elements(requested_payload->'secret_refs') loop
      if item#>>'{}' !~* '^secretref:[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      then return false; end if;
    end loop;
  end if;
  if requested_payload ? 'datasource_id' and requested_payload->>'datasource_id'
    !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  then return false; end if;
  if requested_payload ? 'conversation_id' and requested_payload->>'conversation_id'
    !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  then return false; end if;
  if requested_payload ? 'message_id' and requested_payload->>'message_id'
    !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  then return false; end if;
  if requested_payload ? 'model_profile_id' and requested_payload->>'model_profile_id'
    !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  then return false; end if;
  if requested_payload ? 'model_config_version'
    and requested_payload->>'model_config_version' !~ '^[1-9][0-9]*$' then return false; end if;
  if requested_payload ? 'provider' and requested_payload->>'provider'
    not in ('openai','anthropic','deepseek','glm','kimi','grok','gemini') then return false; end if;
  if requested_payload ? 'model_id'
    and pg_catalog.length(requested_payload->>'model_id') not between 1 and 256 then return false; end if;
  if requested_payload ? 'datasource_binding_hash'
    and requested_payload->>'datasource_binding_hash' !~ '^sha256:[0-9a-f]{64}$' then return false; end if;
  return true;
end
$function$;

create function app_data_agent.current_agent_product_profile_refs()
returns jsonb language plpgsql stable security definer set search_path='' as $function$
declare refs jsonb;
begin
  select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
    'profile_id',head.profile_id,'revision',head.active_revision,
    'revision_hash',head.active_revision_hash) order by head.profile_id) into refs
  from app_data_agent.agent_product_profile_heads head
  join app_data_agent.agent_product_profile_revisions revision
    on revision.app_id=head.app_id and revision.tenant_id=head.tenant_id
    and revision.environment=head.environment and revision.profile_id=head.profile_id
    and revision.revision=head.active_revision and revision.revision_hash=head.active_revision_hash
  where head.app_id=pg_catalog.current_setting('data_agent.app_id')::uuid
    and head.tenant_id=pg_catalog.current_setting('data_agent.tenant_id')::uuid
    and head.environment=pg_catalog.current_setting('data_agent.environment')
    and head.lifecycle='ENABLED' and revision.approval_status='APPROVED';
  if pg_catalog.jsonb_array_length(coalesce(refs,'[]'::jsonb))<>3
    or refs#>>'{0,profile_id}'<>'governed-text2sql-agent'
    or refs#>>'{1,profile_id}'<>'report-writing-agent'
    or refs#>>'{2,profile_id}'<>'semantic-management-agent'
  then return null; end if;
  return refs;
end
$function$;

create function app_data_agent.route_question_run_to_agent_team()
returns trigger language plpgsql volatile security definer set search_path='' as $function$
declare profile_refs jsonb;
begin
  if new.payload_json->>'kind'='START_L2_RESEARCH'
    and new.payload_json ?& array['kind','effective_config_ref']
    and (select pg_catalog.count(*)=2 from pg_catalog.jsonb_object_keys(new.payload_json))
  then
    profile_refs:=app_data_agent.current_agent_product_profile_refs();
    if profile_refs is null then return new; end if;
    new.payload_json:=pg_catalog.jsonb_build_object(
      'kind','START_DATA_AGENT_TEAM','effective_config_ref',new.payload_json->'effective_config_ref',
      'profile_refs',profile_refs);
    new.payload_hash:=platform.canonical_sha256(new.payload_json);
  end if;
  return new;
end
$function$;

create trigger commands_route_question_run_to_agent_team
before insert on app_data_agent.commands for each row
execute function app_data_agent.route_question_run_to_agent_team();

alter function app_data_agent.assert_provider_active_worker_lease(jsonb)
rename to assert_provider_active_worker_lease_pre_u20;

create function app_data_agent.assert_provider_active_worker_lease(requested_lease jsonb)
returns jsonb language plpgsql volatile security definer set search_path='' as $function$
declare legacy_lease jsonb;
begin
  if requested_lease->>'command_kind'='START_DATA_AGENT_TEAM' then
    if not app_data_agent.provider_json_object_has_exact_keys(requested_lease,array[
        'scope','principal_id','outbox_id','run_id','command_id','command_kind','attempt_id',
        'attempt_no','delivery_attempt_no','lease_duration_ms','worker_id','lease_token',
        'worker_fence','expires_at','payload']::text[])
      or requested_lease#>>'{payload,kind}'<>'START_DATA_AGENT_TEAM'
      or not app_data_agent.command_payload_is_valid(requested_lease->'payload')
    then raise exception using errcode='22023',message='PROVIDER_WORKER_LEASE_INVALID'; end if;
    legacy_lease:=pg_catalog.jsonb_set(requested_lease,'{command_kind}',
      '"START_L2_RESEARCH"'::jsonb,false);
    legacy_lease:=pg_catalog.jsonb_set(legacy_lease,'{payload}',pg_catalog.jsonb_build_object(
      'kind','START_L2_RESEARCH',
      'effective_config_ref',requested_lease#>'{payload,effective_config_ref}'),false);
    return app_data_agent.assert_provider_active_worker_lease_pre_u20(legacy_lease);
  end if;
  return app_data_agent.assert_provider_active_worker_lease_pre_u20(requested_lease);
end
$function$;

create or replace function app_data_agent.claim_run_work(
  requested_worker_id text,
  requested_limit integer default 1,
  requested_lease_seconds integer default 60
)
returns table (
  outbox_id uuid,
  run_id uuid,
  command_id uuid,
  topic text,
  command_kind text,
  payload jsonb,
  attempt_id uuid,
  attempt_no integer,
  delivery_attempt_no integer,
  lease_duration_ms integer,
  worker_id text,
  lease_token bigint,
  worker_fence bigint,
  expires_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_authority record;
  candidate record;
  claimed_at timestamptz;
  next_attempt_id uuid;
  next_attempt_no integer;
  next_lease_token bigint;
  next_worker_fence bigint;
  next_expires_at timestamptz;
  budget_projection app_data_agent.run_projections%rowtype;
  budget_projection_document jsonb;
  budget_projection_hash text;
  budget_event_id uuid;
  budget_event jsonb;
  budget_event_hash text;
  claimed_count integer := 0;
  cleanup_count integer := 0;
begin
  if requested_worker_id is null
    or requested_worker_id !~ '^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,127}$'
    or app_data_agent.contains_potential_plaintext_secret(
      pg_catalog.to_jsonb(requested_worker_id),
      'worker_id'
    )
  then
    raise exception using
      errcode = '22023',
      message = 'DA_RUN_WORKER_INVALID';
  end if;
  if requested_limit is null or requested_limit not between 1 and 100 then
    raise exception using
      errcode = '22023',
      message = 'DA_RUN_WORK_LIMIT_INVALID';
  end if;
  if requested_lease_seconds is null
    or requested_lease_seconds not between 5 and 900
  then
    raise exception using
      errcode = '22023',
      message = 'DA_RUN_WORK_LEASE_INVALID';
  end if;

  select *
  into current_authority
  from platform.current_backend_authority(true);

  -- Give expired fifth-attempt settlement and ordinary leases independent
  -- per-call budgets. Exhausted heads are settled first, then requested_limit
  -- ordinary rows can still be returned from the same invocation.
  while claimed_count < requested_limit loop
    claimed_at := pg_catalog.clock_timestamp();
    select
      message.*,
      run.status as run_status,
      run.active_fence,
      run.principal_id,
      command.payload_json as command_payload,
      command.payload_json ->> 'kind' as resolved_command_kind,
      active_attempt.attempt_no as active_attempt_no
    into candidate
    from app_data_agent.outbox as message
    join app_data_agent.runs as run
      on run.app_id = message.app_id
     and run.tenant_id = message.tenant_id
     and run.environment = message.environment
     and run.run_id = message.run_id
    join lateral (
      select queued_command.payload_json
      from app_data_agent.commands as queued_command
      where queued_command.app_id = message.app_id
        and queued_command.tenant_id = message.tenant_id
        and queued_command.environment = message.environment
        and queued_command.command_id = message.command_id
        and queued_command.run_id = message.run_id
        and queued_command.payload_json ->> 'kind' in (
          'START_DATA_AGENT_TEAM',
          'START_L2_RESEARCH',
          'RESUME_RUN'
        )
      limit 1
    ) as command on true
    left join lateral (
      select true as blocked
      from app_data_agent.outbox as earlier_message
      join lateral (
        select 1
        from app_data_agent.commands as earlier_command
        where earlier_command.app_id = earlier_message.app_id
          and earlier_command.tenant_id = earlier_message.tenant_id
          and earlier_command.environment = earlier_message.environment
          and earlier_command.command_id = earlier_message.command_id
          and earlier_command.run_id = earlier_message.run_id
          and earlier_command.payload_json ->> 'kind' in (
            'START_DATA_AGENT_TEAM',
          'START_L2_RESEARCH',
          'RESUME_RUN'
          )
        limit 1
      ) as earlier_command on true
      where earlier_message.app_id = message.app_id
        and earlier_message.tenant_id = message.tenant_id
        and earlier_message.environment = message.environment
        and earlier_message.run_id = message.run_id
        and earlier_message.topic in (
          'run.command.accepted',
          'run.work.resume'
        )
        and earlier_message.status in ('PENDING', 'FAILED', 'LEASED')
        and earlier_message.queue_sequence < message.queue_sequence
      limit 1
    ) as earlier on true
    left join lateral (
      select attempt.attempt_no
      from app_data_agent.run_attempts as attempt
      where attempt.app_id = message.app_id
        and attempt.tenant_id = message.tenant_id
        and attempt.environment = message.environment
        and attempt.run_id = message.run_id
        and attempt.outbox_id = message.outbox_id
        and attempt.command_id = message.command_id
        and attempt.attempt_id = message.active_attempt_id
      limit 1
    ) as active_attempt on true
    where message.app_id = current_authority.app_id
      and message.tenant_id = current_authority.tenant_id
      and message.environment = current_authority.environment
      and message.topic in ('run.command.accepted', 'run.work.resume')
      and message.claimable_at <= claimed_at
      and cleanup_count < requested_limit
      and message.status = 'LEASED'
      and message.attempt_count >= 5
      and run.status = 'RUNNING'
      and message.lease_expires_at < claimed_at
      and run.principal_id = current_authority.principal_id
      and earlier.blocked is null
    order by
      message.claimable_at,
      message.created_at,
      message.outbox_id
    for update of message, run skip locked
    limit 1;

    if not found then
      select
        message.*,
        run.status as run_status,
        run.active_fence,
        run.principal_id,
        command.payload_json as command_payload,
        command.payload_json ->> 'kind' as resolved_command_kind,
        active_attempt.attempt_no as active_attempt_no
      into candidate
      from app_data_agent.outbox as message
      join app_data_agent.runs as run
        on run.app_id = message.app_id
       and run.tenant_id = message.tenant_id
       and run.environment = message.environment
       and run.run_id = message.run_id
      join lateral (
        select queued_command.payload_json
        from app_data_agent.commands as queued_command
        where queued_command.app_id = message.app_id
          and queued_command.tenant_id = message.tenant_id
          and queued_command.environment = message.environment
          and queued_command.command_id = message.command_id
          and queued_command.run_id = message.run_id
          and queued_command.payload_json ->> 'kind' in (
            'START_DATA_AGENT_TEAM',
          'START_L2_RESEARCH',
          'RESUME_RUN'
          )
        limit 1
      ) as command on true
      left join lateral (
        select true as blocked
        from app_data_agent.outbox as earlier_message
        join lateral (
          select 1
          from app_data_agent.commands as earlier_command
          where earlier_command.app_id = earlier_message.app_id
            and earlier_command.tenant_id = earlier_message.tenant_id
            and earlier_command.environment = earlier_message.environment
            and earlier_command.command_id = earlier_message.command_id
            and earlier_command.run_id = earlier_message.run_id
            and earlier_command.payload_json ->> 'kind' in (
              'START_DATA_AGENT_TEAM',
          'START_L2_RESEARCH',
          'RESUME_RUN'
            )
          limit 1
        ) as earlier_command on true
        where earlier_message.app_id = message.app_id
          and earlier_message.tenant_id = message.tenant_id
          and earlier_message.environment = message.environment
          and earlier_message.run_id = message.run_id
          and earlier_message.topic in (
            'run.command.accepted',
            'run.work.resume'
          )
          and earlier_message.status in ('PENDING', 'FAILED', 'LEASED')
          and earlier_message.queue_sequence < message.queue_sequence
        limit 1
      ) as earlier on true
      left join lateral (
        select attempt.attempt_no
        from app_data_agent.run_attempts as attempt
        where attempt.app_id = message.app_id
          and attempt.tenant_id = message.tenant_id
          and attempt.environment = message.environment
          and attempt.run_id = message.run_id
          and attempt.outbox_id = message.outbox_id
          and attempt.command_id = message.command_id
          and attempt.attempt_id = message.active_attempt_id
        limit 1
      ) as active_attempt on true
      where message.app_id = current_authority.app_id
        and message.tenant_id = current_authority.tenant_id
        and message.environment = current_authority.environment
        and message.topic in ('run.command.accepted', 'run.work.resume')
        and message.claimable_at <= claimed_at
        and (
          message.status in ('PENDING', 'FAILED')
          or (
            message.status = 'LEASED'
            and message.attempt_count < 5
          )
        )
        and run.principal_id = current_authority.principal_id
        and (
          (
            run.status = 'QUEUED'
            and message.status in ('PENDING', 'FAILED')
          )
          or (
            run.status = 'RUNNING'
            and message.status = 'LEASED'
            and message.lease_expires_at < claimed_at
          )
        )
        and earlier.blocked is null
      order by
        message.claimable_at,
        message.created_at,
        message.outbox_id
      for update of message, run skip locked
      limit 1;
    end if;

    exit when not found;
    if candidate.status = 'LEASED'
      and candidate.attempt_count >= 5
      and candidate.active_attempt_id is not null
    then
      select projection.*
      into budget_projection
      from app_data_agent.run_projections as projection
      where projection.app_id = candidate.app_id
        and projection.tenant_id = candidate.tenant_id
        and projection.environment = candidate.environment
        and projection.run_id = candidate.run_id
      order by projection.version desc
      limit 1
      for update;
      if not found
        or budget_projection.status not in ('QUEUED', 'RUNNING')
        or budget_projection.projection_json ->> 'terminal_event_id' is not null
      then
        raise exception using
          errcode = '40001',
          message = 'DA_RUN_ATTEMPT_BUDGET_PROJECTION_CONFLICT';
      end if;

      budget_projection_document := budget_projection.projection_json;
      if budget_projection.worker_fence <> candidate.active_fence
        or budget_projection.status <> 'RUNNING'
      then
        budget_event_id := pg_catalog.gen_random_uuid();
        budget_event := pg_catalog.jsonb_build_object(
          'schema_version',
          '1.0.0',
          'event_id',
          budget_event_id,
          'scope',
          pg_catalog.jsonb_build_object(
            'app_id',
            candidate.app_id,
            'tenant_id',
            candidate.tenant_id,
            'environment',
            candidate.environment
          ),
          'run_id',
          candidate.run_id,
          'sequence',
          budget_projection.version + 1,
          'worker_fence',
          candidate.active_fence,
          'idempotency_key',
          'attempt-budget-lease:' || candidate.active_attempt_id::text,
          'occurred_at',
          app_data_agent.runtime_iso_timestamp(claimed_at),
          'event_type',
          'run.leased',
          'payload',
          pg_catalog.jsonb_build_object(
            'command_id',
            candidate.command_id,
            'lease_id',
            candidate.active_attempt_id::text,
            'worker_id',
            candidate.lease_owner,
            'attempt',
            candidate.active_attempt_no
          )
        );
        budget_event_hash :=
          app_data_agent.runtime_canonical_sha256(budget_event);
        budget_projection_document :=
          app_data_agent.reduce_run_projection_document(
            budget_projection_document,
            budget_event
          );
        budget_projection_hash :=
          app_data_agent.runtime_canonical_sha256(
            budget_projection_document
          );

        insert into app_data_agent.run_events (
          app_id,
          tenant_id,
          environment,
          event_id,
          run_id,
          sequence,
          event_type,
          payload_json,
          attempt_id,
          command_id,
          dedupe_key,
          event_hash,
          worker_fence,
          event_document,
          created_at
        )
        values (
          candidate.app_id,
          candidate.tenant_id,
          candidate.environment,
          budget_event_id,
          candidate.run_id,
          budget_projection.version + 1,
          'run.leased',
          budget_event -> 'payload',
          candidate.active_attempt_id,
          candidate.command_id,
          budget_event ->> 'idempotency_key',
          budget_event_hash,
          candidate.active_fence,
          budget_event,
          claimed_at
        );

        insert into app_data_agent.run_projections (
          app_id,
          tenant_id,
          environment,
          run_id,
          version,
          status,
          worker_fence,
          event_id,
          projection_hash,
          projection_json,
          occurred_at
        )
        values (
          candidate.app_id,
          candidate.tenant_id,
          candidate.environment,
          candidate.run_id,
          budget_projection.version + 1,
          'RUNNING',
          candidate.active_fence,
          budget_event_id,
          budget_projection_hash,
          budget_projection_document,
          claimed_at
        );
      end if;

      budget_event_id := pg_catalog.gen_random_uuid();
      budget_event := pg_catalog.jsonb_build_object(
        'schema_version',
        '1.0.0',
        'event_id',
        budget_event_id,
        'scope',
        pg_catalog.jsonb_build_object(
          'app_id',
          candidate.app_id,
          'tenant_id',
          candidate.tenant_id,
          'environment',
          candidate.environment
        ),
        'run_id',
        candidate.run_id,
        'sequence',
        (budget_projection_document ->> 'version')::bigint + 1,
        'worker_fence',
        candidate.active_fence,
        'idempotency_key',
        'attempt-budget-failed:' || candidate.outbox_id::text,
        'occurred_at',
        app_data_agent.runtime_iso_timestamp(claimed_at),
        'event_type',
        'run.failed',
        'payload',
        pg_catalog.jsonb_build_object(
          'error_code',
          'RUN_ATTEMPT_BUDGET_EXHAUSTED',
          'retryable',
          false
        )
      );
      budget_event_hash :=
        app_data_agent.runtime_canonical_sha256(budget_event);
      budget_projection_document :=
        app_data_agent.reduce_run_projection_document(
          budget_projection_document,
          budget_event
        );
      budget_projection_hash :=
        app_data_agent.runtime_canonical_sha256(
          budget_projection_document
        );

      insert into app_data_agent.run_events (
        app_id,
        tenant_id,
        environment,
        event_id,
        run_id,
        sequence,
        event_type,
        payload_json,
        attempt_id,
        command_id,
        dedupe_key,
        event_hash,
        worker_fence,
        event_document,
        created_at
      )
      values (
        candidate.app_id,
        candidate.tenant_id,
        candidate.environment,
        budget_event_id,
        candidate.run_id,
        (budget_event ->> 'sequence')::bigint,
        'run.failed',
        budget_event -> 'payload',
        candidate.active_attempt_id,
        candidate.command_id,
        budget_event ->> 'idempotency_key',
        budget_event_hash,
        candidate.active_fence,
        budget_event,
        claimed_at
      );

      insert into app_data_agent.run_projections (
        app_id,
        tenant_id,
        environment,
        run_id,
        version,
        status,
        worker_fence,
        event_id,
        projection_hash,
        projection_json,
        occurred_at
      )
      values (
        candidate.app_id,
        candidate.tenant_id,
        candidate.environment,
        candidate.run_id,
        (budget_event ->> 'sequence')::bigint,
        'FAILED',
        candidate.active_fence,
        budget_event_id,
        budget_projection_hash,
        budget_projection_document,
        claimed_at
      );

      update app_data_agent.run_attempts as exhausted_attempt
      set status = 'FAILED',
          error_code = 'RUN_ATTEMPT_BUDGET_EXHAUSTED',
          finished_at = claimed_at
      where exhausted_attempt.app_id = candidate.app_id
        and exhausted_attempt.tenant_id = candidate.tenant_id
        and exhausted_attempt.environment = candidate.environment
        and exhausted_attempt.attempt_id = candidate.active_attempt_id
        and exhausted_attempt.status = 'ACTIVE';

      update app_data_agent.outbox as exhausted_message
      set status = 'DEAD_LETTER',
          lease_owner = null,
          lease_expires_at = null
      where exhausted_message.app_id = candidate.app_id
        and exhausted_message.tenant_id = candidate.tenant_id
        and exhausted_message.environment = candidate.environment
        and exhausted_message.outbox_id = candidate.outbox_id;

      update app_data_agent.commands as exhausted_command
      set status = 'FAILED'
      where exhausted_command.app_id = candidate.app_id
        and exhausted_command.tenant_id = candidate.tenant_id
        and exhausted_command.environment = candidate.environment
        and exhausted_command.command_id = candidate.command_id
        and exhausted_command.status = 'PROCESSING';

      update app_data_agent.runs as exhausted_run
      set status = 'FAILED',
          updated_at = claimed_at
      where exhausted_run.app_id = candidate.app_id
        and exhausted_run.tenant_id = candidate.tenant_id
        and exhausted_run.environment = candidate.environment
        and exhausted_run.run_id = candidate.run_id
        and exhausted_run.active_fence = candidate.active_fence;
      cleanup_count := cleanup_count + 1;
      continue;
    end if;

    if candidate.status = 'LEASED'
      and candidate.active_attempt_id is not null
    then
      update app_data_agent.run_attempts as expired
      set status = 'EXPIRED',
          finished_at = claimed_at
      where expired.app_id = candidate.app_id
        and expired.tenant_id = candidate.tenant_id
        and expired.environment = candidate.environment
        and expired.attempt_id = candidate.active_attempt_id
        and expired.status = 'ACTIVE';
    end if;

    select coalesce(pg_catalog.max(attempt.attempt_no), 0)::integer + 1
    into next_attempt_no
    from app_data_agent.run_attempts as attempt
    where attempt.app_id = candidate.app_id
      and attempt.tenant_id = candidate.tenant_id
      and attempt.environment = candidate.environment
      and attempt.run_id = candidate.run_id;

    next_attempt_id := pg_catalog.gen_random_uuid();
    next_lease_token := candidate.lease_token + 1;
    next_worker_fence := candidate.active_fence + 1;
    next_expires_at := claimed_at
      + pg_catalog.make_interval(secs => requested_lease_seconds);

    update app_data_agent.runs as claimed_run
    set status = 'RUNNING',
        active_fence = next_worker_fence,
        updated_at = claimed_at
    where claimed_run.app_id = candidate.app_id
      and claimed_run.tenant_id = candidate.tenant_id
      and claimed_run.environment = candidate.environment
      and claimed_run.run_id = candidate.run_id
      and claimed_run.active_fence = candidate.active_fence;
    if not found then
      raise exception using
        errcode = '40001',
        message = 'DA_RUN_WORK_CLAIM_CONFLICT';
    end if;

    insert into app_data_agent.run_attempts (
      app_id,
      tenant_id,
      environment,
      run_id,
      outbox_id,
      command_id,
      attempt_id,
      attempt_no,
      worker_id,
      lease_token,
      worker_fence,
      lease_expires_at,
      last_heartbeat_at,
      started_at
    )
    values (
      candidate.app_id,
      candidate.tenant_id,
      candidate.environment,
      candidate.run_id,
      candidate.outbox_id,
      candidate.command_id,
      next_attempt_id,
      next_attempt_no,
      requested_worker_id,
      next_lease_token,
      next_worker_fence,
      next_expires_at,
      claimed_at,
      claimed_at
    );

    update app_data_agent.outbox as claimed_message
    set status = 'LEASED',
        attempt_count = claimed_message.attempt_count + 1,
        lease_owner = requested_worker_id,
        lease_token = next_lease_token,
        lease_expires_at = next_expires_at,
        published_at = null,
        active_attempt_id = next_attempt_id,
        run_fence = next_worker_fence,
        last_heartbeat_at = claimed_at
    where claimed_message.app_id = candidate.app_id
      and claimed_message.tenant_id = candidate.tenant_id
      and claimed_message.environment = candidate.environment
      and claimed_message.outbox_id = candidate.outbox_id;

    update app_data_agent.commands as claimed_command
    set status = 'PROCESSING'
    where claimed_command.app_id = candidate.app_id
      and claimed_command.tenant_id = candidate.tenant_id
      and claimed_command.environment = candidate.environment
      and claimed_command.command_id = candidate.command_id
      and claimed_command.status = 'ACCEPTED';

    outbox_id := candidate.outbox_id;
    run_id := candidate.run_id;
    command_id := candidate.command_id;
    topic := candidate.topic;
    command_kind := candidate.resolved_command_kind;
    payload := candidate.command_payload;
    attempt_id := next_attempt_id;
    attempt_no := next_attempt_no;
    delivery_attempt_no := candidate.attempt_count + 1;
    lease_duration_ms := requested_lease_seconds * 1000;
    worker_id := requested_worker_id;
    lease_token := next_lease_token;
    worker_fence := next_worker_fence;
    expires_at := next_expires_at;
    claimed_count := claimed_count + 1;
    return next;
  end loop;
end
$$;

create or replace function app_data_agent.heartbeat_run_work(
  requested_outbox_id uuid,
  requested_attempt_id uuid,
  requested_worker_id text,
  expected_lease_token bigint,
  expected_worker_fence bigint,
  requested_lease_seconds integer
)
returns timestamptz
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_authority record;
  target_run_id uuid;
  lease_checked_at timestamptz;
  heartbeat_at timestamptz;
  extended_expires_at timestamptz;
  message_lease_expires_at timestamptz;
  attempt_lease_expires_at timestamptz;
  message_last_heartbeat_at timestamptz;
  attempt_last_heartbeat_at timestamptz;
begin
  if requested_outbox_id is null
    or requested_attempt_id is null
    or requested_worker_id is null
    or expected_lease_token is null
    or expected_worker_fence is null
    or requested_lease_seconds is null
    or requested_lease_seconds not between 5 and 900
  then
    raise exception using
      errcode = '22023',
      message = 'DA_RUN_HEARTBEAT_INPUT_INVALID';
  end if;

  select *
  into current_authority
  from platform.current_backend_authority(true);

  -- All Runtime writers lock Run first. This prevents an Artifact/Control
  -- transaction from holding Run while a Heartbeat holds Outbox/Attempt.
  select run.run_id
  into target_run_id
  from app_data_agent.outbox as message
  join app_data_agent.runs as run
    on run.app_id = message.app_id
   and run.tenant_id = message.tenant_id
   and run.environment = message.environment
   and run.run_id = message.run_id
  where message.app_id = current_authority.app_id
    and message.tenant_id = current_authority.tenant_id
    and message.environment = current_authority.environment
    and message.outbox_id = requested_outbox_id
    and message.active_attempt_id = requested_attempt_id
    and message.status = 'LEASED'
    and message.lease_owner = requested_worker_id
    and message.lease_token = expected_lease_token
    and message.run_fence = expected_worker_fence
    and run.active_fence = expected_worker_fence
    and run.status = 'RUNNING'
    and run.principal_id = current_authority.principal_id
  for update of run;
  if not found then
    raise exception using
      errcode = '40001',
      message = 'DA_RUN_LEASE_STALE';
  end if;

  select
    message.lease_expires_at,
    attempt.lease_expires_at,
    message.last_heartbeat_at,
    attempt.last_heartbeat_at
  into
    message_lease_expires_at,
    attempt_lease_expires_at,
    message_last_heartbeat_at,
    attempt_last_heartbeat_at
  from app_data_agent.outbox as message
  join app_data_agent.run_attempts as attempt
    on attempt.app_id = message.app_id
   and attempt.tenant_id = message.tenant_id
   and attempt.environment = message.environment
   and attempt.attempt_id = message.active_attempt_id
   and attempt.outbox_id = message.outbox_id
   and attempt.run_id = message.run_id
  where message.app_id = current_authority.app_id
    and message.tenant_id = current_authority.tenant_id
    and message.environment = current_authority.environment
    and message.run_id = target_run_id
    and message.outbox_id = requested_outbox_id
    and message.active_attempt_id = requested_attempt_id
    and message.status = 'LEASED'
    and message.lease_owner = requested_worker_id
    and message.lease_token = expected_lease_token
    and message.run_fence = expected_worker_fence
    and attempt.worker_id = requested_worker_id
    and attempt.lease_token = expected_lease_token
    and attempt.worker_fence = expected_worker_fence
    and attempt.status = 'ACTIVE'
  for update of message, attempt;
  if not found then
    raise exception using
      errcode = '40001',
      message = 'DA_RUN_LEASE_STALE';
  end if;

  -- Take the authority timestamp only after all identity rows are locked.
  -- GREATEST also makes two overlapping Heartbeats strictly monotonic even
  -- when the database clock has microsecond-level ties.
  lease_checked_at := pg_catalog.clock_timestamp();
  if message_lease_expires_at < lease_checked_at
    or attempt_lease_expires_at < lease_checked_at
  then
    raise exception using
      errcode = '40001',
      message = 'DA_RUN_LEASE_STALE';
  end if;
  heartbeat_at := greatest(
    lease_checked_at,
    message_last_heartbeat_at + interval '1 microsecond',
    attempt_last_heartbeat_at + interval '1 microsecond'
  );
  extended_expires_at := heartbeat_at
    + pg_catalog.make_interval(secs => requested_lease_seconds);

  update app_data_agent.run_attempts as attempt
  set lease_expires_at = extended_expires_at,
      last_heartbeat_at = heartbeat_at
  where attempt.app_id = current_authority.app_id
    and attempt.tenant_id = current_authority.tenant_id
    and attempt.environment = current_authority.environment
    and attempt.attempt_id = requested_attempt_id;

  update app_data_agent.outbox as message
  set lease_expires_at = extended_expires_at,
      last_heartbeat_at = heartbeat_at
  where message.app_id = current_authority.app_id
    and message.tenant_id = current_authority.tenant_id
    and message.environment = current_authority.environment
    and message.outbox_id = requested_outbox_id;

  return extended_expires_at;
end
$$;

create function app_data_agent.load_agent_team_public_projection(requested_run_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $function$
declare authority record; result jsonb;
begin
  if not pg_catalog.pg_has_role(session_user,'data_agent_backend','USAGE') then
    raise exception using errcode='42501',message='DA_BACKEND_ROLE_REQUIRED'; end if;
  select * into authority from platform.current_backend_authority(false);
  if not exists(select 1 from app_data_agent.runs run where run.app_id=authority.app_id
    and run.tenant_id=authority.tenant_id and run.environment=authority.environment
    and run.run_id=requested_run_id and run.principal_id=authority.principal_id)
  then return null; end if;
  if exists(select 1 from app_data_agent.agent_team_tasks task
    where task.app_id=authority.app_id and task.tenant_id=authority.tenant_id
      and task.environment=authority.environment and task.run_id=requested_run_id
      and (task.task_hash<>app_data_agent.u2_canonical_sha256(task.task_json-'task_hash')
        or task.task_id<>(task.task_json->>'task_id')::uuid
        or task.parent_task_id is distinct from case when task.task_json->'parent_task_id'='null'::jsonb
          then null else (task.task_json->>'parent_task_id')::uuid end
        or task.depth<>(task.task_json->>'depth')::integer
        or task.profile_id<>task.task_json->>'profile_id'
        or task.profile_revision<>(task.task_json->>'profile_revision')::integer
        or task.profile_hash<>task.task_json->>'profile_hash'
        or task.task_revision<>(task.task_json->>'task_revision')::integer
        or task.task_attempt_id<>(task.task_json->>'attempt_id')::uuid
        or task.worker_fence<>(task.task_json->>'worker_fence')::bigint))
    or exists(select 1 from app_data_agent.agent_team_handoffs handoff
      join app_data_agent.agent_team_tasks child on child.app_id=handoff.app_id
        and child.tenant_id=handoff.tenant_id and child.environment=handoff.environment
        and child.task_id=handoff.child_task_id
      where handoff.app_id=authority.app_id and handoff.tenant_id=authority.tenant_id
        and handoff.environment=authority.environment and handoff.run_id=requested_run_id
        and (handoff.handoff_id<>(handoff.handoff_json#>>'{child_task,parent_handoff_id}')::uuid
          or handoff.parent_task_id<>(handoff.handoff_json->>'parent_task_id')::uuid
          or handoff.child_task_id<>(handoff.handoff_json#>>'{child_task,task_id}')::uuid
          or handoff.parent_expected_revision<>
            (handoff.handoff_json->>'parent_expected_revision')::integer
          or handoff.handoff_json->'child_task'<>child.task_json))
    or exists(select 1 from app_data_agent.agent_team_context_epochs epoch
      where epoch.app_id=authority.app_id and epoch.tenant_id=authority.tenant_id
        and epoch.environment=authority.environment and epoch.run_id=requested_run_id
        and (epoch.document_hash<>app_data_agent.u2_canonical_sha256(epoch.epoch_json)
          or epoch.task_id<>(epoch.epoch_json#>>'{proposed_obligations,task_id}')::uuid
          or epoch.epoch_id<>(epoch.epoch_json#>>'{proposed_epoch,epoch_id}')::uuid
          or epoch.epoch_revision<>(epoch.epoch_json->>'revision')::integer
          or epoch.phase<>epoch.epoch_json->>'phase'
          or epoch.build_signature<>epoch.epoch_json#>>'{proposed_epoch,build_signature}'
          or epoch.obligation_ledger_hash<>
            epoch.epoch_json#>>'{proposed_obligations,ledger_hash}'))
    or exists(select 1 from app_data_agent.agent_team_verifier_decisions verifier
      where verifier.app_id=authority.app_id and verifier.tenant_id=authority.tenant_id
        and verifier.environment=authority.environment and verifier.run_id=requested_run_id
        and (verifier.decision_hash<>
            app_data_agent.u2_canonical_sha256(verifier.decision_json-'decision_hash')
          or verifier.task_id<>(verifier.decision_json->>'task_id')::uuid
          or verifier.task_revision<>(verifier.decision_json->>'task_revision')::integer
          or verifier.decision_id<>(verifier.decision_json->>'decision_id')::uuid
          or verifier.completion_hash<>verifier.decision_json->>'completion_hash'))
    or exists(select 1 from app_data_agent.agent_team_completion_receipts completion
      where completion.app_id=authority.app_id and completion.tenant_id=authority.tenant_id
        and completion.environment=authority.environment and completion.run_id=requested_run_id
        and (completion.completion_hash<>
            app_data_agent.u2_canonical_sha256(completion.receipt_json-'completion_hash')
          or completion.task_id<>(completion.receipt_json->>'task_id')::uuid
          or completion.task_revision<>(completion.receipt_json->>'task_revision')::integer
          or completion.completion_id<>(completion.receipt_json->>'completion_id')::uuid))
    or exists(select 1 from app_data_agent.agent_team_acceptance_receipts acceptance
      where acceptance.app_id=authority.app_id and acceptance.tenant_id=authority.tenant_id
        and acceptance.environment=authority.environment and acceptance.run_id=requested_run_id
        and (acceptance.acceptance_hash<>
            app_data_agent.u2_canonical_sha256(acceptance.receipt_json-'acceptance_hash')
          or acceptance.task_id<>(acceptance.receipt_json->>'task_id')::uuid
          or acceptance.task_revision<>(acceptance.receipt_json->>'task_revision')::integer
          or acceptance.completion_id<>(acceptance.receipt_json->>'completion_id')::uuid
          or acceptance.status<>acceptance.receipt_json->>'status'))
  then raise exception using errcode='55000',message='AGENT_TEAM_TRACE_CORRUPT'; end if;
  if not exists(select 1 from app_data_agent.agent_team_tasks task
    where task.app_id=authority.app_id and task.tenant_id=authority.tenant_id
      and task.environment=authority.environment and task.run_id=requested_run_id)
  then return null; end if;
  result:=pg_catalog.jsonb_build_object(
    'tasks',coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
      'task_id',task.task_id,'parent_task_id',task.parent_task_id,'depth',task.depth,
      'profile_id',task.profile_id,'profile_revision',task.profile_revision,
      'profile_hash',task.profile_hash,'task_revision',task.task_revision,
      'attempt_id',task.task_attempt_id,'worker_fence',task.worker_fence,
      'status',case when acceptance.status='ACCEPTED' then 'ACCEPTED'
        when acceptance.status='REJECTED' then 'REJECTED'
        when completion.completion_id is not null then 'COMPLETED' else 'RUNNING' end,
      'created_at',pg_catalog.to_char(task.created_at at time zone 'UTC',
        'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')) order by task.task_id)
      from app_data_agent.agent_team_tasks task
      left join lateral(select receipt.status from app_data_agent.agent_team_acceptance_receipts receipt
        where receipt.app_id=task.app_id and receipt.tenant_id=task.tenant_id
          and receipt.environment=task.environment and receipt.task_id=task.task_id
        order by receipt.created_at desc limit 1) acceptance on true
      left join lateral(select receipt.completion_id from app_data_agent.agent_team_completion_receipts receipt
        where receipt.app_id=task.app_id and receipt.tenant_id=task.tenant_id
          and receipt.environment=task.environment and receipt.task_id=task.task_id
        order by receipt.created_at desc limit 1) completion on true
      where task.app_id=authority.app_id and task.tenant_id=authority.tenant_id
        and task.environment=authority.environment and task.run_id=requested_run_id),'[]'::jsonb),
    'handoffs',coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
      'handoff_id',handoff.handoff_id,'parent_task_id',handoff.parent_task_id,
      'child_task_id',handoff.child_task_id,'parent_expected_revision',handoff.parent_expected_revision,
      'request_hash',handoff.request_hash,'created_at',pg_catalog.to_char(handoff.created_at at time zone 'UTC',
        'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')) order by handoff.handoff_id)
      from app_data_agent.agent_team_handoffs handoff where handoff.app_id=authority.app_id
        and handoff.tenant_id=authority.tenant_id and handoff.environment=authority.environment
        and handoff.run_id=requested_run_id),'[]'::jsonb),
    'epochs',coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
      'task_id',epoch.task_id,'epoch_id',epoch.epoch_id,'epoch_revision',epoch.epoch_revision,
      'phase',epoch.phase,'build_signature',epoch.build_signature,
      'obligation_ledger_hash',epoch.obligation_ledger_hash,
      'created_at',pg_catalog.to_char(epoch.created_at at time zone 'UTC',
        'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')) order by epoch.task_id,epoch.epoch_id,epoch.epoch_revision)
      from app_data_agent.agent_team_context_epochs epoch where epoch.app_id=authority.app_id
        and epoch.tenant_id=authority.tenant_id and epoch.environment=authority.environment
        and epoch.run_id=requested_run_id),'[]'::jsonb),
    'verifier_decisions',coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
      'task_id',verifier.task_id,'task_revision',verifier.task_revision,
      'decision_id',verifier.decision_id,'completion_hash',verifier.completion_hash,
      'decision_hash',verifier.decision_hash,'created_at',pg_catalog.to_char(verifier.created_at at time zone 'UTC',
        'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')) order by verifier.decision_id)
      from app_data_agent.agent_team_verifier_decisions verifier where verifier.app_id=authority.app_id
        and verifier.tenant_id=authority.tenant_id and verifier.environment=authority.environment
        and verifier.run_id=requested_run_id),'[]'::jsonb));
  return result;
end
$function$;
-- Rendered from the reviewed runtime functions. Display events advance only the
-- durable projection cursor while retaining the active Run authority state.
create function app_data_agent.public_run_display_payload_is_valid(
  requested_event_type text,
  requested_payload jsonb
)
returns boolean language plpgsql immutable strict set search_path='' as $function$
declare key_count integer;
begin
  if pg_catalog.jsonb_typeof(requested_payload)<>'object' then return false; end if;
  select pg_catalog.count(*) into key_count from pg_catalog.jsonb_object_keys(requested_payload);
  case requested_event_type
    when 'run.progress' then
      return key_count=4 and requested_payload ?& array['phase','title','summary','status']
        and pg_catalog.jsonb_typeof(requested_payload->'phase')='string'
        and pg_catalog.jsonb_typeof(requested_payload->'title')='string'
        and pg_catalog.jsonb_typeof(requested_payload->'summary')='string'
        and pg_catalog.jsonb_typeof(requested_payload->'status')='string'
        and pg_catalog.length(requested_payload->>'phase') between 1 and 128
        and pg_catalog.length(requested_payload->>'title') between 1 and 128
        and pg_catalog.length(requested_payload->>'summary') between 1 and 100000
        and requested_payload->>'status' in ('RUNNING','COMPLETED');
    when 'run.tool_started' then
      return key_count=5 and requested_payload ?& array[
          'call_id','tool_name','title','summary','input']
        and pg_catalog.jsonb_typeof(requested_payload->'call_id')='string'
        and pg_catalog.jsonb_typeof(requested_payload->'tool_name')='string'
        and pg_catalog.jsonb_typeof(requested_payload->'title')='string'
        and pg_catalog.jsonb_typeof(requested_payload->'summary')='string'
        and pg_catalog.length(requested_payload->>'call_id') between 1 and 256
        and pg_catalog.length(requested_payload->>'tool_name') between 1 and 128
        and pg_catalog.length(requested_payload->>'title') between 1 and 128
        and pg_catalog.length(requested_payload->>'summary') between 1 and 100000
        and pg_catalog.jsonb_typeof(requested_payload->'input') in ('string','null')
        and pg_catalog.length(coalesce(requested_payload->>'input',''))<=100000;
    when 'run.tool_completed' then
      return key_count=5 and requested_payload ?& array[
          'call_id','tool_name','summary','output','duration_ms']
        and pg_catalog.jsonb_typeof(requested_payload->'call_id')='string'
        and pg_catalog.jsonb_typeof(requested_payload->'tool_name')='string'
        and pg_catalog.jsonb_typeof(requested_payload->'summary')='string'
        and pg_catalog.length(requested_payload->>'call_id') between 1 and 256
        and pg_catalog.length(requested_payload->>'tool_name') between 1 and 128
        and pg_catalog.length(requested_payload->>'summary') between 1 and 100000
        and pg_catalog.jsonb_typeof(requested_payload->'output') in ('string','null')
        and pg_catalog.length(coalesce(requested_payload->>'output',''))<=200000
        and pg_catalog.jsonb_typeof(requested_payload->'duration_ms')='number'
        and requested_payload->>'duration_ms' ~ '^(0|[1-9][0-9]{0,15})$'
        and (requested_payload->>'duration_ms')::numeric<=9007199254740991;
    when 'run.tool_failed' then
      return key_count=6 and requested_payload ?& array[
          'call_id','tool_name','summary','error_code','output','duration_ms']
        and pg_catalog.jsonb_typeof(requested_payload->'call_id')='string'
        and pg_catalog.jsonb_typeof(requested_payload->'tool_name')='string'
        and pg_catalog.jsonb_typeof(requested_payload->'summary')='string'
        and pg_catalog.jsonb_typeof(requested_payload->'error_code')='string'
        and pg_catalog.length(requested_payload->>'call_id') between 1 and 256
        and pg_catalog.length(requested_payload->>'tool_name') between 1 and 128
        and pg_catalog.length(requested_payload->>'summary') between 1 and 100000
        and requested_payload->>'error_code' ~ '^[A-Z][A-Z0-9_]{0,127}$'
        and pg_catalog.jsonb_typeof(requested_payload->'output') in ('string','null')
        and pg_catalog.length(coalesce(requested_payload->>'output',''))<=200000
        and pg_catalog.jsonb_typeof(requested_payload->'duration_ms')='number'
        and requested_payload->>'duration_ms' ~ '^(0|[1-9][0-9]{0,15})$'
        and (requested_payload->>'duration_ms')::numeric<=9007199254740991;
    when 'run.answer_delta' then
      return key_count=1 and requested_payload ? 'delta'
        and pg_catalog.jsonb_typeof(requested_payload->'delta')='string'
        and pg_catalog.length(requested_payload->>'delta') between 1 and 100000;
    when 'run.reasoning_started' then
      return key_count=2 and requested_payload ?& array['block_id','title']
        and pg_catalog.jsonb_typeof(requested_payload->'block_id')='string'
        and pg_catalog.jsonb_typeof(requested_payload->'title')='string'
        and pg_catalog.length(requested_payload->>'block_id') between 1 and 256
        and pg_catalog.length(requested_payload->>'title') between 1 and 128;
    when 'run.reasoning_delta' then
      return key_count=2 and requested_payload ?& array['block_id','delta']
        and pg_catalog.jsonb_typeof(requested_payload->'block_id')='string'
        and pg_catalog.jsonb_typeof(requested_payload->'delta')='string'
        and pg_catalog.length(requested_payload->>'block_id') between 1 and 256
        and pg_catalog.length(requested_payload->>'delta') between 1 and 4096;
    when 'run.reasoning_completed' then
      return key_count=3 and requested_payload ?& array['block_id','summary','duration_ms']
        and pg_catalog.jsonb_typeof(requested_payload->'block_id')='string'
        and pg_catalog.jsonb_typeof(requested_payload->'summary')='string'
        and pg_catalog.length(requested_payload->>'block_id') between 1 and 256
        and pg_catalog.length(requested_payload->>'summary') between 1 and 100000
        and pg_catalog.jsonb_typeof(requested_payload->'duration_ms')='number'
        and requested_payload->>'duration_ms' ~ '^(0|[1-9][0-9]{0,15})$'
        and (requested_payload->>'duration_ms')::numeric<=9007199254740991;
    else return false;
  end case;
exception when others then return false;
end
$function$;

create or replace function app_data_agent.reduce_run_projection_document(
  current_projection jsonb,
  requested_event jsonb
)
returns jsonb
language plpgsql
immutable
strict
security definer
set search_path = ''
as $$
declare
  event_type text;
  payload jsonb;
  expected_projection jsonb;
begin
  if pg_catalog.jsonb_typeof(current_projection) <> 'object'
    or pg_catalog.jsonb_typeof(requested_event) <> 'object'
    or pg_catalog.jsonb_typeof(requested_event -> 'payload') <> 'object'
  then
    raise exception using
      errcode = '22023',
      message = 'DA_RUN_PROJECTION_REDUCER_INPUT_INVALID';
  end if;

  event_type := requested_event ->> 'event_type';
  payload := requested_event -> 'payload';

  expected_projection := current_projection || pg_catalog.jsonb_build_object(
    'version',
    (requested_event ->> 'sequence')::bigint,
    'worker_fence',
    (requested_event ->> 'worker_fence')::bigint,
    'last_event_id',
    requested_event ->> 'event_id',
    'last_occurred_at',
    requested_event -> 'occurred_at'
  );

  case event_type
    when 'run.leased' then
      expected_projection := expected_projection ||
        pg_catalog.jsonb_build_object(
          'status',
          'RUNNING',
          'attempt_count',
          (payload ->> 'attempt')::bigint
        );
    when 'run.checkpointed' then
      expected_projection := expected_projection ||
        pg_catalog.jsonb_build_object(
          'active_artifact_ref',
          payload -> 'active_artifact_ref',
          'active_snapshot_ref',
          payload -> 'snapshot_ref'
        );
    when 'run.side_effect_committed' then
      expected_projection := expected_projection ||
        pg_catalog.jsonb_build_object(
          'last_side_effect_receipt_id',
          payload ->> 'receipt_id'
        );
    when 'run.progress' then null;
    when 'run.tool_started' then null;
    when 'run.tool_completed' then null;
    when 'run.tool_failed' then null;
    when 'run.answer_delta' then null;
    when 'run.reasoning_started' then null;
    when 'run.reasoning_delta' then null;
    when 'run.reasoning_completed' then null;
    when 'run.suspended' then
      expected_projection := expected_projection ||
        pg_catalog.jsonb_build_object('status', 'WAITING');
    when 'run.resumed' then
      expected_projection := expected_projection ||
        pg_catalog.jsonb_build_object('status', 'QUEUED');
    when 'run.retry_scheduled' then
      expected_projection := expected_projection ||
        pg_catalog.jsonb_build_object('status', 'QUEUED');
    when 'run.cancel_requested' then
      expected_projection := expected_projection ||
        pg_catalog.jsonb_build_object(
          'status',
          'CANCELLED',
          'terminal_event_id',
          requested_event ->> 'event_id'
        );
    when 'run.completed' then
      expected_projection := expected_projection ||
        pg_catalog.jsonb_build_object(
          'status',
          'COMPLETED',
          'terminal_event_id',
          requested_event ->> 'event_id'
        );
    when 'run.failed' then
      expected_projection := expected_projection ||
        pg_catalog.jsonb_build_object(
          'status',
          'FAILED',
          'terminal_event_id',
          requested_event ->> 'event_id'
        );
    else
      raise exception using
        errcode = '22023',
        message = 'DA_RUN_PROJECTION_REDUCER_EVENT_INVALID';
  end case;

  return expected_projection;
exception
  when invalid_text_representation or numeric_value_out_of_range then
    raise exception using
      errcode = '22023',
      message = 'DA_RUN_PROJECTION_REDUCER_INPUT_INVALID';
end
$$;
create or replace function app_data_agent.prepare_run_event_insert()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  payload_command_id text;
  payload_hash text;
  expected_document jsonb;
begin
  if new.event_type = 'command.accepted' then
    if new.sequence <> 1 or new.worker_fence <> 0 then
      raise exception using
        errcode = '22023',
        message = 'DA_RUN_LEGACY_EVENT_UNSUPPORTED';
    end if;
    payload_command_id := coalesce(
      new.payload_json ->> 'command_id',
      new.payload_json ->> 'commandId'
    );
    payload_hash := coalesce(
      new.payload_json ->> 'payload_hash',
      new.payload_json ->> 'payloadHash'
    );
    if payload_command_id is null
      or payload_command_id !~
        '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      or payload_hash is null
      or payload_hash !~ '^sha256:[0-9a-f]{64}$'
    then
      raise exception using
        errcode = '22023',
        message = 'DA_RUN_LEGACY_EVENT_INVALID';
    end if;
    new.event_type := 'run.accepted';
    new.command_id := payload_command_id::uuid;
    new.payload_json := pg_catalog.jsonb_build_object(
      'command_id',
      payload_command_id,
      'payload_hash',
      payload_hash
    );
    new.dedupe_key := 'event:' || new.event_id::text;
  end if;

  if new.dedupe_key is null then
    new.dedupe_key := 'event:' || new.event_id::text;
  end if;
  if pg_catalog.length(new.dedupe_key) not between 1 and 256 then
    raise exception using
      errcode = '22023',
      message = 'DA_RUN_EVENT_DEDUPE_INVALID';
  end if;

  if new.command_id is null then
    payload_command_id := coalesce(
      new.payload_json ->> 'command_id',
      new.payload_json ->> 'commandId'
    );
    if payload_command_id is not null
      and payload_command_id ~
        '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    then
      new.command_id := payload_command_id::uuid;
    end if;
  end if;

  expected_document := pg_catalog.jsonb_build_object(
    'schema_version',
    '1.0.0',
    'event_id',
    new.event_id,
    'scope',
    pg_catalog.jsonb_build_object(
      'app_id',
      new.app_id,
      'tenant_id',
      new.tenant_id,
      'environment',
      new.environment
    ),
    'run_id',
    new.run_id,
    'sequence',
    new.sequence,
    'worker_fence',
    new.worker_fence,
    'idempotency_key',
    new.dedupe_key,
    'occurred_at',
    app_data_agent.runtime_iso_timestamp(new.created_at),
    'event_type',
    new.event_type,
    'payload',
    new.payload_json
  );

  if new.event_document is null then
    new.event_document := expected_document;
  elsif new.event_document <> expected_document then
    raise exception using
      errcode = '22023',
      message = 'DA_RUN_EVENT_DOCUMENT_MISMATCH';
  end if;

  if pg_catalog.jsonb_typeof(new.event_document) <> 'object'
    or app_data_agent.contains_potential_plaintext_secret(new.event_document)
  then
    raise exception using
      errcode = '22023',
      message = 'DA_RUN_EVENT_DOCUMENT_INVALID';
  end if;

  if new.event_type in ('run.progress',
      'run.tool_started',
      'run.tool_completed',
      'run.tool_failed',
      'run.answer_delta',
      'run.reasoning_started',
      'run.reasoning_delta',
      'run.reasoning_completed')
    and not app_data_agent.public_run_display_payload_is_valid(
      new.event_type,
      new.payload_json
    )
  then
    raise exception using
      errcode = '22023',
      message = 'DA_RUN_DISPLAY_EVENT_PAYLOAD_INVALID';
  end if;

  if new.event_type not in (
    'run.accepted',
    'run.leased',
    'run.checkpointed',
    'run.side_effect_committed',
    'run.progress',
    'run.tool_started',
    'run.tool_completed',
    'run.tool_failed',
    'run.answer_delta',
    'run.reasoning_started',
    'run.reasoning_delta',
    'run.reasoning_completed',
    'run.suspended',
    'run.resumed',
    'run.retry_scheduled',
    'run.cancel_requested',
    'run.completed',
    'run.failed'
  ) then
    raise exception using
      errcode = '22023',
      message = 'DA_RUN_EVENT_TYPE_INVALID';
  end if;
  if new.event_type = 'run.accepted'
    and (new.sequence <> 1 or new.worker_fence <> 0)
  then
    raise exception using
      errcode = '22023',
      message = 'DA_RUN_ACCEPTED_EVENT_INVALID';
  end if;
  if current_user = 'data_agent_backend'
    and new.event_type <> 'run.accepted'
  then
    raise exception using
      errcode = '42501',
      message = 'DA_RUN_EVENT_DIRECT_WRITE_FORBIDDEN';
  end if;

  if new.event_hash is null then
    new.event_hash :=
      app_data_agent.runtime_canonical_sha256(new.event_document);
  end if;
  if new.event_hash !~ '^sha256:[0-9a-f]{64}$' then
    raise exception using
      errcode = '22023',
      message = 'DA_RUN_EVENT_HASH_INVALID';
  end if;
  if new.event_hash <>
    app_data_agent.runtime_canonical_sha256(new.event_document)
  then
    raise exception using
      errcode = '22023',
      message = 'DA_RUN_EVENT_HASH_MISMATCH';
  end if;
  return new;
end
$$;
create or replace function app_data_agent.append_run_event(
  requested_lease jsonb,
  requested_event jsonb,
  requested_event_hash text,
  expected_projection_hash text,
  requested_projection jsonb,
  requested_projection_hash text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_authority record;
  target_run app_data_agent.runs%rowtype;
  current_projection app_data_agent.run_projections%rowtype;
  existing_event app_data_agent.run_events%rowtype;
  active_attempt app_data_agent.run_attempts%rowtype;
  requested_event_id uuid;
  requested_run_id uuid;
  requested_outbox_id uuid;
  requested_attempt_id uuid;
  lease_command_id uuid;
  requested_worker_id text;
  expected_lease_token bigint;
  lease_run_id uuid;
  lease_worker_fence bigint;
  requested_sequence bigint;
  requested_worker_fence bigint;
  requested_dedupe_key text;
  requested_event_type text;
  requested_occurred_at timestamptz;
  requested_command_id uuid;
  requested_projection_status text;
  requested_projection_version bigint;
  requested_projection_fence bigint;
  requested_error_code text;
  requested_retry_delay_ms bigint;
  active_delivery_attempt_no integer;
  scheduled_retry_at timestamptz;
  required_status text;
  active_message_lease_expires_at timestamptz;
  now_at timestamptz;
begin
  if requested_lease is null
    or pg_catalog.jsonb_typeof(requested_lease) <> 'object'
    or pg_catalog.jsonb_typeof(requested_lease -> 'scope') <> 'object'
    or requested_event is null
    or requested_projection is null
    or pg_catalog.jsonb_typeof(requested_event) <> 'object'
    or pg_catalog.jsonb_typeof(requested_projection) <> 'object'
    or requested_event_hash is null
    or requested_event_hash !~ '^sha256:[0-9a-f]{64}$'
    or requested_projection_hash is null
    or requested_projection_hash !~ '^sha256:[0-9a-f]{64}$'
    or app_data_agent.contains_potential_plaintext_secret(
      requested_lease - 'lease_token'
    )
    or app_data_agent.contains_potential_plaintext_secret(requested_event)
    or app_data_agent.contains_potential_plaintext_secret(requested_projection)
  then
    raise exception using
      errcode = '22023',
      message = 'DA_RUN_EVENT_INPUT_INVALID';
  end if;
  if requested_event_hash <>
    app_data_agent.runtime_canonical_sha256(requested_event)
  then
    raise exception using
      errcode = '22023',
      message = 'DA_RUN_EVENT_HASH_MISMATCH';
  end if;
  if requested_projection_hash <>
    app_data_agent.runtime_canonical_sha256(requested_projection)
  then
    raise exception using
      errcode = '22023',
      message = 'DA_RUN_PROJECTION_HASH_MISMATCH';
  end if;
  if requested_event ->> 'schema_version' <> '1.0.0'
    or requested_projection ->> 'schema_version' <> '1.0.0'
    or pg_catalog.jsonb_typeof(requested_event -> 'scope') <> 'object'
    or pg_catalog.jsonb_typeof(requested_event -> 'payload') <> 'object'
    or pg_catalog.jsonb_typeof(requested_projection -> 'scope') <> 'object'
  then
    raise exception using
      errcode = '22023',
      message = 'DA_RUN_EVENT_INPUT_INVALID';
  end if;

  begin
    requested_outbox_id := (requested_lease ->> 'outbox_id')::uuid;
    requested_attempt_id := (requested_lease ->> 'attempt_id')::uuid;
    lease_command_id := (requested_lease ->> 'command_id')::uuid;
    requested_worker_id := requested_lease ->> 'worker_id';
    expected_lease_token := (requested_lease ->> 'lease_token')::bigint;
    lease_run_id := (requested_lease ->> 'run_id')::uuid;
    lease_worker_fence := (requested_lease ->> 'worker_fence')::bigint;
    requested_event_id := (requested_event ->> 'event_id')::uuid;
    requested_run_id := (requested_event ->> 'run_id')::uuid;
    requested_sequence := (requested_event ->> 'sequence')::bigint;
    requested_worker_fence := (requested_event ->> 'worker_fence')::bigint;
    requested_dedupe_key := requested_event ->> 'idempotency_key';
    requested_event_type := requested_event ->> 'event_type';
    requested_occurred_at := (requested_event ->> 'occurred_at')::timestamptz;
    requested_projection_version :=
      (requested_projection ->> 'version')::bigint;
    requested_projection_fence :=
      (requested_projection ->> 'worker_fence')::bigint;
    requested_projection_status := requested_projection ->> 'status';
    if requested_event -> 'payload' ? 'command_id' then
      requested_command_id :=
        (requested_event -> 'payload' ->> 'command_id')::uuid;
    end if;
    if requested_event ->> 'event_type' in (
      'run.retry_scheduled',
      'run.failed'
    ) then
      requested_error_code :=
        requested_event -> 'payload' ->> 'error_code';
    end if;
    if requested_event ->> 'event_type' = 'run.retry_scheduled' then
      requested_retry_delay_ms :=
        (requested_event -> 'payload' ->> 'retry_delay_ms')::bigint;
    end if;
  exception
    when others then
      raise exception using
        errcode = '22023',
        message = 'DA_RUN_EVENT_INPUT_INVALID';
  end;

  if requested_sequence < 1
    or requested_worker_id is null
    or requested_worker_id !~ '^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,127}$'
    or expected_lease_token < 1
    or lease_run_id <> requested_run_id
    or lease_worker_fence <> requested_worker_fence
    or requested_lease -> 'scope' is distinct from requested_event -> 'scope'
    or requested_worker_fence < 0
    or requested_dedupe_key is null
    or pg_catalog.length(requested_dedupe_key) not between 1 and 256
    or requested_event ->> 'occurred_at' <>
      app_data_agent.runtime_iso_timestamp(requested_occurred_at)
    or requested_event_type not in (
      'run.leased',
      'run.checkpointed',
      'run.side_effect_committed',
      'run.progress',
          'run.tool_started',
          'run.tool_completed',
          'run.tool_failed',
          'run.answer_delta',
          'run.reasoning_started',
          'run.reasoning_delta',
          'run.reasoning_completed',
      'run.suspended',
      'run.retry_scheduled',
      'run.completed',
      'run.failed'
    )
    or requested_projection_status not in (
      'QUEUED',
      'RUNNING',
      'WAITING',
      'COMPLETED',
      'FAILED',
      'CANCELLED'
    )
    or requested_projection_version <> requested_sequence
    or requested_projection_fence <> requested_worker_fence
    or requested_projection ->> 'run_id' <> requested_run_id::text
    or requested_projection ->> 'last_event_id' <> requested_event_id::text
    or requested_event -> 'scope' ->> 'app_id'
      is distinct from requested_projection -> 'scope' ->> 'app_id'
    or requested_event -> 'scope' ->> 'tenant_id'
      is distinct from requested_projection -> 'scope' ->> 'tenant_id'
    or requested_event -> 'scope' ->> 'environment'
      is distinct from requested_projection -> 'scope' ->> 'environment'
  then
    raise exception using
      errcode = '22023',
      message = 'DA_RUN_EVENT_PROJECTION_INVALID';
  end if;

  select *
  into current_authority
  from platform.current_backend_authority(true);
  if requested_event -> 'scope' ->> 'app_id'
      <> current_authority.app_id::text
    or requested_event -> 'scope' ->> 'tenant_id'
      <> current_authority.tenant_id::text
    or requested_event -> 'scope' ->> 'environment'
      <> current_authority.environment
  then
    raise exception using
      errcode = '42501',
      message = 'DA_RUN_EVENT_SCOPE_FORBIDDEN';
  end if;

  select run.*
  into target_run
  from app_data_agent.runs as run
  where run.app_id = current_authority.app_id
    and run.tenant_id = current_authority.tenant_id
    and run.environment = current_authority.environment
    and run.run_id = requested_run_id
    and run.principal_id = current_authority.principal_id
  for update;
  if not found then
    raise exception using
      errcode = 'P0002',
      message = 'DA_RUN_NOT_FOUND';
  end if;

  select event.*
  into existing_event
  from app_data_agent.run_events as event
  where event.app_id = current_authority.app_id
    and event.tenant_id = current_authority.tenant_id
    and event.environment = current_authority.environment
    and event.run_id = requested_run_id
    and event.dedupe_key = requested_dedupe_key;
  if found then
    if not exists (
      select 1
      from app_data_agent.run_attempts as replay_attempt
      where replay_attempt.app_id = current_authority.app_id
        and replay_attempt.tenant_id = current_authority.tenant_id
        and replay_attempt.environment = current_authority.environment
        and replay_attempt.run_id = requested_run_id
        and replay_attempt.outbox_id = requested_outbox_id
        and replay_attempt.attempt_id = requested_attempt_id
        and replay_attempt.command_id = lease_command_id
        and replay_attempt.worker_id = requested_worker_id
        and replay_attempt.lease_token = expected_lease_token
        and replay_attempt.worker_fence = requested_worker_fence
    ) then
      raise exception using
        errcode = '40001',
        message = 'DA_RUN_EVENT_LEASE_STALE';
    end if;
    if existing_event.attempt_id is distinct from requested_attempt_id
      or existing_event.event_id <> requested_event_id
      or existing_event.event_hash <> requested_event_hash
      or existing_event.event_document <> requested_event
    then
      raise exception using
        errcode = '23505',
        message = 'DA_RUN_EVENT_IDEMPOTENCY_CONFLICT';
    end if;
    select projection.*
    into current_projection
    from app_data_agent.run_projections as projection
    where projection.app_id = current_authority.app_id
      and projection.tenant_id = current_authority.tenant_id
      and projection.environment = current_authority.environment
      and projection.run_id = requested_run_id
    order by projection.version desc
    limit 1;
    return pg_catalog.jsonb_build_object(
      'replayed',
      true,
      'event',
      existing_event.event_document,
      'event_hash',
      existing_event.event_hash,
      'projection',
      current_projection.projection_json,
      'projection_hash',
      current_projection.projection_hash
    );
  end if;

  select projection.*
  into current_projection
  from app_data_agent.run_projections as projection
  where projection.app_id = current_authority.app_id
    and projection.tenant_id = current_authority.tenant_id
    and projection.environment = current_authority.environment
    and projection.run_id = requested_run_id
  order by projection.version desc
  limit 1
  for update;
  if not found then
    raise exception using
      errcode = 'P0002',
      message = 'DA_RUN_PROJECTION_NOT_FOUND';
  end if;
  if expected_projection_hash is null
    or current_projection.projection_hash <> expected_projection_hash
  then
    raise exception using
      errcode = '40001',
      message = 'DA_RUN_PROJECTION_CONFLICT';
  end if;
  if requested_sequence <> current_projection.version + 1 then
    raise exception using
      errcode = '40001',
      message = 'DA_RUN_EVENT_SEQUENCE_INVALID';
  end if;
  if target_run.active_fence <> requested_worker_fence then
    raise exception using
      errcode = '40001',
      message = 'DA_RUN_EVENT_FENCE_STALE';
  end if;
  if current_projection.projection_json ->> 'terminal_event_id' is not null then
    raise exception using
      errcode = '40001',
      message = 'DA_RUN_EVENT_AFTER_TERMINAL';
  end if;
  if requested_projection <>
    app_data_agent.reduce_run_projection_document(
      current_projection.projection_json,
      requested_event
    )
  then
    raise exception using
      errcode = '22023',
      message = 'DA_RUN_PROJECTION_SEMANTIC_MISMATCH';
  end if;

  select attempt.*
  into active_attempt
  from app_data_agent.run_attempts as attempt
  join app_data_agent.outbox as message
    on message.app_id = attempt.app_id
   and message.tenant_id = attempt.tenant_id
   and message.environment = attempt.environment
   and message.run_id = attempt.run_id
   and message.outbox_id = attempt.outbox_id
   and message.command_id = attempt.command_id
   and message.active_attempt_id = attempt.attempt_id
  where attempt.app_id = current_authority.app_id
    and attempt.tenant_id = current_authority.tenant_id
    and attempt.environment = current_authority.environment
    and attempt.run_id = requested_run_id
    and attempt.outbox_id = requested_outbox_id
    and attempt.attempt_id = requested_attempt_id
    and attempt.command_id = lease_command_id
    and attempt.worker_id = requested_worker_id
    and attempt.lease_token = expected_lease_token
    and attempt.worker_fence = requested_worker_fence
    and attempt.status = 'ACTIVE'
    and message.status = 'LEASED'
    and message.lease_owner = requested_worker_id
    and message.lease_token = expected_lease_token
    and message.run_fence = requested_worker_fence
  for update of attempt, message;
  if not found then
    raise exception using
      errcode = '40001',
      message = 'DA_RUN_EVENT_LEASE_STALE';
  end if;
  select message.lease_expires_at
  into active_message_lease_expires_at
  from app_data_agent.outbox as message
  where message.app_id = active_attempt.app_id
    and message.tenant_id = active_attempt.tenant_id
    and message.environment = active_attempt.environment
    and message.outbox_id = active_attempt.outbox_id;
  now_at := pg_catalog.clock_timestamp();
  if active_attempt.lease_expires_at < now_at
    or active_message_lease_expires_at < now_at
  then
    raise exception using
      errcode = '40001',
      message = 'DA_RUN_EVENT_LEASE_STALE';
  end if;
  select message.attempt_count
  into active_delivery_attempt_no
  from app_data_agent.outbox as message
  where message.app_id = active_attempt.app_id
    and message.tenant_id = active_attempt.tenant_id
    and message.environment = active_attempt.environment
    and message.outbox_id = active_attempt.outbox_id;

  case requested_event_type
    when 'run.leased' then
      if current_projection.status not in ('QUEUED', 'RUNNING')
        or requested_worker_fence <= current_projection.worker_fence
        or (requested_event -> 'payload' ->> 'worker_id')
          is distinct from active_attempt.worker_id
        or (requested_event -> 'payload' ->> 'lease_id')
          is distinct from active_attempt.attempt_id::text
        or (requested_event -> 'payload' ->> 'attempt')::integer
          is distinct from active_attempt.attempt_no
        or requested_command_id is distinct from active_attempt.command_id
      then
        raise exception using
          errcode = '22023',
          message = 'DA_RUN_EVENT_TRANSITION_INVALID';
      end if;
      required_status := 'RUNNING';
    when 'run.checkpointed' then
      begin
        perform 1
        from app_data_agent.run_checkpoints as checkpoint
        where checkpoint.app_id = current_authority.app_id
          and checkpoint.tenant_id = current_authority.tenant_id
          and checkpoint.environment = current_authority.environment
          and checkpoint.run_id = requested_run_id
          and checkpoint.attempt_id = active_attempt.attempt_id
          and checkpoint.snapshot_id =
            (requested_event -> 'payload' -> 'snapshot_ref'
              ->> 'snapshot_id')::uuid
          and checkpoint.snapshot_version =
            (requested_event -> 'payload' -> 'snapshot_ref'
              ->> 'snapshot_version')::integer
          and checkpoint.snapshot_hash =
            requested_event -> 'payload' -> 'snapshot_ref'
              ->> 'snapshot_hash'
          and checkpoint.worker_fence = requested_worker_fence
          and checkpoint.event_sequence = current_projection.version
          and requested_event -> 'payload' -> 'active_artifact_ref'
            is not distinct from
              checkpoint.binding_json -> 'active_artifact_ref'
          and (
            checkpoint.binding_json -> 'active_artifact_ref' = 'null'::jsonb
            or exists (
              select 1
              from app_data_agent.artifacts as artifact
              where artifact.app_id = checkpoint.app_id
                and artifact.tenant_id = checkpoint.tenant_id
                and artifact.environment = checkpoint.environment
                and artifact.run_id = checkpoint.run_id
                and artifact.artifact_id =
                  (checkpoint.binding_json -> 'active_artifact_ref'
                    ->> 'artifact_id')::uuid
                and artifact.artifact_type =
                  checkpoint.binding_json -> 'active_artifact_ref'
                    ->> 'artifact_type'
                and artifact.revision =
                  (checkpoint.binding_json -> 'active_artifact_ref'
                    ->> 'revision')::integer
                and artifact.content_hash =
                  checkpoint.binding_json -> 'active_artifact_ref'
                    ->> 'content_hash'
                and artifact.is_active
            )
          );
      exception
        when others then
          raise exception using
            errcode = '22023',
            message = 'DA_RUN_EVENT_TRANSITION_INVALID';
      end;
      if not found then
        raise exception using
          errcode = '22023',
          message = 'DA_RUN_EVENT_TRANSITION_INVALID';
      end if;
      required_status := 'RUNNING';
    when 'run.side_effect_committed' then
      begin
        perform 1
        from app_data_agent.run_effect_receipts as receipt
        where receipt.app_id = current_authority.app_id
          and receipt.tenant_id = current_authority.tenant_id
          and receipt.environment = current_authority.environment
          and receipt.run_id = requested_run_id
          and receipt.receipt_id =
            (requested_event -> 'payload' ->> 'receipt_id')::uuid
          and receipt.effect_kind =
            requested_event -> 'payload' ->> 'effect_kind'
          and receipt.input_hash =
            requested_event -> 'payload' ->> 'input_hash'
          and receipt.output_hash =
            requested_event -> 'payload' ->> 'output_hash';
      exception
        when others then
          raise exception using
            errcode = '22023',
            message = 'DA_RUN_EVENT_TRANSITION_INVALID';
      end;
      if not found then
        raise exception using
          errcode = '22023',
          message = 'DA_RUN_EVENT_TRANSITION_INVALID';
      end if;
      required_status := 'RUNNING';
    when 'run.progress',
      'run.tool_started',
      'run.tool_completed',
      'run.tool_failed',
      'run.answer_delta',
      'run.reasoning_started',
      'run.reasoning_delta',
      'run.reasoning_completed' then
      required_status := 'RUNNING';
    when 'run.suspended' then
      required_status := 'WAITING';
    when 'run.retry_scheduled' then
      if requested_command_id is distinct from active_attempt.command_id
        or active_delivery_attempt_no >= 5
        or requested_error_code is null
        or requested_error_code !~
          '^[A-Za-z][A-Za-z0-9._:@/-]{0,127}$'
        or pg_catalog.jsonb_typeof(
          requested_event -> 'payload' -> 'retry_delay_ms'
        ) <> 'number'
        or requested_event -> 'payload' ->> 'retry_delay_ms'
          !~ '^(0|[1-9][0-9]{0,7})$'
        or requested_retry_delay_ms not between 1000 and 86400000
      then
        raise exception using
          errcode = '22023',
          message = 'DA_RUN_EVENT_TRANSITION_INVALID';
      end if;
      scheduled_retry_at := now_at + pg_catalog.make_interval(
        secs => requested_retry_delay_ms::double precision / 1000.0
      );
      required_status := 'QUEUED';
    when 'run.completed' then
      required_status := 'COMPLETED';
    when 'run.failed' then
      if requested_error_code is null
        or requested_error_code !~
          '^[A-Za-z][A-Za-z0-9._:@/-]{0,127}$'
        or pg_catalog.jsonb_typeof(
          requested_event -> 'payload' -> 'retryable'
        ) <> 'boolean'
      then
        raise exception using
          errcode = '22023',
          message = 'DA_RUN_EVENT_TRANSITION_INVALID';
      end if;
      required_status := 'FAILED';
  end case;

  if requested_event_type <> 'run.leased'
    and (
      current_projection.status <> 'RUNNING'
      or requested_worker_fence <> current_projection.worker_fence
    )
  then
    raise exception using
      errcode = '22023',
      message = 'DA_RUN_EVENT_TRANSITION_INVALID';
  end if;
  if requested_projection_status <> required_status then
    raise exception using
      errcode = '22023',
      message = 'DA_RUN_EVENT_PROJECTION_INVALID';
  end if;

  insert into app_data_agent.run_events (
    app_id,
    tenant_id,
    environment,
    event_id,
    run_id,
    sequence,
    event_type,
    payload_json,
    attempt_id,
    command_id,
    dedupe_key,
    event_hash,
    worker_fence,
    event_document,
    created_at
  )
  values (
    current_authority.app_id,
    current_authority.tenant_id,
    current_authority.environment,
    requested_event_id,
    requested_run_id,
    requested_sequence,
    requested_event_type,
    requested_event -> 'payload',
    active_attempt.attempt_id,
    requested_command_id,
    requested_dedupe_key,
    requested_event_hash,
    requested_worker_fence,
    requested_event,
    requested_occurred_at
  );

  insert into app_data_agent.run_projections (
    app_id,
    tenant_id,
    environment,
    run_id,
    version,
    status,
    worker_fence,
    event_id,
    projection_hash,
    projection_json,
    occurred_at
  )
  values (
    current_authority.app_id,
    current_authority.tenant_id,
    current_authority.environment,
    requested_run_id,
    requested_sequence,
    requested_projection_status,
    requested_worker_fence,
    requested_event_id,
    requested_projection_hash,
    requested_projection,
    requested_occurred_at
  );

  if requested_event_type = 'run.suspended' then
    update app_data_agent.run_attempts as suspended_attempt
    set status = 'SUSPENDED',
        finished_at = now_at
    where suspended_attempt.app_id = current_authority.app_id
      and suspended_attempt.tenant_id = current_authority.tenant_id
      and suspended_attempt.environment = current_authority.environment
      and suspended_attempt.attempt_id = active_attempt.attempt_id;

    update app_data_agent.outbox as suspended_message
    set status = 'PUBLISHED',
        published_at = now_at,
        lease_owner = null,
        lease_expires_at = null
    where suspended_message.app_id = current_authority.app_id
      and suspended_message.tenant_id = current_authority.tenant_id
      and suspended_message.environment = current_authority.environment
      and suspended_message.outbox_id = active_attempt.outbox_id;

    update app_data_agent.commands as suspended_command
    set status = 'SUCCEEDED'
    where suspended_command.app_id = current_authority.app_id
      and suspended_command.tenant_id = current_authority.tenant_id
      and suspended_command.environment = current_authority.environment
      and suspended_command.command_id = active_attempt.command_id
      and suspended_command.status = 'PROCESSING';

    update app_data_agent.runs as suspended_run
    set status = 'WAITING',
        updated_at = now_at
    where suspended_run.app_id = current_authority.app_id
      and suspended_run.tenant_id = current_authority.tenant_id
      and suspended_run.environment = current_authority.environment
      and suspended_run.run_id = requested_run_id;
  elsif requested_event_type = 'run.retry_scheduled' then
    update app_data_agent.run_attempts as retry_attempt
    set status = 'RETRY_SCHEDULED',
        error_code = requested_error_code,
        retry_at = scheduled_retry_at,
        finished_at = now_at
    where retry_attempt.app_id = current_authority.app_id
      and retry_attempt.tenant_id = current_authority.tenant_id
      and retry_attempt.environment = current_authority.environment
      and retry_attempt.attempt_id = active_attempt.attempt_id;

    update app_data_agent.outbox as retry_message
    set status = 'PENDING',
        available_at = scheduled_retry_at,
        lease_owner = null,
        lease_expires_at = null,
        published_at = null
    where retry_message.app_id = current_authority.app_id
      and retry_message.tenant_id = current_authority.tenant_id
      and retry_message.environment = current_authority.environment
      and retry_message.outbox_id = active_attempt.outbox_id;

    update app_data_agent.runs as retry_run
    set status = 'QUEUED',
        updated_at = now_at
    where retry_run.app_id = current_authority.app_id
      and retry_run.tenant_id = current_authority.tenant_id
      and retry_run.environment = current_authority.environment
      and retry_run.run_id = requested_run_id;
  elsif requested_event_type in ('run.completed', 'run.failed') then
    update app_data_agent.run_attempts as terminal_attempt
    set status = case requested_event_type
          when 'run.completed' then 'SUCCEEDED'
          else 'FAILED'
        end,
        error_code = case requested_event_type
          when 'run.failed' then requested_error_code
          else null
        end,
        finished_at = now_at
    where terminal_attempt.app_id = current_authority.app_id
      and terminal_attempt.tenant_id = current_authority.tenant_id
      and terminal_attempt.environment = current_authority.environment
      and terminal_attempt.attempt_id = active_attempt.attempt_id;

    update app_data_agent.outbox as terminal_message
    set status = case requested_event_type
          when 'run.completed' then 'PUBLISHED'
          else 'DEAD_LETTER'
        end,
        published_at = case requested_event_type
          when 'run.completed' then now_at
          else null
        end,
        lease_owner = null,
        lease_expires_at = null
    where terminal_message.app_id = current_authority.app_id
      and terminal_message.tenant_id = current_authority.tenant_id
      and terminal_message.environment = current_authority.environment
      and terminal_message.outbox_id = active_attempt.outbox_id;

    update app_data_agent.commands as terminal_command
    set status = case requested_event_type
          when 'run.completed' then 'SUCCEEDED'
          else 'FAILED'
        end
    where terminal_command.app_id = current_authority.app_id
      and terminal_command.tenant_id = current_authority.tenant_id
      and terminal_command.environment = current_authority.environment
      and terminal_command.command_id = active_attempt.command_id
      and terminal_command.status = 'PROCESSING';

    update app_data_agent.runs as terminal_run
    set status = case requested_event_type
          when 'run.completed' then 'SUCCEEDED'
          else 'FAILED'
        end,
        updated_at = now_at
    where terminal_run.app_id = current_authority.app_id
      and terminal_run.tenant_id = current_authority.tenant_id
      and terminal_run.environment = current_authority.environment
      and terminal_run.run_id = requested_run_id;
  end if;

  return pg_catalog.jsonb_build_object(
    'replayed',
    false,
    'event',
    requested_event,
    'event_hash',
    requested_event_hash,
    'projection',
    requested_projection,
    'projection_hash',
    requested_projection_hash
  );
end
$$;

create or replace function app_data_agent.complete_run_work(
  requested_outbox_id uuid,
  requested_attempt_id uuid,
  requested_worker_id text,
  expected_lease_token bigint,
  expected_worker_fence bigint,
  final_event_sequence bigint
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_authority record;
begin
  if requested_outbox_id is null
    or requested_attempt_id is null
    or requested_worker_id is null
    or expected_lease_token is null
    or expected_worker_fence is null
    or final_event_sequence is null
    or final_event_sequence < 1
  then
    raise exception using
      errcode = '22023',
      message = 'DA_RUN_COMPLETE_INPUT_INVALID';
  end if;

  select *
  into current_authority
  from platform.current_backend_authority(true);

  if exists (
    select 1
    from app_data_agent.outbox as message
    join app_data_agent.run_attempts as attempt
      on attempt.app_id = message.app_id
     and attempt.tenant_id = message.tenant_id
     and attempt.environment = message.environment
     and attempt.attempt_id = requested_attempt_id
     and attempt.outbox_id = message.outbox_id
    join app_data_agent.run_projections as projection
      on projection.app_id = message.app_id
     and projection.tenant_id = message.tenant_id
     and projection.environment = message.environment
     and projection.run_id = message.run_id
     and projection.version = final_event_sequence
    join app_data_agent.runs as run
      on run.app_id = message.app_id
     and run.tenant_id = message.tenant_id
     and run.environment = message.environment
     and run.run_id = message.run_id
    where message.app_id = current_authority.app_id
      and message.tenant_id = current_authority.tenant_id
      and message.environment = current_authority.environment
      and message.outbox_id = requested_outbox_id
      and message.active_attempt_id = requested_attempt_id
      and message.lease_token = expected_lease_token
      and message.run_fence = expected_worker_fence
      and attempt.worker_id = requested_worker_id
      and attempt.lease_token = expected_lease_token
      and attempt.worker_fence = expected_worker_fence
      and run.active_fence = expected_worker_fence
      and (
        (
          attempt.status in ('SUCCEEDED', 'FAILED')
          and projection.status in ('COMPLETED', 'FAILED')
          and message.status = case projection.status
            when 'COMPLETED' then 'PUBLISHED'
            else 'DEAD_LETTER'
          end
          and run.status = case projection.status
            when 'COMPLETED' then 'SUCCEEDED'
            else 'FAILED'
          end
        )
        or (
          attempt.status = 'SUSPENDED'
          and projection.status = 'WAITING'
          and message.status = 'PUBLISHED'
          and run.status = 'WAITING'
        )
      )
      and not exists (
        select 1
        from app_data_agent.run_projections as newer
        where newer.app_id = projection.app_id
          and newer.tenant_id = projection.tenant_id
          and newer.environment = projection.environment
          and newer.run_id = projection.run_id
          and newer.version > projection.version
      )
      and run.principal_id = current_authority.principal_id
  ) then
    return true;
  end if;
  return false;
end
$$;

create or replace function app_data_agent.retry_run_work(
  requested_outbox_id uuid,
  requested_attempt_id uuid,
  requested_worker_id text,
  expected_lease_token bigint,
  expected_worker_fence bigint,
  final_event_sequence bigint,
  requested_error_code text,
  requested_retry_delay_ms bigint
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_authority record;
begin
  if requested_outbox_id is null
    or requested_attempt_id is null
    or requested_worker_id is null
    or expected_lease_token is null
    or expected_worker_fence is null
    or final_event_sequence is null
    or final_event_sequence < 1
    or requested_error_code is null
    or requested_error_code !~ '^[A-Za-z][A-Za-z0-9._:@/-]{0,127}$'
    or requested_retry_delay_ms is null
    or requested_retry_delay_ms not between 1000 and 86400000
  then
    raise exception using
      errcode = '22023',
      message = 'DA_RUN_RETRY_INPUT_INVALID';
  end if;

  select *
  into current_authority
  from platform.current_backend_authority(true);

  return exists (
    select 1
    from app_data_agent.outbox as message
    join app_data_agent.run_attempts as attempt
      on attempt.app_id = message.app_id
     and attempt.tenant_id = message.tenant_id
     and attempt.environment = message.environment
     and attempt.attempt_id = requested_attempt_id
     and attempt.outbox_id = message.outbox_id
    join app_data_agent.run_projections as projection
      on projection.app_id = message.app_id
     and projection.tenant_id = message.tenant_id
     and projection.environment = message.environment
     and projection.run_id = message.run_id
     and projection.version = final_event_sequence
    join app_data_agent.run_events as event
      on event.app_id = message.app_id
     and event.tenant_id = message.tenant_id
     and event.environment = message.environment
     and event.run_id = message.run_id
     and event.sequence = final_event_sequence
    join app_data_agent.runs as run
      on run.app_id = message.app_id
     and run.tenant_id = message.tenant_id
     and run.environment = message.environment
     and run.run_id = message.run_id
    where message.app_id = current_authority.app_id
      and message.tenant_id = current_authority.tenant_id
      and message.environment = current_authority.environment
      and message.outbox_id = requested_outbox_id
      and message.active_attempt_id = requested_attempt_id
      and message.status = 'PENDING'
      and message.lease_token = expected_lease_token
      and message.run_fence = expected_worker_fence
      and attempt.worker_id = requested_worker_id
      and attempt.lease_token = expected_lease_token
      and attempt.worker_fence = expected_worker_fence
      and attempt.status = 'RETRY_SCHEDULED'
      and attempt.error_code = requested_error_code
      and attempt.retry_at = message.available_at
      and projection.status = 'QUEUED'
      and projection.worker_fence = expected_worker_fence
      and event.event_type = 'run.retry_scheduled'
      and event.worker_fence = expected_worker_fence
      and event.payload_json ->> 'error_code' = requested_error_code
      and (event.payload_json ->> 'retry_delay_ms')::bigint =
        requested_retry_delay_ms
      and run.status = 'QUEUED'
      and run.active_fence = expected_worker_fence
      and not exists (
        select 1
        from app_data_agent.run_projections as newer
        where newer.app_id = projection.app_id
          and newer.tenant_id = projection.tenant_id
          and newer.environment = projection.environment
          and newer.run_id = projection.run_id
          and newer.version > projection.version
      )
      and run.principal_id = current_authority.principal_id
  );
end
$$;

alter table app_data_agent.agent_product_profile_revisions owner to data_agent_u20_profile_owner;
alter table app_data_agent.agent_product_profile_heads owner to data_agent_u20_profile_owner;
alter table app_data_agent.agent_product_profile_operation_receipts owner to data_agent_u20_profile_owner;
alter function app_data_agent.reject_agent_profile_immutable_mutation() owner to data_agent_u20_profile_owner;
alter function app_data_agent.commit_agent_profile_revision(jsonb) owner to data_agent_u20_profile_owner;
alter function app_data_agent.list_agent_profile_revisions(boolean) owner to data_agent_u20_profile_owner;
alter function app_data_agent.current_agent_product_profile_refs() owner to data_agent_u20_profile_owner;
alter function app_data_agent.route_question_run_to_agent_team() owner to data_agent_u20_profile_owner;
alter function app_data_agent.assert_provider_active_worker_lease_pre_u20(jsonb)
  owner to data_agent_provider_invocation_rpc_owner;
alter function app_data_agent.assert_provider_active_worker_lease(jsonb)
  owner to data_agent_provider_invocation_rpc_owner;
alter function app_data_agent.load_agent_team_public_projection(uuid)
  owner to data_agent_u19_team_owner;
alter function app_data_agent.public_run_display_payload_is_valid(text,jsonb)
  owner to data_agent_u20_profile_owner;
grant usage on schema app_data_agent,platform to data_agent_u20_profile_owner;
grant execute on function platform.current_backend_authority(boolean),
  platform.backend_context_matches(uuid,uuid,text,boolean),
  platform.canonical_sha256(jsonb),
  app_data_agent.u2_canonical_sha256(jsonb),app_data_agent.resolved_context_exact_keys(jsonb,text[])
  to data_agent_u20_profile_owner;
grant select on app_data_agent.skill_revisions,app_data_agent.skill_heads,
  app_data_agent.skill_signer_revocations,app_data_agent.agent_profile_revisions
  to data_agent_u20_profile_owner;
revoke all on function app_data_agent.public_run_display_payload_is_valid(text,jsonb)
  from public,anon,authenticated,service_role;
grant execute on function app_data_agent.public_run_display_payload_is_valid(text,jsonb)
  to data_agent_backend,data_agent_job_authority;
revoke all on app_data_agent.agent_product_profile_revisions,
  app_data_agent.agent_product_profile_heads,app_data_agent.agent_product_profile_operation_receipts
  from public,anon,authenticated,service_role,data_agent_backend;
revoke all on function app_data_agent.commit_agent_profile_revision(jsonb),
  app_data_agent.list_agent_profile_revisions(boolean),
  app_data_agent.current_agent_product_profile_refs(),
  app_data_agent.route_question_run_to_agent_team()
  from public,anon,authenticated,service_role,data_agent_backend;
grant execute on function app_data_agent.commit_agent_profile_revision(jsonb),
  app_data_agent.list_agent_profile_revisions(boolean) to data_agent_backend;
revoke all on function app_data_agent.load_agent_team_public_projection(uuid)
  from public,anon,authenticated,service_role,data_agent_backend;
grant execute on function app_data_agent.load_agent_team_public_projection(uuid)
  to data_agent_backend;
revoke all on function app_data_agent.assert_provider_active_worker_lease_pre_u20(jsonb),
  app_data_agent.assert_provider_active_worker_lease(jsonb)
  from public,anon,authenticated,service_role,data_agent_backend,data_agent_job_authority;

do $postconditions$
begin
  if exists(select 1 from pg_catalog.pg_class relation join pg_catalog.pg_namespace namespace
    on namespace.oid=relation.relnamespace where namespace.nspname='app_data_agent'
      and relation.relname in ('agent_product_profile_revisions','agent_product_profile_heads',
        'agent_product_profile_operation_receipts')
      and (not relation.relrowsecurity or not relation.relforcerowsecurity
        or relation.relowner<>(select oid from pg_catalog.pg_roles
          where rolname='data_agent_u20_profile_owner')))
  then raise exception using errcode='P0001',message='U20_AGENT_PROFILE_RLS_OR_OWNER_UNSAFE'; end if;
  if not exists(select 1 from pg_catalog.pg_roles where rolname='data_agent_u20_profile_owner'
    and not rolcanlogin and not rolsuper and not rolinherit and not rolbypassrls)
  then raise exception using errcode='P0001',message='U20_AGENT_PROFILE_OWNER_FLAGS_UNSAFE'; end if;
  if pg_catalog.has_table_privilege('data_agent_backend',
    'app_data_agent.agent_product_profile_revisions','INSERT,UPDATE,DELETE')
  then raise exception using errcode='P0001',message='U20_AGENT_PROFILE_BACKEND_DML_UNSAFE'; end if;
end
$postconditions$;
select platform.assert_migration_checksum(
  'app','00000000-0000-4000-8000-00000000da01'::uuid,
  '20260725010667_app_data_agent_agent_product_profiles','sha256:d917fcd4aa24928fcda7b83d8879a0a435a329d91331aa38d90c05a7949c9a9d');
commit;
