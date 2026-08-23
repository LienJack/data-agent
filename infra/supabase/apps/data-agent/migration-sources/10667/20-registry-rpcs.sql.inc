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
