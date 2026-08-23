-- semantic_json_portability_migration_checksum: sha256:eca40306594985cc431b3e615f0dd85254e70c5b7f79122d5f75552dc2fe90d0
-- ============================================================
-- 10632: Semantic workspace JSON portability
-- Depends on: 20260725010631_app_data_agent_model_billing_settlement
-- Clean-install only. No legacy semantic import backfill is supported.
-- ============================================================

begin;

do $bootstrap$
begin
  if pg_catalog.current_setting('server_version_num')::integer not between 170000 and 179999 then
    raise exception using errcode = '0A000', message = 'SEMANTIC_PORTABILITY_POSTGRES_VERSION_UNSUPPORTED';
  end if;
  if session_user <> 'postgres' or current_user <> 'postgres' then
    raise exception using errcode = '42501', message = 'SEMANTIC_PORTABILITY_MIGRATION_EXECUTOR_UNSAFE';
  end if;
  if not exists (
    select 1 from platform.migration_ledger as ledger
    where ledger.owner_kind = 'app'
      and ledger.app_id = '00000000-0000-4000-8000-00000000da01'::uuid
      and ledger.migration_version = '20260725010631_app_data_agent_model_billing_settlement'
  ) then
    raise exception using errcode = 'P0001', message = 'SEMANTIC_PORTABILITY_BASELINE_10631_MISSING';
  end if;
  if exists (
    select 1 from platform.migration_ledger as ledger
    where ledger.owner_kind = 'app'
      and ledger.app_id = '00000000-0000-4000-8000-00000000da01'::uuid
      and ledger.migration_version = '20260725010632_app_data_agent_semantic_json_portability'
  ) then
    raise exception using errcode = 'P0001', message = 'SEMANTIC_PORTABILITY_MIGRATION_10632_ALREADY_RECORDED';
  end if;
  if pg_catalog.to_regclass('semantic.semantic_source_release') is null
    or pg_catalog.to_regclass('app_data_agent.datasource_connections') is null
  then
    raise exception using errcode = 'P0001', message = 'SEMANTIC_PORTABILITY_BASELINE_AUTHORITY_MISSING';
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
-- ============================================================
-- 10632: Durable semantic import jobs, mappings, operations and receipts
-- ============================================================

create table app_data_agent.semantic_import_jobs (
  app_id uuid not null check (app_id = '00000000-0000-4000-8000-00000000da01'::uuid),
  tenant_id uuid not null,
  environment text not null check (environment ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$'),
  import_id uuid not null,
  principal_id uuid not null,
  file_name text not null check (pg_catalog.length(pg_catalog.btrim(file_name)) between 1 and 255),
  byte_size integer not null check (byte_size between 1 and 1048576),
  upload_hash text not null check (upload_hash ~ '^sha256:[0-9a-f]{64}$'),
  document_content_hash text not null check (document_content_hash ~ '^sha256:[0-9a-f]{64}$'),
  format text not null check (format = 'semantic-workspace-export@1.0.0'),
  source_document jsonb not null check (
    pg_catalog.jsonb_typeof(source_document) = 'object'
    and source_document ->> 'format' = format
    and source_document ->> 'content_hash' = document_content_hash
    and source_document - array[
      'format', 'compatibility', 'datasource_refs', 'domains', 'exported_at', 'content_hash'
    ] = '{}'::jsonb
    and pg_catalog.jsonb_typeof(source_document -> 'compatibility') = 'object'
    and pg_catalog.jsonb_typeof(source_document -> 'datasource_refs') = 'array'
    and pg_catalog.jsonb_array_length(source_document -> 'datasource_refs') between 1 and 64
    and pg_catalog.jsonb_typeof(source_document -> 'domains') = 'array'
    and pg_catalog.jsonb_array_length(source_document -> 'domains') between 1 and 64
    and not app_data_agent.contains_potential_plaintext_secret(source_document)
  ),
  state text not null check (state in (
    'UPLOADED', 'VALIDATED', 'AWAITING_DATASOURCE_MAPPING', 'READY',
    'DRAFT_CREATED', 'FAILED', 'CANCELLED'
  )),
  mapping_hash text check (mapping_hash is null or mapping_hash ~ '^sha256:[0-9a-f]{64}$'),
  preview jsonb check (
    preview is null or (
      pg_catalog.jsonb_typeof(preview) = 'object'
      and not app_data_agent.contains_potential_plaintext_secret(preview)
    )
  ),
  reason_code text check (reason_code is null or reason_code ~ '^[A-Z][A-Z0-9_]{0,127}$'),
  candidate_refs jsonb not null default '[]'::jsonb check (
    pg_catalog.jsonb_typeof(candidate_refs) = 'array'
    and pg_catalog.jsonb_array_length(candidate_refs) between 0 and 64
    and not app_data_agent.contains_potential_plaintext_secret(candidate_refs)
  ),
  receipt_id uuid,
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  updated_at timestamptz not null default pg_catalog.clock_timestamp(),
  primary key (app_id, tenant_id, environment, import_id),
  unique (app_id, tenant_id, environment, import_id, principal_id),
  foreign key (app_id, tenant_id, environment)
    references app_data_agent.workspaces (app_id, workspace_id, environment) on delete restrict,
  foreign key (app_id, tenant_id, environment, principal_id)
    references app_data_agent.memberships (app_id, tenant_id, environment, principal_id) on delete restrict,
  check (
    (state = 'DRAFT_CREATED' and receipt_id is not null
      and pg_catalog.jsonb_array_length(candidate_refs) between 1 and 64
      and reason_code is null)
    or (state in ('FAILED', 'CANCELLED') and receipt_id is null
      and pg_catalog.jsonb_array_length(candidate_refs) = 0 and reason_code is not null)
    or (state not in ('DRAFT_CREATED', 'FAILED', 'CANCELLED') and receipt_id is null
      and pg_catalog.jsonb_array_length(candidate_refs) = 0 and reason_code is null)
  ),
  check (
    state <> 'READY'
    or (mapping_hash is not null and preview ->> 'compatible' = 'true')
  )
);

create index semantic_import_jobs_principal_created
  on app_data_agent.semantic_import_jobs (
    app_id, tenant_id, environment, principal_id, created_at desc, import_id
  );

create table app_data_agent.semantic_import_mappings (
  app_id uuid not null check (app_id = '00000000-0000-4000-8000-00000000da01'::uuid),
  tenant_id uuid not null,
  environment text not null check (environment ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$'),
  import_id uuid not null,
  logical_ref text not null check (
    pg_catalog.length(logical_ref) between 1 and 128
    and logical_ref ~ '^[A-Za-z0-9][A-Za-z0-9._:@/-]*$'
  ),
  target_datasource_id uuid not null,
  target_semantic_domain text not null check (
    target_semantic_domain ~ '^[A-Za-z_][A-Za-z0-9_]{0,63}$'
  ),
  mapped_by_principal_id uuid not null,
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  primary key (app_id, tenant_id, environment, import_id, logical_ref),
  unique (app_id, tenant_id, environment, import_id, target_semantic_domain),
  foreign key (app_id, tenant_id, environment, import_id, mapped_by_principal_id)
    references app_data_agent.semantic_import_jobs (
      app_id, tenant_id, environment, import_id, principal_id
    ) on delete cascade,
  foreign key (app_id, tenant_id, environment, target_datasource_id)
    references app_data_agent.datasource_connections (
      app_id, tenant_id, environment, datasource_id
    ) on delete restrict,
  foreign key (
    app_id, tenant_id, environment, target_semantic_domain, target_datasource_id
  ) references semantic.semantic_domain_registry (
    app_id, tenant_id, environment, semantic_domain, datasource_id
  ) on delete restrict
);

create table app_data_agent.semantic_import_operations (
  app_id uuid not null check (app_id = '00000000-0000-4000-8000-00000000da01'::uuid),
  tenant_id uuid not null,
  environment text not null check (environment ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$'),
  principal_id uuid not null,
  operation_id uuid not null,
  idempotency_key uuid not null,
  operation_kind text not null check (operation_kind in ('UPLOAD', 'MAP', 'DRY_RUN', 'COMMIT', 'CANCEL')),
  input_hash text not null check (input_hash ~ '^sha256:[0-9a-f]{64}$'),
  import_id uuid not null,
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  primary key (app_id, tenant_id, environment, principal_id, idempotency_key),
  unique (app_id, tenant_id, environment, principal_id, operation_id),
  foreign key (app_id, tenant_id, environment, import_id)
    references app_data_agent.semantic_import_jobs (
      app_id, tenant_id, environment, import_id
    ) on delete restrict
);

create table app_data_agent.semantic_import_receipts (
  app_id uuid not null check (app_id = '00000000-0000-4000-8000-00000000da01'::uuid),
  tenant_id uuid not null,
  environment text not null check (environment ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$'),
  receipt_id uuid not null,
  import_id uuid not null,
  principal_id uuid not null,
  upload_hash text not null check (upload_hash ~ '^sha256:[0-9a-f]{64}$'),
  document_content_hash text not null check (document_content_hash ~ '^sha256:[0-9a-f]{64}$'),
  mapping_hash text not null check (mapping_hash ~ '^sha256:[0-9a-f]{64}$'),
  candidate_refs jsonb not null check (
    pg_catalog.jsonb_typeof(candidate_refs) = 'array'
    and pg_catalog.jsonb_array_length(candidate_refs) between 1 and 64
    and not app_data_agent.contains_potential_plaintext_secret(candidate_refs)
  ),
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  primary key (app_id, tenant_id, environment, receipt_id),
  unique (app_id, tenant_id, environment, import_id),
  foreign key (app_id, tenant_id, environment, import_id, principal_id)
    references app_data_agent.semantic_import_jobs (
      app_id, tenant_id, environment, import_id, principal_id
    ) on delete restrict
);

alter table app_data_agent.semantic_import_jobs
  add constraint semantic_import_jobs_receipt_fk
  foreign key (app_id, tenant_id, environment, receipt_id)
  references app_data_agent.semantic_import_receipts (
    app_id, tenant_id, environment, receipt_id
  ) on delete restrict;

alter table app_data_agent.semantic_import_jobs owner to data_agent_u6_data_owner;
alter table app_data_agent.semantic_import_mappings owner to data_agent_u6_data_owner;
alter table app_data_agent.semantic_import_operations owner to data_agent_u6_data_owner;
alter table app_data_agent.semantic_import_receipts owner to data_agent_u6_data_owner;
-- ============================================================
-- 10632: Portable published semantic and safe target read bridges
-- ============================================================

create or replace function semantic.read_portable_published_semantic(
  p_app_id uuid,
  p_tenant_id uuid,
  p_environment text
) returns table (
  semantic_domain text,
  datasource_name text,
  datasource_type text,
  release_generation bigint,
  release_digest text,
  schema_fingerprint text,
  semantic_content jsonb
)
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if not platform.backend_context_matches(p_app_id, p_tenant_id, p_environment, false) then
    raise exception using errcode = '42501', message = 'SEMANTIC_SCOPE_FORBIDDEN';
  end if;
  return query
  select
    domain.semantic_domain,
    datasource.name,
    datasource.datasource_type,
    release.release_generation,
    release.release_digest,
    release.relationship_projection_hash,
    source.source_payload #> '{source,content}'
  from semantic.semantic_domain_registry as domain
  join app_data_agent.datasource_connections as datasource
    on datasource.app_id = domain.app_id
   and datasource.tenant_id = domain.tenant_id
   and datasource.environment = domain.environment
   and datasource.datasource_id = domain.datasource_id
  join semantic.semantic_active_pointer as pointer
    on pointer.app_id = domain.app_id
   and pointer.tenant_id = domain.tenant_id
   and pointer.environment = domain.environment
   and pointer.semantic_domain = domain.semantic_domain
  join semantic.semantic_source_release as release
    on release.app_id = pointer.app_id
   and release.tenant_id = pointer.tenant_id
   and release.environment = pointer.environment
   and release.semantic_domain = pointer.semantic_domain
   and release.release_id = pointer.current_release_id
  join semantic.semantic_candidate as candidate
    on candidate.app_id = release.app_id
   and candidate.tenant_id = release.tenant_id
   and candidate.environment = release.environment
   and candidate.semantic_domain = release.semantic_domain
   and candidate.candidate_id = release.candidate_id
  join semantic.semantic_candidate_revision as revision
    on revision.app_id = candidate.app_id
   and revision.tenant_id = candidate.tenant_id
   and revision.environment = candidate.environment
   and revision.semantic_domain = candidate.semantic_domain
   and revision.candidate_id = candidate.candidate_id
   and revision.revision_id = candidate.current_revision_id
  join semantic.semantic_source_revision as source
    on source.app_id = revision.app_id
   and source.tenant_id = revision.tenant_id
   and source.environment = revision.environment
   and source.semantic_domain = revision.semantic_domain
   and source.revision_id = revision.source_revision_id
  where domain.app_id = p_app_id
    and domain.tenant_id = p_tenant_id
    and domain.environment = p_environment
    and domain.is_active = true
    and datasource.status = 'ACTIVE'
    and pointer.current_release_id is not null
  order by domain.semantic_domain;
end;
$function$;

create or replace function semantic.read_portability_targets(
  p_app_id uuid,
  p_tenant_id uuid,
  p_environment text
) returns table (
  datasource_id uuid,
  display_name text,
  dialect text,
  semantic_domains jsonb
)
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if not platform.backend_context_matches(p_app_id, p_tenant_id, p_environment, false) then
    raise exception using errcode = '42501', message = 'SEMANTIC_SCOPE_FORBIDDEN';
  end if;
  return query
  select
    datasource.datasource_id,
    datasource.name,
    datasource.datasource_type,
    pg_catalog.jsonb_agg(domain.semantic_domain order by domain.semantic_domain)
  from app_data_agent.datasource_connections as datasource
  join semantic.semantic_domain_registry as domain
    on domain.app_id = datasource.app_id
   and domain.tenant_id = datasource.tenant_id
   and domain.environment = datasource.environment
   and domain.datasource_id = datasource.datasource_id
   and domain.is_active = true
  where datasource.app_id = p_app_id
    and datasource.tenant_id = p_tenant_id
    and datasource.environment = p_environment
    and datasource.status = 'ACTIVE'
  group by datasource.datasource_id, datasource.name, datasource.datasource_type
  order by datasource.name, datasource.datasource_id;
end;
$function$;

alter function semantic.read_portable_published_semantic(uuid, uuid, text)
  owner to data_agent_u6_rpc_owner;
alter function semantic.read_portability_targets(uuid, uuid, text)
  owner to data_agent_u6_rpc_owner;

revoke all on function semantic.read_portable_published_semantic(uuid, uuid, text) from public;
revoke all on function semantic.read_portability_targets(uuid, uuid, text) from public;
grant execute on function semantic.read_portable_published_semantic(uuid, uuid, text)
  to data_agent_backend;
grant execute on function semantic.read_portability_targets(uuid, uuid, text)
  to data_agent_backend;
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
-- ============================================================
-- 10632: Postconditions
-- ============================================================

do $postconditions$
begin
  if exists (
    select 1 from (
      values
        ('semantic_import_jobs'),
        ('semantic_import_mappings'),
        ('semantic_import_operations'),
        ('semantic_import_receipts')
    ) as expected(relation_name)
    where not exists (
      select 1
      from pg_catalog.pg_class as relation
      join pg_catalog.pg_namespace as namespace on namespace.oid = relation.relnamespace
      where namespace.nspname = 'app_data_agent'
        and relation.relname = expected.relation_name
        and relation.relrowsecurity
        and relation.relforcerowsecurity
    )
  ) then
    raise exception using errcode = 'P0001', message = 'SEMANTIC_PORTABILITY_RLS_POSTCONDITION_FAILED';
  end if;
  if not pg_catalog.has_function_privilege(
    'data_agent_backend',
    'semantic.read_portable_published_semantic(uuid,uuid,text)',
    'EXECUTE'
  ) or not pg_catalog.has_function_privilege(
    'data_agent_backend',
    'semantic.read_portability_targets(uuid,uuid,text)',
    'EXECUTE'
  ) then
    raise exception using errcode = 'P0001', message = 'SEMANTIC_PORTABILITY_BRIDGE_GRANT_MISSING';
  end if;
  if pg_catalog.has_table_privilege(
    'data_agent_backend', 'semantic.semantic_source_release', 'SELECT'
  ) then
    raise exception using errcode = 'P0001', message = 'SEMANTIC_PORTABILITY_RAW_SEMANTIC_GRANT_FORBIDDEN';
  end if;
end
$postconditions$;
-- ============================================================
-- 10632: Ledger checksum and commit
-- ============================================================

select platform.assert_migration_checksum(
  'app',
  '00000000-0000-4000-8000-00000000da01'::uuid,
  '20260725010632_app_data_agent_semantic_json_portability',
  'sha256:eca40306594985cc431b3e615f0dd85254e70c5b7f79122d5f75552dc2fe90d0'
);

commit;
