-- legacy_profile_list_runtime_repair_migration_checksum: sha256:46d0334725b021afc286e4e5aed2e916aecf0a5b78c7ec72725433525f06937a
begin;

do $bootstrap$
begin
  if pg_catalog.current_setting('server_version_num')::integer not between 170000 and 179999 then
    raise exception using
      errcode = '0A000',
      message = 'LEGACY_PROFILE_LIST_RUNTIME_REPAIR_POSTGRES_VERSION_UNSUPPORTED';
  end if;
  if session_user <> 'postgres' or current_user <> 'postgres' then
    raise exception using
      errcode = '42501',
      message = 'LEGACY_PROFILE_LIST_RUNTIME_REPAIR_EXECUTOR_UNSAFE';
  end if;
  if not exists (
    select 1
    from platform.migration_ledger
    where owner_kind = 'app'
      and app_id = '00000000-0000-4000-8000-00000000da01'::uuid
      and migration_version = '20260725010700_app_data_agent_provider_task_validator_grant_repair'
  ) then
    raise exception using
      errcode = 'P0001',
      message = 'LEGACY_PROFILE_LIST_RUNTIME_REPAIR_BASELINE_10700_MISSING';
  end if;
end
$bootstrap$;

set local lock_timeout = '2000ms';
set local statement_timeout = '300000ms';
set local idle_in_transaction_session_timeout = '60000ms';

select platform.acquire_migration_lock(
  'app',
  '00000000-0000-4000-8000-00000000da01'::uuid
);

create or replace function app_data_agent.list_agent_profile_revisions(enabled_only boolean)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  authority record;
  items jsonb;
begin
  if not pg_catalog.pg_has_role(session_user, 'data_agent_backend', 'USAGE') then
    raise exception using errcode = '42501', message = 'DA_BACKEND_ROLE_REQUIRED';
  end if;
  select * into authority from platform.current_backend_authority(false);

  select coalesce(
    pg_catalog.jsonb_agg(
      pg_catalog.jsonb_build_object(
        'schema_version', 'agent-product-profile-registry-item@1.0.0',
        'revision', revision.document_json,
        'head', pg_catalog.jsonb_build_object(
          'schema_version', 'agent-product-profile-head@1.0.0',
          'scope', pg_catalog.jsonb_build_object(
            'app_id', head.app_id,
            'tenant_id', head.tenant_id,
            'environment', head.environment
          ),
          'profile_id', head.profile_id,
          'active_revision', revision.revision,
          'active_revision_hash', revision.revision_hash,
          'lifecycle', head.lifecycle,
          'version', head.version,
          'updated_at', head.updated_at
        )
      )
      order by head.profile_id
    ),
    '[]'::jsonb
  ) into items
  from app_data_agent.agent_product_profile_heads head
  join lateral (
    select candidate.*
    from app_data_agent.agent_product_profile_revisions candidate
    where candidate.app_id = head.app_id
      and candidate.tenant_id = head.tenant_id
      and candidate.environment = head.environment
      and candidate.profile_id = head.profile_id
      and candidate.document_json ->> 'schema_version' =
        'agent-product-profile-revision@1.0.0'
    order by candidate.revision desc
    limit 1
  ) revision on true
  where head.app_id = authority.app_id
    and head.tenant_id = authority.tenant_id
    and head.environment = authority.environment
    and (
      not enabled_only
      or (
        head.lifecycle = 'ENABLED'
        and revision.approval_status = 'APPROVED'
        and not exists (
          select 1
          from pg_catalog.jsonb_array_elements(revision.document_json -> 'skill_refs')
            skill_ref(document)
          where not exists (
            select 1
            from app_data_agent.skill_revisions skill
            join app_data_agent.skill_heads skill_head
              on skill_head.app_id = skill.app_id
              and skill_head.tenant_id = skill.tenant_id
              and skill_head.environment = skill.environment
              and skill_head.skill_id = skill.skill_id
              and skill_head.active_revision = skill.revision
              and skill_head.active_revision_hash = skill.revision_hash
            where skill.app_id = revision.app_id
              and skill.tenant_id = revision.tenant_id
              and skill.environment = revision.environment
              and skill.skill_id = (skill_ref.document ->> 'skill_id')::uuid
              and skill.revision = (skill_ref.document ->> 'revision')::bigint
              and skill.revision_hash = skill_ref.document ->> 'revision_hash'
              and skill.approval_status = 'APPROVED'
              and skill_head.lifecycle = 'ENABLED'
              and not exists (
                select 1
                from app_data_agent.skill_signer_revocations revocation
                where revocation.app_id = skill.app_id
                  and revocation.tenant_id = skill.tenant_id
                  and revocation.environment = skill.environment
                  and revocation.signer_id = skill.signer_id
              )
          )
        )
      )
    );

  return pg_catalog.jsonb_build_object(
    'schema_version', 'agent-product-profile-list-result@1.0.0',
    'items', items
  );
end
$function$;

alter function app_data_agent.list_agent_profile_revisions(boolean)
owner to data_agent_u20_profile_owner;
revoke all on function app_data_agent.list_agent_profile_revisions(boolean)
from public, data_agent_backend, data_agent_u20_profile_owner;
grant execute on function app_data_agent.list_agent_profile_revisions(boolean)
to data_agent_u20_profile_owner, data_agent_backend;

do $postconditions$
declare
  definition text;
begin
  select pg_catalog.pg_get_functiondef(
    'app_data_agent.list_agent_profile_revisions(boolean)'::regprocedure
  ) into definition;
  if (
      select pg_catalog.pg_get_userbyid(proowner)
      from pg_catalog.pg_proc
      where oid = 'app_data_agent.list_agent_profile_revisions(boolean)'::regprocedure
    ) <> 'data_agent_u20_profile_owner'
    or not pg_catalog.has_function_privilege(
      'data_agent_backend',
      'app_data_agent.list_agent_profile_revisions(boolean)',
      'EXECUTE'
    )
    or pg_catalog.has_function_privilege(
      'public',
      'app_data_agent.list_agent_profile_revisions(boolean)',
      'EXECUTE'
    )
    or pg_catalog.strpos(definition, 'agent-product-profile-revision@1.0.0') = 0
    or pg_catalog.strpos(definition, 'join lateral') = 0
    or pg_catalog.strpos(definition, 'candidate.revision desc') = 0
    or pg_catalog.strpos(definition, 'skill_signer_revocations') = 0
  then
    raise exception using
      errcode = 'P0001',
      message = 'LEGACY_PROFILE_LIST_RUNTIME_REPAIR_POSTCONDITION_FAILED';
  end if;
end
$postconditions$;

select platform.assert_migration_checksum(
  'app',
  '00000000-0000-4000-8000-00000000da01'::uuid,
  '20260725010701_app_data_agent_legacy_profile_list_runtime_repair',
  'sha256:46d0334725b021afc286e4e5aed2e916aecf0a5b78c7ec72725433525f06937a'
);

commit;
