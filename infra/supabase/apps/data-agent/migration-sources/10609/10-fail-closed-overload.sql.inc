-- ============================================================
-- Temporary overload for the historical 10610 GRANT only
-- ============================================================

do $compatibility$
begin
  if not exists (
    select 1
    from platform.migration_ledger as ledger
    where ledger.owner_kind = 'app'
      and ledger.app_id = '00000000-0000-4000-8000-00000000da01'::uuid
      and ledger.migration_version = '20260725010610_app_data_agent_semantic_control_plane'
  ) then
    execute 'create schema if not exists semantic';
    execute $ddl$
      create or replace function semantic.commit_publish_attempt(
        p_app_id uuid,
        p_tenant_id uuid,
        p_environment text,
        p_semantic_domain text,
        p_attempt_id uuid,
        p_executable_projection_ref uuid,
        p_executable_projection_hash text,
        p_relationship_projection_ref uuid,
        p_relationship_projection_hash text,
        p_runtime_restriction_projection_ref uuid,
        p_runtime_restriction_projection_hash text,
        p_committed_legacy_attempt_ref uuid
      ) returns jsonb
        language plpgsql
        called on null input
        security invoker
        set search_path = ''
      as $function$
      begin
        raise exception using
          errcode = '0A000',
          message = 'SEMANTIC_COMMIT_PUBLISH_COMPATIBILITY_SIGNATURE_DISABLED';
      end;
      $function$
    $ddl$;
    execute $revoke$
      revoke all on function semantic.commit_publish_attempt(
        uuid, uuid, text, text, uuid, uuid, text, uuid, text, uuid, text, uuid
      ) from public
    $revoke$;
    execute $revoke$
      revoke all on function semantic.commit_publish_attempt(
        uuid, uuid, text, text, uuid, uuid, text, uuid, text, uuid, text, uuid
      ) from data_agent_u6_rpc_owner
    $revoke$;
  end if;
end
$compatibility$;
