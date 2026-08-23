-- ============================================================
-- 10632: RLS, immutable evidence and exact privileges
-- ============================================================

alter table app_data_agent.semantic_import_jobs enable row level security;
alter table app_data_agent.semantic_import_jobs force row level security;
alter table app_data_agent.semantic_import_mappings enable row level security;
alter table app_data_agent.semantic_import_mappings force row level security;
alter table app_data_agent.semantic_import_operations enable row level security;
alter table app_data_agent.semantic_import_operations force row level security;
alter table app_data_agent.semantic_import_receipts enable row level security;
alter table app_data_agent.semantic_import_receipts force row level security;

create policy semantic_import_jobs_backend_policy
  on app_data_agent.semantic_import_jobs for all to data_agent_backend
  using (platform.backend_principal_object_matches(
    app_id, tenant_id, environment, principal_id, false
  ))
  with check (platform.backend_principal_object_matches(
    app_id, tenant_id, environment, principal_id, true
  ));

create policy semantic_import_mappings_backend_policy
  on app_data_agent.semantic_import_mappings for all to data_agent_backend
  using (
    platform.backend_context_matches(app_id, tenant_id, environment, false)
    and exists (
      select 1 from app_data_agent.semantic_import_jobs as job
      where job.app_id = semantic_import_mappings.app_id
        and job.tenant_id = semantic_import_mappings.tenant_id
        and job.environment = semantic_import_mappings.environment
        and job.import_id = semantic_import_mappings.import_id
        and platform.backend_principal_object_matches(
          job.app_id, job.tenant_id, job.environment, job.principal_id, false
        )
    )
  )
  with check (
    platform.backend_context_matches(app_id, tenant_id, environment, true)
    and mapped_by_principal_id = nullif(
      pg_catalog.current_setting('data_agent.principal_id', true), ''
    )::uuid
  );

create policy semantic_import_operations_backend_policy
  on app_data_agent.semantic_import_operations for all to data_agent_backend
  using (platform.backend_exact_principal_object_matches(
    app_id, tenant_id, environment, principal_id, false
  ))
  with check (platform.backend_exact_principal_object_matches(
    app_id, tenant_id, environment, principal_id, true
  ));

create policy semantic_import_receipts_backend_policy
  on app_data_agent.semantic_import_receipts for all to data_agent_backend
  using (platform.backend_principal_object_matches(
    app_id, tenant_id, environment, principal_id, false
  ))
  with check (platform.backend_principal_object_matches(
    app_id, tenant_id, environment, principal_id, true
  ));

create policy semantic_portability_domain_rpc_select
  on semantic.semantic_domain_registry for select to data_agent_u6_rpc_owner
  using (
    app_id = nullif(pg_catalog.current_setting('data_agent.app_id', true), '')::uuid
    and tenant_id = nullif(pg_catalog.current_setting('data_agent.tenant_id', true), '')::uuid
    and environment = nullif(pg_catalog.current_setting('data_agent.environment', true), '')
  );
create policy semantic_portability_pointer_rpc_select
  on semantic.semantic_active_pointer for select to data_agent_u6_rpc_owner
  using (
    app_id = nullif(pg_catalog.current_setting('data_agent.app_id', true), '')::uuid
    and tenant_id = nullif(pg_catalog.current_setting('data_agent.tenant_id', true), '')::uuid
    and environment = nullif(pg_catalog.current_setting('data_agent.environment', true), '')
  );
create policy semantic_portability_release_rpc_select
  on semantic.semantic_source_release for select to data_agent_u6_rpc_owner
  using (
    app_id = nullif(pg_catalog.current_setting('data_agent.app_id', true), '')::uuid
    and tenant_id = nullif(pg_catalog.current_setting('data_agent.tenant_id', true), '')::uuid
    and environment = nullif(pg_catalog.current_setting('data_agent.environment', true), '')
  );
create policy semantic_portability_candidate_rpc_select
  on semantic.semantic_candidate for select to data_agent_u6_rpc_owner
  using (
    app_id = nullif(pg_catalog.current_setting('data_agent.app_id', true), '')::uuid
    and tenant_id = nullif(pg_catalog.current_setting('data_agent.tenant_id', true), '')::uuid
    and environment = nullif(pg_catalog.current_setting('data_agent.environment', true), '')
  );
create policy semantic_portability_revision_rpc_select
  on semantic.semantic_candidate_revision for select to data_agent_u6_rpc_owner
  using (
    app_id = nullif(pg_catalog.current_setting('data_agent.app_id', true), '')::uuid
    and tenant_id = nullif(pg_catalog.current_setting('data_agent.tenant_id', true), '')::uuid
    and environment = nullif(pg_catalog.current_setting('data_agent.environment', true), '')
  );
create policy semantic_portability_source_rpc_select
  on semantic.semantic_source_revision for select to data_agent_u6_rpc_owner
  using (
    app_id = nullif(pg_catalog.current_setting('data_agent.app_id', true), '')::uuid
    and tenant_id = nullif(pg_catalog.current_setting('data_agent.tenant_id', true), '')::uuid
    and environment = nullif(pg_catalog.current_setting('data_agent.environment', true), '')
  );
create policy semantic_portability_datasource_rpc_select
  on app_data_agent.datasource_connections for select to data_agent_u6_rpc_owner
  using (
    app_id = nullif(pg_catalog.current_setting('data_agent.app_id', true), '')::uuid
    and tenant_id = nullif(pg_catalog.current_setting('data_agent.tenant_id', true), '')::uuid
    and environment = nullif(pg_catalog.current_setting('data_agent.environment', true), '')
  );

grant select, insert, update on table app_data_agent.semantic_import_jobs to data_agent_backend;
grant select, insert, update, delete on table app_data_agent.semantic_import_mappings
  to data_agent_backend;
grant select, insert on table app_data_agent.semantic_import_operations to data_agent_backend;
grant select, insert on table app_data_agent.semantic_import_receipts to data_agent_backend;

grant select on table
  semantic.semantic_domain_registry,
  semantic.semantic_active_pointer,
  semantic.semantic_source_release,
  semantic.semantic_candidate,
  semantic.semantic_candidate_revision,
  semantic.semantic_source_revision,
  app_data_agent.datasource_connections
to data_agent_u6_rpc_owner;

revoke all on table
  semantic.semantic_domain_registry,
  semantic.semantic_active_pointer,
  semantic.semantic_source_release,
  semantic.semantic_candidate,
  semantic.semantic_candidate_revision,
  semantic.semantic_source_revision
from data_agent_backend;

create or replace function app_data_agent.reject_semantic_import_evidence_mutation()
returns trigger
language plpgsql
set search_path = ''
as $function$
begin
  raise exception using errcode = '55000', message = 'SEMANTIC_IMPORT_EVIDENCE_IMMUTABLE';
end;
$function$;

create trigger semantic_import_operations_immutable
before update or delete on app_data_agent.semantic_import_operations
for each row execute function app_data_agent.reject_semantic_import_evidence_mutation();
create trigger semantic_import_receipts_immutable
before update or delete on app_data_agent.semantic_import_receipts
for each row execute function app_data_agent.reject_semantic_import_evidence_mutation();

create or replace function app_data_agent.validate_semantic_import_receipt_candidates()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  candidate_ref jsonb;
begin
  for candidate_ref in
    select value from pg_catalog.jsonb_array_elements(new.candidate_refs)
  loop
    if pg_catalog.jsonb_typeof(candidate_ref) <> 'object'
      or candidate_ref - array['semantic_domain', 'candidate_id', 'revision_id'] <> '{}'::jsonb
      or not exists (
        select 1
        from semantic.semantic_candidate as candidate
        join semantic.semantic_candidate_revision as revision
          on revision.app_id = candidate.app_id
         and revision.tenant_id = candidate.tenant_id
         and revision.environment = candidate.environment
         and revision.semantic_domain = candidate.semantic_domain
         and revision.candidate_id = candidate.candidate_id
         and revision.revision_id = candidate.current_revision_id
        where candidate.app_id = new.app_id
          and candidate.tenant_id = new.tenant_id
          and candidate.environment = new.environment
          and candidate.semantic_domain = candidate_ref ->> 'semantic_domain'
          and candidate.candidate_id = (candidate_ref ->> 'candidate_id')::uuid
          and revision.revision_id = (candidate_ref ->> 'revision_id')::uuid
          and candidate.candidate_status = 'DRAFT'
      )
    then
      raise exception using errcode = '23503', message = 'SEMANTIC_IMPORT_CANDIDATE_REF_INVALID';
    end if;
  end loop;
  return new;
exception
  when invalid_text_representation then
    raise exception using errcode = '23503', message = 'SEMANTIC_IMPORT_CANDIDATE_REF_INVALID';
end;
$function$;

alter function app_data_agent.validate_semantic_import_receipt_candidates()
  owner to data_agent_u6_rpc_owner;

create trigger semantic_import_receipt_candidates_valid
before insert on app_data_agent.semantic_import_receipts
for each row execute function app_data_agent.validate_semantic_import_receipt_candidates();

create or replace function app_data_agent.guard_semantic_import_job_update()
returns trigger
language plpgsql
set search_path = ''
as $function$
begin
  if new.app_id <> old.app_id
    or new.tenant_id <> old.tenant_id
    or new.environment <> old.environment
    or new.import_id <> old.import_id
    or new.principal_id <> old.principal_id
    or new.file_name <> old.file_name
    or new.byte_size <> old.byte_size
    or new.upload_hash <> old.upload_hash
    or new.document_content_hash <> old.document_content_hash
    or new.format <> old.format
    or new.source_document <> old.source_document
    or new.created_at <> old.created_at
  then
    raise exception using errcode = '55000', message = 'SEMANTIC_IMPORT_IDENTITY_IMMUTABLE';
  end if;
  if old.state in ('DRAFT_CREATED', 'FAILED', 'CANCELLED') and new is distinct from old then
    raise exception using errcode = '55000', message = 'SEMANTIC_IMPORT_TERMINAL_IMMUTABLE';
  end if;
  if new.state = 'DRAFT_CREATED' and not exists (
    select 1
    from app_data_agent.semantic_import_receipts as receipt
    where receipt.app_id = new.app_id
      and receipt.tenant_id = new.tenant_id
      and receipt.environment = new.environment
      and receipt.receipt_id = new.receipt_id
      and receipt.import_id = new.import_id
      and receipt.principal_id = new.principal_id
      and receipt.upload_hash = new.upload_hash
      and receipt.document_content_hash = new.document_content_hash
      and receipt.mapping_hash = new.mapping_hash
      and receipt.candidate_refs = new.candidate_refs
  ) then
    raise exception using errcode = '23503', message = 'SEMANTIC_IMPORT_RECEIPT_BINDING_INVALID';
  end if;
  return new;
end;
$function$;

create trigger semantic_import_job_guard
before update or delete on app_data_agent.semantic_import_jobs
for each row execute function app_data_agent.guard_semantic_import_job_update();
