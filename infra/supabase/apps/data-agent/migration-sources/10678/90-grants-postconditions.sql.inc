alter table app_data_agent.legacy_attribution_cleanup_receipts
  owner to data_agent_legacy_attribution_cleanup_owner;
alter function app_data_agent.reject_legacy_attribution_cleanup_receipt_mutation()
  owner to data_agent_legacy_attribution_cleanup_owner;
alter function app_data_agent.legacy_attribution_cleanup_target_tables()
  owner to data_agent_legacy_attribution_cleanup_owner;
alter function app_data_agent.legacy_attribution_cleanup_inventory(uuid)
  owner to data_agent_legacy_attribution_cleanup_owner;
alter function app_data_agent.execute_legacy_attribution_cleanup(jsonb)
  owner to data_agent_legacy_attribution_cleanup_owner;

alter table app_data_agent.legacy_attribution_cleanup_receipts enable row level security;
alter table app_data_agent.legacy_attribution_cleanup_receipts force row level security;
create policy legacy_attribution_cleanup_receipts_owner_all
on app_data_agent.legacy_attribution_cleanup_receipts for all
to data_agent_legacy_attribution_cleanup_owner using(true) with check(true);

grant usage on schema app_data_agent,platform to data_agent_legacy_attribution_cleanup_owner;
grant select,insert on app_data_agent.legacy_attribution_cleanup_receipts
  to data_agent_legacy_attribution_cleanup_owner;
grant select,delete on
  app_data_agent.attribution_active_pointer,
  app_data_agent.attribution_capability_directory,
  app_data_agent.attribution_conclusion_policy,
  app_data_agent.attribution_eligibility_decision,
  app_data_agent.attribution_nonce_ledger,
  app_data_agent.attribution_owner_map_release,
  app_data_agent.attribution_profile_projection,
  app_data_agent.attribution_profile_request,
  app_data_agent.attribution_relationship_promotion_receipt,
  app_data_agent.attribution_safety_verdict,
  app_data_agent.attribution_signer_assignment,
  app_data_agent.attribution_verification_key_revision
to data_agent_legacy_attribution_cleanup_owner;
grant select on platform.deployment_mappings,platform.app_environment_lifecycle,platform.migration_ledger
  to data_agent_legacy_attribution_cleanup_owner;
grant execute on function platform.canonical_sha256(jsonb)
  to data_agent_legacy_attribution_cleanup_owner;

revoke all on app_data_agent.legacy_attribution_cleanup_receipts
  from public,anon,authenticated,service_role,data_agent_backend;
revoke all on function
  app_data_agent.reject_legacy_attribution_cleanup_receipt_mutation(),
  app_data_agent.legacy_attribution_cleanup_target_tables(),
  app_data_agent.legacy_attribution_cleanup_inventory(uuid),
  app_data_agent.execute_legacy_attribution_cleanup(jsonb)
from public,anon,authenticated,service_role,data_agent_backend;

do $postconditions$
begin
  if not exists(select 1 from pg_catalog.pg_roles
      where rolname='data_agent_legacy_attribution_cleanup_owner'
        and not rolcanlogin and not rolinherit and rolbypassrls and not rolsuper)
    or pg_catalog.to_regclass('app_data_agent.legacy_attribution_cleanup_receipts') is null
    or pg_catalog.to_regprocedure('app_data_agent.legacy_attribution_cleanup_inventory(uuid)') is null
    or pg_catalog.to_regprocedure('app_data_agent.execute_legacy_attribution_cleanup(jsonb)') is null
    or pg_catalog.has_function_privilege('data_agent_backend',
      'app_data_agent.execute_legacy_attribution_cleanup(jsonb)','EXECUTE')
    or pg_catalog.has_function_privilege('authenticated',
      'app_data_agent.legacy_attribution_cleanup_inventory(uuid)','EXECUTE')
    or pg_catalog.has_table_privilege('data_agent_backend',
      'app_data_agent.legacy_attribution_cleanup_receipts','SELECT')
  then raise exception using errcode='P0001',message='LEGACY_ATTRIBUTION_CLEANUP_POSTCONDITION_FAILED'; end if;
end
$postconditions$;
