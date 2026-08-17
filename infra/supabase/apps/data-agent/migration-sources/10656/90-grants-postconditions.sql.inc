-- ============================================================
-- Ownership, RLS, grants, and postconditions.
-- ============================================================

do $u5_tables$
declare name text;
begin
  foreach name in array array[
    'semantic_bootstrap_signer_key_revisions','semantic_bootstrap_signer_activations',
    'verified_semantic_domain_bootstrap_receipts','semantic_bootstrap_policy_revisions',
    'semantic_bootstrap_policy_pointer','semantic_bootstrap_publisher_grants',
    'semantic_bootstrap_validation_receipts','initial_semantic_release_sets',
    'initial_semantic_release_package_bindings','semantic_package_admission_receipts',
    'first_release_admission_receipts','semantic_bootstrap_capability_tombstones',
    'semantic_bootstrap_publish_idempotency','semantic_bootstrap_outbox'
  ] loop
    execute pg_catalog.format('alter table semantic.%I owner to data_agent_u5_data_owner',name);
    execute pg_catalog.format('alter table semantic.%I enable row level security',name);
    execute pg_catalog.format('alter table semantic.%I force row level security',name);
    execute pg_catalog.format(
      'create policy %I on semantic.%I for all to data_agent_u5_verifier_owner using (platform.backend_context_matches(app_id,tenant_id,environment,false)) with check (platform.backend_context_matches(app_id,tenant_id,environment,true))',
      'u5_verifier_'||name,name);
    execute pg_catalog.format(
      'create policy %I on semantic.%I for all to data_agent_u5_publisher_owner using (platform.backend_context_matches(app_id,tenant_id,environment,false)) with check (platform.backend_context_matches(app_id,tenant_id,environment,true))',
      'u5_publisher_'||name,name);
  end loop;
end
$u5_tables$;

grant usage on schema semantic,platform,app_data_agent,extensions to
  data_agent_u5_data_owner,data_agent_u5_verifier_owner,data_agent_u5_publisher_owner,
  data_agent_u5_human_governance_owner;

grant select,insert,update on table
  semantic.semantic_bootstrap_signer_key_revisions,
  semantic.semantic_bootstrap_signer_activations,
  semantic.verified_semantic_domain_bootstrap_receipts,
  semantic.semantic_bootstrap_policy_revisions,
  semantic.semantic_bootstrap_policy_pointer,
  semantic.semantic_bootstrap_publisher_grants
to data_agent_u5_verifier_owner;
grant select,insert on table semantic.semantic_domain_registry to data_agent_u5_verifier_owner;
grant select,insert,update on table
  semantic.semantic_authority_fence,semantic.semantic_active_pointer,semantic.semantic_runtime_activation
to data_agent_u5_verifier_owner;

grant select on table
  semantic.verified_semantic_domain_bootstrap_receipts,
  semantic.semantic_bootstrap_policy_revisions,semantic.semantic_bootstrap_policy_pointer
to data_agent_u5_publisher_owner;
grant select,update on table semantic.semantic_bootstrap_publisher_grants
to data_agent_u5_publisher_owner;
grant select,insert,update on table
  semantic.semantic_bootstrap_validation_receipts,semantic.initial_semantic_release_sets,
  semantic.initial_semantic_release_package_bindings,semantic.semantic_package_admission_receipts,
  semantic.first_release_admission_receipts,semantic.semantic_bootstrap_capability_tombstones,
  semantic.semantic_bootstrap_publish_idempotency,semantic.semantic_bootstrap_outbox
to data_agent_u5_publisher_owner;
grant select,update on table
  semantic.semantic_authority_fence,semantic.semantic_active_pointer,semantic.semantic_runtime_activation,
  semantic.semantic_candidate
to data_agent_u5_publisher_owner;
grant select,insert,update on table semantic.semantic_publish_attempt
to data_agent_u5_publisher_owner;
grant select on table semantic.semantic_candidate_revision to data_agent_u5_publisher_owner;
grant select,insert on table
  semantic.semantic_review_task,semantic.semantic_source_release,
  semantic.semantic_executable_projection,semantic.semantic_relationship_projection,
  semantic.semantic_runtime_restriction_projection
to data_agent_u5_publisher_owner;
grant select on table
  semantic.ontology_package_candidates,semantic.ontology_package_validation_receipts,
  semantic.ontology_package_preview_bindings
to data_agent_u5_publisher_owner;
grant insert on table app_data_agent.audit_log to data_agent_u5_publisher_owner;
create policy audit_log_u5_publisher_insert on app_data_agent.audit_log
for insert to data_agent_u5_publisher_owner
with check (platform.backend_context_matches(app_id,tenant_id,environment,true));

grant select,insert,update on table
  semantic.semantic_authority_fence,semantic.semantic_review_task,semantic.semantic_publish_attempt,
  semantic.semantic_source_release,semantic.semantic_active_pointer,semantic.semantic_runtime_activation,
  semantic.semantic_candidate,semantic.semantic_rollback_authorization,semantic.semantic_rollback_receipt
to data_agent_u5_human_governance_owner;
grant select on table semantic.semantic_review_decision to data_agent_u5_human_governance_owner;

do $u5_legacy_policies$
declare name text; role_name text;
begin
  foreach role_name in array array[
    'data_agent_u5_verifier_owner','data_agent_u5_publisher_owner','data_agent_u5_human_governance_owner'
  ] loop
    foreach name in array array[
      'semantic_domain_registry','semantic_authority_fence','semantic_active_pointer','semantic_runtime_activation',
      'semantic_candidate','semantic_candidate_revision','semantic_review_task','semantic_review_decision','semantic_publish_attempt',
      'semantic_source_release','semantic_executable_projection','semantic_relationship_projection',
      'semantic_runtime_restriction_projection','semantic_rollback_authorization','semantic_rollback_receipt',
      'ontology_package_candidates','ontology_package_validation_receipts','ontology_package_preview_bindings'
    ] loop
      if pg_catalog.to_regclass('semantic.'||name) is not null then
        execute pg_catalog.format(
          'create policy %I on semantic.%I for all to %I using (platform.backend_context_matches(app_id,tenant_id,environment,false)) with check (platform.backend_context_matches(app_id,tenant_id,environment,true))',
          'u5_'||pg_catalog.md5(role_name||':'||name),name,role_name);
      end if;
    end loop;
  end loop;
end
$u5_legacy_policies$;

grant execute on function
  platform.backend_context_matches(uuid,uuid,text,boolean),app_data_agent.u2_canonical_sha256(jsonb),
  app_data_agent.contains_potential_plaintext_secret(jsonb,text),
  app_data_agent.runtime_canonical_json(jsonb),
  semantic.u5_json_has_exact_keys(jsonb,text[]),semantic.assert_u5_scope(jsonb,text,boolean),
  semantic.lock_semantic_authority_fence(uuid,uuid,text,text)
to data_agent_u5_verifier_owner,data_agent_u5_publisher_owner,data_agent_u5_human_governance_owner;
grant execute on function semantic.semantic_sha256(text,jsonb) to data_agent_u5_human_governance_owner;

alter function semantic.register_semantic_bootstrap_signer_key(jsonb) owner to data_agent_u5_verifier_owner;
alter function semantic.activate_semantic_bootstrap_signer_key(jsonb) owner to data_agent_u5_verifier_owner;
alter function semantic.commit_semantic_bootstrap_policy(jsonb) owner to data_agent_u5_verifier_owner;
alter function semantic.load_semantic_bootstrap_signer_context(jsonb) owner to data_agent_u5_verifier_owner;
alter function semantic.commit_verified_semantic_domain_bootstrap(jsonb) owner to data_agent_u5_verifier_owner;
alter function semantic.create_semantic_bootstrap_publisher_grant(jsonb) owner to data_agent_u5_verifier_owner;
alter function semantic.commit_semantic_bootstrap_validation(jsonb) owner to data_agent_u5_publisher_owner;
alter function semantic.publish_initial_semantic_release_set(jsonb) owner to data_agent_u5_publisher_owner;
alter function semantic.load_initial_semantic_release_set(jsonb) owner to data_agent_u5_publisher_owner;

alter function semantic.prepare_publish_attempt(uuid,uuid,text,text,uuid,uuid,text,bigint,bigint,bigint,text,jsonb)
  owner to data_agent_u5_human_governance_owner;
alter function semantic.commit_publish_attempt(uuid,uuid,text,text,uuid,uuid,text,uuid,text,uuid,text,jsonb,uuid)
  owner to data_agent_u5_human_governance_owner;
alter function semantic.execute_rollback(uuid,uuid,text,text,uuid,uuid,text)
  owner to data_agent_u5_human_governance_owner;
alter function semantic.bootstrap_domain(uuid,uuid,text,text,uuid,text,text,text,text,text,text,jsonb,text,jsonb,text,text,text,uuid,timestamptz)
  owner to data_agent_u5_human_governance_owner;
alter function semantic.human_prepare_publish_attempt(jsonb) owner to data_agent_u5_human_governance_owner;
alter function semantic.human_commit_publish_attempt(jsonb) owner to data_agent_u5_human_governance_owner;
alter function semantic.human_execute_rollback(jsonb) owner to data_agent_u5_human_governance_owner;

revoke all on all tables in schema semantic from public,anon,authenticated;
revoke all on function
  semantic.register_semantic_bootstrap_signer_key(jsonb),
  semantic.activate_semantic_bootstrap_signer_key(jsonb),
  semantic.commit_semantic_bootstrap_policy(jsonb),
  semantic.load_semantic_bootstrap_signer_context(jsonb),
  semantic.commit_verified_semantic_domain_bootstrap(jsonb),
  semantic.create_semantic_bootstrap_publisher_grant(jsonb),
  semantic.commit_semantic_bootstrap_validation(jsonb),
  semantic.publish_initial_semantic_release_set(jsonb),
  semantic.load_initial_semantic_release_set(jsonb),
  semantic.prepare_publish_attempt(uuid,uuid,text,text,uuid,uuid,text,bigint,bigint,bigint,text,jsonb),
  semantic.commit_publish_attempt(uuid,uuid,text,text,uuid,uuid,text,uuid,text,uuid,text,jsonb,uuid),
  semantic.execute_rollback(uuid,uuid,text,text,uuid,uuid,text),
  semantic.bootstrap_domain(uuid,uuid,text,text,uuid,text,text,text,text,text,text,jsonb,text,jsonb,text,text,text,uuid,timestamptz),
  semantic.human_prepare_publish_attempt(jsonb),semantic.human_commit_publish_attempt(jsonb),
  semantic.human_execute_rollback(jsonb)
from public,anon,authenticated,service_role,data_agent_backend;

grant execute on function
  semantic.human_prepare_publish_attempt(jsonb),semantic.human_commit_publish_attempt(jsonb),
  semantic.human_execute_rollback(jsonb)
to data_agent_backend;

do $u5_postconditions$
begin
  if exists (select 1 from pg_catalog.pg_roles where rolname like 'data_agent_u5_%_owner'
    and (rolcanlogin or rolsuper or rolcreatedb or rolcreaterole or rolreplication or rolinherit or rolbypassrls))
  then raise exception 'SEMANTIC_BOOTSTRAP_OWNER_ROLE_UNSAFE'; end if;
  if pg_catalog.has_function_privilege('anon','semantic.publish_initial_semantic_release_set(jsonb)','EXECUTE')
    or pg_catalog.has_function_privilege('data_agent_backend',
      'semantic.bootstrap_domain(uuid,uuid,text,text,uuid,text,text,text,text,text,text,jsonb,text,jsonb,text,text,text,uuid,timestamptz)','EXECUTE')
  then raise exception 'SEMANTIC_BOOTSTRAP_EXECUTE_SURFACE_UNSAFE'; end if;
end
$u5_postconditions$;
