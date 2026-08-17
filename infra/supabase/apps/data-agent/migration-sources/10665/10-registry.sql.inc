create table app_data_agent.mcp_server_revisions (
  app_id uuid not null,tenant_id uuid not null,environment text not null,
  server_id uuid not null,revision bigint not null check(revision>0),revision_hash text not null,
  approval_status text not null check(approval_status in ('APPROVED','QUARANTINED')),
  document_json jsonb not null,created_by uuid not null,created_at timestamptz not null,
  primary key(app_id,tenant_id,environment,server_id,revision),
  unique(app_id,tenant_id,environment,server_id,revision,revision_hash),
  check(revision_hash ~ '^sha256:[0-9a-f]{64}$'
    and revision_hash=app_data_agent.u2_canonical_sha256(document_json-'revision_hash')),
  check(document_json->>'schema_version'='mcp-server-revision@1.0.0'
    and (document_json->>'server_id')::uuid=server_id
    and (document_json->>'revision')::bigint=revision
    and document_json->>'approval_status'=approval_status),
  foreign key(app_id,tenant_id,environment)
    references app_data_agent.workspaces(app_id,workspace_id,environment) on delete restrict,
  foreign key(app_id,tenant_id,environment,created_by)
    references app_data_agent.memberships(app_id,tenant_id,environment,principal_id) on delete restrict
);
create table app_data_agent.mcp_server_heads (
  app_id uuid not null,tenant_id uuid not null,environment text not null,server_id uuid not null,
  active_revision bigint not null,active_revision_hash text not null,
  lifecycle text not null check(lifecycle in ('ENABLED','DISABLED','REVOKED')),
  version bigint not null check(version>0),updated_by uuid not null,updated_at timestamptz not null,
  primary key(app_id,tenant_id,environment,server_id),
  foreign key(app_id,tenant_id,environment,server_id,active_revision,active_revision_hash)
    references app_data_agent.mcp_server_revisions(app_id,tenant_id,environment,server_id,revision,revision_hash),
  foreign key(app_id,tenant_id,environment)
    references app_data_agent.workspaces(app_id,workspace_id,environment) on delete restrict,
  foreign key(app_id,tenant_id,environment,updated_by)
    references app_data_agent.memberships(app_id,tenant_id,environment,principal_id) on delete restrict
);
create table app_data_agent.skill_revisions (
  app_id uuid not null,tenant_id uuid not null,environment text not null,
  skill_id uuid not null,revision bigint not null check(revision>0),revision_hash text not null,
  signer_id uuid not null,approval_status text not null check(approval_status in ('APPROVED','QUARANTINED')),
  document_json jsonb not null,created_by uuid not null,created_at timestamptz not null,
  primary key(app_id,tenant_id,environment,skill_id,revision),
  unique(app_id,tenant_id,environment,skill_id,revision,revision_hash),
  check(revision_hash ~ '^sha256:[0-9a-f]{64}$'
    and revision_hash=app_data_agent.u2_canonical_sha256(document_json-'revision_hash')),
  check(document_json->>'schema_version'='skill-revision@1.0.0'
    and (document_json->>'skill_id')::uuid=skill_id
    and (document_json->>'revision')::bigint=revision
    and (document_json->>'signer_id')::uuid=signer_id
    and document_json->>'approval_status'=approval_status),
  foreign key(app_id,tenant_id,environment)
    references app_data_agent.workspaces(app_id,workspace_id,environment) on delete restrict,
  foreign key(app_id,tenant_id,environment,created_by)
    references app_data_agent.memberships(app_id,tenant_id,environment,principal_id) on delete restrict
);
create table app_data_agent.skill_heads (
  app_id uuid not null,tenant_id uuid not null,environment text not null,skill_id uuid not null,
  active_revision bigint not null,active_revision_hash text not null,
  lifecycle text not null check(lifecycle in ('ENABLED','DISABLED','QUARANTINED','REVOKED')),
  signer_revocation_version bigint not null default 0 check(signer_revocation_version>=0),
  version bigint not null check(version>0),updated_by uuid not null,updated_at timestamptz not null,
  primary key(app_id,tenant_id,environment,skill_id),
  foreign key(app_id,tenant_id,environment,skill_id,active_revision,active_revision_hash)
    references app_data_agent.skill_revisions(app_id,tenant_id,environment,skill_id,revision,revision_hash),
  foreign key(app_id,tenant_id,environment)
    references app_data_agent.workspaces(app_id,workspace_id,environment) on delete restrict,
  foreign key(app_id,tenant_id,environment,updated_by)
    references app_data_agent.memberships(app_id,tenant_id,environment,principal_id) on delete restrict
);
create table app_data_agent.skill_signer_revocations (
  app_id uuid not null,tenant_id uuid not null,environment text not null,signer_id uuid not null,
  revocation_version bigint not null check(revocation_version>0),reason_code text not null,
  revoked_by uuid not null,revoked_at timestamptz not null,
  primary key(app_id,tenant_id,environment,signer_id,revocation_version),
  foreign key(app_id,tenant_id,environment)
    references app_data_agent.workspaces(app_id,workspace_id,environment) on delete restrict,
  foreign key(app_id,tenant_id,environment,revoked_by)
    references app_data_agent.memberships(app_id,tenant_id,environment,principal_id) on delete restrict
);
create table app_data_agent.extension_operation_receipts (
  app_id uuid not null,tenant_id uuid not null,environment text not null,actor_principal_id uuid not null,
  operation_id uuid not null,idempotency_key text not null,input_hash text not null,result_json jsonb not null,
  committed_at timestamptz not null,
  primary key(app_id,tenant_id,environment,operation_id),
  unique(app_id,tenant_id,environment,actor_principal_id,idempotency_key),
  check(input_hash ~ '^sha256:[0-9a-f]{64}$'),
  foreign key(app_id,tenant_id,environment)
    references app_data_agent.workspaces(app_id,workspace_id,environment) on delete restrict,
  foreign key(app_id,tenant_id,environment,actor_principal_id)
    references app_data_agent.memberships(app_id,tenant_id,environment,principal_id) on delete restrict
);

create function app_data_agent.reject_extension_immutable_mutation()
returns trigger language plpgsql set search_path='' as $function$
begin raise exception using errcode='55000',message='EXTENSION_AUTHORITY_IMMUTABLE'; end
$function$;
create trigger mcp_server_revisions_immutable before update or delete on app_data_agent.mcp_server_revisions
for each row execute function app_data_agent.reject_extension_immutable_mutation();
create trigger skill_revisions_immutable before update or delete on app_data_agent.skill_revisions
for each row execute function app_data_agent.reject_extension_immutable_mutation();
create trigger skill_signer_revocations_immutable before update or delete on app_data_agent.skill_signer_revocations
for each row execute function app_data_agent.reject_extension_immutable_mutation();
create trigger extension_operation_receipts_immutable before update or delete on app_data_agent.extension_operation_receipts
for each row execute function app_data_agent.reject_extension_immutable_mutation();

alter table app_data_agent.mcp_server_revisions enable row level security;
alter table app_data_agent.mcp_server_revisions force row level security;
alter table app_data_agent.mcp_server_heads enable row level security;
alter table app_data_agent.mcp_server_heads force row level security;
alter table app_data_agent.skill_revisions enable row level security;
alter table app_data_agent.skill_revisions force row level security;
alter table app_data_agent.skill_heads enable row level security;
alter table app_data_agent.skill_heads force row level security;
alter table app_data_agent.skill_signer_revocations enable row level security;
alter table app_data_agent.skill_signer_revocations force row level security;
alter table app_data_agent.extension_operation_receipts enable row level security;
alter table app_data_agent.extension_operation_receipts force row level security;

create policy mcp_server_revisions_owner on app_data_agent.mcp_server_revisions for all to data_agent_u14_extension_owner
using(platform.backend_context_matches(app_id,tenant_id,environment,false))
with check(platform.backend_context_matches(app_id,tenant_id,environment,true));
create policy mcp_server_heads_owner on app_data_agent.mcp_server_heads for all to data_agent_u14_extension_owner
using(platform.backend_context_matches(app_id,tenant_id,environment,false))
with check(platform.backend_context_matches(app_id,tenant_id,environment,true));
create policy skill_revisions_owner on app_data_agent.skill_revisions for all to data_agent_u14_extension_owner
using(platform.backend_context_matches(app_id,tenant_id,environment,false))
with check(platform.backend_context_matches(app_id,tenant_id,environment,true));
create policy skill_heads_owner on app_data_agent.skill_heads for all to data_agent_u14_extension_owner
using(platform.backend_context_matches(app_id,tenant_id,environment,false))
with check(platform.backend_context_matches(app_id,tenant_id,environment,true));
create policy skill_signer_revocations_owner on app_data_agent.skill_signer_revocations for all to data_agent_u14_extension_owner
using(platform.backend_context_matches(app_id,tenant_id,environment,false))
with check(platform.backend_context_matches(app_id,tenant_id,environment,true));
create policy extension_operation_receipts_owner on app_data_agent.extension_operation_receipts for all to data_agent_u14_extension_owner
using(platform.backend_context_matches(app_id,tenant_id,environment,false))
with check(platform.backend_context_matches(app_id,tenant_id,environment,true));
