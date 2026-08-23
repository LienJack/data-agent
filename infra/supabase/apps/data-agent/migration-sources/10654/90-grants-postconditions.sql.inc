create or replace function platform.resolve_backend_authority(
  requested_deployment_id uuid,
  requested_tenant_id uuid,
  requested_principal_id uuid,
  require_write boolean default false
)
returns table (
  app_id uuid,tenant_id uuid,environment text,deployment_id uuid,principal_id uuid,
  membership_role text,membership_version bigint,app_epoch bigint,
  lifecycle_state text,can_write boolean
)
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
  lock_app_id uuid;
  lock_environment text;
begin
  if not pg_catalog.pg_has_role(session_user,'data_agent_backend','USAGE')
    and not pg_catalog.pg_has_role(session_user,'data_agent_job_authority','USAGE')
  then
    raise exception using errcode = '42501',message = 'DA_BACKEND_ROLE_REQUIRED';
  end if;
  if require_write is null then
    raise exception using errcode = '22023',message = 'DA_AUTHORITY_MODE_INVALID';
  end if;
  if require_write then
    select deployment.app_id,deployment.environment
    into lock_app_id,lock_environment
    from platform.deployment_mappings deployment
    where deployment.deployment_id = requested_deployment_id and deployment.is_active;
    if found then
      perform platform.acquire_lifecycle_shared_lock(lock_app_id,lock_environment);
    end if;
  end if;
  return query
  select deployment.app_id,membership.tenant_id,deployment.environment,
    deployment.deployment_id,membership.principal_id,membership.membership_role,
    membership.membership_version,lifecycle.authority_epoch,lifecycle.lifecycle_state,
    lifecycle.lifecycle_state = 'ACTIVE'
      and membership.membership_role in ('owner','analyst')
  from platform.deployment_mappings deployment
  join platform.app_environment_lifecycle lifecycle
    on lifecycle.app_id = deployment.app_id
   and lifecycle.environment = deployment.environment
  join app_data_agent.memberships membership
    on membership.app_id = deployment.app_id
   and membership.environment = deployment.environment
  where deployment.deployment_id = requested_deployment_id
    and deployment.is_active
    and membership.tenant_id = requested_tenant_id
    and membership.principal_id = requested_principal_id
    and membership.membership_role <> 'demo'
    and membership.revoked_at is null
    and lifecycle.lifecycle_state <> 'DELETED'
    and (not require_write or (
      lifecycle.lifecycle_state = 'ACTIVE'
      and membership.membership_role in ('owner','analyst')));
  if not found then
    raise exception using errcode = '42501',message = 'DA_SCOPE_FORBIDDEN';
  end if;
end
$function$;

create or replace function platform.revalidate_backend_authority(
  requested_app_id uuid,
  requested_tenant_id uuid,
  requested_environment text,
  requested_deployment_id uuid,
  requested_principal_id uuid,
  requested_role text,
  requested_membership_version bigint,
  requested_app_epoch bigint,
  require_write boolean default false
)
returns table (
  app_id uuid,tenant_id uuid,environment text,deployment_id uuid,principal_id uuid,
  membership_role text,membership_version bigint,app_epoch bigint,
  lifecycle_state text,can_write boolean
)
language plpgsql
volatile
security definer
set search_path = ''
as $function$
begin
  if not pg_catalog.pg_has_role(session_user,'data_agent_backend','USAGE')
    and not pg_catalog.pg_has_role(session_user,'data_agent_job_authority','USAGE')
  then
    raise exception using errcode = '42501',message = 'DA_BACKEND_ROLE_REQUIRED';
  end if;
  if require_write is null then
    raise exception using errcode = '22023',message = 'DA_AUTHORITY_MODE_INVALID';
  end if;
  if require_write then
    perform platform.acquire_lifecycle_shared_lock(requested_app_id,requested_environment);
  end if;
  return query
  select deployment.app_id,membership.tenant_id,deployment.environment,
    deployment.deployment_id,membership.principal_id,membership.membership_role,
    membership.membership_version,lifecycle.authority_epoch,lifecycle.lifecycle_state,
    lifecycle.lifecycle_state = 'ACTIVE'
      and membership.membership_role in ('owner','analyst')
  from platform.deployment_mappings deployment
  join platform.app_environment_lifecycle lifecycle
    on lifecycle.app_id = deployment.app_id
   and lifecycle.environment = deployment.environment
  join app_data_agent.memberships membership
    on membership.app_id = deployment.app_id
   and membership.environment = deployment.environment
  where deployment.app_id = requested_app_id
    and membership.tenant_id = requested_tenant_id
    and deployment.environment = requested_environment
    and deployment.deployment_id = requested_deployment_id
    and membership.principal_id = requested_principal_id
    and membership.membership_role = requested_role
    and membership.membership_version = requested_membership_version
    and lifecycle.authority_epoch = requested_app_epoch
    and deployment.is_active
    and membership.membership_role <> 'demo'
    and membership.revoked_at is null
    and lifecycle.lifecycle_state <> 'DELETED'
    and (not require_write or (
      lifecycle.lifecycle_state = 'ACTIVE'
      and membership.membership_role in ('owner','analyst')));
  if not found then
    raise exception using errcode = '42501',message = 'DA_AUTHORITY_STALE_OR_FORBIDDEN';
  end if;
end
$function$;

revoke all on table
  app_data_agent.provider_invocation_intents,
  app_data_agent.provider_invocation_dispatch_permits,
  app_data_agent.provider_invocation_outcomes,
  app_data_agent.provider_invocation_usage_receipts
from public,anon,authenticated,service_role,data_agent_backend,data_agent_job_authority;

grant usage on schema app_data_agent,platform
to data_agent_provider_invocation_rpc_owner;
grant usage on schema app_data_agent,platform
to data_agent_provider_smoke_rpc_owner;
grant usage on schema app_data_agent to data_agent_backend,data_agent_job_authority;
grant execute on function
  platform.resolve_backend_authority(uuid,uuid,uuid,boolean),
  platform.revalidate_backend_authority(uuid,uuid,text,uuid,uuid,text,bigint,bigint,boolean),
  platform.backend_context_matches(uuid,uuid,text,boolean)
to data_agent_job_authority;
grant execute on function
  platform.current_backend_authority(boolean),
  platform.backend_context_matches(uuid,uuid,text,boolean),
  platform.backend_run_object_matches(uuid,uuid,text,uuid,boolean),
  platform.canonical_sha256(jsonb),
  app_data_agent.u2_canonical_sha256(jsonb),
  app_data_agent.contains_potential_plaintext_secret(jsonb,text),
  app_data_agent.runtime_iso_timestamp(timestamptz),
  app_data_agent.lock_owned_run_fence(uuid),
  app_data_agent.revalidate_effective_run_config_internal(uuid,bigint,text,uuid,boolean)
to data_agent_provider_invocation_rpc_owner;
grant execute on function
  platform.current_backend_authority(boolean),
  platform.backend_context_matches(uuid,uuid,text,boolean),
  platform.backend_run_object_matches(uuid,uuid,text,uuid,boolean),
  platform.canonical_sha256(jsonb),
  app_data_agent.u2_canonical_sha256(jsonb),
  app_data_agent.provider_json_object_has_exact_keys(jsonb,text[]),
  app_data_agent.command_payload_is_valid(jsonb),
  app_data_agent.workspace_command_payload_is_valid(jsonb),
  app_data_agent.canonical_uuid_json_string_is_valid(jsonb),
  app_data_agent.contains_potential_plaintext_secret(jsonb,text),
  app_data_agent.runtime_iso_timestamp(timestamptz)
to data_agent_provider_smoke_rpc_owner;

grant select on table
  app_data_agent.runs,app_data_agent.outbox,app_data_agent.commands,
  app_data_agent.run_attempts,app_data_agent.provider_invocation_intents,
  app_data_agent.provider_invocation_dispatch_permits,
  app_data_agent.provider_invocation_outcomes,
  app_data_agent.provider_invocation_usage_receipts,app_data_agent.artifacts
to data_agent_provider_smoke_rpc_owner;
grant update on table
  app_data_agent.runs,app_data_agent.outbox,app_data_agent.commands
to data_agent_provider_smoke_rpc_owner;
grant insert on table app_data_agent.run_attempts
to data_agent_provider_smoke_rpc_owner;

create policy provider_smoke_runs_rpc_select
on app_data_agent.runs for select to data_agent_provider_smoke_rpc_owner
using (platform.backend_context_matches(app_id,tenant_id,environment,false));
create policy provider_smoke_runs_rpc_update
on app_data_agent.runs for update to data_agent_provider_smoke_rpc_owner
using (platform.backend_run_object_matches(app_id,tenant_id,environment,run_id,true))
with check (platform.backend_run_object_matches(app_id,tenant_id,environment,run_id,true));
create policy provider_smoke_outbox_rpc_select
on app_data_agent.outbox for select to data_agent_provider_smoke_rpc_owner
using (platform.backend_run_object_matches(app_id,tenant_id,environment,run_id,false));
create policy provider_smoke_outbox_rpc_update
on app_data_agent.outbox for update to data_agent_provider_smoke_rpc_owner
using (platform.backend_run_object_matches(app_id,tenant_id,environment,run_id,true))
with check (platform.backend_run_object_matches(app_id,tenant_id,environment,run_id,true));
create policy provider_smoke_commands_rpc_select
on app_data_agent.commands for select to data_agent_provider_smoke_rpc_owner
using (platform.backend_run_object_matches(app_id,tenant_id,environment,run_id,false));
create policy provider_smoke_commands_rpc_update
on app_data_agent.commands for update to data_agent_provider_smoke_rpc_owner
using (platform.backend_run_object_matches(app_id,tenant_id,environment,run_id,true))
with check (platform.backend_run_object_matches(app_id,tenant_id,environment,run_id,true));
create policy provider_smoke_attempts_rpc_select
on app_data_agent.run_attempts for select to data_agent_provider_smoke_rpc_owner
using (platform.backend_run_object_matches(app_id,tenant_id,environment,run_id,false));
create policy provider_smoke_attempts_rpc_insert
on app_data_agent.run_attempts for insert to data_agent_provider_smoke_rpc_owner
with check (platform.backend_run_object_matches(app_id,tenant_id,environment,run_id,true));
create policy provider_smoke_intents_rpc_select
on app_data_agent.provider_invocation_intents for select
to data_agent_provider_smoke_rpc_owner
using (
  platform.backend_run_object_matches(app_id,tenant_id,environment,run_id,false)
  and principal_id = (select principal_id from platform.current_backend_authority(false)));
create policy provider_smoke_permits_rpc_select
on app_data_agent.provider_invocation_dispatch_permits for select
to data_agent_provider_smoke_rpc_owner
using (exists (
  select 1 from app_data_agent.provider_invocation_intents intent
  where intent.app_id = provider_invocation_dispatch_permits.app_id
    and intent.tenant_id = provider_invocation_dispatch_permits.tenant_id
    and intent.environment = provider_invocation_dispatch_permits.environment
    and intent.intent_id = provider_invocation_dispatch_permits.intent_id
    and platform.backend_run_object_matches(
      intent.app_id,intent.tenant_id,intent.environment,intent.run_id,false)
    and intent.principal_id =
      (select principal_id from platform.current_backend_authority(false))));
create policy provider_smoke_outcomes_rpc_select
on app_data_agent.provider_invocation_outcomes for select
to data_agent_provider_smoke_rpc_owner
using (exists (
  select 1 from app_data_agent.provider_invocation_intents intent
  where intent.app_id = provider_invocation_outcomes.app_id
    and intent.tenant_id = provider_invocation_outcomes.tenant_id
    and intent.environment = provider_invocation_outcomes.environment
    and intent.intent_id = provider_invocation_outcomes.intent_id
    and platform.backend_run_object_matches(
      intent.app_id,intent.tenant_id,intent.environment,intent.run_id,false)
    and intent.principal_id =
      (select principal_id from platform.current_backend_authority(false))));
create policy provider_smoke_usage_rpc_select
on app_data_agent.provider_invocation_usage_receipts for select
to data_agent_provider_smoke_rpc_owner
using (exists (
  select 1 from app_data_agent.provider_invocation_intents intent
  where intent.app_id = provider_invocation_usage_receipts.app_id
    and intent.tenant_id = provider_invocation_usage_receipts.tenant_id
    and intent.environment = provider_invocation_usage_receipts.environment
    and intent.intent_id = provider_invocation_usage_receipts.intent_id
    and platform.backend_run_object_matches(
      intent.app_id,intent.tenant_id,intent.environment,intent.run_id,false)
    and intent.principal_id =
      (select principal_id from platform.current_backend_authority(false))));
create policy provider_smoke_artifacts_rpc_select
on app_data_agent.artifacts for select to data_agent_provider_smoke_rpc_owner
using (
  artifact_type = 'ProviderResponseArtifact'
  and platform.backend_run_object_matches(app_id,tenant_id,environment,run_id,false));

grant select,insert,update,delete on table
  app_data_agent.provider_invocation_intents,
  app_data_agent.provider_invocation_dispatch_permits,
  app_data_agent.provider_invocation_outcomes,
  app_data_agent.provider_invocation_usage_receipts
to data_agent_provider_invocation_rpc_owner;

grant select on table
  app_data_agent.runs,app_data_agent.run_attempts,app_data_agent.outbox,
  app_data_agent.effective_run_config_receipts,
  app_data_agent.effective_run_config_resource_bindings,
  app_data_agent.effective_config_context_receipts,
  app_data_agent.qa_conversations,app_data_agent.datasource_connections,
  app_data_agent.workspace_run_bindings,app_data_agent.qa_messages,
  app_data_agent.run_events,
  app_data_agent.model_catalog_entries,app_data_agent.model_config_versions,
  app_data_agent.model_provider_connections,
  app_data_agent.model_provider_connection_versions,
  platform.deployment_mappings
to data_agent_provider_invocation_rpc_owner;
-- Row locks require UPDATE ACL. The lock-only UPDATE policies below expose the
-- scoped old row to FOR SHARE/UPDATE while WITH CHECK (false) denies direct mutation.
grant update on table
  app_data_agent.runs,app_data_agent.run_attempts,app_data_agent.outbox,
  app_data_agent.effective_run_config_receipts,
  app_data_agent.effective_config_context_receipts,
  app_data_agent.qa_conversations,app_data_agent.datasource_connections,
  app_data_agent.workspace_run_bindings,app_data_agent.qa_messages,
  app_data_agent.run_events,
  app_data_agent.model_catalog_entries,app_data_agent.model_config_versions,
  app_data_agent.model_provider_connections,
  app_data_agent.model_provider_connection_versions,
  app_data_agent.artifacts
to data_agent_provider_invocation_rpc_owner;
grant select,insert on table app_data_agent.artifacts
to data_agent_provider_invocation_rpc_owner;

create policy provider_invocation_runs_rpc_select
on app_data_agent.runs for select to data_agent_provider_invocation_rpc_owner
using (platform.backend_context_matches(app_id,tenant_id,environment,false));
create policy provider_invocation_runs_rpc_lock
on app_data_agent.runs for update to data_agent_provider_invocation_rpc_owner
using (platform.backend_context_matches(app_id,tenant_id,environment,false))
with check (false);
create policy provider_invocation_attempts_rpc_select
on app_data_agent.run_attempts for select to data_agent_provider_invocation_rpc_owner
using (platform.backend_run_object_matches(app_id,tenant_id,environment,run_id,false));
create policy provider_invocation_attempts_rpc_lock
on app_data_agent.run_attempts for update to data_agent_provider_invocation_rpc_owner
using (platform.backend_run_object_matches(app_id,tenant_id,environment,run_id,false))
with check (false);
create policy provider_invocation_outbox_rpc_select
on app_data_agent.outbox for select to data_agent_provider_invocation_rpc_owner
using (platform.backend_run_object_matches(app_id,tenant_id,environment,run_id,false));
create policy provider_invocation_outbox_rpc_lock
on app_data_agent.outbox for update to data_agent_provider_invocation_rpc_owner
using (platform.backend_run_object_matches(app_id,tenant_id,environment,run_id,false))
with check (false);
create policy provider_invocation_effective_config_rpc_select
on app_data_agent.effective_run_config_receipts for select to data_agent_provider_invocation_rpc_owner
using (platform.backend_run_object_matches(app_id,tenant_id,environment,run_id,false));
create policy provider_invocation_effective_config_rpc_lock
on app_data_agent.effective_run_config_receipts for update
to data_agent_provider_invocation_rpc_owner
using (platform.backend_run_object_matches(app_id,tenant_id,environment,run_id,false))
with check (false);
create policy provider_invocation_effective_binding_rpc_select
on app_data_agent.effective_run_config_resource_bindings for select
to data_agent_provider_invocation_rpc_owner
using (exists (select 1 from app_data_agent.effective_run_config_receipts receipt
  where receipt.app_id = effective_run_config_resource_bindings.app_id
    and receipt.tenant_id = effective_run_config_resource_bindings.tenant_id
    and receipt.environment = effective_run_config_resource_bindings.environment
    and receipt.config_id = effective_run_config_resource_bindings.config_id
    and receipt.config_revision = effective_run_config_resource_bindings.config_revision
    and platform.backend_run_object_matches(
      receipt.app_id,receipt.tenant_id,receipt.environment,receipt.run_id,false)));
create policy provider_invocation_context_rpc_select
on app_data_agent.effective_config_context_receipts for select
to data_agent_provider_invocation_rpc_owner
using (platform.backend_run_object_matches(app_id,tenant_id,environment,run_id,false));
create policy provider_invocation_context_rpc_lock
on app_data_agent.effective_config_context_receipts for update
to data_agent_provider_invocation_rpc_owner
using (platform.backend_run_object_matches(app_id,tenant_id,environment,run_id,false))
with check (false);
create policy provider_invocation_conversation_rpc_select
on app_data_agent.qa_conversations for select to data_agent_provider_invocation_rpc_owner
using (
  platform.backend_context_matches(app_id,tenant_id,environment,false)
  and owner_principal_id = (select principal_id from platform.current_backend_authority(false))
);
create policy provider_invocation_conversation_rpc_lock
on app_data_agent.qa_conversations for update to data_agent_provider_invocation_rpc_owner
using (
  platform.backend_context_matches(app_id,tenant_id,environment,false)
  and owner_principal_id = (select principal_id from platform.current_backend_authority(false))
) with check (false);
create policy provider_invocation_run_binding_rpc_select
on app_data_agent.workspace_run_bindings for select to data_agent_provider_invocation_rpc_owner
using (platform.backend_run_object_matches(app_id,tenant_id,environment,run_id,false));
create policy provider_invocation_run_binding_rpc_lock
on app_data_agent.workspace_run_bindings for update to data_agent_provider_invocation_rpc_owner
using (platform.backend_run_object_matches(app_id,tenant_id,environment,run_id,false))
with check (false);
create policy provider_invocation_qa_message_rpc_select
on app_data_agent.qa_messages for select to data_agent_provider_invocation_rpc_owner
using (
  platform.backend_context_matches(app_id,tenant_id,environment,false)
  and owner_principal_id = (select principal_id from platform.current_backend_authority(false))
);
create policy provider_invocation_qa_message_rpc_lock
on app_data_agent.qa_messages for update to data_agent_provider_invocation_rpc_owner
using (
  platform.backend_context_matches(app_id,tenant_id,environment,false)
  and owner_principal_id = (select principal_id from platform.current_backend_authority(false))
) with check (false);
create policy provider_invocation_run_event_rpc_select
on app_data_agent.run_events for select to data_agent_provider_invocation_rpc_owner
using (platform.backend_run_object_matches(app_id,tenant_id,environment,run_id,false));
create policy provider_invocation_run_event_rpc_lock
on app_data_agent.run_events for update to data_agent_provider_invocation_rpc_owner
using (platform.backend_run_object_matches(app_id,tenant_id,environment,run_id,false))
with check (false);
create policy provider_invocation_datasource_rpc_select
on app_data_agent.datasource_connections for select to data_agent_provider_invocation_rpc_owner
using (platform.backend_context_matches(app_id,tenant_id,environment,false));
create policy provider_invocation_datasource_rpc_lock
on app_data_agent.datasource_connections for update to data_agent_provider_invocation_rpc_owner
using (platform.backend_context_matches(app_id,tenant_id,environment,false))
with check (false);
create policy provider_invocation_model_catalog_rpc_select
on app_data_agent.model_catalog_entries for select to data_agent_provider_invocation_rpc_owner
using (
  app_id = (select app_id from platform.current_backend_authority(false))
  and environment = (select environment from platform.current_backend_authority(false))
);
create policy provider_invocation_model_catalog_rpc_lock
on app_data_agent.model_catalog_entries for update to data_agent_provider_invocation_rpc_owner
using (
  app_id = (select app_id from platform.current_backend_authority(false))
  and environment = (select environment from platform.current_backend_authority(false))
) with check (false);
create policy provider_invocation_model_config_rpc_select
on app_data_agent.model_config_versions for select to data_agent_provider_invocation_rpc_owner
using (
  app_id = (select app_id from platform.current_backend_authority(false))
  and environment = (select environment from platform.current_backend_authority(false))
);
create policy provider_invocation_model_config_rpc_lock
on app_data_agent.model_config_versions for update to data_agent_provider_invocation_rpc_owner
using (
  app_id = (select app_id from platform.current_backend_authority(false))
  and environment = (select environment from platform.current_backend_authority(false))
) with check (false);
create policy provider_invocation_connection_rpc_select
on app_data_agent.model_provider_connections for select to data_agent_provider_invocation_rpc_owner
using (
  app_id = (select app_id from platform.current_backend_authority(false))
  and environment = (select environment from platform.current_backend_authority(false))
);
create policy provider_invocation_connection_rpc_lock
on app_data_agent.model_provider_connections for update to data_agent_provider_invocation_rpc_owner
using (
  app_id = (select app_id from platform.current_backend_authority(false))
  and environment = (select environment from platform.current_backend_authority(false))
) with check (false);
create policy provider_invocation_connection_version_rpc_select
on app_data_agent.model_provider_connection_versions for select
to data_agent_provider_invocation_rpc_owner
using (
  app_id = (select app_id from platform.current_backend_authority(false))
  and environment = (select environment from platform.current_backend_authority(false))
);
create policy provider_invocation_connection_version_rpc_lock
on app_data_agent.model_provider_connection_versions for update
to data_agent_provider_invocation_rpc_owner
using (
  app_id = (select app_id from platform.current_backend_authority(false))
  and environment = (select environment from platform.current_backend_authority(false))
) with check (false);
create policy provider_invocation_artifacts_rpc_select
on app_data_agent.artifacts for select to data_agent_provider_invocation_rpc_owner
using (
  platform.backend_run_object_matches(app_id,tenant_id,environment,run_id,false)
  or (artifact_type in ('ModelCertificationReceipt','ProviderReconciliationEvidence')
    and platform.backend_context_matches(app_id,tenant_id,environment,false))
);
create policy provider_invocation_artifacts_rpc_lock
on app_data_agent.artifacts for update to data_agent_provider_invocation_rpc_owner
using (
  platform.backend_run_object_matches(app_id,tenant_id,environment,run_id,false)
  or (artifact_type in ('ModelCertificationReceipt','ProviderReconciliationEvidence')
    and platform.backend_context_matches(app_id,tenant_id,environment,false))
) with check (false);
create policy provider_invocation_artifacts_rpc_insert
on app_data_agent.artifacts for insert to data_agent_provider_invocation_rpc_owner
with check (
  (artifact_type = 'ProviderResponseArtifact'
    and platform.backend_run_object_matches(app_id,tenant_id,environment,run_id,true))
  or (artifact_type = 'ProviderReconciliationEvidence'
    and platform.backend_context_matches(app_id,tenant_id,environment,true))
  or (artifact_type = 'ProviderTaskArtifact'
    and platform.backend_run_object_matches(app_id,tenant_id,environment,run_id,true))
  or (artifact_type = 'ProviderStaleMarkerRecoveryReceipt'
    and platform.backend_run_object_matches(app_id,tenant_id,environment,run_id,true))
);

alter function app_data_agent.provider_json_object_has_exact_keys(jsonb,text[])
owner to data_agent_provider_invocation_rpc_owner;
alter function app_data_agent.assert_provider_active_worker_lease(jsonb)
owner to data_agent_provider_invocation_rpc_owner;
alter function app_data_agent.resolve_conversation_run_selections(uuid,bigint)
owner to data_agent_provider_invocation_rpc_owner;
alter function app_data_agent.list_provider_execution_profiles()
owner to data_agent_provider_invocation_rpc_owner;
alter function app_data_agent.begin_provider_invocation(jsonb,jsonb)
owner to data_agent_provider_invocation_rpc_owner;
alter function app_data_agent.mark_provider_invocation_dispatched(jsonb,jsonb)
owner to data_agent_provider_invocation_rpc_owner;
alter function app_data_agent.mark_provider_invocation_response_observed(jsonb,jsonb)
owner to data_agent_provider_invocation_rpc_owner;
alter function app_data_agent.commit_provider_invocation_worker_transition_internal(jsonb,jsonb,jsonb,text)
owner to data_agent_provider_invocation_rpc_owner;
alter function app_data_agent.commit_provider_invocation_completed(jsonb,jsonb)
owner to data_agent_provider_invocation_rpc_owner;
alter function app_data_agent.commit_provider_invocation_terminal(jsonb,jsonb,jsonb)
owner to data_agent_provider_invocation_rpc_owner;
alter function app_data_agent.mark_provider_invocation_outcome_unknown(jsonb,jsonb,jsonb)
owner to data_agent_provider_invocation_rpc_owner;
alter function app_data_agent.commit_provider_reconciliation_evidence(jsonb)
owner to data_agent_provider_invocation_rpc_owner;
alter function app_data_agent.reconcile_provider_invocation_unknown(jsonb,jsonb,jsonb)
owner to data_agent_provider_invocation_rpc_owner;
alter function app_data_agent.recover_stale_provider_invocation_marker(jsonb)
owner to data_agent_provider_invocation_rpc_owner;
alter function app_data_agent.recover_next_stale_provider_invocation_marker()
owner to data_agent_provider_invocation_rpc_owner;
alter function app_data_agent.claim_provider_invocation_smoke_work(text,integer,uuid,uuid)
owner to data_agent_provider_smoke_rpc_owner;
alter function app_data_agent.verify_provider_invocation_smoke_completion(uuid,uuid,uuid,bigint)
owner to data_agent_provider_invocation_rpc_owner;
alter function app_data_agent.discover_next_provider_invocation_unknown()
owner to data_agent_provider_invocation_rpc_owner;
alter function app_data_agent.load_provider_invocation(jsonb)
owner to data_agent_provider_invocation_rpc_owner;
alter function app_data_agent.commit_provider_task_artifact(jsonb,jsonb)
owner to data_agent_provider_invocation_rpc_owner;
alter function app_data_agent.load_provider_task_artifact(jsonb)
owner to data_agent_provider_invocation_rpc_owner;
alter function app_data_agent.commit_provider_response_artifact(jsonb,jsonb)
owner to data_agent_provider_invocation_rpc_owner;
alter function app_data_agent.load_provider_response_artifact(jsonb)
owner to data_agent_provider_invocation_rpc_owner;

revoke all on function app_data_agent.provider_json_object_has_exact_keys(jsonb,text[])
from public,anon,authenticated,service_role,data_agent_backend,data_agent_job_authority;
revoke all on function app_data_agent.assert_provider_active_worker_lease(jsonb)
from public,anon,authenticated,service_role,data_agent_backend,data_agent_job_authority;
revoke all on function app_data_agent.commit_provider_invocation_worker_transition_internal(jsonb,jsonb,jsonb,text)
from public,anon,authenticated,service_role,data_agent_backend,data_agent_job_authority;
revoke all on function app_data_agent.resolve_conversation_run_selections(uuid,bigint),
  app_data_agent.list_provider_execution_profiles(),
  app_data_agent.begin_provider_invocation(jsonb,jsonb),
  app_data_agent.mark_provider_invocation_dispatched(jsonb,jsonb),
  app_data_agent.mark_provider_invocation_response_observed(jsonb,jsonb),
  app_data_agent.commit_provider_invocation_completed(jsonb,jsonb),
  app_data_agent.commit_provider_invocation_terminal(jsonb,jsonb,jsonb),
  app_data_agent.mark_provider_invocation_outcome_unknown(jsonb,jsonb,jsonb),
  app_data_agent.commit_provider_reconciliation_evidence(jsonb),
  app_data_agent.reconcile_provider_invocation_unknown(jsonb,jsonb,jsonb),
  app_data_agent.recover_stale_provider_invocation_marker(jsonb),
  app_data_agent.recover_next_stale_provider_invocation_marker(),
  app_data_agent.claim_provider_invocation_smoke_work(text,integer,uuid,uuid),
  app_data_agent.verify_provider_invocation_smoke_completion(uuid,uuid,uuid,bigint),
  app_data_agent.discover_next_provider_invocation_unknown(),
  app_data_agent.load_provider_invocation(jsonb),
  app_data_agent.commit_provider_task_artifact(jsonb,jsonb),
  app_data_agent.load_provider_task_artifact(jsonb),
  app_data_agent.load_provider_response_artifact(jsonb)
from public,anon,authenticated,service_role,data_agent_backend,data_agent_job_authority;

grant execute on function app_data_agent.resolve_conversation_run_selections(uuid,bigint),
  app_data_agent.list_provider_execution_profiles(),
  app_data_agent.begin_provider_invocation(jsonb,jsonb),
  app_data_agent.mark_provider_invocation_dispatched(jsonb,jsonb),
  app_data_agent.mark_provider_invocation_response_observed(jsonb,jsonb),
  app_data_agent.commit_provider_invocation_completed(jsonb,jsonb),
  app_data_agent.commit_provider_invocation_terminal(jsonb,jsonb,jsonb),
  app_data_agent.mark_provider_invocation_outcome_unknown(jsonb,jsonb,jsonb),
  app_data_agent.commit_provider_task_artifact(jsonb,jsonb),
  app_data_agent.load_provider_task_artifact(jsonb),
  app_data_agent.load_provider_response_artifact(jsonb)
to data_agent_backend;
grant execute on function app_data_agent.reconcile_provider_invocation_unknown(jsonb,jsonb,jsonb)
to data_agent_job_authority;
grant execute on function app_data_agent.recover_stale_provider_invocation_marker(jsonb)
to data_agent_job_authority;
grant execute on function app_data_agent.recover_next_stale_provider_invocation_marker()
to data_agent_job_authority;
grant execute on function app_data_agent.claim_provider_invocation_smoke_work(
  text,integer,uuid,uuid
) to data_agent_job_authority;
grant execute on function app_data_agent.verify_provider_invocation_smoke_completion(
  uuid,uuid,uuid,bigint
) to data_agent_job_authority;
grant execute on function app_data_agent.discover_next_provider_invocation_unknown()
to data_agent_job_authority;
grant execute on function app_data_agent.commit_provider_reconciliation_evidence(jsonb)
to data_agent_job_authority;
grant execute on function app_data_agent.load_provider_invocation(jsonb)
to data_agent_backend;

-- Standalone response insertion is intentionally not executable by backend: COMPLETED owns
-- response Artifact + Outcome + Usage in one transaction through commit_provider_invocation_completed.
revoke all on function app_data_agent.commit_provider_response_artifact(jsonb,jsonb)
from public,anon,authenticated,service_role,data_agent_backend,data_agent_job_authority;

do $postconditions$
declare relation_name text;
begin
  foreach relation_name in array array[
    'provider_invocation_intents','provider_invocation_dispatch_permits',
    'provider_invocation_outcomes','provider_invocation_usage_receipts'
  ] loop
    if not exists (select 1 from pg_catalog.pg_class relation
      join pg_catalog.pg_namespace namespace on namespace.oid = relation.relnamespace
      where namespace.nspname = 'app_data_agent' and relation.relname = relation_name
        and relation.relrowsecurity and relation.relforcerowsecurity) then
      raise exception using errcode = 'P0001', message = 'PROVIDER_INVOCATION_FORCE_RLS_MISSING';
    end if;
  end loop;
  if not exists (select 1 from pg_catalog.pg_roles
    where rolname = 'data_agent_provider_invocation_rpc_owner'
      and not rolcanlogin and not rolsuper and not rolcreatedb and not rolcreaterole
      and not rolreplication and not rolbypassrls)
    or pg_catalog.pg_has_role(
      'data_agent_provider_invocation_rpc_owner','data_agent_backend','MEMBER')
    or pg_catalog.pg_has_role(
      'data_agent_provider_invocation_rpc_owner','data_agent_job_authority','MEMBER')
  then
    raise exception using errcode = 'P0001', message = 'PROVIDER_INVOCATION_RPC_OWNER_UNSAFE';
  end if;
  if not exists (select 1 from pg_catalog.pg_roles
    where rolname = 'data_agent_provider_smoke_rpc_owner'
      and not rolcanlogin and not rolsuper and not rolcreatedb and not rolcreaterole
      and not rolreplication and not rolbypassrls)
    or pg_catalog.pg_has_role(
      'data_agent_provider_smoke_rpc_owner','data_agent_backend','MEMBER')
    or pg_catalog.pg_has_role(
      'data_agent_provider_smoke_rpc_owner','data_agent_job_authority','MEMBER')
  then
    raise exception using errcode = 'P0001', message = 'PROVIDER_SMOKE_RPC_OWNER_UNSAFE';
  end if;
  if not pg_catalog.has_function_privilege(
    'data_agent_provider_invocation_rpc_owner',
    'app_data_agent.u2_canonical_sha256(jsonb)','EXECUTE'
  ) or not pg_catalog.has_function_privilege(
    'data_agent_provider_smoke_rpc_owner',
    'app_data_agent.u2_canonical_sha256(jsonb)','EXECUTE'
  ) or pg_catalog.has_function_privilege(
    'data_agent_provider_invocation_rpc_owner',
    'app_data_agent.attribution_canonical_json(jsonb)','EXECUTE'
  ) or pg_catalog.has_function_privilege(
    'data_agent_backend','app_data_agent.u2_canonical_sha256(jsonb)','EXECUTE'
  ) or pg_catalog.has_function_privilege(
    'data_agent_job_authority','app_data_agent.u2_canonical_sha256(jsonb)','EXECUTE'
  ) then
    raise exception using errcode = 'P0001', message = 'PROVIDER_CONTRACT_HASH_AUTHORITY_UNSAFE';
  end if;
end
$postconditions$;
