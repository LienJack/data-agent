create or replace function app_data_agent.list_agent_profile_revisions_v2(enabled_only boolean)
returns jsonb language plpgsql stable security definer set search_path='' as $function$
declare authority record; items jsonb;
begin
  if not pg_catalog.pg_has_role(session_user,'data_agent_backend','USAGE') then
    raise exception using errcode='42501',message='DA_BACKEND_ROLE_REQUIRED'; end if;
  select * into authority from platform.current_backend_authority(false);
  select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
    'schema_version','agent-product-profile-registry-item@2.0.0','revision',revision.document_json,
    'head',pg_catalog.jsonb_build_object(
      'schema_version','agent-product-profile-head@2.0.0',
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
    and revision.document_json->>'schema_version'='agent-product-profile-revision@2.0.0'
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
  return pg_catalog.jsonb_build_object(
    'schema_version','agent-product-profile-list-result@2.0.0','items',items);
end
$function$;

alter function app_data_agent.list_agent_profile_revisions_v2(boolean)
  owner to data_agent_u20_profile_owner;
