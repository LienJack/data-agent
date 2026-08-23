-- semantic_induction_migration_checksum: sha256:a727d28106ae592df8cf82c49245068b716f86b7dafe464c72a363a1ccdb7890
-- ============================================================
-- 10662: Semantic Induction, Drift Impact and Metric Maintenance
-- Review-only: U5 Candidate Plane remains the only Candidate authority.
-- No data import, Falcon execution, Provider invocation, or publication.
-- ============================================================

begin;

do $bootstrap$
begin
  if pg_catalog.current_setting('server_version_num')::integer not between 170000 and 179999 then
    raise exception using errcode='0A000',message='SEMANTIC_INDUCTION_POSTGRES_VERSION_UNSUPPORTED';
  end if;
  if session_user<>'postgres' or current_user<>'postgres' then
    raise exception using errcode='42501',message='SEMANTIC_INDUCTION_MIGRATION_EXECUTOR_UNSAFE';
  end if;
  if not exists (
    select 1 from platform.migration_ledger
    where owner_kind='app' and app_id='00000000-0000-4000-8000-00000000da01'::uuid
      and migration_version='20260725010661_app_data_agent_knowledge_base'
  ) then raise exception using errcode='P0001',message='SEMANTIC_INDUCTION_BASELINE_10661_MISSING'; end if;
  if pg_catalog.to_regprocedure('app_data_agent.assert_job_active_lease(jsonb)') is null
    or pg_catalog.to_regprocedure('semantic.create_candidate_draft(uuid,uuid,text,text,text,uuid,text,text,text,text,jsonb,jsonb)') is null
    or pg_catalog.to_regprocedure('app_data_agent.u2_canonical_sha256(jsonb)') is null
  then raise exception using errcode='P0001',message='SEMANTIC_INDUCTION_PREREQUISITE_MISSING'; end if;
  if not exists (select 1 from pg_catalog.pg_roles where rolname='data_agent_u11_induction_owner') then
    create role data_agent_u11_induction_owner
      nologin noinherit nosuperuser nocreatedb nocreaterole noreplication nobypassrls;
  end if;
end
$bootstrap$;

set local lock_timeout='2000ms';
set local statement_timeout='300000ms';
set local idle_in_transaction_session_timeout='60000ms';
select platform.acquire_migration_lock('app','00000000-0000-4000-8000-00000000da01'::uuid);
create table app_data_agent.semantic_induction_source_packages (
  app_id uuid not null,
  tenant_id uuid not null,
  environment text not null,
  semantic_domain text not null,
  source_kind text not null check (source_kind in ('METRIC_EXCHANGE','FOUNDATIONAL_ONTOLOGY')),
  resource_id uuid not null,
  resource_revision bigint not null check (resource_revision between 1 and 9007199254740991),
  resource_hash text not null check (resource_hash~'^sha256:[0-9a-f]{64}$'),
  content_json jsonb not null check (pg_catalog.jsonb_typeof(content_json)='object'),
  registered_at timestamptz not null,
  primary key (app_id,tenant_id,environment,resource_id,resource_revision),
  unique (app_id,tenant_id,environment,resource_id,resource_revision,resource_hash)
);

create table app_data_agent.semantic_induction_proposals (
  app_id uuid not null,
  tenant_id uuid not null,
  environment text not null,
  induction_id uuid not null,
  semantic_domain text not null,
  proposal_hash text not null check (proposal_hash~'^sha256:[0-9a-f]{64}$'),
  proposal_json jsonb not null check (pg_catalog.jsonb_typeof(proposal_json)='object'),
  committed_at timestamptz not null,
  primary key (app_id,tenant_id,environment,induction_id),
  unique (app_id,tenant_id,environment,induction_id,proposal_hash)
);

create table app_data_agent.semantic_impact_plans (
  app_id uuid not null,
  tenant_id uuid not null,
  environment text not null,
  induction_id uuid not null,
  semantic_domain text not null,
  plan_hash text not null check (plan_hash~'^sha256:[0-9a-f]{64}$'),
  plan_json jsonb not null check (pg_catalog.jsonb_typeof(plan_json)='object'),
  committed_at timestamptz not null,
  primary key (app_id,tenant_id,environment,induction_id),
  unique (app_id,tenant_id,environment,induction_id,plan_hash)
);

create table app_data_agent.semantic_metric_dry_run_receipts (
  app_id uuid not null,
  tenant_id uuid not null,
  environment text not null,
  import_id uuid not null,
  semantic_domain text not null,
  receipt_hash text not null check (receipt_hash~'^sha256:[0-9a-f]{64}$'),
  receipt_json jsonb not null check (pg_catalog.jsonb_typeof(receipt_json)='object'),
  committed_at timestamptz not null,
  primary key (app_id,tenant_id,environment,import_id),
  unique (app_id,tenant_id,environment,import_id,receipt_hash)
);

create table app_data_agent.semantic_induction_receipts (
  app_id uuid not null,
  tenant_id uuid not null,
  environment text not null,
  induction_id uuid not null,
  semantic_domain text not null,
  job_id uuid not null,
  attempt_id uuid not null,
  worker_fence bigint not null,
  request_hash text not null check (request_hash~'^sha256:[0-9a-f]{64}$'),
  receipt_hash text not null check (receipt_hash~'^sha256:[0-9a-f]{64}$'),
  receipt_json jsonb not null check (pg_catalog.jsonb_typeof(receipt_json)='object'),
  result_json jsonb not null check (pg_catalog.jsonb_typeof(result_json)='object'),
  committed_at timestamptz not null,
  primary key (app_id,tenant_id,environment,induction_id),
  unique (app_id,tenant_id,environment,job_id),
  foreign key (app_id,tenant_id,environment,job_id)
    references app_data_agent.jobs(app_id,tenant_id,environment,job_id)
);

do $rls$
declare relation_name text;
begin
  foreach relation_name in array array[
    'semantic_induction_source_packages','semantic_induction_proposals','semantic_impact_plans',
    'semantic_metric_dry_run_receipts','semantic_induction_receipts'
  ] loop
    execute pg_catalog.format('alter table app_data_agent.%I enable row level security',relation_name);
    execute pg_catalog.format('alter table app_data_agent.%I force row level security',relation_name);
    execute pg_catalog.format('alter table app_data_agent.%I owner to data_agent_u11_induction_owner',relation_name);
    execute pg_catalog.format(
      'create policy %I on app_data_agent.%I for all to data_agent_u11_induction_owner using (platform.backend_context_matches(app_id,tenant_id,environment,false)) with check (platform.backend_context_matches(app_id,tenant_id,environment,true))',
      relation_name||'_owner_all',relation_name
    );
  end loop;
end
$rls$;

create index semantic_induction_proposals_domain_idx on app_data_agent.semantic_induction_proposals(
  app_id,tenant_id,environment,semantic_domain,committed_at desc
);
create function app_data_agent.reject_semantic_induction_immutable_mutation()
returns trigger language plpgsql security definer set search_path=''
as $function$
begin
  raise exception using errcode='55000',message='SEMANTIC_INDUCTION_AUTHORITY_IMMUTABLE';
end
$function$;

create function app_data_agent.semantic_induction_assert_source(source jsonb)
returns void language plpgsql immutable security definer set search_path=''
as $function$
begin
  if not app_data_agent.provider_json_object_has_exact_keys(source,array[
      'schema_version','source_kind','source_ref','corpus_class','taint'
    ]) or source->>'schema_version'<>'semantic-induction-source@1.0.0'
    or source->>'source_kind' not in (
      'PHYSICAL_SCHEMA','KNOWLEDGE_DOCUMENT','METRIC_EXCHANGE','FOUNDATIONAL_ONTOLOGY'
    ) or source->>'corpus_class'<>'SEMANTIC_BOOTSTRAP_CORPUS'
    or not app_data_agent.provider_json_object_has_exact_keys(source->'source_ref',array[
      'resource_kind','resource_id','resource_revision','resource_hash'
    ]) or (source#>>'{source_ref,resource_id}')::uuid::text<>source#>>'{source_ref,resource_id}'
    or (source#>>'{source_ref,resource_revision}')::bigint not between 1 and 9007199254740991
    or source#>>'{source_ref,resource_hash}'!~'^sha256:[0-9a-f]{64}$'
    or not app_data_agent.provider_json_object_has_exact_keys(source->'taint',array[
      'contains_holdout_or_test','contains_gold_or_expected_output','contains_oracle_feedback','sealed_benchmark'
    ]) or (source#>>'{taint,contains_holdout_or_test}')::boolean
    or (source#>>'{taint,contains_gold_or_expected_output}')::boolean
    or (source#>>'{taint,contains_oracle_feedback}')::boolean
    or (source#>>'{taint,sealed_benchmark}')::boolean
    or (source->>'source_kind'='PHYSICAL_SCHEMA' and source#>>'{source_ref,resource_kind}'<>'SCHEMA_SNAPSHOT')
    or (source->>'source_kind'='KNOWLEDGE_DOCUMENT' and source#>>'{source_ref,resource_kind}'<>'KNOWLEDGE_REVISION')
    or (source->>'source_kind'='METRIC_EXCHANGE' and source#>>'{source_ref,resource_kind}'<>'METRIC_EXCHANGE_PACKAGE')
    or (source->>'source_kind'='FOUNDATIONAL_ONTOLOGY' and source#>>'{source_ref,resource_kind}'<>'FOUNDATIONAL_ONTOLOGY_RELEASE')
  then raise exception using errcode='22023',message='SEMANTIC_INDUCTION_SOURCE_INVALID'; end if;
exception when invalid_text_representation or numeric_value_out_of_range then
  raise exception using errcode='22023',message='SEMANTIC_INDUCTION_SOURCE_INVALID';
end
$function$;

create function app_data_agent.semantic_induction_assert_request(requested_request jsonb)
returns void language plpgsql stable security definer set search_path=''
as $function$
declare source jsonb; previous_identity text; identity text;
begin
  if not app_data_agent.provider_json_object_has_exact_keys(requested_request,array[
      'schema_version','scope','semantic_domain','induction_id','induction_kind',
      'base_release_ref','sources','idempotency_key'
    ]) or requested_request->>'schema_version'<>'semantic-induction-request@1.0.0'
    or requested_request->>'induction_kind' not in (
      'SCHEMA_INDUCTION','DOCUMENT_INDUCTION','FOUNDATIONAL_GROUNDING','DRIFT_REPAIR','METRIC_IMPORT'
    ) or (requested_request->>'induction_id')::uuid::text<>requested_request->>'induction_id'
    or requested_request->>'semantic_domain'!~'^[A-Za-z_][A-Za-z0-9_]{0,63}$'
    or pg_catalog.jsonb_typeof(requested_request->'sources')<>'array'
    or pg_catalog.jsonb_array_length(requested_request->'sources') not between 1 and 64
    or (requested_request->>'induction_kind'='METRIC_IMPORT'
      and pg_catalog.jsonb_array_length(requested_request->'sources')<>1)
    or requested_request#>>'{scope,app_id}'<>pg_catalog.current_setting('data_agent.app_id',true)
    or requested_request#>>'{scope,tenant_id}'<>pg_catalog.current_setting('data_agent.tenant_id',true)
    or requested_request#>>'{scope,environment}'<>pg_catalog.current_setting('data_agent.environment',true)
  then raise exception using errcode='22023',message='SEMANTIC_INDUCTION_REQUEST_INVALID'; end if;
  for source in select value from pg_catalog.jsonb_array_elements(requested_request->'sources') loop
    perform app_data_agent.semantic_induction_assert_source(source);
    if (requested_request->>'induction_kind'='SCHEMA_INDUCTION' and source->>'source_kind'<>'PHYSICAL_SCHEMA')
      or (requested_request->>'induction_kind'='DOCUMENT_INDUCTION' and source->>'source_kind'<>'KNOWLEDGE_DOCUMENT')
      or (requested_request->>'induction_kind'='METRIC_IMPORT' and source->>'source_kind'<>'METRIC_EXCHANGE')
      or (requested_request->>'induction_kind'='FOUNDATIONAL_GROUNDING' and source->>'source_kind'<>'FOUNDATIONAL_ONTOLOGY')
    then raise exception using errcode='22023',message='SEMANTIC_INDUCTION_SOURCE_KIND_MISMATCH'; end if;
    identity:=pg_catalog.jsonb_build_array(
      source->>'source_kind',source#>>'{source_ref,resource_id}',
      (source#>>'{source_ref,resource_revision}')::bigint,source#>>'{source_ref,resource_hash}'
    )::text;
    if previous_identity is not null and previous_identity>=identity then
      raise exception using errcode='22023',message='SEMANTIC_INDUCTION_SOURCES_NOT_CANONICAL'; end if;
    previous_identity:=identity;
  end loop;
end
$function$;

create function app_data_agent.semantic_induction_utc_millis(value timestamptz)
returns text language sql immutable strict parallel safe set search_path=''
as $function$
  select pg_catalog.to_char(value at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
$function$;

create function app_data_agent.semantic_induction_assert_base_release(
  request jsonb, requested_app_id uuid, requested_tenant_id uuid, requested_environment text
) returns void language plpgsql stable security definer set search_path=''
as $function$
begin
  if request->'base_release_ref'='null'::jsonb then
    if exists (
      select 1 from semantic.semantic_source_release release
      where release.app_id=requested_app_id and release.tenant_id=requested_tenant_id
        and release.environment=requested_environment
        and release.semantic_domain=request->>'semantic_domain'
    ) then raise exception using errcode='40001',message='SEMANTIC_INDUCTION_BASE_RELEASE_REQUIRED'; end if;
  elsif not exists (
    select 1 from semantic.semantic_source_release release
    join semantic.semantic_active_pointer pointer
      on pointer.app_id=release.app_id and pointer.tenant_id=release.tenant_id
      and pointer.environment=release.environment
      and pointer.semantic_domain=release.semantic_domain
      and pointer.current_release_id=release.release_id
      and pointer.current_release_generation=release.release_generation
      and pointer.current_release_digest=release.release_digest
    where release.app_id=requested_app_id and release.tenant_id=requested_tenant_id
      and release.environment=requested_environment
      and release.semantic_domain=request->>'semantic_domain'
      and release.release_id=(request#>>'{base_release_ref,release_id}')::uuid
      and release.release_generation=(request#>>'{base_release_ref,generation}')::bigint
      and release.release_digest=request#>>'{base_release_ref,release_hash}'
  ) then raise exception using errcode='40001',message='SEMANTIC_INDUCTION_BASE_RELEASE_STALE'; end if;
exception when invalid_text_representation or numeric_value_out_of_range then
  raise exception using errcode='22023',message='SEMANTIC_INDUCTION_BASE_RELEASE_INVALID';
end
$function$;

create function app_data_agent.semantic_induction_stable_object_id(identity_hash text)
returns uuid language plpgsql immutable strict security definer set search_path=''
as $function$
declare value text; variant text;
begin
  if identity_hash!~'^sha256:[0-9a-f]{64}$' then
    raise exception using errcode='22023',message='SEMANTIC_STABLE_OBJECT_IDENTITY_INVALID';
  end if;
  value:=pg_catalog.substr(identity_hash,8,32);
  value:=pg_catalog.substr(value,1,12)||'8'||pg_catalog.substr(value,14);
  variant:=case pg_catalog.substr(value,17,1)
    when '0' then '8' when '4' then '8' when '8' then '8' when 'c' then '8'
    when '1' then '9' when '5' then '9' when '9' then '9' when 'd' then '9'
    when '2' then 'a' when '6' then 'a' when 'a' then 'a' when 'e' then 'a'
    else 'b' end;
  value:=pg_catalog.substr(value,1,16)||variant||pg_catalog.substr(value,18);
  return (pg_catalog.substr(value,1,8)||'-'||pg_catalog.substr(value,9,4)||'-'||
    pg_catalog.substr(value,13,4)||'-'||pg_catalog.substr(value,17,4)||'-'||
    pg_catalog.substr(value,21,12))::uuid;
end
$function$;
create function app_data_agent.register_semantic_induction_source(
  requested_semantic_domain text, requested_source jsonb, requested_content jsonb
) returns jsonb language plpgsql security definer set search_path=''
as $function$
declare authority record; existing app_data_agent.semantic_induction_source_packages%rowtype;
begin
  select * into authority from platform.current_backend_authority(true);
  perform app_data_agent.semantic_induction_assert_source(requested_source);
  if requested_source->>'source_kind' not in ('METRIC_EXCHANGE','FOUNDATIONAL_ONTOLOGY')
    or requested_semantic_domain!~'^[A-Za-z_][A-Za-z0-9_]{0,63}$'
    or not app_data_agent.provider_json_object_has_exact_keys(requested_content,array[
      'metric_format','facts','metrics','dependencies'
    ])
    or pg_catalog.jsonb_typeof(requested_content->'facts')<>'array'
    or pg_catalog.jsonb_typeof(requested_content->'metrics')<>'array'
    or pg_catalog.jsonb_typeof(requested_content->'dependencies')<>'array'
    or (requested_source->>'source_kind'='METRIC_EXCHANGE')<>(requested_content->'metric_format'<>'null'::jsonb)
    or (requested_content->'metric_format'<>'null'::jsonb
      and requested_content->>'metric_format' not in ('OSI_METRIC_EXCHANGE','OSSIE_METRIC_EXCHANGE'))
    or (requested_source->>'source_kind'='METRIC_EXCHANGE' and (
      pg_catalog.jsonb_array_length(requested_content->'facts')<>0
      or pg_catalog.jsonb_array_length(requested_content->'metrics')=0
    ))
    or (requested_source->>'source_kind'='FOUNDATIONAL_ONTOLOGY' and (
      pg_catalog.jsonb_array_length(requested_content->'facts')=0
      or pg_catalog.jsonb_array_length(requested_content->'metrics')<>0
      or exists (
        select 1 from pg_catalog.jsonb_array_elements(requested_content->'facts') fact(value)
        where fact.value->>'object_role'<>'ONTOLOGY_ALIGNMENT'
      )
    ))
    or requested_source#>>'{source_ref,resource_hash}'<>app_data_agent.u2_canonical_sha256(requested_content)
  then raise exception using errcode='22023',message='SEMANTIC_INDUCTION_SOURCE_INVALID'; end if;
  select * into existing from app_data_agent.semantic_induction_source_packages
  where app_id=authority.app_id and tenant_id=authority.tenant_id and environment=authority.environment
    and resource_id=(requested_source#>>'{source_ref,resource_id}')::uuid
    and resource_revision=(requested_source#>>'{source_ref,resource_revision}')::bigint;
  if found then
    if existing.resource_hash<>requested_source#>>'{source_ref,resource_hash}'
      or existing.content_json<>requested_content or existing.semantic_domain<>requested_semantic_domain
    then raise exception using errcode='23505',message='SEMANTIC_INDUCTION_SOURCE_CONFLICT'; end if;
    return requested_source->'source_ref';
  end if;
  insert into app_data_agent.semantic_induction_source_packages(
    app_id,tenant_id,environment,semantic_domain,source_kind,resource_id,resource_revision,
    resource_hash,content_json,registered_at
  ) values (
    authority.app_id,authority.tenant_id,authority.environment,requested_semantic_domain,
    requested_source->>'source_kind',(requested_source#>>'{source_ref,resource_id}')::uuid,
    (requested_source#>>'{source_ref,resource_revision}')::bigint,
    requested_source#>>'{source_ref,resource_hash}',requested_content,pg_catalog.clock_timestamp()
  );
  return requested_source->'source_ref';
end
$function$;

create function app_data_agent.load_semantic_induction_target(requested_lease jsonb)
returns jsonb language plpgsql security definer set search_path=''
as $function$
declare attempt app_data_agent.job_attempts%rowtype; job app_data_agent.jobs%rowtype;
  request jsonb; source jsonb; source_content jsonb; sources jsonb:='[]'::jsonb;
  facts jsonb; chunks jsonb; package app_data_agent.semantic_induction_source_packages%rowtype;
  scan catalog.schema_scan_run%rowtype; snapshot catalog.physical_schema_snapshot%rowtype;
  base app_data_agent.knowledge_base_revisions%rowtype; generation app_data_agent.knowledge_index_generations%rowtype;
  previous_objects jsonb:='[]'::jsonb; dependencies jsonb:='[]'::jsonb;
begin
  attempt:=app_data_agent.assert_job_active_lease(requested_lease);
  select * into strict job from app_data_agent.jobs
  where app_id=attempt.app_id and tenant_id=attempt.tenant_id and environment=attempt.environment
    and job_id=attempt.job_id;
  if job.kind not in ('SEMANTIC_INDUCTION','METRIC_IMPORT')
    or job.input_json->>'kind'<>job.kind or job.input_json->'resource_refs'<>'[]'::jsonb
    or not app_data_agent.provider_json_object_has_exact_keys(job.input_json->'parameters',array['request'])
  then raise exception using errcode='22023',message='SEMANTIC_INDUCTION_JOB_INVALID'; end if;
  request:=job.input_json#>'{parameters,request}';
  perform app_data_agent.semantic_induction_assert_request(request);
  perform app_data_agent.semantic_induction_assert_base_release(
    request,job.app_id,job.tenant_id,job.environment
  );
  if (job.kind='METRIC_IMPORT')<>(request->>'induction_kind'='METRIC_IMPORT') then
    raise exception using errcode='22023',message='SEMANTIC_INDUCTION_JOB_INVALID'; end if;
  for source in select value from pg_catalog.jsonb_array_elements(request->'sources') loop
    if source->>'source_kind'='PHYSICAL_SCHEMA' then
      select * into strict scan from catalog.schema_scan_run
      where app_id=job.app_id and tenant_id=job.tenant_id and environment=job.environment
        and snapshot_id=(source#>>'{source_ref,resource_id}')::uuid and terminal='SUCCEEDED'
        and snapshot_content_hash=source#>>'{source_ref,resource_hash}';
      if (source#>>'{source_ref,resource_revision}')::bigint<>1 then
        raise exception using errcode='40001',message='SEMANTIC_INDUCTION_SOURCE_STALE'; end if;
      select * into strict snapshot from catalog.physical_schema_snapshot
      where app_id=scan.app_id and tenant_id=scan.tenant_id and environment=scan.environment
        and datasource_id=scan.datasource_id and datasource_fingerprint=scan.datasource_fingerprint
        and snapshot_content_hash=scan.snapshot_content_hash;
      select pg_catalog.coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
        'namespace',request->>'semantic_domain','object_role','ENTITY',
        'name',relation.value#>>'{identity,relation_name}','aliases','[]'::jsonb,
        'mapping_identities',pg_catalog.jsonb_build_array('relation:'||(relation.value#>>'{identity,schema_name}')||'.'||(relation.value#>>'{identity,relation_name}')),
        'evidence_identities',pg_catalog.jsonb_build_array('physical-relation:'||(relation.value#>>'{identity,schema_name}')||'.'||(relation.value#>>'{identity,relation_name}')),
        'payload',pg_catalog.jsonb_build_object('schema_name',relation.value#>>'{identity,schema_name}','relation_name',relation.value#>>'{identity,relation_name}','relation_kind',relation.value->>'relation_kind')
      ) order by relation.value#>>'{identity,schema_name}',relation.value#>>'{identity,relation_name}'),'[]'::jsonb)
      into facts from pg_catalog.jsonb_array_elements(snapshot.content_payload->'relations') relation(value);
      source_content:=pg_catalog.jsonb_build_object(
        'source_ref',source->'source_ref','content_hash',snapshot.content_storage_digest,
        'metric_format',null,'facts',facts,'metrics','[]'::jsonb,'document_chunks','[]'::jsonb
      );
    elsif source->>'source_kind'='KNOWLEDGE_DOCUMENT' then
      select * into strict base from app_data_agent.knowledge_base_revisions
      where app_id=job.app_id and tenant_id=job.tenant_id and environment=job.environment
        and knowledge_base_id=(source#>>'{source_ref,resource_id}')::uuid
        and revision=(source#>>'{source_ref,resource_revision}')::bigint
        and revision_hash=source#>>'{source_ref,resource_hash}' and status='READY';
      select * into strict generation from app_data_agent.knowledge_index_generations
      where app_id=base.app_id and tenant_id=base.tenant_id and environment=base.environment
        and knowledge_base_id=base.knowledge_base_id and knowledge_base_revision=base.revision
        and knowledge_base_revision_hash=base.revision_hash and state='READY'
      order by generation_revision desc limit 1;
      if exists (
        select 1 from app_data_agent.knowledge_chunks chunk
        left join app_data_agent.knowledge_projection_receipts projection
          on projection.app_id=chunk.app_id and projection.tenant_id=chunk.tenant_id
          and projection.environment=chunk.environment
          and projection.generation_id=chunk.generation_id and projection.chunk_id=chunk.chunk_id
        where chunk.app_id=generation.app_id and chunk.tenant_id=generation.tenant_id
          and chunk.environment=generation.environment and chunk.generation_id=generation.generation_id
          and (
            projection.receipt_id is null or projection.decision<>'ALLOW'
            or projection.receipt_json->>'classification' not in ('PUBLIC','INTERNAL')
            or (projection.receipt_json->>'pii_finding_count')::bigint<>0
            or (projection.receipt_json->>'credential_finding_count')::bigint<>0
            or (projection.receipt_json->>'prompt_injection_detected')::boolean
            or pg_catalog.lower(chunk.normalized_text) ~
              '(^|[^a-z])(falcon|holdout|gold[ _-]?(sql|answer)|expected[ _-]?(sql|output|answer)|oracle[ _-]?feedback|test[ _-]?question)([^a-z]|$)'
          )
      ) then raise exception using errcode='22023',message='SEMANTIC_INDUCTION_SOURCE_TAINTED'; end if;
      select pg_catalog.coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
        'chunk_id',chunk.chunk_id,'ordinal',chunk.ordinal,'text_hash',chunk.text_hash,
        'normalized_text',chunk.normalized_text
      ) order by chunk.ordinal),'[]'::jsonb) into chunks
      from app_data_agent.knowledge_chunks chunk
      where chunk.app_id=generation.app_id and chunk.tenant_id=generation.tenant_id
        and chunk.environment=generation.environment and chunk.generation_id=generation.generation_id;
      if pg_catalog.jsonb_array_length(chunks)=0 then
        raise exception using errcode='40001',message='SEMANTIC_INDUCTION_SOURCE_STALE'; end if;
      source_content:=pg_catalog.jsonb_build_object(
        'source_ref',source->'source_ref','content_hash',base.revision_hash,
        'metric_format',null,'facts','[]'::jsonb,'metrics','[]'::jsonb,'document_chunks',chunks
      );
    else
      select * into strict package from app_data_agent.semantic_induction_source_packages
      where app_id=job.app_id and tenant_id=job.tenant_id and environment=job.environment
        and semantic_domain=request->>'semantic_domain' and source_kind=source->>'source_kind'
        and resource_id=(source#>>'{source_ref,resource_id}')::uuid
        and resource_revision=(source#>>'{source_ref,resource_revision}')::bigint
        and resource_hash=source#>>'{source_ref,resource_hash}';
      source_content:=pg_catalog.jsonb_build_object(
        'source_ref',source->'source_ref','content_hash',package.resource_hash,
        'metric_format',package.content_json->'metric_format',
        'facts',package.content_json->'facts','metrics',package.content_json->'metrics',
        'document_chunks','[]'::jsonb
      );
      dependencies:=dependencies||(package.content_json->'dependencies');
    end if;
    sources:=sources||pg_catalog.jsonb_build_array(source_content);
  end loop;
  select pg_catalog.coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
    'object_id',(object.value->>'object_id')::uuid,
    'object_kind',case object.value#>>'{material,object_role}'
      when 'DIMENSION' then 'DIMENSION' when 'METRIC' then 'METRIC'
      when 'RELATIONSHIP' then 'RELATIONSHIP' when 'FORMULA' then 'FORMULA' else 'ENTITY' end,
    'object_hash',object.value->>'identity_hash'
  ) order by object.value->>'object_id'),'[]'::jsonb) into previous_objects
  from (
    select proposal_json from app_data_agent.semantic_induction_proposals
    where app_id=job.app_id and tenant_id=job.tenant_id and environment=job.environment
      and semantic_domain=request->>'semantic_domain'
    order by committed_at desc limit 1
  ) previous, lateral pg_catalog.jsonb_array_elements(previous.proposal_json->'stable_objects') object(value);
  return pg_catalog.jsonb_build_object(
    'request',request,'sources',sources,'previous_objects',previous_objects,'dependencies',dependencies
  );
exception when no_data_found or invalid_text_representation or numeric_value_out_of_range then
  raise exception using errcode='40001',message='SEMANTIC_INDUCTION_SOURCE_STALE';
end
$function$;
create function app_data_agent.commit_semantic_induction_candidate(
  requested_lease jsonb, requested_command jsonb
) returns jsonb language plpgsql security definer set search_path=''
as $function$
declare attempt app_data_agent.job_attempts%rowtype; job app_data_agent.jobs%rowtype;
  request jsonb; proposal jsonb; impact jsonb; dry_run jsonb; candidate_draft jsonb;
  candidate jsonb; receipt jsonb; result jsonb; now_at timestamptz:=pg_catalog.clock_timestamp();
  existing app_data_agent.semantic_induction_receipts%rowtype;
  stable_object jsonb; evidence_item jsonb; evidence_identity text;
begin
  if not app_data_agent.provider_json_object_has_exact_keys(requested_command,array[
      'schema_version','request','proposal','impact_plan','metric_dry_run','candidate_draft'
    ]) or requested_command->>'schema_version'<>'semantic-induction-commit-command@1.0.0'
  then raise exception using errcode='22023',message='SEMANTIC_INDUCTION_COMMIT_INVALID'; end if;
  request:=requested_command->'request'; proposal:=requested_command->'proposal';
  impact:=requested_command->'impact_plan';
  dry_run:=nullif(requested_command->'metric_dry_run','null'::jsonb);
  candidate_draft:=requested_command->'candidate_draft';
  perform app_data_agent.semantic_induction_assert_request(request);
  if proposal->>'proposal_hash'<>app_data_agent.u2_canonical_sha256(proposal-'proposal_hash')
    or impact->>'plan_hash'<>app_data_agent.u2_canonical_sha256(impact-'plan_hash')
    or (dry_run is not null and dry_run->>'receipt_hash'<>app_data_agent.u2_canonical_sha256(dry_run-'receipt_hash'))
    or proposal->>'induction_id'<>request->>'induction_id'
    or impact->>'induction_id'<>request->>'induction_id'
    or proposal->>'semantic_domain'<>request->>'semantic_domain'
    or impact->>'semantic_domain'<>request->>'semantic_domain'
    or proposal->'scope'<>request->'scope' or impact->'scope'<>request->'scope'
    or proposal->'base_release_ref'<>request->'base_release_ref'
    or (request->>'induction_kind'='METRIC_IMPORT')<>(dry_run is not null)
    or (dry_run is not null and (
      dry_run->>'status'<>'VALID' or dry_run->'scope'<>request->'scope'
      or dry_run->>'semantic_domain'<>request->>'semantic_domain'
      or dry_run->>'import_id'<>request->>'induction_id'
    ))
    or candidate_draft->>'schema_version'<>'semantic-candidate-draft@1.0.0'
    or candidate_draft->>'semantic_domain'<>request->>'semantic_domain'
    or candidate_draft->>'idempotency_key'<>request->>'induction_id'
    or candidate_draft#>>'{source_payload,content,review_only}'<>'true'
    or candidate_draft#>>'{source_payload,content,proposal_hash}'<>proposal->>'proposal_hash'
  then raise exception using errcode='22023',message='SEMANTIC_INDUCTION_COMMIT_INVALID'; end if;
  if pg_catalog.jsonb_typeof(proposal->'stable_objects')<>'array'
    or pg_catalog.jsonb_typeof(proposal->'evidence')<>'array'
    or pg_catalog.jsonb_typeof(proposal->'candidates')<>'array'
    or pg_catalog.jsonb_array_length(proposal->'stable_objects')
      <>pg_catalog.jsonb_array_length(proposal->'candidates')
  then raise exception using errcode='22023',message='SEMANTIC_INDUCTION_PROPOSAL_CLOSURE_INVALID'; end if;
  for stable_object in select value from pg_catalog.jsonb_array_elements(proposal->'stable_objects') loop
    if stable_object->>'identity_hash'<>app_data_agent.u2_canonical_sha256(stable_object->'material')
      or (stable_object->>'object_id')::uuid
        <>app_data_agent.semantic_induction_stable_object_id(stable_object->>'identity_hash')
      or 1<>(select pg_catalog.count(*) from pg_catalog.jsonb_array_elements(proposal->'candidates') candidate(value)
        where candidate.value->>'object_id'=stable_object->>'object_id')
    then raise exception using errcode='22023',message='SEMANTIC_INDUCTION_PROPOSAL_CLOSURE_INVALID'; end if;
    for evidence_identity in select value from pg_catalog.jsonb_array_elements_text(
      stable_object#>'{material,evidence_identities}'
    ) loop
      if 1<>(select pg_catalog.count(*) from pg_catalog.jsonb_array_elements(proposal->'evidence') evidence(value)
        where evidence.value->>'evidence_id'=evidence_identity)
      then raise exception using errcode='22023',message='SEMANTIC_INDUCTION_PROPOSAL_CLOSURE_INVALID'; end if;
    end loop;
  end loop;
  for evidence_item in select value from pg_catalog.jsonb_array_elements(proposal->'evidence') loop
    if not exists (
      select 1 from pg_catalog.jsonb_array_elements(request->'sources') source(value)
      where source.value->'source_ref'=evidence_item->'source_ref'
    ) or not exists (
      select 1 from pg_catalog.jsonb_array_elements(proposal->'stable_objects') object(value),
        lateral pg_catalog.jsonb_array_elements_text(object.value#>'{material,evidence_identities}') identity(value)
      where identity.value=evidence_item->>'evidence_id'
    ) then raise exception using errcode='22023',message='SEMANTIC_INDUCTION_PROPOSAL_CLOSURE_INVALID'; end if;
  end loop;
  if exists (
    select 1 from pg_catalog.jsonb_array_elements_text(impact->'changed_object_ids') changed(value)
    where not exists (
      select 1 from pg_catalog.jsonb_array_elements(proposal->'candidates') candidate(value)
      where candidate.value->>'object_id'=changed.value
    )
  ) then raise exception using errcode='22023',message='SEMANTIC_INDUCTION_IMPACT_CLOSURE_INVALID'; end if;
  attempt:=app_data_agent.assert_job_active_lease(requested_lease);
  select * into strict job from app_data_agent.jobs
  where app_id=attempt.app_id and tenant_id=attempt.tenant_id and environment=attempt.environment
    and job_id=attempt.job_id and kind in ('SEMANTIC_INDUCTION','METRIC_IMPORT');
  if job.input_json#>'{parameters,request}'<>request then
    raise exception using errcode='22023',message='SEMANTIC_INDUCTION_REQUEST_MISMATCH'; end if;
  perform app_data_agent.semantic_induction_assert_base_release(
    request,job.app_id,job.tenant_id,job.environment
  );
  select * into existing from app_data_agent.semantic_induction_receipts
  where app_id=job.app_id and tenant_id=job.tenant_id and environment=job.environment
    and induction_id=(request->>'induction_id')::uuid;
  if found then
    if existing.request_hash<>job.request_hash
      or existing.receipt_json->>'proposal_hash'<>proposal->>'proposal_hash'
      or existing.receipt_json#>>'{impact_plan_ref,resource_hash}'<>impact->>'plan_hash'
    then raise exception using errcode='23505',message='SEMANTIC_INDUCTION_IDEMPOTENCY_CONFLICT'; end if;
    return existing.result_json;
  end if;
  perform pg_catalog.set_config('app.semantic_domain',request->>'semantic_domain',true);
  candidate:=semantic.create_candidate_draft(
    job.app_id,job.tenant_id,job.environment,request->>'semantic_domain',job.principal_id::text,
    (candidate_draft->>'idempotency_key')::uuid,candidate_draft->>'title',candidate_draft->>'description',
    candidate_draft->>'change_class',candidate_draft->>'risk_level',
    candidate_draft->'source_payload',candidate_draft->'diff'
  )||pg_catalog.jsonb_build_object(
    'schema_version','semantic-candidate-create-result@1.0.0','authority','POSTGRESQL'
  );
  insert into app_data_agent.semantic_induction_proposals(
    app_id,tenant_id,environment,induction_id,semantic_domain,proposal_hash,proposal_json,committed_at
  ) values (job.app_id,job.tenant_id,job.environment,(request->>'induction_id')::uuid,
    request->>'semantic_domain',proposal->>'proposal_hash',proposal,now_at);
  insert into app_data_agent.semantic_impact_plans(
    app_id,tenant_id,environment,induction_id,semantic_domain,plan_hash,plan_json,committed_at
  ) values (job.app_id,job.tenant_id,job.environment,(request->>'induction_id')::uuid,
    request->>'semantic_domain',impact->>'plan_hash',impact,now_at);
  if dry_run is not null then
    insert into app_data_agent.semantic_metric_dry_run_receipts(
      app_id,tenant_id,environment,import_id,semantic_domain,receipt_hash,receipt_json,committed_at
    ) values (job.app_id,job.tenant_id,job.environment,(dry_run->>'import_id')::uuid,
      request->>'semantic_domain',dry_run->>'receipt_hash',dry_run,now_at);
  end if;
  receipt:=pg_catalog.jsonb_build_object(
    'schema_version','semantic-induction-receipt@1.0.0','scope',request->'scope',
    'semantic_domain',request->>'semantic_domain','induction_id',request->>'induction_id',
    'request_hash',job.request_hash,'proposal_hash',proposal->>'proposal_hash',
    'impact_plan_ref',pg_catalog.jsonb_build_object('resource_id',request->>'induction_id','resource_revision',1,'resource_hash',impact->>'plan_hash'),
    'metric_dry_run_ref',case when dry_run is null then null else pg_catalog.jsonb_build_object(
      'resource_id',dry_run->>'import_id','resource_revision',1,'resource_hash',dry_run->>'receipt_hash') end,
    'candidate_ref',pg_catalog.jsonb_build_object('resource_id',candidate->>'candidate_id','resource_revision',1,'resource_hash',candidate->>'revision_digest'),
    'terminal','CANDIDATE_CREATED','created_at',app_data_agent.semantic_induction_utc_millis(now_at)
  );
  receipt:=receipt||pg_catalog.jsonb_build_object('receipt_hash',app_data_agent.u2_canonical_sha256(receipt));
  result:=pg_catalog.jsonb_build_object(
    'schema_version','semantic-induction-commit-result@1.0.0','receipt',receipt,'candidate',candidate
  );
  insert into app_data_agent.semantic_induction_receipts(
    app_id,tenant_id,environment,induction_id,semantic_domain,job_id,attempt_id,worker_fence,
    request_hash,receipt_hash,receipt_json,result_json,committed_at
  ) values (job.app_id,job.tenant_id,job.environment,(request->>'induction_id')::uuid,
    request->>'semantic_domain',job.job_id,attempt.attempt_id,attempt.worker_fence,
    job.request_hash,receipt->>'receipt_hash',receipt,result,now_at);
  return result;
exception when no_data_found then
  raise exception using errcode='40001',message='SEMANTIC_INDUCTION_JOB_STALE';
end
$function$;

create function app_data_agent.record_semantic_induction_rejection(
  requested_lease jsonb, requested_command jsonb
) returns jsonb language plpgsql security definer set search_path=''
as $function$
declare attempt app_data_agent.job_attempts%rowtype; job app_data_agent.jobs%rowtype;
  request jsonb; dry_run jsonb; terminal text; receipt jsonb; result jsonb;
  now_at timestamptz:=pg_catalog.clock_timestamp();
  existing app_data_agent.semantic_induction_receipts%rowtype;
begin
  if not app_data_agent.provider_json_object_has_exact_keys(requested_command,array[
      'schema_version','request','terminal','metric_dry_run'
    ]) or requested_command->>'schema_version'<>'semantic-induction-reject-command@1.0.0'
    or requested_command->>'terminal' not in ('DRY_RUN_REJECTED','CONFLICT')
  then raise exception using errcode='22023',message='SEMANTIC_INDUCTION_REJECTION_INVALID'; end if;
  request:=requested_command->'request'; terminal:=requested_command->>'terminal';
  dry_run:=nullif(requested_command->'metric_dry_run','null'::jsonb);
  perform app_data_agent.semantic_induction_assert_request(request);
  if (terminal='DRY_RUN_REJECTED' and (
      dry_run is null or dry_run->>'status' not in ('INVALID','CONFLICT')
    )) or (dry_run is not null and (
      dry_run->>'receipt_hash'<>app_data_agent.u2_canonical_sha256(dry_run-'receipt_hash')
      or dry_run->'scope'<>request->'scope'
      or dry_run->>'semantic_domain'<>request->>'semantic_domain'
      or dry_run->>'import_id'<>request->>'induction_id'
    ))
  then raise exception using errcode='22023',message='SEMANTIC_INDUCTION_REJECTION_INVALID'; end if;
  attempt:=app_data_agent.assert_job_active_lease(requested_lease);
  select * into strict job from app_data_agent.jobs
  where app_id=attempt.app_id and tenant_id=attempt.tenant_id and environment=attempt.environment
    and job_id=attempt.job_id and kind in ('SEMANTIC_INDUCTION','METRIC_IMPORT');
  if job.input_json#>'{parameters,request}'<>request then
    raise exception using errcode='22023',message='SEMANTIC_INDUCTION_REQUEST_MISMATCH'; end if;
  select * into existing from app_data_agent.semantic_induction_receipts
  where app_id=job.app_id and tenant_id=job.tenant_id and environment=job.environment
    and induction_id=(request->>'induction_id')::uuid;
  if found then
    if existing.request_hash<>job.request_hash
      or existing.receipt_json->>'terminal'<>terminal
      or existing.receipt_json#>>'{metric_dry_run_ref,resource_hash}'
        is distinct from dry_run->>'receipt_hash'
    then raise exception using errcode='23505',message='SEMANTIC_INDUCTION_IDEMPOTENCY_CONFLICT'; end if;
    return existing.result_json;
  end if;
  if dry_run is not null then
    insert into app_data_agent.semantic_metric_dry_run_receipts(
      app_id,tenant_id,environment,import_id,semantic_domain,receipt_hash,receipt_json,committed_at
    ) values (job.app_id,job.tenant_id,job.environment,(dry_run->>'import_id')::uuid,
      request->>'semantic_domain',dry_run->>'receipt_hash',dry_run,now_at);
  end if;
  receipt:=pg_catalog.jsonb_build_object(
    'schema_version','semantic-induction-receipt@1.0.0','scope',request->'scope',
    'semantic_domain',request->>'semantic_domain','induction_id',request->>'induction_id',
    'request_hash',job.request_hash,'proposal_hash',null,
    'impact_plan_ref',null,
    'metric_dry_run_ref',case when dry_run is null then null else pg_catalog.jsonb_build_object(
      'resource_id',dry_run->>'import_id','resource_revision',1,'resource_hash',dry_run->>'receipt_hash') end,
    'candidate_ref',null,'terminal',terminal,
    'created_at',app_data_agent.semantic_induction_utc_millis(now_at)
  );
  receipt:=receipt||pg_catalog.jsonb_build_object(
    'receipt_hash',app_data_agent.u2_canonical_sha256(receipt)
  );
  result:=pg_catalog.jsonb_build_object(
    'schema_version','semantic-induction-reject-result@1.0.0','receipt',receipt
  );
  insert into app_data_agent.semantic_induction_receipts(
    app_id,tenant_id,environment,induction_id,semantic_domain,job_id,attempt_id,worker_fence,
    request_hash,receipt_hash,receipt_json,result_json,committed_at
  ) values (job.app_id,job.tenant_id,job.environment,(request->>'induction_id')::uuid,
    request->>'semantic_domain',job.job_id,attempt.attempt_id,attempt.worker_fence,
    job.request_hash,receipt->>'receipt_hash',receipt,result,now_at);
  return result;
exception when no_data_found then
  raise exception using errcode='40001',message='SEMANTIC_INDUCTION_JOB_STALE';
end
$function$;
insert into app_data_agent.job_handler_revisions(
  kind,handler_revision,enabled,dependencies_ready,output_receipt_required
) values
  ('SEMANTIC_INDUCTION','semantic-induction-handler@1.1.0',true,true,true),
  ('METRIC_IMPORT','metric-import-handler@1.1.0',true,true,true);

create or replace function app_data_agent.assert_job_artifact_references(
  requested_references jsonb,requested_app_id uuid,requested_tenant_id uuid,requested_environment text
)
returns void language plpgsql security definer set search_path=''
as $function$
declare reference jsonb; identity text; previous_identity text;
begin
  if pg_catalog.jsonb_typeof(requested_references)<>'array'
    or pg_catalog.jsonb_array_length(requested_references)>64
  then raise exception using errcode='22023',message='JOB_OUTPUT_REFERENCES_INVALID'; end if;
  for reference in select value from pg_catalog.jsonb_array_elements(requested_references) loop
    if reference ? 'artifact_type' then
      if not app_data_agent.provider_json_object_has_exact_keys(reference,array[
          'artifact_id','artifact_type','app_id','tenant_id','environment','run_id','revision','content_hash'
        ]) or reference->>'app_id'<>requested_app_id::text
        or reference->>'tenant_id'<>requested_tenant_id::text
        or reference->>'environment'<>requested_environment
        or not exists (
          select 1 from app_data_agent.artifacts artifact
          where artifact.app_id=requested_app_id and artifact.tenant_id=requested_tenant_id
            and artifact.environment=requested_environment
            and artifact.run_id=(reference->>'run_id')::uuid
            and artifact.artifact_id=(reference->>'artifact_id')::uuid
            and artifact.artifact_type=reference->>'artifact_type'
            and artifact.revision=(reference->>'revision')::integer
            and artifact.content_hash=reference->>'content_hash' and artifact.is_active
        )
      then raise exception using errcode='23503',message='JOB_ARTIFACT_NOT_COMMITTED'; end if;
      identity:='ARTIFACT:'||reference::text;
    else
      if not app_data_agent.provider_json_object_has_exact_keys(reference,array[
          'schema_version','resource_kind','app_id','tenant_id','environment','resource_id',
          'resource_revision','resource_hash'
        ]) or reference->>'schema_version'<>'job-domain-output-reference@1.0.0'
        or reference->>'resource_kind' not in (
          'WORKSPACE_FILE_SCAN_RECEIPT','KNOWLEDGE_INDEX_GENERATION','SEMANTIC_INDUCTION_RECEIPT'
        ) or reference->>'app_id'<>requested_app_id::text
        or reference->>'tenant_id'<>requested_tenant_id::text
        or reference->>'environment'<>requested_environment
        or reference->>'resource_hash'!~'^sha256:[0-9a-f]{64}$'
      then raise exception using errcode='23503',message='JOB_DOMAIN_OUTPUT_NOT_COMMITTED'; end if;
      if reference->>'resource_kind'='WORKSPACE_FILE_SCAN_RECEIPT' and not exists (
        select 1 from app_data_agent.workspace_file_scan_receipts receipt
        where receipt.app_id=requested_app_id and receipt.tenant_id=requested_tenant_id
          and receipt.environment=requested_environment
          and receipt.receipt_id=(reference->>'resource_id')::uuid
          and receipt.receipt_hash=reference->>'resource_hash'
      ) then raise exception using errcode='23503',message='JOB_DOMAIN_OUTPUT_NOT_COMMITTED'; end if;
      if reference->>'resource_kind'='KNOWLEDGE_INDEX_GENERATION' and not exists (
        select 1 from app_data_agent.knowledge_index_generations generation
        where generation.app_id=requested_app_id and generation.tenant_id=requested_tenant_id
          and generation.environment=requested_environment
          and generation.generation_id=(reference->>'resource_id')::uuid
          and generation.generation_revision=(reference->>'resource_revision')::bigint
          and generation.generation_hash=reference->>'resource_hash' and generation.state='READY'
      ) then raise exception using errcode='23503',message='JOB_DOMAIN_OUTPUT_NOT_COMMITTED'; end if;
      if reference->>'resource_kind'='SEMANTIC_INDUCTION_RECEIPT' and not exists (
        select 1 from app_data_agent.semantic_induction_receipts receipt
        where receipt.app_id=requested_app_id and receipt.tenant_id=requested_tenant_id
          and receipt.environment=requested_environment
          and receipt.induction_id=(reference->>'resource_id')::uuid
          and (reference->>'resource_revision')::bigint=1
          and receipt.receipt_hash=reference->>'resource_hash'
      ) then raise exception using errcode='23503',message='JOB_DOMAIN_OUTPUT_NOT_COMMITTED'; end if;
      identity:='DOMAIN:'||pg_catalog.jsonb_build_array(
        reference->>'app_id',reference->>'tenant_id',reference->>'environment',
        reference->>'resource_kind',reference->>'resource_id',
        (reference->>'resource_revision')::bigint,reference->>'resource_hash'
      )::text;
    end if;
    if previous_identity is not null and previous_identity>=identity then
      raise exception using errcode='22023',message='JOB_OUTPUT_REFERENCES_NOT_CANONICAL'; end if;
    previous_identity:=identity;
  end loop;
exception when invalid_text_representation or numeric_value_out_of_range then
  raise exception using errcode='22023',message='JOB_OUTPUT_REFERENCES_INVALID';
end
$function$;
create trigger semantic_induction_source_packages_immutable
before update or delete on app_data_agent.semantic_induction_source_packages
for each row execute function app_data_agent.reject_semantic_induction_immutable_mutation();
create trigger semantic_induction_proposals_immutable
before update or delete on app_data_agent.semantic_induction_proposals
for each row execute function app_data_agent.reject_semantic_induction_immutable_mutation();
create trigger semantic_impact_plans_immutable
before update or delete on app_data_agent.semantic_impact_plans
for each row execute function app_data_agent.reject_semantic_induction_immutable_mutation();
create trigger semantic_metric_dry_run_receipts_immutable
before update or delete on app_data_agent.semantic_metric_dry_run_receipts
for each row execute function app_data_agent.reject_semantic_induction_immutable_mutation();
create trigger semantic_induction_receipts_immutable
before update or delete on app_data_agent.semantic_induction_receipts
for each row execute function app_data_agent.reject_semantic_induction_immutable_mutation();
alter function app_data_agent.reject_semantic_induction_immutable_mutation() owner to data_agent_u11_induction_owner;
alter function app_data_agent.semantic_induction_assert_source(jsonb) owner to data_agent_u11_induction_owner;
alter function app_data_agent.semantic_induction_assert_request(jsonb) owner to data_agent_u11_induction_owner;
alter function app_data_agent.semantic_induction_utc_millis(timestamptz) owner to data_agent_u11_induction_owner;
alter function app_data_agent.semantic_induction_assert_base_release(jsonb,uuid,uuid,text) owner to data_agent_u11_induction_owner;
alter function app_data_agent.semantic_induction_stable_object_id(text) owner to data_agent_u11_induction_owner;
alter function app_data_agent.register_semantic_induction_source(text,jsonb,jsonb) owner to data_agent_u11_induction_owner;
alter function app_data_agent.load_semantic_induction_target(jsonb) owner to data_agent_u11_induction_owner;
alter function app_data_agent.commit_semantic_induction_candidate(jsonb,jsonb) owner to data_agent_u11_induction_owner;
alter function app_data_agent.record_semantic_induction_rejection(jsonb,jsonb) owner to data_agent_u11_induction_owner;

grant usage on schema app_data_agent,platform,semantic,catalog to data_agent_u11_induction_owner;
grant execute on function
  platform.current_backend_authority(boolean),
  platform.backend_context_matches(uuid,uuid,text,boolean),
  app_data_agent.provider_json_object_has_exact_keys(jsonb,text[]),
  app_data_agent.u2_canonical_sha256(jsonb),
  app_data_agent.assert_job_active_lease(jsonb),
  semantic.create_candidate_draft(uuid,uuid,text,text,text,uuid,text,text,text,text,jsonb,jsonb)
to data_agent_u11_induction_owner;
grant select on app_data_agent.jobs,app_data_agent.job_attempts,
  app_data_agent.knowledge_base_revisions,app_data_agent.knowledge_index_generations,
  app_data_agent.knowledge_chunks,app_data_agent.knowledge_projection_receipts,
  catalog.schema_scan_run,catalog.physical_schema_snapshot,semantic.semantic_source_release,
  semantic.semantic_active_pointer
to data_agent_u11_induction_owner;

create policy jobs_u11_induction_select on app_data_agent.jobs
  as permissive for select to data_agent_u11_induction_owner
  using (platform.backend_context_matches(app_id,tenant_id,environment,false));
create policy job_attempts_u11_induction_select on app_data_agent.job_attempts
  as permissive for select to data_agent_u11_induction_owner
  using (platform.backend_context_matches(app_id,tenant_id,environment,false));
create policy knowledge_revisions_u11_induction_select on app_data_agent.knowledge_base_revisions
  as permissive for select to data_agent_u11_induction_owner
  using (platform.backend_context_matches(app_id,tenant_id,environment,false));
create policy knowledge_generations_u11_induction_select on app_data_agent.knowledge_index_generations
  as permissive for select to data_agent_u11_induction_owner
  using (platform.backend_context_matches(app_id,tenant_id,environment,false));
create policy knowledge_chunks_u11_induction_select on app_data_agent.knowledge_chunks
  as permissive for select to data_agent_u11_induction_owner
  using (platform.backend_context_matches(app_id,tenant_id,environment,false));
create policy knowledge_projection_u11_induction_select on app_data_agent.knowledge_projection_receipts
  as permissive for select to data_agent_u11_induction_owner
  using (platform.backend_context_matches(app_id,tenant_id,environment,false));
create policy schema_scan_u11_induction_select on catalog.schema_scan_run
  as permissive for select to data_agent_u11_induction_owner
  using (platform.backend_context_matches(app_id,tenant_id,environment,false));
create policy schema_snapshot_u11_induction_select on catalog.physical_schema_snapshot
  as permissive for select to data_agent_u11_induction_owner
  using (platform.backend_context_matches(app_id,tenant_id,environment,false));
create policy semantic_release_u11_induction_select on semantic.semantic_source_release
  as permissive for select to data_agent_u11_induction_owner
  using (platform.backend_context_matches(app_id,tenant_id,environment,false));
create policy semantic_active_pointer_u11_induction_select on semantic.semantic_active_pointer
  as permissive for select to data_agent_u11_induction_owner
  using (platform.backend_context_matches(app_id,tenant_id,environment,false));

grant select on app_data_agent.semantic_induction_receipts to data_agent_u15_knowledge_owner;
create policy semantic_induction_receipts_u15_job_output_select on app_data_agent.semantic_induction_receipts
  as permissive for select to data_agent_u15_knowledge_owner
  using (platform.backend_context_matches(app_id,tenant_id,environment,false));

revoke all on app_data_agent.semantic_induction_source_packages,
  app_data_agent.semantic_induction_proposals,app_data_agent.semantic_impact_plans,
  app_data_agent.semantic_metric_dry_run_receipts,app_data_agent.semantic_induction_receipts
from public,anon,authenticated,service_role,data_agent_backend;
revoke all on function
  app_data_agent.register_semantic_induction_source(text,jsonb,jsonb),
  app_data_agent.load_semantic_induction_target(jsonb),
  app_data_agent.commit_semantic_induction_candidate(jsonb,jsonb),
  app_data_agent.record_semantic_induction_rejection(jsonb,jsonb)
from public,anon,authenticated,service_role,data_agent_backend;
revoke all on function
  app_data_agent.reject_semantic_induction_immutable_mutation(),
  app_data_agent.semantic_induction_assert_source(jsonb),
  app_data_agent.semantic_induction_assert_request(jsonb),
  app_data_agent.semantic_induction_assert_base_release(jsonb,uuid,uuid,text),
  app_data_agent.semantic_induction_utc_millis(timestamptz),
  app_data_agent.semantic_induction_stable_object_id(text)
from public,anon,authenticated,service_role,data_agent_backend;
grant execute on function
  app_data_agent.reject_semantic_induction_immutable_mutation(),
  app_data_agent.semantic_induction_assert_source(jsonb),
  app_data_agent.semantic_induction_assert_request(jsonb),
  app_data_agent.semantic_induction_assert_base_release(jsonb,uuid,uuid,text),
  app_data_agent.semantic_induction_utc_millis(timestamptz),
  app_data_agent.semantic_induction_stable_object_id(text)
to data_agent_u11_induction_owner;
grant execute on function
  app_data_agent.register_semantic_induction_source(text,jsonb,jsonb),
  app_data_agent.load_semantic_induction_target(jsonb),
  app_data_agent.commit_semantic_induction_candidate(jsonb,jsonb),
  app_data_agent.record_semantic_induction_rejection(jsonb,jsonb)
to data_agent_backend;

do $postconditions$
declare relation_name text;
begin
  foreach relation_name in array array[
    'semantic_induction_source_packages','semantic_induction_proposals','semantic_impact_plans',
    'semantic_metric_dry_run_receipts','semantic_induction_receipts'
  ] loop
    if not exists (
      select 1 from pg_catalog.pg_class relation
      join pg_catalog.pg_namespace namespace on namespace.oid=relation.relnamespace
      where namespace.nspname='app_data_agent' and relation.relname=relation_name
        and relation.relrowsecurity and relation.relforcerowsecurity
        and relation.relowner=(select oid from pg_catalog.pg_roles where rolname='data_agent_u11_induction_owner')
    ) then raise exception using errcode='P0001',message='SEMANTIC_INDUCTION_FORCE_RLS_OR_OWNER_MISSING'; end if;
  end loop;
  if not exists (
    select 1 from pg_catalog.pg_roles where rolname='data_agent_u11_induction_owner'
      and not rolcanlogin and not rolsuper and not rolcreatedb and not rolcreaterole
      and not rolreplication and not rolinherit and not rolbypassrls
  ) or pg_catalog.pg_has_role('data_agent_u11_induction_owner','data_agent_backend','MEMBER')
  then raise exception using errcode='P0001',message='SEMANTIC_INDUCTION_OWNER_FLAGS_UNSAFE'; end if;
  if not exists (
    select 1 from app_data_agent.job_handler_revisions
    where kind='SEMANTIC_INDUCTION' and handler_revision='semantic-induction-handler@1.1.0'
      and enabled and dependencies_ready and output_receipt_required
  ) or not exists (
    select 1 from app_data_agent.job_handler_revisions
    where kind='METRIC_IMPORT' and handler_revision='metric-import-handler@1.1.0'
      and enabled and dependencies_ready and output_receipt_required
  ) then raise exception using errcode='P0001',message='SEMANTIC_INDUCTION_JOB_HANDLERS_MISSING'; end if;
  if pg_catalog.has_table_privilege('data_agent_backend','app_data_agent.semantic_induction_receipts','INSERT,UPDATE,DELETE')
    or not pg_catalog.has_function_privilege('data_agent_backend','app_data_agent.load_semantic_induction_target(jsonb)','EXECUTE')
    or not pg_catalog.has_function_privilege('data_agent_backend','app_data_agent.commit_semantic_induction_candidate(jsonb,jsonb)','EXECUTE')
    or not pg_catalog.has_function_privilege('data_agent_backend','app_data_agent.record_semantic_induction_rejection(jsonb,jsonb)','EXECUTE')
    or pg_catalog.has_function_privilege('anon','app_data_agent.register_semantic_induction_source(text,jsonb,jsonb)','EXECUTE')
  then raise exception using errcode='P0001',message='SEMANTIC_INDUCTION_GRANT_POSTCONDITION_FAILED'; end if;
  if exists (
    select 1 from pg_catalog.pg_proc procedure
    join pg_catalog.pg_namespace namespace on namespace.oid=procedure.pronamespace
    where namespace.nspname='app_data_agent'
      and procedure.proname in (
        'register_semantic_induction_source','load_semantic_induction_target',
        'commit_semantic_induction_candidate','record_semantic_induction_rejection'
      ) and (not procedure.prosecdef or not procedure.proconfig @> array['search_path=""']::text[])
  ) then raise exception using errcode='P0001',message='SEMANTIC_INDUCTION_RPC_SECURITY_UNSAFE'; end if;
end
$postconditions$;
select platform.assert_migration_checksum(
  'app',
  '00000000-0000-4000-8000-00000000da01'::uuid,
  '20260725010662_app_data_agent_semantic_induction',
  'sha256:a727d28106ae592df8cf82c49245068b716f86b7dafe464c72a363a1ccdb7890'
);

commit;
