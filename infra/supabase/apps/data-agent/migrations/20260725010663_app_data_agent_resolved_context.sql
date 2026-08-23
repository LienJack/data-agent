-- resolved_context_migration_checksum: sha256:1b067a92410754e3f34ae4d51f0c6df67f868f1620b51fc71d7574203710882d
-- ============================================================
-- 10663: Resolved Context Package Authority
-- Published-only semantic context for Preview and Run consumers.
-- No Candidate reads, Provider invocation, data import, or benchmark execution.
-- ============================================================

begin;

do $bootstrap$
begin
  if pg_catalog.current_setting('server_version_num')::integer not between 170000 and 179999 then
    raise exception using errcode='0A000',message='RESOLVED_CONTEXT_POSTGRES_VERSION_UNSUPPORTED';
  end if;
  if session_user<>'postgres' or current_user<>'postgres' then
    raise exception using errcode='42501',message='RESOLVED_CONTEXT_MIGRATION_EXECUTOR_UNSAFE';
  end if;
  if not exists (
    select 1 from platform.migration_ledger
    where owner_kind='app' and app_id='00000000-0000-4000-8000-00000000da01'::uuid
      and migration_version='20260725010662_app_data_agent_semantic_induction'
  ) then raise exception using errcode='P0001',message='RESOLVED_CONTEXT_BASELINE_10662_MISSING'; end if;
  if pg_catalog.to_regprocedure('app_data_agent.u2_canonical_sha256(jsonb)') is null
    or pg_catalog.to_regprocedure('platform.current_backend_authority(boolean)') is null
  then raise exception using errcode='P0001',message='RESOLVED_CONTEXT_PREREQUISITE_MISSING'; end if;
  if not exists (select 1 from pg_catalog.pg_roles where rolname='data_agent_u12_context_owner') then
    create role data_agent_u12_context_owner
      nologin noinherit nosuperuser nocreatedb nocreaterole noreplication nobypassrls;
  end if;
end
$bootstrap$;

set local lock_timeout='2000ms';
set local statement_timeout='300000ms';
set local idle_in_transaction_session_timeout='60000ms';
select platform.acquire_migration_lock('app','00000000-0000-4000-8000-00000000da01'::uuid);
create table app_data_agent.resolved_context_receipts (
  app_id uuid not null check (app_id='00000000-0000-4000-8000-00000000da01'::uuid),
  tenant_id uuid not null,
  environment text not null check (environment ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$'),
  receipt_id uuid not null,
  request_id uuid not null,
  request_hash text not null check (request_hash ~ '^sha256:[0-9a-f]{64}$'),
  consumer text not null check (consumer in ('PREVIEW','RUN')),
  run_id uuid,
  package_id uuid not null,
  package_key_hash text not null check (package_key_hash ~ '^sha256:[0-9a-f]{64}$'),
  package_hash text not null check (
    package_hash ~ '^sha256:[0-9a-f]{64}$'
    and package_hash=app_data_agent.u2_canonical_sha256(package_json-'package_hash')
  ),
  authority_snapshot_hash text not null check (authority_snapshot_hash ~ '^sha256:[0-9a-f]{64}$'),
  state text not null check (state in ('READY','PARTIAL','NEEDS_CLARIFICATION','REJECTED','STALE')),
  route text not null check (route in ('METRIC','ONTOLOGY_TEXT2SQL','KNOWLEDGE','GRAPH','NONE')),
  package_json jsonb not null check (
    pg_catalog.jsonb_typeof(package_json)='object'
    and not app_data_agent.contains_potential_plaintext_secret(package_json)
  ),
  receipt_json jsonb not null check (
    pg_catalog.jsonb_typeof(receipt_json)='object'
    and not app_data_agent.contains_potential_plaintext_secret(receipt_json)
  ),
  receipt_hash text not null check (
    receipt_hash ~ '^sha256:[0-9a-f]{64}$'
    and receipt_hash=app_data_agent.u2_canonical_sha256(receipt_json-'receipt_hash')
  ),
  resolved_at timestamptz not null,
  committed_by uuid not null,
  committed_at timestamptz not null default pg_catalog.clock_timestamp(),
  primary key (app_id,tenant_id,environment,receipt_id),
  unique (app_id,tenant_id,environment,request_id,consumer),
  unique (app_id,tenant_id,environment,receipt_id,receipt_hash),
  check ((consumer='PREVIEW' and run_id is null) or (consumer='RUN' and run_id is not null)),
  check (request_id::text=receipt_json->>'request_id' and request_hash=receipt_json->>'request_hash'),
  check (package_id::text=package_json->>'package_id' and package_key_hash=package_json->>'package_key_hash'),
  foreign key (app_id,tenant_id,environment)
    references app_data_agent.workspaces(app_id,workspace_id,environment) on delete restrict,
  foreign key (app_id,tenant_id,environment,committed_by)
    references app_data_agent.memberships(app_id,tenant_id,environment,principal_id) on delete restrict
);

create function app_data_agent.reject_resolved_context_mutation()
returns trigger language plpgsql set search_path='' as $function$
begin
  raise exception using errcode='55000',message='RESOLVED_CONTEXT_AUTHORITY_IMMUTABLE';
end
$function$;

create trigger resolved_context_receipts_immutable
before update or delete on app_data_agent.resolved_context_receipts
for each row execute function app_data_agent.reject_resolved_context_mutation();

alter table app_data_agent.resolved_context_receipts enable row level security;
alter table app_data_agent.resolved_context_receipts force row level security;
create policy resolved_context_receipts_owner on app_data_agent.resolved_context_receipts
  for all to data_agent_u12_context_owner
  using (platform.backend_context_matches(app_id,tenant_id,environment,false))
  with check (platform.backend_context_matches(app_id,tenant_id,environment,true));
create function app_data_agent.resolved_context_exact_keys(value jsonb,keys text[])
returns boolean language sql immutable strict set search_path='' as $function$
  select pg_catalog.jsonb_typeof(value)='object'
    and value-keys='{}'::jsonb
    and not exists(select 1 from pg_catalog.unnest(keys) required(key) where not value ? required.key)
$function$;

create function app_data_agent.resolved_context_uuid_v8_from_hash(requested_hash text)
returns uuid language plpgsql immutable strict set search_path='' as $function$
declare
  raw bytea;
  encoded text;
begin
  if requested_hash !~ '^sha256:[0-9a-f]{64}$' then
    raise exception using errcode='22023',message='RESOLVED_CONTEXT_HASH_INVALID';
  end if;
  raw:=pg_catalog.decode(pg_catalog.substr(requested_hash,8,32),'hex');
  raw:=pg_catalog.set_byte(raw,6,(pg_catalog.get_byte(raw,6) & 15) | 128);
  raw:=pg_catalog.set_byte(raw,8,(pg_catalog.get_byte(raw,8) & 63) | 128);
  encoded:=pg_catalog.encode(raw,'hex');
  return (
    pg_catalog.substring(encoded,1,8)||'-'||pg_catalog.substring(encoded,9,4)||'-'||
    pg_catalog.substring(encoded,13,4)||'-'||pg_catalog.substring(encoded,17,4)||'-'||
    pg_catalog.substring(encoded,21,12)
  )::uuid;
end
$function$;

create function app_data_agent.resolved_context_package_key_hash(package_document jsonb)
returns text language sql immutable strict set search_path='' as $function$
  select app_data_agent.u2_canonical_sha256(pg_catalog.jsonb_build_object(
    'scope',package_document->'scope',
    'question_hash',package_document->'question_hash',
    'defaults_ref',package_document->'defaults_ref',
    'semantic_release',package_document->'semantic_release',
    'schema_snapshot',package_document->'schema_snapshot',
    'context_policy',package_document->'context_policy',
    'egress_policy',package_document->'egress_policy',
    'provider',package_document->'provider',
    'authority_snapshot_hash',package_document->'authority_snapshot_hash'
  ))
$function$;

create function app_data_agent.assert_resolved_context_request(requested jsonb)
returns void language plpgsql immutable set search_path='' as $function$
begin
  if requested is null
    or not app_data_agent.resolved_context_exact_keys(requested,
      case when requested#>>'{basis,consumer}'='RUN'
        then array['schema_version','request_id','request_hash','scope','basis']::text[]
        else array['schema_version','request_id','request_hash','scope','question','basis']::text[] end)
    or requested->>'schema_version'<>'resolved-context-request@1.0.0'
    or coalesce(requested->>'request_hash','') !~ '^sha256:[0-9a-f]{64}$'
    or requested->>'request_hash'<>app_data_agent.u2_canonical_sha256(requested-'request_hash')
    or not app_data_agent.resolved_context_exact_keys(requested->'scope',array[
      'app_id','tenant_id','environment'
    ]::text[])
    or (requested#>>'{basis,consumer}'='PREVIEW'
      and pg_catalog.length(pg_catalog.btrim(requested->>'question')) not between 1 and 4000)
    or coalesce(requested->>'request_id','') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    or requested#>>'{basis,consumer}' not in ('PREVIEW','RUN')
    or (requested#>>'{basis,consumer}'='PREVIEW' and not app_data_agent.resolved_context_exact_keys(
      requested->'basis',array['consumer','defaults_ref']::text[]))
    or (requested#>>'{basis,consumer}'='PREVIEW' and not app_data_agent.resolved_context_exact_keys(
      requested#>'{basis,defaults_ref}',array['defaults_id','defaults_revision','defaults_hash']::text[]))
    or (requested#>>'{basis,consumer}'='RUN' and not app_data_agent.resolved_context_exact_keys(
      requested->'basis',array['consumer','run_id','config_ref','context_receipt_ref']::text[]))
    or (requested#>>'{basis,consumer}'='RUN' and not app_data_agent.resolved_context_exact_keys(
      requested#>'{basis,config_ref}',array['config_id','config_revision','config_hash']::text[]))
    or (requested#>>'{basis,consumer}'='RUN' and not app_data_agent.resolved_context_exact_keys(
      requested#>'{basis,context_receipt_ref}',array['receipt_id','receipt_hash']::text[]))
  then raise exception using errcode='22023',message='RESOLVED_CONTEXT_REQUEST_INVALID'; end if;
end
$function$;

create function app_data_agent.resolved_context_metric_projection(
  p_app_id uuid,p_tenant_id uuid,p_environment text,p_semantic_domain text,p_release_id uuid
) returns jsonb language sql stable set search_path='' as $function$
  select coalesce(pg_catalog.jsonb_agg(metric.document order by metric.document->>'metric_id'),'[]'::jsonb)
  from (
    select distinct on (node.value->>'node_id') pg_catalog.jsonb_build_object(
      'metric_id',node.value->>'node_id','name',node.value->>'name',
      'aliases',coalesce((select pg_catalog.jsonb_agg(alias.value order by alias.value#>>'{}')
        from pg_catalog.jsonb_array_elements(coalesce(node.value->'aliases','[]'::jsonb)) alias(value)),'[]'::jsonb),
      'mapping_refs',mapping.refs,
      'mapping_hash',app_data_agent.u2_canonical_sha256(
        pg_catalog.jsonb_build_object('metric_binding',metric_binding.value,'mappings',mapping.documents)),
      'formula_hash',metric_binding.value->>'formula_ast_hash'
    ) as document
    from semantic.initial_semantic_release_sets release_set
    join semantic.initial_semantic_release_package_bindings binding
      using (app_id,tenant_id,environment,semantic_domain,release_set_id)
    join semantic.ontology_package_candidates package
      on package.app_id=binding.app_id and package.tenant_id=binding.tenant_id
     and package.environment=binding.environment and package.semantic_domain=binding.semantic_domain
     and package.package_id=binding.package_id and package.package_version=binding.package_version
     and package.package_hash=binding.package_hash
    cross join lateral pg_catalog.jsonb_array_elements(package.package_json#>'{graph_source,nodes}') node(value)
    join lateral (
      select object.value from pg_catalog.jsonb_array_elements(package.package_json->'objects') object(value)
      where object.value->>'graph_entry_id'=node.value->>'node_id'
        and object.value->>'semantic_role'='METRIC' limit 1
    ) metric_object on true
    join lateral (
      select candidate.value from pg_catalog.jsonb_array_elements(package.package_json->'metric_bindings') candidate(value)
      where candidate.value->>'metric_object_id'=metric_object.value->>'object_id'
        and candidate.value->>'resolution'='RESOLVED' limit 1
    ) metric_binding on true
    join lateral (
      select pg_catalog.jsonb_agg(to_jsonb(candidate.value->>'mapping_id') order by candidate.value->>'mapping_id') refs,
        pg_catalog.jsonb_agg(candidate.value order by candidate.value->>'mapping_id') documents
      from pg_catalog.jsonb_array_elements(package.package_json->'physical_mappings') candidate(value)
      where candidate.value->>'mode'='QUERYABLE' and candidate.value->>'logical_object_id' in (
        select id.value#>>'{}' from pg_catalog.jsonb_array_elements(
          pg_catalog.jsonb_build_array(metric_binding.value->>'metric_object_id',metric_binding.value->>'formula_object_id')
          || coalesce(metric_binding.value->'dimension_object_ids','[]'::jsonb)
          || coalesce(metric_binding.value->'grain_object_ids','[]'::jsonb)
          || case when metric_binding.value->>'time_object_id' is null then '[]'::jsonb else pg_catalog.jsonb_build_array(metric_binding.value->>'time_object_id') end
        ) id(value)
      )
      having pg_catalog.count(*)>0
    ) mapping on true
    where release_set.app_id=p_app_id and release_set.tenant_id=p_tenant_id
      and release_set.environment=p_environment and release_set.semantic_domain=p_semantic_domain
      and release_set.release_id=p_release_id and node.value->>'node_type'='METRIC'
    order by node.value->>'node_id',binding.package_id,binding.package_version
  ) metric
$function$;

create function app_data_agent.resolved_context_ontology_projection(
  p_app_id uuid,p_tenant_id uuid,p_environment text,p_semantic_domain text,p_release_id uuid
) returns jsonb language sql stable set search_path='' as $function$
  select coalesce(pg_catalog.jsonb_agg(object.document order by object.document->>'object_id'),'[]'::jsonb)
  from (
    select distinct on (node.value->>'node_id') pg_catalog.jsonb_build_object(
      'object_id',node.value->>'node_id',
      'object_kind',case node.value->>'node_type' when 'BUSINESS_SUBJECT' then 'ENTITY'
        when 'GLOSSARY_TERM' then 'TERM' else 'DIMENSION' end,
      'name',node.value->>'name',
      'aliases',coalesce((select pg_catalog.jsonb_agg(alias.value order by alias.value#>>'{}')
        from pg_catalog.jsonb_array_elements(coalesce(node.value->'aliases','[]'::jsonb)) alias(value)),'[]'::jsonb),
      'queryable',exists(select 1 from pg_catalog.jsonb_array_elements(package.package_json->'physical_mappings') mapping(value)
        where mapping.value->>'mode'='QUERYABLE'
          and mapping.value->>'logical_object_id'=semantic_object.value->>'object_id'),
      'mapping_refs',coalesce((select pg_catalog.jsonb_agg(to_jsonb(mapping.value->>'mapping_id') order by mapping.value->>'mapping_id')
        from pg_catalog.jsonb_array_elements(package.package_json->'physical_mappings') mapping(value)
        where mapping.value->>'mode'='QUERYABLE'
          and mapping.value->>'logical_object_id'=semantic_object.value->>'object_id'),'[]'::jsonb),
      'object_hash',app_data_agent.u2_canonical_sha256(node.value)
    ) as document
    from semantic.initial_semantic_release_sets release_set
    join semantic.initial_semantic_release_package_bindings binding
      using (app_id,tenant_id,environment,semantic_domain,release_set_id)
    join semantic.ontology_package_candidates package
      on package.app_id=binding.app_id and package.tenant_id=binding.tenant_id
     and package.environment=binding.environment and package.semantic_domain=binding.semantic_domain
     and package.package_id=binding.package_id and package.package_version=binding.package_version
     and package.package_hash=binding.package_hash
    cross join lateral pg_catalog.jsonb_array_elements(package.package_json#>'{graph_source,nodes}') node(value)
    join lateral (
      select object.value from pg_catalog.jsonb_array_elements(package.package_json->'objects') object(value)
      where object.value->>'graph_entry_id'=node.value->>'node_id' limit 1
    ) semantic_object on true
    where release_set.app_id=p_app_id and release_set.tenant_id=p_tenant_id
      and release_set.environment=p_environment and release_set.semantic_domain=p_semantic_domain
      and release_set.release_id=p_release_id
      and node.value->>'node_type' in ('BUSINESS_SUBJECT','DIMENSION','GLOSSARY_TERM')
    order by node.value->>'node_id',binding.package_id,binding.package_version
  ) object
$function$;

create function app_data_agent.resolved_context_relationship_projection(
  p_app_id uuid,p_tenant_id uuid,p_environment text,p_semantic_domain text,p_release_id uuid
) returns jsonb language sql stable set search_path='' as $function$
  select coalesce(pg_catalog.jsonb_agg(edge.document order by edge.document->>'relationship_id'),'[]'::jsonb)
  from (
    select distinct on (entry.value->>'edge_id') pg_catalog.jsonb_build_object(
      'relationship_id',entry.value->>'edge_id','source_object_id',entry.value->>'source_node_id',
      'target_object_id',entry.value->>'target_node_id','relationship_kind',entry.value->>'edge_type',
      'relationship_hash',app_data_agent.u2_canonical_sha256(entry.value)) as document
    from semantic.initial_semantic_release_sets release_set
    join semantic.initial_semantic_release_package_bindings binding
      using (app_id,tenant_id,environment,semantic_domain,release_set_id)
    join semantic.ontology_package_candidates package
      on package.app_id=binding.app_id and package.tenant_id=binding.tenant_id
     and package.environment=binding.environment and package.semantic_domain=binding.semantic_domain
     and package.package_id=binding.package_id and package.package_version=binding.package_version
     and package.package_hash=binding.package_hash
    cross join lateral pg_catalog.jsonb_array_elements(package.package_json#>'{graph_source,edges}') entry(value)
    where release_set.app_id=p_app_id and release_set.tenant_id=p_tenant_id
      and release_set.environment=p_environment and release_set.semantic_domain=p_semantic_domain
      and release_set.release_id=p_release_id
    order by entry.value->>'edge_id',binding.package_id,binding.package_version
  ) edge
$function$;
create function app_data_agent.load_resolved_context_authority_snapshot(requested jsonb)
returns jsonb language plpgsql volatile security definer set search_path='' as $function$
declare
  authority record;
  defaults_record app_data_agent.workspace_run_default_revisions%rowtype;
  config_record app_data_agent.effective_run_config_receipts%rowtype;
  context_record app_data_agent.effective_config_context_receipts%rowtype;
  model_record app_data_agent.model_catalog_entries%rowtype;
  release_record semantic.semantic_source_release%rowtype;
  defaults_json jsonb;
  semantic_ref jsonb;
  snapshot_ref jsonb;
  context_policy jsonb;
  egress_policy jsonb;
  provider_name text;
  knowledge_refs jsonb;
  snapshot_document jsonb;
  run_question text;
begin
  if not pg_catalog.pg_has_role(session_user,'data_agent_backend','USAGE') then
    raise exception using errcode='42501',message='DA_BACKEND_ROLE_REQUIRED';
  end if;
  perform app_data_agent.assert_resolved_context_request(requested);
  select * into authority from platform.current_backend_authority(false);
  if requested->'scope' <> pg_catalog.jsonb_build_object(
    'app_id',authority.app_id,'tenant_id',authority.tenant_id,'environment',authority.environment)
  then raise exception using errcode='42501',message='RESOLVED_CONTEXT_SCOPE_MISMATCH'; end if;

  if requested#>>'{basis,consumer}'='PREVIEW' then
    run_question:=requested->>'question';
    select revision.* into defaults_record
    from app_data_agent.workspace_run_defaults current_defaults
    join app_data_agent.workspace_run_default_revisions revision
      on revision.app_id=current_defaults.app_id and revision.tenant_id=current_defaults.tenant_id
     and revision.environment=current_defaults.environment and revision.defaults_id=current_defaults.defaults_id
     and revision.defaults_revision=current_defaults.defaults_revision and revision.defaults_hash=current_defaults.defaults_hash
    where current_defaults.app_id=authority.app_id and current_defaults.tenant_id=authority.tenant_id
      and current_defaults.environment=authority.environment
      and current_defaults.defaults_id=(requested#>>'{basis,defaults_ref,defaults_id}')::uuid
      and current_defaults.defaults_revision=(requested#>>'{basis,defaults_ref,defaults_revision}')::bigint
      and current_defaults.defaults_hash=requested#>>'{basis,defaults_ref,defaults_hash}'
    for share of current_defaults,revision;
    if not found then raise exception using errcode='40001',message='RESOLVED_CONTEXT_DEFAULTS_STALE'; end if;
    defaults_json:=defaults_record.defaults_json;
    if defaults_json->'model'='null'::jsonb or defaults_json->'datasource'='null'::jsonb
      or defaults_json->'semantic_release'='null'::jsonb or defaults_json->'schema_snapshot'='null'::jsonb
    then raise exception using errcode='55000',message='RESOLVED_CONTEXT_DEFAULTS_INCOMPLETE'; end if;
    select model.* into model_record from app_data_agent.model_catalog_entries model
    where model.app_id=authority.app_id and model.environment=authority.environment
      and model.model_profile_id=(defaults_json#>>'{model,resource_id}')::uuid
      and model.config_version=(defaults_json#>>'{model,resource_revision}')::bigint and model.status='ACTIVE';
    if not found then raise exception using errcode='55000',message='RESOLVED_CONTEXT_MODEL_STALE'; end if;
    select release.* into release_record from semantic.semantic_source_release release
    where release.app_id=authority.app_id and release.tenant_id=authority.tenant_id
      and release.environment=authority.environment
      and release.release_id=(defaults_json#>>'{semantic_release,resource_id}')::uuid
      and release.release_generation=(defaults_json#>>'{semantic_release,resource_revision}')::bigint
      and release.release_digest=defaults_json#>>'{semantic_release,resource_hash}'
      and exists(select 1 from semantic.semantic_active_pointer pointer
        where pointer.app_id=release.app_id and pointer.tenant_id=release.tenant_id
          and pointer.environment=release.environment and pointer.semantic_domain=release.semantic_domain
          and pointer.current_release_id=release.release_id
          and pointer.current_release_generation=release.release_generation
          and pointer.current_release_digest=release.release_digest);
    if not found then raise exception using errcode='40001',message='RESOLVED_CONTEXT_RELEASE_STALE'; end if;
    semantic_ref:=(defaults_json->'semantic_release')||pg_catalog.jsonb_build_object(
      'datasource_id',(defaults_json#>>'{datasource,resource_id}')::uuid,
      'semantic_generation',release_record.release_generation,'publication_status','PUBLISHED');
    snapshot_ref:=(defaults_json->'schema_snapshot')||pg_catalog.jsonb_build_object(
      'datasource_id',(defaults_json#>>'{datasource,resource_id}')::uuid,
      'semantic_release_id',release_record.release_id,'semantic_generation',release_record.release_generation);
    context_policy:=app_data_agent.builtin_effective_config_policy('CONTEXT_POLICY');
    egress_policy:=app_data_agent.builtin_effective_config_policy('EGRESS_POLICY');
    provider_name:=model_record.provider;
    knowledge_refs:=coalesce(defaults_json->'knowledge','[]'::jsonb);
  else
    select config.* into config_record from app_data_agent.effective_run_config_receipts config
    where config.app_id=authority.app_id and config.tenant_id=authority.tenant_id
      and config.environment=authority.environment
      and config.run_id=(requested#>>'{basis,run_id}')::uuid
      and config.config_id=(requested#>>'{basis,config_ref,config_id}')::uuid
      and config.config_revision=(requested#>>'{basis,config_ref,config_revision}')::bigint
      and config.config_hash=requested#>>'{basis,config_ref,config_hash}'
    for share;
    if not found then raise exception using errcode='40001',message='RESOLVED_CONTEXT_CONFIG_STALE'; end if;
    select context.* into context_record from app_data_agent.effective_config_context_receipts context
    join app_data_agent.run_attempts attempt
      on attempt.app_id=context.app_id and attempt.tenant_id=context.tenant_id
     and attempt.environment=context.environment and attempt.attempt_id=context.attempt_id
     and attempt.run_id=context.run_id and attempt.outbox_id=context.outbox_id
    join app_data_agent.outbox message
      on message.app_id=attempt.app_id and message.tenant_id=attempt.tenant_id
     and message.environment=attempt.environment and message.outbox_id=attempt.outbox_id
    where context.app_id=authority.app_id and context.tenant_id=authority.tenant_id
      and context.environment=authority.environment and context.run_id=config_record.run_id
      and context.config_id=config_record.config_id and context.config_hash=config_record.config_hash
      and context.context_receipt_id=(requested#>>'{basis,context_receipt_ref,receipt_id}')::uuid
      and context.receipt_hash=requested#>>'{basis,context_receipt_ref,receipt_hash}'
      and context.consumer_kind='WORKER_START' and attempt.status='ACTIVE'
      and attempt.worker_fence=context.worker_fence and attempt.lease_token=context.lease_token
      and attempt.lease_expires_at>pg_catalog.clock_timestamp()
      and message.status='LEASED' and message.active_attempt_id=attempt.attempt_id
      and message.run_fence=attempt.worker_fence and message.lease_token=attempt.lease_token
      and message.lease_expires_at>pg_catalog.clock_timestamp()
    for share of context,attempt,message;
    if not found then raise exception using errcode='40001',message='RESOLVED_CONTEXT_WORKER_AUTHORITY_STALE'; end if;
    select message.content into run_question
    from app_data_agent.workspace_run_bindings binding
    join app_data_agent.qa_messages message
      on message.app_id=binding.app_id and message.tenant_id=binding.tenant_id
     and message.environment=binding.environment and message.conversation_id=binding.conversation_id
     and message.run_id=binding.run_id and message.role='user' and message.message_type='text'
    join app_data_agent.run_events event
      on event.app_id=binding.app_id and event.tenant_id=binding.tenant_id
     and event.environment=binding.environment and event.run_id=binding.run_id
     and event.event_id=message.message_id and event.event_type='run.accepted'
    where binding.app_id=authority.app_id and binding.tenant_id=authority.tenant_id
      and binding.environment=authority.environment and binding.run_id=config_record.run_id;
    if run_question is null then raise exception using errcode='40001',message='RESOLVED_CONTEXT_QUESTION_MISSING'; end if;
    defaults_json:=config_record.effective_config_json;
    semantic_ref:=defaults_json->'semantic_release';
    snapshot_ref:=defaults_json->'schema_snapshot';
    context_policy:=defaults_json->'context_policy';
    egress_policy:=defaults_json->'egress_policy';
    provider_name:=config_record.provider;
    select coalesce(pg_catalog.jsonb_agg(binding.document order by binding.document->>'resource_id'),'[]'::jsonb)
    into knowledge_refs from (
      select resource.document
      from pg_catalog.jsonb_array_elements(defaults_json->'resource_bindings') binding(document)
      cross join lateral (select binding.document->'effective_resource' document) resource
      where binding.document->>'resource_kind'='KNOWLEDGE'
        and binding.document->>'availability'='AVAILABLE'
    ) binding;
    defaults_record.defaults_id:=config_record.defaults_id;
    defaults_record.defaults_revision:=config_record.defaults_revision;
    defaults_record.defaults_hash:=config_record.defaults_hash;
    select release.* into release_record from semantic.semantic_source_release release
    where release.app_id=authority.app_id and release.tenant_id=authority.tenant_id
      and release.environment=authority.environment
      and release.semantic_domain=config_record.semantic_domain
      and release.release_id=config_record.semantic_release_id
      and release.release_generation=config_record.semantic_release_generation
      and release.release_digest=config_record.semantic_release_digest
      and exists(select 1 from semantic.semantic_active_pointer pointer
        where pointer.app_id=release.app_id and pointer.tenant_id=release.tenant_id
          and pointer.environment=release.environment and pointer.semantic_domain=release.semantic_domain
          and pointer.current_release_id=release.release_id
          and pointer.current_release_generation=release.release_generation
          and pointer.current_release_digest=release.release_digest);
    if not found then raise exception using errcode='40001',message='RESOLVED_CONTEXT_RELEASE_STALE'; end if;
  end if;
  if not (egress_policy->'allowed_providers') ? provider_name then
    raise exception using errcode='42501',message='RESOLVED_CONTEXT_PROVIDER_DENIED';
  end if;
  snapshot_document:=pg_catalog.jsonb_build_object(
    'schema_version','resolved-context-authority-snapshot@1.0.0','scope',requested->'scope',
    'semantic_domain',release_record.semantic_domain,'question',run_question,
    'question_hash',app_data_agent.u2_canonical_sha256(to_jsonb(run_question)),
    'defaults_ref',pg_catalog.jsonb_build_object('defaults_id',defaults_record.defaults_id,
      'defaults_revision',defaults_record.defaults_revision,'defaults_hash',defaults_record.defaults_hash),
    'semantic_release',semantic_ref,'schema_snapshot',snapshot_ref,
    'context_policy',context_policy,'egress_policy',egress_policy,'provider',provider_name,
    'published_metrics',app_data_agent.resolved_context_metric_projection(
      authority.app_id,authority.tenant_id,authority.environment,release_record.semantic_domain,release_record.release_id),
    'published_ontology',app_data_agent.resolved_context_ontology_projection(
      authority.app_id,authority.tenant_id,authority.environment,release_record.semantic_domain,release_record.release_id),
    'published_relationships',app_data_agent.resolved_context_relationship_projection(
      authority.app_id,authority.tenant_id,authority.environment,release_record.semantic_domain,release_record.release_id),
    'knowledge_refs',knowledge_refs,
    'projection_hashes',(select pg_catalog.jsonb_agg(to_jsonb(projection_hash) order by projection_hash)
      from pg_catalog.unnest(array[
        release_record.executable_projection_hash,release_record.relationship_projection_hash,
        release_record.runtime_restriction_projection_hash]::text[]) projection_hash));
  return snapshot_document||pg_catalog.jsonb_build_object(
    'snapshot_hash',app_data_agent.u2_canonical_sha256(snapshot_document));
exception when invalid_text_representation or numeric_value_out_of_range then
  raise exception using errcode='22023',message='RESOLVED_CONTEXT_REQUEST_INVALID';
end
$function$;
create function app_data_agent.commit_resolved_context_package(requested jsonb)
returns jsonb language plpgsql volatile security definer set search_path='' as $function$
declare
  authority record;
  authoritative_snapshot jsonb;
  expected_package_key_hash text;
  existing app_data_agent.resolved_context_receipts%rowtype;
  committed_at timestamptz;
begin
  if not pg_catalog.pg_has_role(session_user,'data_agent_backend','USAGE') then
    raise exception using errcode='42501',message='DA_BACKEND_ROLE_REQUIRED';
  end if;
  if requested is null or not app_data_agent.resolved_context_exact_keys(requested,array[
    'schema_version','request','authority_snapshot_hash','package','receipt'
  ]::text[]) or requested->>'schema_version'<>'resolved-context-commit@1.0.0'
  then raise exception using errcode='22023',message='RESOLVED_CONTEXT_COMMIT_INVALID'; end if;
  perform app_data_agent.assert_resolved_context_request(requested->'request');
  if not app_data_agent.resolved_context_exact_keys(requested->'package',array[
      'schema_version','scope','semantic_domain','question_hash','defaults_ref','semantic_release',
      'schema_snapshot','context_policy','egress_policy','provider','authority_snapshot_hash',
      'route_decision','capacity','evidence','knowledge_refs','package_id','package_key_hash','package_hash'
    ]::text[])
    or requested#>>'{package,schema_version}'<>'resolved-context-package@1.0.0'
    or not app_data_agent.resolved_context_exact_keys(requested->'receipt',array[
      'schema_version','receipt_id','scope','consumer','request_id','request_hash','run_id','package_ref',
      'state','route','authority_snapshot_hash','resolved_at','receipt_hash'
    ]::text[])
    or requested#>>'{receipt,schema_version}'<>'resolved-context-receipt@1.0.0'
    or not app_data_agent.resolved_context_exact_keys(requested#>'{receipt,package_ref}',array[
      'package_id','package_revision','package_hash'
    ]::text[])
  then raise exception using errcode='22023',message='RESOLVED_CONTEXT_COMMIT_INVALID'; end if;
  select * into authority from platform.current_backend_authority(true);
  authoritative_snapshot:=app_data_agent.load_resolved_context_authority_snapshot(requested->'request');
  expected_package_key_hash:=app_data_agent.resolved_context_package_key_hash(requested->'package');
  if authoritative_snapshot->>'snapshot_hash'<>requested->>'authority_snapshot_hash'
    or requested#>>'{package,authority_snapshot_hash}'<>authoritative_snapshot->>'snapshot_hash'
    or requested#>'{package,scope}'<>requested#>'{request,scope}'
    or requested#>>'{package,semantic_domain}'<>authoritative_snapshot->>'semantic_domain'
    or requested#>>'{package,question_hash}'<>authoritative_snapshot->>'question_hash'
    or requested#>'{package,defaults_ref}'<>authoritative_snapshot->'defaults_ref'
    or requested#>'{package,semantic_release}'<>authoritative_snapshot->'semantic_release'
    or requested#>'{package,schema_snapshot}'<>authoritative_snapshot->'schema_snapshot'
    or requested#>'{package,context_policy}'<>authoritative_snapshot->'context_policy'
    or requested#>'{package,egress_policy}'<>authoritative_snapshot->'egress_policy'
    or requested#>>'{package,provider}'<>authoritative_snapshot->>'provider'
    or requested#>'{package,knowledge_refs}'<>authoritative_snapshot->'knowledge_refs'
    or requested#>>'{package,package_key_hash}'<>expected_package_key_hash
    or requested#>>'{package,package_id}'<>
      app_data_agent.resolved_context_uuid_v8_from_hash(expected_package_key_hash)::text
    or requested#>>'{package,package_hash}'<>app_data_agent.u2_canonical_sha256(requested->'package'-'package_hash')
    or requested#>>'{receipt,receipt_hash}'<>app_data_agent.u2_canonical_sha256(requested->'receipt'-'receipt_hash')
    or requested#>'{receipt,scope}'<>requested#>'{request,scope}'
    or requested#>>'{receipt,request_id}'<>requested#>>'{request,request_id}'
    or requested#>>'{receipt,request_hash}'<>requested#>>'{request,request_hash}'
    or requested#>>'{receipt,package_ref,package_id}'<>requested#>>'{package,package_id}'
    or requested#>>'{receipt,package_ref,package_revision}'<>'1'
    or requested#>>'{receipt,package_ref,package_hash}'<>requested#>>'{package,package_hash}'
    or requested#>>'{receipt,authority_snapshot_hash}'<>authoritative_snapshot->>'snapshot_hash'
    or requested#>>'{receipt,state}'<>requested#>>'{package,route_decision,state}'
    or requested#>>'{receipt,route}'<>requested#>>'{package,route_decision,route}'
    or requested#>>'{receipt,consumer}'<>requested#>>'{request,basis,consumer}'
    or (requested#>>'{request,basis,consumer}'='PREVIEW' and requested#>'{receipt,run_id}'<>'null'::jsonb)
    or (requested#>>'{request,basis,consumer}'='RUN'
      and requested#>>'{receipt,run_id}'<>requested#>>'{request,basis,run_id}')
  then raise exception using errcode='23514',message='RESOLVED_CONTEXT_COMMIT_CLOSURE_INVALID'; end if;
  select receipt.* into existing from app_data_agent.resolved_context_receipts receipt
  where receipt.app_id=authority.app_id and receipt.tenant_id=authority.tenant_id
    and receipt.environment=authority.environment
    and receipt.request_id=(requested#>>'{request,request_id}')::uuid
    and receipt.consumer=requested#>>'{request,basis,consumer}' for share;
  if found then
    if existing.receipt_hash<>requested#>>'{receipt,receipt_hash}'
      or existing.package_hash<>requested#>>'{package,package_hash}'
      or existing.package_json<>requested->'package' or existing.receipt_json<>requested->'receipt'
    then raise exception using errcode='23505',message='RESOLVED_CONTEXT_IDEMPOTENCY_CONFLICT'; end if;
    return pg_catalog.jsonb_build_object('schema_version','resolved-context-commit-result@1.0.0',
      'disposition','REPLAYED','package',existing.package_json,'receipt',existing.receipt_json);
  end if;
  committed_at:=pg_catalog.clock_timestamp();
  insert into app_data_agent.resolved_context_receipts(
    app_id,tenant_id,environment,receipt_id,request_id,request_hash,consumer,run_id,
    package_id,package_key_hash,package_hash,
    authority_snapshot_hash,state,route,package_json,receipt_json,receipt_hash,resolved_at,committed_by,committed_at
  ) values (
    authority.app_id,authority.tenant_id,authority.environment,(requested#>>'{receipt,receipt_id}')::uuid,
    (requested#>>'{request,request_id}')::uuid,requested#>>'{request,request_hash}',
    requested#>>'{request,basis,consumer}',
    case when requested#>>'{request,basis,consumer}'='RUN' then (requested#>>'{request,basis,run_id}')::uuid else null end,
    (requested#>>'{package,package_id}')::uuid,requested#>>'{package,package_key_hash}',
    requested#>>'{package,package_hash}',
    authoritative_snapshot->>'snapshot_hash',requested#>>'{package,route_decision,state}',
    requested#>>'{package,route_decision,route}',requested->'package',requested->'receipt',
    requested#>>'{receipt,receipt_hash}',(requested#>>'{receipt,resolved_at}')::timestamptz,
    authority.principal_id,committed_at);
  return pg_catalog.jsonb_build_object('schema_version','resolved-context-commit-result@1.0.0',
    'disposition','CREATED','package',requested->'package','receipt',requested->'receipt');
exception when invalid_text_representation or numeric_value_out_of_range then
  raise exception using errcode='22023',message='RESOLVED_CONTEXT_COMMIT_INVALID';
end
$function$;
create function app_data_agent.assert_resolved_context_integrity()
returns void language plpgsql stable set search_path='' as $function$
begin
  if exists (
    select 1 from app_data_agent.resolved_context_receipts receipt
    where receipt.request_hash<>receipt.receipt_json->>'request_hash'
      or receipt.package_key_hash<>app_data_agent.resolved_context_package_key_hash(receipt.package_json)
      or receipt.package_id<>app_data_agent.resolved_context_uuid_v8_from_hash(receipt.package_key_hash)
      or receipt.package_hash<>app_data_agent.u2_canonical_sha256(receipt.package_json-'package_hash')
      or receipt.receipt_hash<>app_data_agent.u2_canonical_sha256(receipt.receipt_json-'receipt_hash')
      or receipt.package_id::text<>receipt.package_json->>'package_id'
      or receipt.authority_snapshot_hash<>receipt.package_json->>'authority_snapshot_hash'
  ) then raise exception using errcode='23514',message='RESOLVED_CONTEXT_INTEGRITY_FAILED'; end if;
end
$function$;
alter table app_data_agent.resolved_context_receipts owner to data_agent_u12_context_owner;
alter function app_data_agent.reject_resolved_context_mutation() owner to data_agent_u12_context_owner;
alter function app_data_agent.resolved_context_exact_keys(jsonb,text[]) owner to data_agent_u12_context_owner;
alter function app_data_agent.resolved_context_uuid_v8_from_hash(text) owner to data_agent_u12_context_owner;
alter function app_data_agent.resolved_context_package_key_hash(jsonb) owner to data_agent_u12_context_owner;
alter function app_data_agent.assert_resolved_context_request(jsonb) owner to data_agent_u12_context_owner;
alter function app_data_agent.resolved_context_metric_projection(uuid,uuid,text,text,uuid) owner to data_agent_u12_context_owner;
alter function app_data_agent.resolved_context_ontology_projection(uuid,uuid,text,text,uuid) owner to data_agent_u12_context_owner;
alter function app_data_agent.resolved_context_relationship_projection(uuid,uuid,text,text,uuid) owner to data_agent_u12_context_owner;
alter function app_data_agent.load_resolved_context_authority_snapshot(jsonb) owner to data_agent_u12_context_owner;
alter function app_data_agent.commit_resolved_context_package(jsonb) owner to data_agent_u12_context_owner;
alter function app_data_agent.assert_resolved_context_integrity() owner to data_agent_u12_context_owner;

grant usage on schema app_data_agent,platform,semantic,catalog to data_agent_u12_context_owner;
grant execute on function platform.current_backend_authority(boolean),
  platform.backend_context_matches(uuid,uuid,text,boolean),
  app_data_agent.u2_canonical_sha256(jsonb),
  app_data_agent.contains_potential_plaintext_secret(jsonb,text),
  app_data_agent.builtin_effective_config_policy(text)
to data_agent_u12_context_owner;
grant select on app_data_agent.workspace_run_defaults,app_data_agent.workspace_run_default_revisions,
  app_data_agent.model_catalog_entries,app_data_agent.effective_run_config_receipts,
  app_data_agent.effective_config_context_receipts,app_data_agent.run_attempts,app_data_agent.outbox,
  app_data_agent.workspace_run_bindings,app_data_agent.qa_messages,app_data_agent.run_events,
  semantic.semantic_source_release,semantic.semantic_active_pointer,
  semantic.initial_semantic_release_sets,semantic.initial_semantic_release_package_bindings,
  semantic.ontology_package_candidates
to data_agent_u12_context_owner;

create policy workspace_run_defaults_u12_select on app_data_agent.workspace_run_defaults
  for select to data_agent_u12_context_owner using (platform.backend_context_matches(app_id,tenant_id,environment,false));
create policy workspace_run_default_revisions_u12_select on app_data_agent.workspace_run_default_revisions
  for select to data_agent_u12_context_owner using (platform.backend_context_matches(app_id,tenant_id,environment,false));
create policy effective_run_config_u12_select on app_data_agent.effective_run_config_receipts
  for select to data_agent_u12_context_owner using (platform.backend_context_matches(app_id,tenant_id,environment,false));
create policy effective_context_receipt_u12_select on app_data_agent.effective_config_context_receipts
  for select to data_agent_u12_context_owner using (platform.backend_context_matches(app_id,tenant_id,environment,false));
create policy run_attempt_u12_select on app_data_agent.run_attempts
  for select to data_agent_u12_context_owner using (platform.backend_context_matches(app_id,tenant_id,environment,false));
create policy outbox_u12_select on app_data_agent.outbox
  for select to data_agent_u12_context_owner using (platform.backend_context_matches(app_id,tenant_id,environment,false));
create policy workspace_run_binding_u12_select on app_data_agent.workspace_run_bindings
  for select to data_agent_u12_context_owner using (platform.backend_context_matches(app_id,tenant_id,environment,false));
create policy qa_message_u12_select on app_data_agent.qa_messages
  for select to data_agent_u12_context_owner using (platform.backend_context_matches(app_id,tenant_id,environment,false));
create policy run_event_u12_select on app_data_agent.run_events
  for select to data_agent_u12_context_owner using (platform.backend_context_matches(app_id,tenant_id,environment,false));
create policy semantic_release_u12_select on semantic.semantic_source_release
  for select to data_agent_u12_context_owner using (platform.backend_context_matches(app_id,tenant_id,environment,false));
create policy semantic_pointer_u12_select on semantic.semantic_active_pointer
  for select to data_agent_u12_context_owner using (platform.backend_context_matches(app_id,tenant_id,environment,false));
create policy initial_release_set_u12_select on semantic.initial_semantic_release_sets
  for select to data_agent_u12_context_owner using (platform.backend_context_matches(app_id,tenant_id,environment,false));
create policy initial_release_binding_u12_select on semantic.initial_semantic_release_package_bindings
  for select to data_agent_u12_context_owner using (platform.backend_context_matches(app_id,tenant_id,environment,false));
create policy ontology_package_u12_select on semantic.ontology_package_candidates
  for select to data_agent_u12_context_owner using (platform.backend_context_matches(app_id,tenant_id,environment,false));

revoke all on app_data_agent.resolved_context_receipts from public,anon,authenticated,service_role,data_agent_backend;
revoke all on function app_data_agent.resolved_context_exact_keys(jsonb,text[]),
  app_data_agent.resolved_context_uuid_v8_from_hash(text),
  app_data_agent.resolved_context_package_key_hash(jsonb),
  app_data_agent.assert_resolved_context_request(jsonb)
from public,anon,authenticated,service_role,data_agent_backend;
revoke all on function app_data_agent.load_resolved_context_authority_snapshot(jsonb),
  app_data_agent.commit_resolved_context_package(jsonb) from public,anon,authenticated,service_role,data_agent_backend;
grant execute on function app_data_agent.load_resolved_context_authority_snapshot(jsonb),
  app_data_agent.commit_resolved_context_package(jsonb) to data_agent_backend;

do $postconditions$
begin
  if not exists (
    select 1 from pg_catalog.pg_class relation join pg_catalog.pg_namespace namespace on namespace.oid=relation.relnamespace
    where namespace.nspname='app_data_agent' and relation.relname='resolved_context_receipts'
      and relation.relrowsecurity and relation.relforcerowsecurity
      and relation.relowner=(select oid from pg_catalog.pg_roles where rolname='data_agent_u12_context_owner')
  ) then raise exception using errcode='P0001',message='RESOLVED_CONTEXT_FORCE_RLS_OR_OWNER_MISSING'; end if;
  if not exists (select 1 from pg_catalog.pg_roles where rolname='data_agent_u12_context_owner'
    and not rolcanlogin and not rolsuper and not rolcreatedb and not rolcreaterole
    and not rolreplication and not rolinherit and not rolbypassrls)
  then raise exception using errcode='P0001',message='RESOLVED_CONTEXT_OWNER_FLAGS_UNSAFE'; end if;
  if pg_catalog.has_table_privilege('data_agent_backend','app_data_agent.resolved_context_receipts','INSERT,UPDATE,DELETE')
    or not pg_catalog.has_function_privilege('data_agent_backend','app_data_agent.load_resolved_context_authority_snapshot(jsonb)','EXECUTE')
    or not pg_catalog.has_function_privilege('data_agent_backend','app_data_agent.commit_resolved_context_package(jsonb)','EXECUTE')
  then raise exception using errcode='P0001',message='RESOLVED_CONTEXT_GRANT_POSTCONDITION_FAILED'; end if;
  if exists (select 1 from pg_catalog.pg_proc procedure join pg_catalog.pg_namespace namespace on namespace.oid=procedure.pronamespace
    where namespace.nspname='app_data_agent' and procedure.proname in (
      'load_resolved_context_authority_snapshot','commit_resolved_context_package')
      and (not procedure.prosecdef or not procedure.proconfig @> array['search_path=""']::text[]))
  then raise exception using errcode='P0001',message='RESOLVED_CONTEXT_RPC_SECURITY_UNSAFE'; end if;
end
$postconditions$;
select platform.assert_migration_checksum(
  'app',
  '00000000-0000-4000-8000-00000000da01'::uuid,
  '20260725010663_app_data_agent_resolved_context',
  'sha256:1b067a92410754e3f34ae4d51f0c6df67f868f1620b51fc71d7574203710882d'
);

commit;
