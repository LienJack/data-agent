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
