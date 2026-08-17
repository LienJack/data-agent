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
