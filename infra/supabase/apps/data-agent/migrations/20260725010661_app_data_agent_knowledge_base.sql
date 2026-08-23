-- knowledge_base_migration_checksum: sha256:b628dcb85fd659327a9fc1a5b931774cb685ea7565281140d7b1452ab1b89887
-- ============================================================
-- 10661: Knowledge Base, Embedding and Retrieval Authority
-- PostgreSQL authority; Neo4j is a rebuildable vector projection.
-- No data import, Falcon execution, Provider invocation, or billing.
-- ============================================================

begin;

do $bootstrap$
begin
  if pg_catalog.current_setting('server_version_num')::integer not between 170000 and 179999 then
    raise exception using errcode='0A000',message='KNOWLEDGE_POSTGRES_VERSION_UNSUPPORTED';
  end if;
  if session_user<>'postgres' or current_user<>'postgres' then
    raise exception using errcode='42501',message='KNOWLEDGE_MIGRATION_EXECUTOR_UNSAFE';
  end if;
  if not exists (
    select 1 from platform.migration_ledger
    where owner_kind='app' and app_id='00000000-0000-4000-8000-00000000da01'::uuid
      and migration_version='20260725010660_app_data_agent_workspace_files'
  ) then raise exception using errcode='P0001',message='KNOWLEDGE_BASELINE_10660_MISSING'; end if;
  if pg_catalog.to_regprocedure('app_data_agent.assert_job_active_lease(jsonb)') is null
    or pg_catalog.to_regprocedure('app_data_agent.u2_canonical_sha256(jsonb)') is null
  then raise exception using errcode='P0001',message='KNOWLEDGE_AUTHORITY_PREREQUISITE_MISSING'; end if;
  if not exists (select 1 from pg_catalog.pg_roles where rolname='data_agent_u15_knowledge_owner') then
    create role data_agent_u15_knowledge_owner
      nologin noinherit nosuperuser nocreatedb nocreaterole noreplication nobypassrls;
  end if;
end
$bootstrap$;

set local lock_timeout='2000ms';
set local statement_timeout='300000ms';
set local idle_in_transaction_session_timeout='60000ms';
select platform.acquire_migration_lock('app','00000000-0000-4000-8000-00000000da01'::uuid);
create table app_data_agent.knowledge_embedding_profile_revisions (
  app_id uuid not null,
  tenant_id uuid not null,
  environment text not null,
  profile_id uuid not null,
  revision bigint not null check (revision between 1 and 9007199254740991),
  provider text not null,
  model_id text not null,
  dimensions integer not null check (dimensions between 2 and 16384),
  status text not null check (status in ('READY','NOT_READY','STALE')),
  profile_hash text not null check (profile_hash~'^sha256:[0-9a-f]{64}$'),
  profile_json jsonb not null,
  created_at timestamptz not null,
  primary key (app_id,tenant_id,environment,profile_id,revision),
  unique (app_id,tenant_id,environment,profile_id,revision,profile_hash)
);

create table app_data_agent.knowledge_bases (
  app_id uuid not null,
  tenant_id uuid not null,
  environment text not null,
  knowledge_base_id uuid not null,
  current_revision bigint not null,
  current_revision_hash text not null,
  current_status text not null check (current_status in ('PENDING','INDEXING','READY','STALE','FAILED','DELETED')),
  updated_at timestamptz not null,
  primary key (app_id,tenant_id,environment,knowledge_base_id)
);

create table app_data_agent.knowledge_base_revisions (
  app_id uuid not null,
  tenant_id uuid not null,
  environment text not null,
  knowledge_base_id uuid not null,
  revision bigint not null check (revision between 1 and 9007199254740991),
  revision_hash text not null check (revision_hash~'^sha256:[0-9a-f]{64}$'),
  status text not null check (status in ('PENDING','INDEXING','READY','STALE','FAILED','DELETED')),
  profile_id uuid not null,
  profile_revision bigint not null,
  profile_hash text not null,
  acl_hash text not null check (acl_hash~'^sha256:[0-9a-f]{64}$'),
  source_refs_json jsonb not null check (pg_catalog.jsonb_typeof(source_refs_json)='array'),
  revision_json jsonb not null check (pg_catalog.jsonb_typeof(revision_json)='object'),
  created_at timestamptz not null,
  primary key (app_id,tenant_id,environment,knowledge_base_id,revision),
  unique (app_id,tenant_id,environment,knowledge_base_id,revision,revision_hash),
  foreign key (app_id,tenant_id,environment,profile_id,profile_revision,profile_hash)
    references app_data_agent.knowledge_embedding_profile_revisions(
      app_id,tenant_id,environment,profile_id,revision,profile_hash
    )
);

create table app_data_agent.knowledge_index_generations (
  app_id uuid not null,
  tenant_id uuid not null,
  environment text not null,
  generation_id uuid not null,
  generation_revision bigint not null check (generation_revision between 1 and 9007199254740991),
  generation_hash text not null check (generation_hash~'^sha256:[0-9a-f]{64}$'),
  knowledge_base_id uuid not null,
  knowledge_base_revision bigint not null,
  knowledge_base_revision_hash text not null,
  state text not null check (state in ('PENDING','INDEXING','READY','STALE','FAILED')),
  manifest_hash text not null check (manifest_hash~'^sha256:[0-9a-f]{64}$'),
  chunk_count bigint not null check (chunk_count between 0 and 9007199254740991),
  generation_json jsonb not null check (pg_catalog.jsonb_typeof(generation_json)='object'),
  created_at timestamptz not null,
  completed_at timestamptz,
  primary key (app_id,tenant_id,environment,generation_id,generation_revision),
  unique (app_id,tenant_id,environment,generation_id,generation_revision,generation_hash),
  foreign key (app_id,tenant_id,environment,knowledge_base_id,knowledge_base_revision,knowledge_base_revision_hash)
    references app_data_agent.knowledge_base_revisions(
      app_id,tenant_id,environment,knowledge_base_id,revision,revision_hash
    )
);

create table app_data_agent.knowledge_projection_receipts (
  app_id uuid not null,
  tenant_id uuid not null,
  environment text not null,
  receipt_id uuid not null,
  knowledge_base_id uuid not null,
  generation_id uuid not null,
  projection_kind text not null check (projection_kind in ('CHUNK','QUERY')),
  chunk_id uuid,
  decision text not null check (decision in ('ALLOW','POLICY_BLOCKED')),
  receipt_hash text not null check (receipt_hash~'^sha256:[0-9a-f]{64}$'),
  receipt_json jsonb not null,
  projected_at timestamptz not null,
  primary key (app_id,tenant_id,environment,receipt_id),
  unique (app_id,tenant_id,environment,generation_id,chunk_id),
  check ((projection_kind='CHUNK')=(chunk_id is not null))
);

create table app_data_agent.knowledge_chunks (
  app_id uuid not null,
  tenant_id uuid not null,
  environment text not null,
  generation_id uuid not null,
  generation_revision bigint not null,
  chunk_id uuid not null,
  knowledge_base_id uuid not null,
  source_file_id uuid not null,
  source_file_revision bigint not null,
  source_file_revision_hash text not null,
  ordinal bigint not null,
  start_byte bigint not null,
  end_byte bigint not null,
  text_hash text not null,
  normalized_text text not null,
  embedding_hash text not null,
  dimensions integer not null,
  vector_json jsonb not null check (pg_catalog.jsonb_typeof(vector_json)='array'),
  chunk_hash text not null check (chunk_hash~'^sha256:[0-9a-f]{64}$'),
  chunk_json jsonb not null,
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  primary key (app_id,tenant_id,environment,generation_id,chunk_id),
  unique (app_id,tenant_id,environment,generation_id,ordinal),
  unique (app_id,tenant_id,environment,generation_id,chunk_id,chunk_hash),
  foreign key (app_id,tenant_id,environment,source_file_id,source_file_revision,source_file_revision_hash)
    references app_data_agent.workspace_file_revisions(
      app_id,tenant_id,environment,file_id,revision,revision_hash
    )
);

create table app_data_agent.knowledge_retrieval_receipts (
  app_id uuid not null,
  tenant_id uuid not null,
  environment text not null,
  receipt_id uuid not null,
  principal_id uuid not null,
  knowledge_base_id uuid not null,
  generation_id uuid not null,
  generation_hash text not null,
  query_hash text not null,
  receipt_hash text not null check (receipt_hash~'^sha256:[0-9a-f]{64}$'),
  receipt_json jsonb not null,
  retrieved_at timestamptz not null,
  primary key (app_id,tenant_id,environment,receipt_id)
);

create table app_data_agent.knowledge_idempotency (
  app_id uuid not null,
  tenant_id uuid not null,
  environment text not null,
  principal_id uuid not null,
  operation_kind text not null check (operation_kind in ('CREATE','REBUILD','REGISTER_PROFILE')),
  idempotency_key text not null,
  request_hash text not null,
  result_json jsonb not null,
  created_at timestamptz not null,
  primary key (app_id,tenant_id,environment,principal_id,operation_kind,idempotency_key)
);

do $rls$
declare relation_name text;
begin
  foreach relation_name in array array[
    'knowledge_embedding_profile_revisions','knowledge_bases','knowledge_base_revisions',
    'knowledge_index_generations','knowledge_projection_receipts','knowledge_chunks',
    'knowledge_retrieval_receipts','knowledge_idempotency'
  ] loop
    execute pg_catalog.format('alter table app_data_agent.%I enable row level security',relation_name);
    execute pg_catalog.format('alter table app_data_agent.%I force row level security',relation_name);
    execute pg_catalog.format('alter table app_data_agent.%I owner to data_agent_u15_knowledge_owner',relation_name);
    execute pg_catalog.format(
      'create policy %I on app_data_agent.%I for all to data_agent_u15_knowledge_owner using (platform.backend_context_matches(app_id,tenant_id,environment,false)) with check (platform.backend_context_matches(app_id,tenant_id,environment,true))',
      relation_name||'_owner_all',relation_name
    );
  end loop;
end
$rls$;

create index knowledge_bases_status_idx on app_data_agent.knowledge_bases(
  app_id,tenant_id,environment,current_status,updated_at desc
);
create index knowledge_chunks_generation_idx on app_data_agent.knowledge_chunks(
  app_id,tenant_id,environment,generation_id,ordinal
);
create function app_data_agent.knowledge_utc_millis(value timestamptz)
returns text language sql immutable parallel safe set search_path=''
as $function$
  select pg_catalog.to_char(value at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
$function$;

create function app_data_agent.knowledge_assert_source_refs(
  requested_refs jsonb, requested_app_id uuid, requested_tenant_id uuid,
  requested_environment text, requested_principal_id uuid
)
returns void language plpgsql stable security definer set search_path=''
as $function$
declare item jsonb; previous text; identity text; resolved_file_id uuid;
begin
  if pg_catalog.jsonb_typeof(requested_refs)<>'array'
    or pg_catalog.jsonb_array_length(requested_refs) not between 1 and 128
  then raise exception using errcode='22023',message='KNOWLEDGE_SOURCE_REFERENCES_INVALID'; end if;
  for item in select value from pg_catalog.jsonb_array_elements(requested_refs) loop
    if not app_data_agent.provider_json_object_has_exact_keys(item,array['file_id','revision','revision_hash'])
      or item->>'revision_hash'!~'^sha256:[0-9a-f]{64}$'
    then raise exception using errcode='22023',message='KNOWLEDGE_SOURCE_REFERENCES_INVALID'; end if;
    identity:=pg_catalog.jsonb_build_array(
      item->>'file_id',(item->>'revision')::bigint,item->>'revision_hash'
    )::text;
    if previous is not null and previous>=identity then
      raise exception using errcode='22023',message='KNOWLEDGE_SOURCE_REFERENCES_NOT_CANONICAL';
    end if;
    previous:=identity;
    select revision.file_id into strict resolved_file_id
    from app_data_agent.workspace_file_revisions revision
    join app_data_agent.workspace_files file_record
      on file_record.app_id=revision.app_id and file_record.tenant_id=revision.tenant_id
      and file_record.environment=revision.environment and file_record.file_id=revision.file_id
      and file_record.current_revision=revision.revision
      and file_record.current_revision_hash=revision.revision_hash
    where revision.app_id=requested_app_id and revision.tenant_id=requested_tenant_id
      and revision.environment=requested_environment
      and revision.file_id=(item->>'file_id')::uuid
      and revision.revision=(item->>'revision')::bigint
      and revision.revision_hash=item->>'revision_hash'
      and revision.status='READY'
      and (revision.visibility='WORKSPACE' or revision.owner_principal_id=requested_principal_id);
  end loop;
exception when no_data_found or invalid_text_representation or numeric_value_out_of_range then
  raise exception using errcode='40001',message='KNOWLEDGE_SOURCE_NOT_READY';
end
$function$;

create function app_data_agent.knowledge_enqueue_index_job(
  requested_app_id uuid, requested_tenant_id uuid, requested_environment text,
  requested_principal_id uuid, base_document jsonb, generation_document jsonb,
  idempotency_key text
)
returns uuid language plpgsql security definer set search_path=''
as $function$
declare job_id uuid:=pg_catalog.gen_random_uuid(); now_at timestamptz:=pg_catalog.clock_timestamp();
  input_document jsonb; request_hash text; receipt jsonb; job_row app_data_agent.jobs%rowtype;
begin
  input_document:=pg_catalog.jsonb_build_object(
    'schema_version','job-input@1.0.0','kind','KNOWLEDGE_INDEX','resource_refs','[]'::jsonb,
    'parameters',pg_catalog.jsonb_build_object(
      'knowledge_base_id',base_document->>'knowledge_base_id',
      'revision',(base_document->>'revision')::bigint,
      'revision_hash',base_document->>'revision_hash',
      'generation_id',generation_document->>'generation_id'
    )
  );
  request_hash:=app_data_agent.u2_canonical_sha256(pg_catalog.jsonb_build_object(
    'schema_version','job-submit@1.0.0','scope',base_document->'scope','kind','KNOWLEDGE_INDEX',
    'idempotency_key',idempotency_key,'input',input_document,'priority',50,'max_attempts',3,
    'cancel_policy','COOPERATIVE'
  ));
  receipt:=pg_catalog.jsonb_build_object(
    'schema_version','job-submission-receipt@1.0.0','disposition','CREATED',
    'scope',base_document->'scope','principal_id',requested_principal_id,'job_id',job_id,
    'kind','KNOWLEDGE_INDEX','request_hash',request_hash,'status','QUEUED',
    'accepted_at',app_data_agent.knowledge_utc_millis(now_at)
  );
  receipt:=receipt||pg_catalog.jsonb_build_object('receipt_hash',app_data_agent.u2_canonical_sha256(receipt));
  insert into app_data_agent.jobs(
    app_id,tenant_id,environment,principal_id,job_id,kind,handler_revision,idempotency_key,
    request_hash,input_json,priority,max_attempts,cancel_policy,status,
    submission_receipt_hash,submission_receipt_json,created_at,updated_at
  ) values (
    requested_app_id,requested_tenant_id,requested_environment,requested_principal_id,job_id,
    'KNOWLEDGE_INDEX','knowledge-index-handler@1.0.0',idempotency_key,request_hash,input_document,
    50,3,'COOPERATIVE','QUEUED',receipt->>'receipt_hash',receipt,now_at,now_at
  ) returning * into job_row;
  perform app_data_agent.job_append_event(job_row,'JOB_QUEUED',pg_catalog.jsonb_build_object(
    'request_hash',request_hash,'handler_revision','knowledge-index-handler@1.0.0'
  ));
  return job_id;
end
$function$;

create function app_data_agent.knowledge_build_resource_binding(
  requested_app_id uuid, requested_tenant_id uuid, requested_environment text,
  requested_principal_id uuid, requested_resource_id uuid, requested_revision bigint,
  requested_source text, requested_mention_id jsonb
)
returns jsonb language plpgsql stable security definer set search_path=''
as $function$
declare resolved_revision app_data_agent.knowledge_base_revisions%rowtype;
  resolved_generation app_data_agent.knowledge_index_generations%rowtype;
  is_current boolean:=false;
begin
  select revision.* into resolved_revision
  from app_data_agent.knowledge_bases base
  join app_data_agent.knowledge_base_revisions revision
    on revision.app_id=base.app_id and revision.tenant_id=base.tenant_id
    and revision.environment=base.environment
    and revision.knowledge_base_id=base.knowledge_base_id
    and revision.revision=base.current_revision
    and revision.revision_hash=base.current_revision_hash
  join app_data_agent.knowledge_embedding_profile_revisions profile
    on profile.app_id=revision.app_id and profile.tenant_id=revision.tenant_id
    and profile.environment=revision.environment and profile.profile_id=revision.profile_id
    and profile.revision=revision.profile_revision and profile.profile_hash=revision.profile_hash
    and profile.status='READY'
  where base.app_id=requested_app_id and base.tenant_id=requested_tenant_id
    and base.environment=requested_environment and base.knowledge_base_id=requested_resource_id
    and base.current_revision=requested_revision and base.current_status='READY'
    and revision.status='READY';
  if found then
    select generation.* into resolved_generation
    from app_data_agent.knowledge_index_generations generation
    where generation.app_id=resolved_revision.app_id
      and generation.tenant_id=resolved_revision.tenant_id
      and generation.environment=resolved_revision.environment
      and generation.knowledge_base_id=resolved_revision.knowledge_base_id
      and generation.generation_id=(resolved_revision.revision_json#>>'{active_generation_ref,generation_id}')::uuid
      and generation.generation_revision=(resolved_revision.revision_json#>>'{active_generation_ref,generation_revision}')::bigint
      and generation.generation_hash=resolved_revision.revision_json#>>'{active_generation_ref,generation_hash}'
      and generation.state='READY'
    limit 1;
    is_current:=found and not exists (
      select 1 from pg_catalog.jsonb_array_elements(resolved_revision.source_refs_json) source_ref
      where not exists (
        select 1 from app_data_agent.workspace_files file_record
        join app_data_agent.workspace_file_revisions file_revision
          on file_revision.app_id=file_record.app_id and file_revision.tenant_id=file_record.tenant_id
          and file_revision.environment=file_record.environment and file_revision.file_id=file_record.file_id
          and file_revision.revision=file_record.current_revision
          and file_revision.revision_hash=file_record.current_revision_hash
        where file_record.app_id=requested_app_id and file_record.tenant_id=requested_tenant_id
          and file_record.environment=requested_environment
          and file_record.file_id=(source_ref->>'file_id')::uuid
          and file_revision.revision=(source_ref->>'revision')::bigint
          and file_revision.revision_hash=source_ref->>'revision_hash'
          and file_revision.status='READY'
          and (file_revision.visibility='WORKSPACE' or file_revision.owner_principal_id=requested_principal_id)
      )
    );
  end if;
  return pg_catalog.jsonb_build_object(
    'resource_kind','KNOWLEDGE','mention_id',requested_mention_id,
    'requested_resource_id',requested_resource_id,'requested_revision',requested_revision,
    'effective_resource',case when is_current then pg_catalog.jsonb_build_object(
      'resource_id',resolved_revision.knowledge_base_id,'resource_revision',resolved_revision.revision,
      'resource_hash',resolved_revision.revision_hash
    ) else null end,
    'source',requested_source,'availability',case when is_current then 'AVAILABLE' else 'UNAVAILABLE' end,
    'unavailable_reason',case when is_current then null else 'RESOURCE_NOT_FOUND_OR_FORBIDDEN' end
  );
exception when invalid_text_representation or numeric_value_out_of_range then
  raise exception using errcode='22023',message='EFFECTIVE_CONFIG_REQUEST_INVALID';
end
$function$;
create function app_data_agent.register_knowledge_embedding_profile(requested_profile jsonb)
returns jsonb language plpgsql security definer set search_path=''
as $function$
declare authority record; existing app_data_agent.knowledge_embedding_profile_revisions%rowtype;
begin
  if not app_data_agent.provider_json_object_has_exact_keys(requested_profile,array[
      'schema_version','scope','profile_id','revision','provider','model_id','dimensions','normalization',
      'parser_version','chunker_version','projection_policy_version','status','created_at','profile_hash'
    ]) or requested_profile->>'schema_version'<>'embedding-profile-revision@1.0.0'
    or requested_profile->>'profile_hash'<>app_data_agent.u2_canonical_sha256(requested_profile-'profile_hash')
    or requested_profile->>'provider'!~'^[a-z0-9][a-z0-9._-]*$'
    or (requested_profile->>'dimensions')::integer not between 2 and 16384
    or requested_profile->>'normalization' not in ('NONE','L2')
    or requested_profile->>'status' not in ('READY','NOT_READY','STALE')
    or app_data_agent.contains_potential_plaintext_secret(requested_profile)
  then raise exception using errcode='22023',message='KNOWLEDGE_EMBEDDING_PROFILE_INVALID'; end if;
  select * into strict authority from platform.current_backend_authority(true);
  if requested_profile->'scope'<>pg_catalog.jsonb_build_object(
    'app_id',authority.app_id,'tenant_id',authority.tenant_id,'environment',authority.environment
  ) then raise exception using errcode='42501',message='KNOWLEDGE_SCOPE_MISMATCH'; end if;
  select * into existing from app_data_agent.knowledge_embedding_profile_revisions
  where app_id=authority.app_id and tenant_id=authority.tenant_id and environment=authority.environment
    and profile_id=(requested_profile->>'profile_id')::uuid
    and revision=(requested_profile->>'revision')::bigint;
  if found then
    if existing.profile_hash<>requested_profile->>'profile_hash' then
      raise exception using errcode='23505',message='KNOWLEDGE_EMBEDDING_PROFILE_REPLAY_CONFLICT';
    end if;
    return existing.profile_json;
  end if;
  insert into app_data_agent.knowledge_embedding_profile_revisions(
    app_id,tenant_id,environment,profile_id,revision,provider,model_id,dimensions,status,
    profile_hash,profile_json,created_at
  ) values (
    authority.app_id,authority.tenant_id,authority.environment,
    (requested_profile->>'profile_id')::uuid,(requested_profile->>'revision')::bigint,
    requested_profile->>'provider',requested_profile->>'model_id',
    (requested_profile->>'dimensions')::integer,requested_profile->>'status',
    requested_profile->>'profile_hash',requested_profile,(requested_profile->>'created_at')::timestamptz
  );
  return requested_profile;
exception when invalid_text_representation or numeric_value_out_of_range or datetime_field_overflow then
  raise exception using errcode='22023',message='KNOWLEDGE_EMBEDDING_PROFILE_INVALID';
end
$function$;

create function app_data_agent.list_knowledge_embedding_profiles(requested_limit integer)
returns jsonb language plpgsql stable security definer set search_path=''
as $function$
declare authority record;
begin
  if requested_limit not between 1 and 100 then
    raise exception using errcode='22023',message='KNOWLEDGE_PROFILE_LIST_INVALID'; end if;
  select * into strict authority from platform.current_backend_authority(false);
  return coalesce((
    select pg_catalog.jsonb_agg(profile.profile_json order by profile.created_at desc,profile.profile_id)
    from (
      select * from app_data_agent.knowledge_embedding_profile_revisions
      where app_id=authority.app_id and tenant_id=authority.tenant_id
        and environment=authority.environment
      order by created_at desc,profile_id limit requested_limit
    ) profile
  ),'[]'::jsonb);
end
$function$;

create function app_data_agent.create_knowledge_base(requested_command jsonb)
returns jsonb language plpgsql security definer set search_path=''
as $function$
declare authority record; existing app_data_agent.knowledge_idempotency%rowtype;
  profile app_data_agent.knowledge_embedding_profile_revisions%rowtype;
  now_at timestamptz:=pg_catalog.clock_timestamp(); base_document jsonb; generation_document jsonb;
  generation_id uuid:=pg_catalog.gen_random_uuid(); acl_hash text; result_document jsonb;
begin
  if not app_data_agent.provider_json_object_has_exact_keys(requested_command,array[
      'schema_version','operation_id','workspace_id','name','source_file_refs',
      'embedding_profile_ref','acl','idempotency_key','request_hash'
    ]) or requested_command->>'schema_version'<>'knowledge-base-create@1.0.0'
    or requested_command->>'request_hash'<>app_data_agent.u2_canonical_sha256(requested_command-'request_hash')
    or pg_catalog.length(pg_catalog.btrim(requested_command->>'name')) not between 1 and 160
    or not app_data_agent.provider_json_object_has_exact_keys(requested_command->'embedding_profile_ref',array[
      'profile_id','revision','profile_hash'
    ]) or not app_data_agent.provider_json_object_has_exact_keys(requested_command->'acl',array[
      'visibility','principal_ids'
    ]) or requested_command#>>'{acl,visibility}' not in ('WORKSPACE','PRINCIPALS')
    or app_data_agent.contains_potential_plaintext_secret(requested_command)
  then raise exception using errcode='22023',message='KNOWLEDGE_BASE_CREATE_INVALID'; end if;
  select * into strict authority from platform.current_backend_authority(true);
  if requested_command->>'workspace_id'<>authority.tenant_id::text then
    raise exception using errcode='42501',message='KNOWLEDGE_SCOPE_MISMATCH';
  end if;
  select * into existing from app_data_agent.knowledge_idempotency
  where app_id=authority.app_id and tenant_id=authority.tenant_id and environment=authority.environment
    and principal_id=authority.principal_id and operation_kind='CREATE'
    and idempotency_key=requested_command->>'idempotency_key';
  if found then
    if existing.request_hash<>requested_command->>'request_hash' then
      raise exception using errcode='23505',message='KNOWLEDGE_IDEMPOTENCY_CONFLICT';
    end if;
    return existing.result_json;
  end if;
  perform app_data_agent.knowledge_assert_source_refs(
    requested_command->'source_file_refs',authority.app_id,authority.tenant_id,
    authority.environment,authority.principal_id
  );
  select * into strict profile from app_data_agent.knowledge_embedding_profile_revisions
  where app_id=authority.app_id and tenant_id=authority.tenant_id and environment=authority.environment
    and profile_id=(requested_command#>>'{embedding_profile_ref,profile_id}')::uuid
    and revision=(requested_command#>>'{embedding_profile_ref,revision}')::bigint
    and profile_hash=requested_command#>>'{embedding_profile_ref,profile_hash}' and status='READY';
  acl_hash:=app_data_agent.u2_canonical_sha256(requested_command->'acl');
  base_document:=pg_catalog.jsonb_build_object(
    'schema_version','knowledge-base-revision@1.0.0',
    'scope',pg_catalog.jsonb_build_object(
      'app_id',authority.app_id,'tenant_id',authority.tenant_id,'environment',authority.environment
    ),
    'knowledge_base_id',(requested_command->>'operation_id')::uuid,'revision',1,
    'name',pg_catalog.btrim(requested_command->>'name'),
    'source_file_refs',requested_command->'source_file_refs',
    'embedding_profile_ref',requested_command->'embedding_profile_ref',
    'acl',requested_command->'acl','status','INDEXING','active_generation_ref',null,
    'created_by_principal_id',authority.principal_id,
    'created_at',app_data_agent.knowledge_utc_millis(now_at)
  );
  base_document:=base_document||pg_catalog.jsonb_build_object(
    'revision_hash',app_data_agent.u2_canonical_sha256(base_document)
  );
  generation_document:=pg_catalog.jsonb_build_object(
    'schema_version','knowledge-index-generation@1.0.0',
    'scope',base_document->'scope','generation_id',generation_id,'generation_revision',1,
    'knowledge_base_ref',pg_catalog.jsonb_build_object(
      'knowledge_base_id',base_document->'knowledge_base_id','revision',1,
      'revision_hash',base_document->'revision_hash'
    ),
    'source_file_refs',base_document->'source_file_refs',
    'embedding_profile_ref',base_document->'embedding_profile_ref','acl_hash',acl_hash,
    'state','INDEXING','chunk_count',0,
    'manifest_hash','sha256:0000000000000000000000000000000000000000000000000000000000000000',
    'checkpoint',null,'reason_code','INDEX_NOT_READY',
    'created_at',app_data_agent.knowledge_utc_millis(now_at),'completed_at',null
  );
  generation_document:=generation_document||pg_catalog.jsonb_build_object(
    'generation_hash',app_data_agent.u2_canonical_sha256(generation_document)
  );
  insert into app_data_agent.knowledge_base_revisions(
    app_id,tenant_id,environment,knowledge_base_id,revision,revision_hash,status,
    profile_id,profile_revision,profile_hash,acl_hash,source_refs_json,revision_json,created_at
  ) values (
    authority.app_id,authority.tenant_id,authority.environment,
    (base_document->>'knowledge_base_id')::uuid,1,base_document->>'revision_hash','INDEXING',
    profile.profile_id,profile.revision,profile.profile_hash,acl_hash,
    base_document->'source_file_refs',base_document,now_at
  );
  insert into app_data_agent.knowledge_bases(
    app_id,tenant_id,environment,knowledge_base_id,current_revision,current_revision_hash,
    current_status,updated_at
  ) values (
    authority.app_id,authority.tenant_id,authority.environment,
    (base_document->>'knowledge_base_id')::uuid,1,base_document->>'revision_hash','INDEXING',now_at
  );
  insert into app_data_agent.knowledge_index_generations(
    app_id,tenant_id,environment,generation_id,generation_revision,generation_hash,
    knowledge_base_id,knowledge_base_revision,knowledge_base_revision_hash,state,
    manifest_hash,chunk_count,generation_json,created_at
  ) values (
    authority.app_id,authority.tenant_id,authority.environment,generation_id,1,
    generation_document->>'generation_hash',(base_document->>'knowledge_base_id')::uuid,
    1,base_document->>'revision_hash','INDEXING',generation_document->>'manifest_hash',0,
    generation_document,now_at
  );
  perform app_data_agent.knowledge_enqueue_index_job(
    authority.app_id,authority.tenant_id,authority.environment,authority.principal_id,
    base_document,generation_document,requested_command->>'idempotency_key'
  );
  result_document:=pg_catalog.jsonb_build_object(
    'knowledge_base',base_document,'generation',generation_document
  );
  insert into app_data_agent.knowledge_idempotency(
    app_id,tenant_id,environment,principal_id,operation_kind,idempotency_key,request_hash,
    result_json,created_at
  ) values (
    authority.app_id,authority.tenant_id,authority.environment,authority.principal_id,'CREATE',
    requested_command->>'idempotency_key',requested_command->>'request_hash',result_document,now_at
  );
  return result_document;
exception when no_data_found or invalid_text_representation or numeric_value_out_of_range then
  raise exception using errcode='40001',message='KNOWLEDGE_RESOURCE_NOT_READY';
end
$function$;

create function app_data_agent.rebuild_knowledge_base(requested_command jsonb)
returns jsonb language plpgsql security definer set search_path=''
as $function$
declare authority record; current_base app_data_agent.knowledge_base_revisions%rowtype;
  existing app_data_agent.knowledge_idempotency%rowtype; now_at timestamptz:=pg_catalog.clock_timestamp();
  base_document jsonb; generation_document jsonb; generation_id uuid:=pg_catalog.gen_random_uuid();
  result_document jsonb; next_revision bigint;
begin
  if not app_data_agent.provider_json_object_has_exact_keys(requested_command,array[
      'schema_version','operation_id','workspace_id','knowledge_base_ref','idempotency_key','request_hash'
    ]) or requested_command->>'schema_version'<>'knowledge-base-rebuild@1.0.0'
    or requested_command->>'request_hash'<>app_data_agent.u2_canonical_sha256(requested_command-'request_hash')
    or not app_data_agent.provider_json_object_has_exact_keys(requested_command->'knowledge_base_ref',array[
      'knowledge_base_id','revision','revision_hash'
    ])
  then raise exception using errcode='22023',message='KNOWLEDGE_BASE_REBUILD_INVALID'; end if;
  select * into strict authority from platform.current_backend_authority(true);
  if requested_command->>'workspace_id'<>authority.tenant_id::text then
    raise exception using errcode='42501',message='KNOWLEDGE_SCOPE_MISMATCH';
  end if;
  select * into existing from app_data_agent.knowledge_idempotency
  where app_id=authority.app_id and tenant_id=authority.tenant_id and environment=authority.environment
    and principal_id=authority.principal_id and operation_kind='REBUILD'
    and idempotency_key=requested_command->>'idempotency_key';
  if found then
    if existing.request_hash<>requested_command->>'request_hash' then
      raise exception using errcode='23505',message='KNOWLEDGE_IDEMPOTENCY_CONFLICT'; end if;
    return existing.result_json;
  end if;
  select revision.* into strict current_base from app_data_agent.knowledge_base_revisions revision
  join app_data_agent.knowledge_bases pointer
    on pointer.app_id=revision.app_id and pointer.tenant_id=revision.tenant_id
    and pointer.environment=revision.environment and pointer.knowledge_base_id=revision.knowledge_base_id
    and pointer.current_revision=revision.revision and pointer.current_revision_hash=revision.revision_hash
  where revision.app_id=authority.app_id and revision.tenant_id=authority.tenant_id
    and revision.environment=authority.environment
    and revision.knowledge_base_id=(requested_command#>>'{knowledge_base_ref,knowledge_base_id}')::uuid
    and revision.revision=(requested_command#>>'{knowledge_base_ref,revision}')::bigint
    and revision.revision_hash=requested_command#>>'{knowledge_base_ref,revision_hash}'
    and revision.status='READY' for update of pointer;
  perform app_data_agent.knowledge_assert_source_refs(
    current_base.source_refs_json,authority.app_id,authority.tenant_id,
    authority.environment,authority.principal_id
  );
  next_revision:=current_base.revision+1;
  base_document:=current_base.revision_json||pg_catalog.jsonb_build_object(
    'revision',next_revision,'status','INDEXING','active_generation_ref',null,
    'created_by_principal_id',authority.principal_id,'created_at',app_data_agent.knowledge_utc_millis(now_at)
  );
  base_document:=base_document-'revision_hash';
  base_document:=base_document||pg_catalog.jsonb_build_object(
    'revision_hash',app_data_agent.u2_canonical_sha256(base_document)
  );
  generation_document:=pg_catalog.jsonb_build_object(
    'schema_version','knowledge-index-generation@1.0.0','scope',base_document->'scope',
    'generation_id',generation_id,'generation_revision',1,
    'knowledge_base_ref',pg_catalog.jsonb_build_object(
      'knowledge_base_id',base_document->'knowledge_base_id','revision',next_revision,
      'revision_hash',base_document->'revision_hash'
    ),
    'source_file_refs',base_document->'source_file_refs',
    'embedding_profile_ref',base_document->'embedding_profile_ref','acl_hash',current_base.acl_hash,
    'state','INDEXING','chunk_count',0,
    'manifest_hash','sha256:0000000000000000000000000000000000000000000000000000000000000000',
    'checkpoint',null,'reason_code','INDEX_NOT_READY',
    'created_at',app_data_agent.knowledge_utc_millis(now_at),'completed_at',null
  );
  generation_document:=generation_document||pg_catalog.jsonb_build_object(
    'generation_hash',app_data_agent.u2_canonical_sha256(generation_document)
  );
  insert into app_data_agent.knowledge_base_revisions(
    app_id,tenant_id,environment,knowledge_base_id,revision,revision_hash,status,
    profile_id,profile_revision,profile_hash,acl_hash,source_refs_json,revision_json,created_at
  ) values (
    current_base.app_id,current_base.tenant_id,current_base.environment,current_base.knowledge_base_id,
    next_revision,base_document->>'revision_hash','INDEXING',current_base.profile_id,
    current_base.profile_revision,current_base.profile_hash,current_base.acl_hash,
    current_base.source_refs_json,base_document,now_at
  );
  insert into app_data_agent.knowledge_index_generations(
    app_id,tenant_id,environment,generation_id,generation_revision,generation_hash,
    knowledge_base_id,knowledge_base_revision,knowledge_base_revision_hash,state,
    manifest_hash,chunk_count,generation_json,created_at
  ) values (
    current_base.app_id,current_base.tenant_id,current_base.environment,generation_id,1,
    generation_document->>'generation_hash',current_base.knowledge_base_id,next_revision,
    base_document->>'revision_hash','INDEXING',generation_document->>'manifest_hash',0,
    generation_document,now_at
  );
  update app_data_agent.knowledge_bases set current_revision=next_revision,
    current_revision_hash=base_document->>'revision_hash',current_status='INDEXING',updated_at=now_at
  where app_id=current_base.app_id and tenant_id=current_base.tenant_id
    and environment=current_base.environment and knowledge_base_id=current_base.knowledge_base_id;
  perform app_data_agent.knowledge_enqueue_index_job(
    authority.app_id,authority.tenant_id,authority.environment,authority.principal_id,
    base_document,generation_document,requested_command->>'idempotency_key'
  );
  result_document:=pg_catalog.jsonb_build_object('knowledge_base',base_document,'generation',generation_document);
  insert into app_data_agent.knowledge_idempotency values (
    authority.app_id,authority.tenant_id,authority.environment,authority.principal_id,'REBUILD',
    requested_command->>'idempotency_key',requested_command->>'request_hash',result_document,now_at
  );
  return result_document;
exception when no_data_found or invalid_text_representation or numeric_value_out_of_range then
  raise exception using errcode='40001',message='KNOWLEDGE_BASE_STALE';
end
$function$;

create function app_data_agent.list_knowledge_bases(requested_limit integer)
returns jsonb language plpgsql security definer set search_path=''
as $function$
declare authority record;
begin
  if requested_limit not between 1 and 200 then
    raise exception using errcode='22023',message='KNOWLEDGE_LIST_INVALID'; end if;
  select * into strict authority from platform.current_backend_authority(false);
  return coalesce((
    select pg_catalog.jsonb_agg(revision.revision_json order by pointer.updated_at desc,pointer.knowledge_base_id)
    from (
      select * from app_data_agent.knowledge_bases
      where app_id=authority.app_id and tenant_id=authority.tenant_id and environment=authority.environment
      order by updated_at desc,knowledge_base_id limit requested_limit
    ) pointer
    join app_data_agent.knowledge_base_revisions revision
      on revision.app_id=pointer.app_id and revision.tenant_id=pointer.tenant_id
      and revision.environment=pointer.environment and revision.knowledge_base_id=pointer.knowledge_base_id
      and revision.revision=pointer.current_revision and revision.revision_hash=pointer.current_revision_hash
  ),'[]'::jsonb);
end
$function$;
create function app_data_agent.load_knowledge_index_target(requested_lease jsonb)
returns jsonb language plpgsql security definer set search_path=''
as $function$
declare attempt app_data_agent.job_attempts%rowtype; job app_data_agent.jobs%rowtype;
  generation app_data_agent.knowledge_index_generations%rowtype;
  base app_data_agent.knowledge_base_revisions%rowtype;
  profile app_data_agent.knowledge_embedding_profile_revisions%rowtype; sources jsonb;
begin
  attempt:=app_data_agent.assert_job_active_lease(requested_lease);
  select * into strict job from app_data_agent.jobs
  where app_id=attempt.app_id and tenant_id=attempt.tenant_id and environment=attempt.environment
    and job_id=attempt.job_id;
  if job.kind<>'KNOWLEDGE_INDEX' or job.input_json->>'kind'<>'KNOWLEDGE_INDEX'
    or job.input_json->'resource_refs'<>'[]'::jsonb
    or not app_data_agent.provider_json_object_has_exact_keys(job.input_json->'parameters',array[
      'knowledge_base_id','revision','revision_hash','generation_id'
    ])
  then raise exception using errcode='22023',message='KNOWLEDGE_INDEX_JOB_INVALID'; end if;
  select * into strict base from app_data_agent.knowledge_base_revisions
  where app_id=job.app_id and tenant_id=job.tenant_id and environment=job.environment
    and knowledge_base_id=(job.input_json#>>'{parameters,knowledge_base_id}')::uuid
    and revision=(job.input_json#>>'{parameters,revision}')::bigint
    and revision_hash=job.input_json#>>'{parameters,revision_hash}' and status='INDEXING';
  select * into strict generation from app_data_agent.knowledge_index_generations
  where app_id=base.app_id and tenant_id=base.tenant_id and environment=base.environment
    and generation_id=(job.input_json#>>'{parameters,generation_id}')::uuid
    and knowledge_base_id=base.knowledge_base_id and knowledge_base_revision=base.revision
    and knowledge_base_revision_hash=base.revision_hash and state in ('INDEXING','READY');
  select * into strict profile from app_data_agent.knowledge_embedding_profile_revisions
  where app_id=base.app_id and tenant_id=base.tenant_id and environment=base.environment
    and profile_id=base.profile_id and revision=base.profile_revision
    and profile_hash=base.profile_hash and status='READY';
  select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
    'file_ref',source.reference,'blob_hash',revision.blob_hash,
    'byte_size',(revision.revision_json->>'byte_size')::bigint,
    'detected_mime',revision.revision_json->>'detected_mime','storage_key',blob.storage_key,
    'classification','INTERNAL'
  ) order by source.ordinal) into sources
  from pg_catalog.jsonb_array_elements(base.source_refs_json) with ordinality source(reference,ordinal)
  join app_data_agent.workspace_file_revisions revision
    on revision.app_id=base.app_id and revision.tenant_id=base.tenant_id
    and revision.environment=base.environment
    and revision.file_id=(source.reference->>'file_id')::uuid
    and revision.revision=(source.reference->>'revision')::bigint
    and revision.revision_hash=source.reference->>'revision_hash' and revision.status='READY'
  join app_data_agent.workspace_files current_file
    on current_file.app_id=revision.app_id and current_file.tenant_id=revision.tenant_id
    and current_file.environment=revision.environment and current_file.file_id=revision.file_id
    and current_file.current_revision=revision.revision
    and current_file.current_revision_hash=revision.revision_hash
  join app_data_agent.workspace_content_blobs blob
    on blob.app_id=revision.app_id and blob.tenant_id=revision.tenant_id
    and blob.environment=revision.environment and blob.blob_hash=revision.blob_hash
    and blob.status='AVAILABLE';
  if sources is null or pg_catalog.jsonb_array_length(sources)<>pg_catalog.jsonb_array_length(base.source_refs_json) then
    raise exception using errcode='40001',message='KNOWLEDGE_SOURCE_STALE'; end if;
  return pg_catalog.jsonb_build_object(
    'schema_version','knowledge-index-target@1.0.0','knowledge_base',base.revision_json,
    'generation',generation.generation_json,'embedding_profile',profile.profile_json,'sources',sources
  );
exception when no_data_found or invalid_text_representation or numeric_value_out_of_range then
  raise exception using errcode='40001',message='KNOWLEDGE_INDEX_TARGET_STALE';
end
$function$;

create function app_data_agent.commit_knowledge_blocked_projection(
  requested_lease jsonb, requested_receipt jsonb
)
returns jsonb language plpgsql security definer set search_path=''
as $function$
declare attempt app_data_agent.job_attempts%rowtype; job app_data_agent.jobs%rowtype;
  generation app_data_agent.knowledge_index_generations%rowtype;
  base app_data_agent.knowledge_base_revisions%rowtype;
  profile app_data_agent.knowledge_embedding_profile_revisions%rowtype;
  existing app_data_agent.knowledge_projection_receipts%rowtype;
begin
  if not app_data_agent.provider_json_object_has_exact_keys(requested_receipt,array[
      'schema_version','receipt_id','scope','knowledge_base_ref','source_file_ref','chunk_id',
      'classification','provider','projection_policy_version','redaction_count',
      'pii_finding_count','credential_finding_count','prompt_injection_detected','decision',
      'payload_hash','projected_at','receipt_hash'
    ]) or requested_receipt->>'schema_version'<>'knowledge-data-projection-receipt@1.0.0'
    or requested_receipt->>'receipt_hash'<>app_data_agent.u2_canonical_sha256(requested_receipt-'receipt_hash')
    or requested_receipt->>'decision'<>'POLICY_BLOCKED'
    or not (
      requested_receipt->>'classification' in ('RESTRICTED','SECRET')
      or (requested_receipt->>'pii_finding_count')::bigint>0
      or (requested_receipt->>'credential_finding_count')::bigint>0
      or (requested_receipt->>'prompt_injection_detected')::boolean
    )
  then raise exception using errcode='22023',message='KNOWLEDGE_PROJECTION_RECEIPT_INVALID'; end if;
  attempt:=app_data_agent.assert_job_active_lease(requested_lease);
  select * into strict job from app_data_agent.jobs
  where app_id=attempt.app_id and tenant_id=attempt.tenant_id and environment=attempt.environment
    and job_id=attempt.job_id and kind='KNOWLEDGE_INDEX';
  select * into strict generation from app_data_agent.knowledge_index_generations
  where app_id=job.app_id and tenant_id=job.tenant_id and environment=job.environment
    and generation_id=(job.input_json#>>'{parameters,generation_id}')::uuid
    and state='INDEXING';
  select * into strict base from app_data_agent.knowledge_base_revisions
  where app_id=generation.app_id and tenant_id=generation.tenant_id and environment=generation.environment
    and knowledge_base_id=generation.knowledge_base_id and revision=generation.knowledge_base_revision
    and revision_hash=generation.knowledge_base_revision_hash;
  select * into strict profile from app_data_agent.knowledge_embedding_profile_revisions
  where app_id=base.app_id and tenant_id=base.tenant_id and environment=base.environment
    and profile_id=base.profile_id and revision=base.profile_revision and profile_hash=base.profile_hash;
  if requested_receipt#>>'{scope,app_id}'<>generation.app_id::text
    or requested_receipt#>>'{scope,tenant_id}'<>generation.tenant_id::text
    or requested_receipt#>>'{scope,environment}'<>generation.environment
    or requested_receipt#>>'{knowledge_base_ref,knowledge_base_id}'<>base.knowledge_base_id::text
    or (requested_receipt#>>'{knowledge_base_ref,revision}')::bigint<>base.revision
    or requested_receipt#>>'{knowledge_base_ref,revision_hash}'<>base.revision_hash
    or requested_receipt->>'provider'<>profile.profile_json->>'provider'
    or requested_receipt->>'projection_policy_version'<>profile.profile_json->>'projection_policy_version'
    or not exists (
      select 1 from pg_catalog.jsonb_array_elements(generation.generation_json->'source_file_refs') source_ref
      where source_ref.value=requested_receipt->'source_file_ref'
    )
  then raise exception using errcode='40001',message='KNOWLEDGE_PROJECTION_AUTHORITY_CHANGED'; end if;
  insert into app_data_agent.knowledge_projection_receipts(
    app_id,tenant_id,environment,receipt_id,knowledge_base_id,generation_id,chunk_id,
    projection_kind,decision,receipt_hash,receipt_json,projected_at
  ) values (
    generation.app_id,generation.tenant_id,generation.environment,
    (requested_receipt->>'receipt_id')::uuid,generation.knowledge_base_id,generation.generation_id,
    (requested_receipt->>'chunk_id')::uuid,'CHUNK','POLICY_BLOCKED',
    requested_receipt->>'receipt_hash',requested_receipt,(requested_receipt->>'projected_at')::timestamptz
  ) on conflict (app_id,tenant_id,environment,receipt_id) do nothing;
  select * into strict existing from app_data_agent.knowledge_projection_receipts
  where app_id=generation.app_id and tenant_id=generation.tenant_id
    and environment=generation.environment and receipt_id=(requested_receipt->>'receipt_id')::uuid;
  if existing.receipt_json<>requested_receipt or existing.decision<>'POLICY_BLOCKED' then
    raise exception using errcode='23505',message='KNOWLEDGE_PROJECTION_RECEIPT_CONFLICT'; end if;
  return existing.receipt_json;
exception when no_data_found or invalid_text_representation or numeric_value_out_of_range
  or datetime_field_overflow or unique_violation then
  raise exception using errcode='22023',message='KNOWLEDGE_PROJECTION_RECEIPT_INVALID';
end
$function$;

create function app_data_agent.stage_knowledge_generation(requested_lease jsonb,requested_stage jsonb)
returns jsonb language plpgsql security definer set search_path=''
as $function$
declare attempt app_data_agent.job_attempts%rowtype; job app_data_agent.jobs%rowtype;
  generation app_data_agent.knowledge_index_generations%rowtype; item jsonb; chunk jsonb;
  projection jsonb; vector jsonb; new_document jsonb; expected_dimensions integer;
  expected_provider text; expected_projection_policy text; expected_ordinal bigint:=0;
begin
  if not app_data_agent.provider_json_object_has_exact_keys(requested_stage,array[
      'schema_version','generation_ref','chunks','manifest_hash'
    ]) or requested_stage->>'schema_version'<>'knowledge-generation-stage@1.0.0'
    or not app_data_agent.provider_json_object_has_exact_keys(requested_stage->'generation_ref',array[
      'generation_id','generation_revision','generation_hash'
    ]) or requested_stage->>'manifest_hash'!~'^sha256:[0-9a-f]{64}$'
    or pg_catalog.jsonb_typeof(requested_stage->'chunks')<>'array'
    or pg_catalog.jsonb_array_length(requested_stage->'chunks') not between 1 and 100000
  then raise exception using errcode='22023',message='KNOWLEDGE_GENERATION_STAGE_INVALID'; end if;
  attempt:=app_data_agent.assert_job_active_lease(requested_lease);
  select * into strict job from app_data_agent.jobs
  where app_id=attempt.app_id and tenant_id=attempt.tenant_id and environment=attempt.environment
    and job_id=attempt.job_id and kind='KNOWLEDGE_INDEX';
  select * into strict generation from app_data_agent.knowledge_index_generations
  where app_id=job.app_id and tenant_id=job.tenant_id and environment=job.environment
    and generation_id=(requested_stage#>>'{generation_ref,generation_id}')::uuid
    and generation_revision=(requested_stage#>>'{generation_ref,generation_revision}')::bigint
    and state in ('INDEXING','READY') for update;
  if generation.generation_id<>(job.input_json#>>'{parameters,generation_id}')::uuid then
    raise exception using errcode='40001',message='KNOWLEDGE_GENERATION_STAGE_CONFLICT';
  end if;
  if exists (select 1 from app_data_agent.knowledge_chunks c
      where c.app_id=generation.app_id and c.tenant_id=generation.tenant_id
        and c.environment=generation.environment and c.generation_id=generation.generation_id)
  then
    if generation.manifest_hash<>requested_stage->>'manifest_hash'
      or generation.chunk_count<>pg_catalog.jsonb_array_length(requested_stage->'chunks')
    then raise exception using errcode='40001',message='KNOWLEDGE_GENERATION_STAGE_CONFLICT'; end if;
    for item in select value from pg_catalog.jsonb_array_elements(requested_stage->'chunks') loop
      if not app_data_agent.provider_json_object_has_exact_keys(item,array[
          'chunk','normalized_text','vector','projection_receipt'
        ]) or not exists (
          select 1
          from app_data_agent.knowledge_chunks existing_chunk
          join app_data_agent.knowledge_projection_receipts existing_projection
            on existing_projection.app_id=existing_chunk.app_id
            and existing_projection.tenant_id=existing_chunk.tenant_id
            and existing_projection.environment=existing_chunk.environment
            and existing_projection.generation_id=existing_chunk.generation_id
            and existing_projection.chunk_id=existing_chunk.chunk_id
            and existing_projection.projection_kind='CHUNK'
          where existing_chunk.app_id=generation.app_id
            and existing_chunk.tenant_id=generation.tenant_id
            and existing_chunk.environment=generation.environment
            and existing_chunk.generation_id=generation.generation_id
            and existing_chunk.chunk_id=(item#>>'{chunk,chunk_id}')::uuid
            and existing_chunk.chunk_json=item->'chunk'
            and existing_chunk.normalized_text=item->>'normalized_text'
            and existing_chunk.vector_json=item->'vector'
            and existing_projection.receipt_json=item->'projection_receipt'
        )
      then raise exception using errcode='40001',message='KNOWLEDGE_GENERATION_STAGE_CONFLICT'; end if;
    end loop;
    return generation.generation_json;
  end if;
  if generation.generation_hash<>requested_stage#>>'{generation_ref,generation_hash}' then
    raise exception using errcode='40001',message='KNOWLEDGE_GENERATION_STAGE_CONFLICT';
  end if;
  if requested_stage->>'manifest_hash' is distinct from (
    select app_data_agent.u2_canonical_sha256(pg_catalog.jsonb_agg(
      element.value#>>'{chunk,chunk_hash}' order by element.ordinality
    ))
    from pg_catalog.jsonb_array_elements(requested_stage->'chunks')
      with ordinality element(value,ordinality)
  ) then raise exception using errcode='22023',message='KNOWLEDGE_GENERATION_STAGE_INVALID'; end if;
  select dimensions,profile.profile_json->>'provider',profile.profile_json->>'projection_policy_version'
  into strict expected_dimensions,expected_provider,expected_projection_policy
  from app_data_agent.knowledge_embedding_profile_revisions profile
  join app_data_agent.knowledge_base_revisions base
    on base.app_id=profile.app_id and base.tenant_id=profile.tenant_id
    and base.environment=profile.environment and base.profile_id=profile.profile_id
    and base.profile_revision=profile.revision and base.profile_hash=profile.profile_hash
  where base.app_id=generation.app_id and base.tenant_id=generation.tenant_id
    and base.environment=generation.environment and base.knowledge_base_id=generation.knowledge_base_id
    and base.revision=generation.knowledge_base_revision;
  for item in select value from pg_catalog.jsonb_array_elements(requested_stage->'chunks') loop
    if not app_data_agent.provider_json_object_has_exact_keys(item,array[
      'chunk','normalized_text','vector','projection_receipt'
    ]) then raise exception using errcode='22023',message='KNOWLEDGE_CHUNK_INVALID'; end if;
    chunk:=item->'chunk';projection:=item->'projection_receipt';vector:=item->'vector';
    if not app_data_agent.provider_json_object_has_exact_keys(chunk,array[
        'schema_version','scope','generation_id','generation_revision','knowledge_base_ref','chunk_id',
        'source_file_ref','ordinal','start_byte','end_byte','text_hash','projection_receipt_hash',
        'embedding_hash','dimensions','chunk_hash'
      ]) or chunk->>'schema_version'<>'knowledge-chunk@1.0.0'
      or chunk->>'chunk_hash'<>app_data_agent.u2_canonical_sha256(chunk-'chunk_hash')
      or chunk->>'generation_id'<>generation.generation_id::text
      or (chunk->>'generation_revision')::bigint<>generation.generation_revision
      or chunk#>>'{scope,app_id}'<>generation.app_id::text
      or chunk#>>'{scope,tenant_id}'<>generation.tenant_id::text
      or chunk#>>'{scope,environment}'<>generation.environment
      or chunk#>>'{knowledge_base_ref,knowledge_base_id}'<>generation.knowledge_base_id::text
      or (chunk#>>'{knowledge_base_ref,revision}')::bigint<>generation.knowledge_base_revision
      or chunk#>>'{knowledge_base_ref,revision_hash}'<>generation.knowledge_base_revision_hash
      or (chunk->>'ordinal')::bigint<>expected_ordinal
      or (chunk->>'end_byte')::bigint<=(chunk->>'start_byte')::bigint
      or chunk->>'dimensions'<>expected_dimensions::text
      or pg_catalog.jsonb_array_length(vector)<>expected_dimensions
      or chunk->>'text_hash'<>app_data_agent.u2_canonical_sha256(pg_catalog.to_jsonb(item->>'normalized_text'))
      or chunk->>'embedding_hash'<>app_data_agent.u2_canonical_sha256(vector)
      or projection->>'receipt_hash'<>app_data_agent.u2_canonical_sha256(projection-'receipt_hash')
      or projection->>'receipt_hash'<>chunk->>'projection_receipt_hash'
      or projection->>'decision'<>'ALLOW'
      or projection->>'chunk_id'<>chunk->>'chunk_id'
      or projection->'scope'<>chunk->'scope'
      or projection->'knowledge_base_ref'<>chunk->'knowledge_base_ref'
      or projection->'source_file_ref'<>chunk->'source_file_ref'
      or projection->>'payload_hash'<>chunk->>'text_hash'
      or projection->>'provider'<>expected_provider
      or projection->>'projection_policy_version'<>expected_projection_policy
      or not exists (
        select 1 from pg_catalog.jsonb_array_elements(generation.generation_json->'source_file_refs') source_ref
        where source_ref.value=chunk->'source_file_ref'
      )
      or item->>'normalized_text'=''
      or pg_catalog.octet_length(item->>'normalized_text')>32000
    then raise exception using errcode='22023',message='KNOWLEDGE_CHUNK_INVALID'; end if;
    insert into app_data_agent.knowledge_projection_receipts(
      app_id,tenant_id,environment,receipt_id,knowledge_base_id,generation_id,chunk_id,
      projection_kind,decision,receipt_hash,receipt_json,projected_at
    ) values (
      generation.app_id,generation.tenant_id,generation.environment,
      (projection->>'receipt_id')::uuid,generation.knowledge_base_id,generation.generation_id,
      (chunk->>'chunk_id')::uuid,'CHUNK','ALLOW',projection->>'receipt_hash',projection,
      (projection->>'projected_at')::timestamptz
    );
    insert into app_data_agent.knowledge_chunks(
      app_id,tenant_id,environment,generation_id,generation_revision,chunk_id,knowledge_base_id,
      source_file_id,source_file_revision,source_file_revision_hash,ordinal,start_byte,end_byte,
      text_hash,normalized_text,embedding_hash,dimensions,vector_json,chunk_hash,chunk_json
    ) values (
      generation.app_id,generation.tenant_id,generation.environment,generation.generation_id,
      generation.generation_revision,(chunk->>'chunk_id')::uuid,generation.knowledge_base_id,
      (chunk#>>'{source_file_ref,file_id}')::uuid,(chunk#>>'{source_file_ref,revision}')::bigint,
      chunk#>>'{source_file_ref,revision_hash}',(chunk->>'ordinal')::bigint,
      (chunk->>'start_byte')::bigint,(chunk->>'end_byte')::bigint,chunk->>'text_hash',
      item->>'normalized_text',chunk->>'embedding_hash',expected_dimensions,vector,
      chunk->>'chunk_hash',chunk
    );
    expected_ordinal:=expected_ordinal+1;
  end loop;
  new_document:=generation.generation_json-'generation_hash'||pg_catalog.jsonb_build_object(
    'manifest_hash',requested_stage->>'manifest_hash',
    'chunk_count',pg_catalog.jsonb_array_length(requested_stage->'chunks')
  );
  new_document:=new_document||pg_catalog.jsonb_build_object(
    'generation_hash',app_data_agent.u2_canonical_sha256(new_document)
  );
  update app_data_agent.knowledge_index_generations set
    generation_hash=new_document->>'generation_hash',manifest_hash=new_document->>'manifest_hash',
    chunk_count=(new_document->>'chunk_count')::bigint,generation_json=new_document
  where app_id=generation.app_id and tenant_id=generation.tenant_id
    and environment=generation.environment and generation_id=generation.generation_id
    and generation_revision=generation.generation_revision;
  return new_document;
exception when no_data_found or invalid_text_representation or numeric_value_out_of_range
  or datetime_field_overflow or unique_violation then
  raise exception using errcode='22023',message='KNOWLEDGE_GENERATION_STAGE_INVALID';
end
$function$;

create function app_data_agent.commit_knowledge_generation_ready(
  requested_lease jsonb,requested_commit jsonb
)
returns jsonb language plpgsql security definer set search_path=''
as $function$
declare attempt app_data_agent.job_attempts%rowtype; job app_data_agent.jobs%rowtype;
  generation app_data_agent.knowledge_index_generations%rowtype;
  base app_data_agent.knowledge_base_revisions%rowtype; now_at timestamptz:=pg_catalog.clock_timestamp();
  generation_document jsonb; base_document jsonb; next_revision bigint;
begin
  if not app_data_agent.provider_json_object_has_exact_keys(requested_commit,array[
      'schema_version','generation_ref','checkpoint'
    ]) or requested_commit->>'schema_version'<>'knowledge-generation-ready@1.0.0'
    or not app_data_agent.provider_json_object_has_exact_keys(requested_commit->'generation_ref',array[
      'generation_id','generation_revision','generation_hash'
    ]) or not app_data_agent.provider_json_object_has_exact_keys(requested_commit->'checkpoint',array[
      'index_kind','build_id','manifest_hash','dimensions','sealed_at'
    ]) or requested_commit#>>'{checkpoint,index_kind}'<>'NEO4J_VECTOR'
  then raise exception using errcode='22023',message='KNOWLEDGE_GENERATION_READY_INVALID'; end if;
  attempt:=app_data_agent.assert_job_active_lease(requested_lease);
  select * into strict job from app_data_agent.jobs
  where app_id=attempt.app_id and tenant_id=attempt.tenant_id and environment=attempt.environment
    and job_id=attempt.job_id and kind='KNOWLEDGE_INDEX';
  select * into strict generation from app_data_agent.knowledge_index_generations
  where app_id=job.app_id and tenant_id=job.tenant_id and environment=job.environment
    and generation_id=(requested_commit#>>'{generation_ref,generation_id}')::uuid
    and generation_revision=(requested_commit#>>'{generation_ref,generation_revision}')::bigint
    and state in ('INDEXING','READY')
    and chunk_count>0 and manifest_hash=requested_commit#>>'{checkpoint,manifest_hash}' for update;
  if generation.state='READY' then
    if generation.generation_json->'checkpoint'<>requested_commit->'checkpoint'
      or not exists (
        select 1
        from app_data_agent.knowledge_bases current_base
        join app_data_agent.knowledge_base_revisions current_revision
          on current_revision.app_id=current_base.app_id
          and current_revision.tenant_id=current_base.tenant_id
          and current_revision.environment=current_base.environment
          and current_revision.knowledge_base_id=current_base.knowledge_base_id
          and current_revision.revision=current_base.current_revision
          and current_revision.revision_hash=current_base.current_revision_hash
        where current_base.app_id=generation.app_id
          and current_base.tenant_id=generation.tenant_id
          and current_base.environment=generation.environment
          and current_base.knowledge_base_id=generation.knowledge_base_id
          and current_base.current_status='READY'
          and current_revision.revision_json#>>'{active_generation_ref,generation_id}'=generation.generation_id::text
          and current_revision.revision_json#>>'{active_generation_ref,generation_hash}'=generation.generation_hash
      )
    then raise exception using errcode='40001',message='KNOWLEDGE_GENERATION_READY_CONFLICT'; end if;
    return generation.generation_json;
  end if;
  if generation.generation_hash<>requested_commit#>>'{generation_ref,generation_hash}' then
    raise exception using errcode='40001',message='KNOWLEDGE_GENERATION_READY_CONFLICT';
  end if;
  select * into strict base from app_data_agent.knowledge_base_revisions
  where app_id=generation.app_id and tenant_id=generation.tenant_id and environment=generation.environment
    and knowledge_base_id=generation.knowledge_base_id and revision=generation.knowledge_base_revision
    and revision_hash=generation.knowledge_base_revision_hash and status='INDEXING';
  if (select pg_catalog.count(*) from app_data_agent.knowledge_chunks chunk
      where chunk.app_id=generation.app_id and chunk.tenant_id=generation.tenant_id
        and chunk.environment=generation.environment and chunk.generation_id=generation.generation_id)
      <>generation.chunk_count
  then raise exception using errcode='40001',message='KNOWLEDGE_INDEX_DIGEST_MISMATCH'; end if;
  generation_document:=generation.generation_json-'generation_hash'||pg_catalog.jsonb_build_object(
    'state','READY','checkpoint',requested_commit->'checkpoint','reason_code',null,
    'completed_at',app_data_agent.knowledge_utc_millis(now_at)
  );
  generation_document:=generation_document||pg_catalog.jsonb_build_object(
    'generation_hash',app_data_agent.u2_canonical_sha256(generation_document)
  );
  update app_data_agent.knowledge_index_generations set state='READY',
    generation_hash=generation_document->>'generation_hash',generation_json=generation_document,
    completed_at=now_at
  where app_id=generation.app_id and tenant_id=generation.tenant_id
    and environment=generation.environment and generation_id=generation.generation_id
    and generation_revision=generation.generation_revision;
  next_revision:=base.revision+1;
  base_document:=base.revision_json-'revision_hash'||pg_catalog.jsonb_build_object(
    'revision',next_revision,'status','READY',
    'active_generation_ref',pg_catalog.jsonb_build_object(
      'generation_id',generation.generation_id,'generation_revision',generation.generation_revision,
      'generation_hash',generation_document->>'generation_hash'
    ),
    'created_by_principal_id',job.principal_id,'created_at',app_data_agent.knowledge_utc_millis(now_at)
  );
  base_document:=base_document||pg_catalog.jsonb_build_object(
    'revision_hash',app_data_agent.u2_canonical_sha256(base_document)
  );
  insert into app_data_agent.knowledge_base_revisions(
    app_id,tenant_id,environment,knowledge_base_id,revision,revision_hash,status,
    profile_id,profile_revision,profile_hash,acl_hash,source_refs_json,revision_json,created_at
  ) values (
    base.app_id,base.tenant_id,base.environment,base.knowledge_base_id,next_revision,
    base_document->>'revision_hash','READY',base.profile_id,base.profile_revision,base.profile_hash,
    base.acl_hash,base.source_refs_json,base_document,now_at
  );
  update app_data_agent.knowledge_bases set current_revision=next_revision,
    current_revision_hash=base_document->>'revision_hash',current_status='READY',updated_at=now_at
  where app_id=base.app_id and tenant_id=base.tenant_id and environment=base.environment
    and knowledge_base_id=base.knowledge_base_id;
  return generation_document;
exception when no_data_found or invalid_text_representation or numeric_value_out_of_range then
  raise exception using errcode='40001',message='KNOWLEDGE_GENERATION_STALE';
end
$function$;
alter table app_data_agent.job_handler_revisions drop constraint job_handler_revisions_kind_check;
alter table app_data_agent.job_handler_revisions add constraint job_handler_revisions_kind_check check (kind in (
  'SCHEMA_SCAN','RELATIONSHIP_INDEX','ARTIFACT_EXPORT','SEMANTIC_INDUCTION','METRIC_IMPORT',
  'DATALINK_REBUILD','FILE_SCAN','KNOWLEDGE_INDEX'
));
alter table app_data_agent.jobs drop constraint jobs_kind_check;
alter table app_data_agent.jobs add constraint jobs_kind_check check (kind in (
  'SCHEMA_SCAN','RELATIONSHIP_INDEX','ARTIFACT_EXPORT','SEMANTIC_INDUCTION','METRIC_IMPORT',
  'DATALINK_REBUILD','FILE_SCAN','KNOWLEDGE_INDEX'
));
insert into app_data_agent.job_handler_revisions(
  kind,handler_revision,enabled,dependencies_ready,output_receipt_required
) values ('KNOWLEDGE_INDEX','knowledge-index-handler@1.0.0',true,true,true);

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
        or reference->>'resource_kind' not in ('WORKSPACE_FILE_SCAN_RECEIPT','KNOWLEDGE_INDEX_GENERATION')
        or reference->>'app_id'<>requested_app_id::text
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
create or replace function app_data_agent.claim_job_work(
  requested_worker_id text,
  requested_handlers jsonb,
  requested_lease_duration_ms integer
)
returns jsonb language plpgsql security definer set search_path=''
as $function$
declare
  authority record;
  job app_data_agent.jobs%rowtype;
  attempt_id uuid := pg_catalog.gen_random_uuid();
  now_at timestamptz := pg_catalog.clock_timestamp();
  expires_at timestamptz;
  lease_document jsonb;
  lease_hash text;
begin
  if requested_worker_id !~ '^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,127}$'
    or requested_lease_duration_ms not between 5000 and 900000
    or pg_catalog.jsonb_typeof(requested_handlers)<>'array'
    or pg_catalog.jsonb_array_length(requested_handlers) not between 1 and 8
  then raise exception using errcode='22023',message='JOB_CLAIM_CONTRACT_INVALID'; end if;
  select * into strict authority from platform.current_backend_authority(true);
  if not exists (
    select 1 from app_data_agent.job_worker_heartbeats heartbeat
    where heartbeat.app_id=authority.app_id and heartbeat.tenant_id=authority.tenant_id
      and heartbeat.environment=authority.environment and heartbeat.worker_id=requested_worker_id
      and heartbeat.expires_at>now_at and heartbeat.handlers_json=requested_handlers
  ) then
    raise exception using errcode='55000',message='JOB_WORKER_HEARTBEAT_STALE';
  end if;
  select candidate.* into job from app_data_agent.jobs candidate
  join app_data_agent.job_handler_revisions revision
    on revision.kind=candidate.kind and revision.handler_revision=candidate.handler_revision
  where candidate.app_id=authority.app_id and candidate.tenant_id=authority.tenant_id
    and candidate.environment=authority.environment and candidate.principal_id=authority.principal_id
    and candidate.status in ('QUEUED','RETRY_WAIT')
    and (candidate.next_attempt_at is null or candidate.next_attempt_at<=now_at)
    and candidate.attempt_count<candidate.max_attempts and revision.enabled and revision.dependencies_ready
    and exists (
      select 1 from pg_catalog.jsonb_array_elements(requested_handlers) handler
      where handler->>'kind'=candidate.kind
        and handler->>'handler_revision'=candidate.handler_revision
        and app_data_agent.provider_json_object_has_exact_keys(handler,array['kind','handler_revision'])
    )
  order by candidate.priority desc,candidate.created_at,candidate.job_id
  for update of candidate skip locked limit 1;
  if not found then return null; end if;
  expires_at := now_at+pg_catalog.make_interval(secs=>requested_lease_duration_ms::double precision/1000.0);
  update app_data_agent.jobs set
    status='LEASED',attempt_count=attempt_count+1,worker_fence=worker_fence+1,
    next_attempt_at=null,updated_at=now_at
  where app_id=job.app_id and tenant_id=job.tenant_id and environment=job.environment and job_id=job.job_id
  returning * into job;
  lease_document := pg_catalog.jsonb_build_object(
    'schema_version','job-work-lease@1.0.0',
    'scope',pg_catalog.jsonb_build_object('app_id',job.app_id,'tenant_id',job.tenant_id,'environment',job.environment),
    'principal_id',job.principal_id,'job_id',job.job_id,'kind',job.kind,'request_hash',job.request_hash,
    'input',job.input_json,'attempt_id',attempt_id,'attempt_no',job.attempt_count,
    'delivery_attempt_no',1,'worker_id',requested_worker_id,'lease_token',job.worker_fence,
    'worker_fence',job.worker_fence,'lease_duration_ms',requested_lease_duration_ms,
    'expires_at',app_data_agent.job_utc_millis(expires_at),'handler_revision',job.handler_revision
  );
  lease_hash := app_data_agent.u2_canonical_sha256(lease_document);
  lease_document := lease_document||pg_catalog.jsonb_build_object('lease_hash',lease_hash);
  insert into app_data_agent.job_attempts(
    app_id,tenant_id,environment,job_id,request_hash,attempt_id,attempt_no,delivery_attempt_no,
    worker_id,lease_token,worker_fence,handler_revision,lease_hash,lease_json,status,lease_expires_at
  ) values (
    job.app_id,job.tenant_id,job.environment,job.job_id,job.request_hash,attempt_id,job.attempt_count,1,
    requested_worker_id,job.worker_fence,job.worker_fence,job.handler_revision,lease_hash,lease_document,
    'LEASED',expires_at
  );
  perform app_data_agent.job_append_event(job,'JOB_LEASED',pg_catalog.jsonb_build_object(
    'attempt_id',attempt_id,'worker_fence',job.worker_fence,'handler_revision',job.handler_revision
  ));
  return lease_document;
end
$function$;
create or replace function app_data_agent.publish_job_worker_heartbeat(requested_heartbeat jsonb)
returns jsonb language plpgsql security definer set search_path=''
as $function$
declare authority record; existing app_data_agent.job_worker_heartbeats%rowtype; kinds text[];
begin
  if not app_data_agent.provider_json_object_has_exact_keys(requested_heartbeat,array[
    'schema_version','heartbeat_id','scope','worker_id','handlers','capacity',
    'observed_at','expires_at','heartbeat_hash'
  ]) or requested_heartbeat->>'schema_version'<>'job-worker-heartbeat@1.0.0'
    or requested_heartbeat->>'heartbeat_hash'<>app_data_agent.u2_canonical_sha256(requested_heartbeat-'heartbeat_hash')
    or pg_catalog.jsonb_typeof(requested_heartbeat->'handlers')<>'array'
    or pg_catalog.jsonb_array_length(requested_heartbeat->'handlers') not between 1 and 8
    or (requested_heartbeat->>'capacity')::integer not between 1 and 64
    or (requested_heartbeat->>'expires_at')::timestamptz<=(requested_heartbeat->>'observed_at')::timestamptz
    or app_data_agent.contains_potential_plaintext_secret(requested_heartbeat)
  then raise exception using errcode='22023',message='JOB_WORKER_HEARTBEAT_INVALID'; end if;
  select * into strict authority from platform.current_backend_authority(true);
  if requested_heartbeat->'scope'<>pg_catalog.jsonb_build_object(
    'app_id',authority.app_id,'tenant_id',authority.tenant_id,'environment',authority.environment
  ) then raise exception using errcode='42501',message='JOB_SCOPE_MISMATCH'; end if;
  select pg_catalog.array_agg(handler->>'kind' order by handler->>'kind') into kinds
  from pg_catalog.jsonb_array_elements(requested_heartbeat->'handlers') handler
  where app_data_agent.provider_json_object_has_exact_keys(handler,array['kind','handler_revision'])
    and exists (
      select 1 from app_data_agent.job_handler_revisions revision
      where revision.kind=handler->>'kind' and revision.handler_revision=handler->>'handler_revision'
    );
  if coalesce(pg_catalog.array_length(kinds,1),0)<>pg_catalog.jsonb_array_length(requested_heartbeat->'handlers')
    or (select pg_catalog.count(distinct item) from pg_catalog.unnest(kinds) item)<>pg_catalog.array_length(kinds,1)
    or requested_heartbeat->'handlers'<>(
      select pg_catalog.jsonb_agg(handler order by handler->>'kind')
      from pg_catalog.jsonb_array_elements(requested_heartbeat->'handlers') handler
    )
  then raise exception using errcode='22023',message='JOB_WORKER_HEARTBEAT_INVALID'; end if;
  select * into existing from app_data_agent.job_worker_heartbeats heartbeat
  where heartbeat.app_id=authority.app_id and heartbeat.tenant_id=authority.tenant_id
    and heartbeat.environment=authority.environment
    and heartbeat.heartbeat_id=(requested_heartbeat->>'heartbeat_id')::uuid;
  if found then
    if existing.heartbeat_hash<>requested_heartbeat->>'heartbeat_hash' then
      raise exception using errcode='23505',message='JOB_WORKER_HEARTBEAT_REPLAY_CONFLICT';
    end if;
    return existing.heartbeat_json;
  end if;
  insert into app_data_agent.job_worker_heartbeats(
    app_id,tenant_id,environment,heartbeat_id,worker_id,handler_kinds,handlers_json,
    capacity,heartbeat_hash,heartbeat_json,observed_at,expires_at
  ) values (
    authority.app_id,authority.tenant_id,authority.environment,
    (requested_heartbeat->>'heartbeat_id')::uuid,requested_heartbeat->>'worker_id',kinds,
    requested_heartbeat->'handlers',(requested_heartbeat->>'capacity')::integer,
    requested_heartbeat->>'heartbeat_hash',requested_heartbeat,
    (requested_heartbeat->>'observed_at')::timestamptz,(requested_heartbeat->>'expires_at')::timestamptz
  );
  return requested_heartbeat;
exception when invalid_text_representation or numeric_value_out_of_range or datetime_field_overflow then
  raise exception using errcode='22023',message='JOB_WORKER_HEARTBEAT_INVALID';
end
$function$;
create function app_data_agent.load_knowledge_search_snapshot(requested_request jsonb)
returns jsonb language plpgsql security definer set search_path=''
as $function$
declare authority record; base app_data_agent.knowledge_base_revisions%rowtype;
  generation app_data_agent.knowledge_index_generations%rowtype;
  profile app_data_agent.knowledge_embedding_profile_revisions%rowtype;
begin
  if not app_data_agent.provider_json_object_has_exact_keys(requested_request,array[
      'schema_version','knowledge_base_ref','generation_ref','query','limit'
    ]) or requested_request->>'schema_version'<>'knowledge-debug-search-request@1.0.0'
    or not app_data_agent.provider_json_object_has_exact_keys(requested_request->'knowledge_base_ref',array[
      'knowledge_base_id','revision','revision_hash'
    ]) or not app_data_agent.provider_json_object_has_exact_keys(requested_request->'generation_ref',array[
      'generation_id','generation_revision','generation_hash'
    ]) or pg_catalog.length(pg_catalog.btrim(requested_request->>'query')) not between 1 and 4000
    or (requested_request->>'limit')::integer not between 1 and 20
  then raise exception using errcode='22023',message='KNOWLEDGE_SEARCH_REQUEST_INVALID'; end if;
  select * into strict authority from platform.current_backend_authority(false);
  select revision.* into strict base from app_data_agent.knowledge_base_revisions revision
  join app_data_agent.knowledge_bases pointer
    on pointer.app_id=revision.app_id and pointer.tenant_id=revision.tenant_id
    and pointer.environment=revision.environment and pointer.knowledge_base_id=revision.knowledge_base_id
    and pointer.current_revision=revision.revision and pointer.current_revision_hash=revision.revision_hash
  where revision.app_id=authority.app_id and revision.tenant_id=authority.tenant_id
    and revision.environment=authority.environment
    and revision.knowledge_base_id=(requested_request#>>'{knowledge_base_ref,knowledge_base_id}')::uuid
    and revision.revision=(requested_request#>>'{knowledge_base_ref,revision}')::bigint
    and revision.revision_hash=requested_request#>>'{knowledge_base_ref,revision_hash}'
    and revision.status='READY'
    and (revision.revision_json#>>'{acl,visibility}'='WORKSPACE' or exists (
      select 1 from pg_catalog.jsonb_array_elements_text(revision.revision_json#>'{acl,principal_ids}') item
      where item=authority.principal_id::text
    ));
  select * into strict generation from app_data_agent.knowledge_index_generations
  where app_id=base.app_id and tenant_id=base.tenant_id and environment=base.environment
    and generation_id=(requested_request#>>'{generation_ref,generation_id}')::uuid
    and generation_revision=(requested_request#>>'{generation_ref,generation_revision}')::bigint
    and generation_hash=requested_request#>>'{generation_ref,generation_hash}' and state='READY'
    and generation_id=(base.revision_json#>>'{active_generation_ref,generation_id}')::uuid;
  select * into strict profile from app_data_agent.knowledge_embedding_profile_revisions
  where app_id=base.app_id and tenant_id=base.tenant_id and environment=base.environment
    and profile_id=base.profile_id and revision=base.profile_revision
    and profile_hash=base.profile_hash and status='READY';
  perform app_data_agent.knowledge_assert_source_refs(
    base.source_refs_json,authority.app_id,authority.tenant_id,
    authority.environment,authority.principal_id
  );
  return pg_catalog.jsonb_build_object(
    'knowledge_base',base.revision_json,'generation',generation.generation_json,
    'embedding_profile',profile.profile_json,
    'principal_id',authority.principal_id
  );
exception when no_data_found or invalid_text_representation or numeric_value_out_of_range then
  raise exception using errcode='55000',message='KNOWLEDGE_INDEX_NOT_READY';
end
$function$;

create function app_data_agent.commit_knowledge_query_projection(requested_receipt jsonb)
returns jsonb language plpgsql security definer set search_path=''
as $function$
declare authority record; generation app_data_agent.knowledge_index_generations%rowtype;
  existing app_data_agent.knowledge_projection_receipts%rowtype;
begin
  if not app_data_agent.provider_json_object_has_exact_keys(requested_receipt,array[
      'schema_version','receipt_id','scope','knowledge_base_ref','generation_ref','classification',
      'provider','projection_policy_version','pii_finding_count','credential_finding_count',
      'prompt_injection_detected','decision','payload_hash','projected_at','receipt_hash'
    ]) or requested_receipt->>'schema_version'<>'knowledge-query-projection-receipt@1.0.0'
    or requested_receipt->>'receipt_hash'<>app_data_agent.u2_canonical_sha256(requested_receipt-'receipt_hash')
    or requested_receipt->>'decision'<>'ALLOW'
    or requested_receipt->>'classification' not in ('PUBLIC','INTERNAL')
    or (requested_receipt->>'pii_finding_count')::bigint<>0
    or (requested_receipt->>'credential_finding_count')::bigint<>0
    or (requested_receipt->>'prompt_injection_detected')::boolean
  then raise exception using errcode='22023',message='KNOWLEDGE_QUERY_PROJECTION_INVALID'; end if;
  select * into strict authority from platform.current_backend_authority(true);
  if requested_receipt->'scope'<>pg_catalog.jsonb_build_object(
    'app_id',authority.app_id,'tenant_id',authority.tenant_id,'environment',authority.environment
  ) then raise exception using errcode='42501',message='KNOWLEDGE_SCOPE_MISMATCH'; end if;
  select * into strict generation from app_data_agent.knowledge_index_generations
  where app_id=authority.app_id and tenant_id=authority.tenant_id and environment=authority.environment
    and generation_id=(requested_receipt#>>'{generation_ref,generation_id}')::uuid
    and generation_revision=(requested_receipt#>>'{generation_ref,generation_revision}')::bigint
    and generation_hash=requested_receipt#>>'{generation_ref,generation_hash}' and state='READY'
    and knowledge_base_id=(requested_receipt#>>'{knowledge_base_ref,knowledge_base_id}')::uuid;
  select * into existing from app_data_agent.knowledge_projection_receipts
  where app_id=authority.app_id and tenant_id=authority.tenant_id and environment=authority.environment
    and receipt_id=(requested_receipt->>'receipt_id')::uuid;
  if found then
    if existing.receipt_hash<>requested_receipt->>'receipt_hash' then
      raise exception using errcode='23505',message='KNOWLEDGE_QUERY_PROJECTION_REPLAY_CONFLICT'; end if;
    return existing.receipt_json;
  end if;
  insert into app_data_agent.knowledge_projection_receipts(
    app_id,tenant_id,environment,receipt_id,knowledge_base_id,generation_id,projection_kind,
    chunk_id,decision,receipt_hash,receipt_json,projected_at
  ) values (
    authority.app_id,authority.tenant_id,authority.environment,
    (requested_receipt->>'receipt_id')::uuid,generation.knowledge_base_id,generation.generation_id,
    'QUERY',null,'ALLOW',requested_receipt->>'receipt_hash',requested_receipt,
    (requested_receipt->>'projected_at')::timestamptz
  );
  return requested_receipt;
exception when no_data_found or invalid_text_representation or numeric_value_out_of_range then
  raise exception using errcode='55000',message='KNOWLEDGE_INDEX_NOT_READY';
end
$function$;

create function app_data_agent.commit_knowledge_retrieval(
  requested_request jsonb,requested_candidates jsonb,requested_query_hash text,
  requested_query_projection_hash text
)
returns jsonb language plpgsql security definer set search_path=''
as $function$
declare authority record; base app_data_agent.knowledge_base_revisions%rowtype;
  generation app_data_agent.knowledge_index_generations%rowtype; candidate jsonb;
  chunk app_data_agent.knowledge_chunks%rowtype; hit jsonb; hits jsonb:='[]'::jsonb;
  receipt jsonb; now_at timestamptz:=pg_catalog.clock_timestamp(); receipt_id uuid:=pg_catalog.gen_random_uuid();
begin
  if requested_query_hash!~'^sha256:[0-9a-f]{64}$'
    or requested_query_projection_hash!~'^sha256:[0-9a-f]{64}$'
    or pg_catalog.jsonb_typeof(requested_candidates)<>'array'
    or pg_catalog.jsonb_array_length(requested_candidates)>50
  then raise exception using errcode='22023',message='KNOWLEDGE_RETRIEVAL_INVALID'; end if;
  select * into strict authority from platform.current_backend_authority(true);
  select revision.* into strict base from app_data_agent.knowledge_base_revisions revision
  join app_data_agent.knowledge_bases pointer
    on pointer.app_id=revision.app_id and pointer.tenant_id=revision.tenant_id
    and pointer.environment=revision.environment and pointer.knowledge_base_id=revision.knowledge_base_id
    and pointer.current_revision=revision.revision and pointer.current_revision_hash=revision.revision_hash
  where revision.app_id=authority.app_id and revision.tenant_id=authority.tenant_id
    and revision.environment=authority.environment
    and revision.knowledge_base_id=(requested_request#>>'{knowledge_base_ref,knowledge_base_id}')::uuid
    and revision.revision=(requested_request#>>'{knowledge_base_ref,revision}')::bigint
    and revision.revision_hash=requested_request#>>'{knowledge_base_ref,revision_hash}'
    and revision.status='READY'
    and (revision.revision_json#>>'{acl,visibility}'='WORKSPACE' or exists (
      select 1 from pg_catalog.jsonb_array_elements_text(revision.revision_json#>'{acl,principal_ids}') item
      where item=authority.principal_id::text
    ));
  select * into strict generation from app_data_agent.knowledge_index_generations
  where app_id=base.app_id and tenant_id=base.tenant_id and environment=base.environment
    and generation_id=(requested_request#>>'{generation_ref,generation_id}')::uuid
    and generation_revision=(requested_request#>>'{generation_ref,generation_revision}')::bigint
    and generation_hash=requested_request#>>'{generation_ref,generation_hash}' and state='READY';
  if not exists (
    select 1 from app_data_agent.knowledge_projection_receipts projection
    where projection.app_id=base.app_id and projection.tenant_id=base.tenant_id
      and projection.environment=base.environment and projection.generation_id=generation.generation_id
      and projection.projection_kind='QUERY' and projection.decision='ALLOW'
      and projection.receipt_hash=requested_query_projection_hash
  ) then raise exception using errcode='23503',message='KNOWLEDGE_QUERY_PROJECTION_NOT_COMMITTED'; end if;
  perform app_data_agent.knowledge_assert_source_refs(
    base.source_refs_json,authority.app_id,authority.tenant_id,
    authority.environment,authority.principal_id
  );
  for candidate in select value from pg_catalog.jsonb_array_elements(requested_candidates) loop
    if not app_data_agent.provider_json_object_has_exact_keys(candidate,array['chunk_id','score'])
      or (candidate->>'score')::double precision not between -1 and 1
    then raise exception using errcode='22023',message='KNOWLEDGE_RETRIEVAL_CANDIDATE_INVALID'; end if;
    select * into strict chunk from app_data_agent.knowledge_chunks
    where app_id=generation.app_id and tenant_id=generation.tenant_id and environment=generation.environment
      and generation_id=generation.generation_id and chunk_id=(candidate->>'chunk_id')::uuid;
    hit:=pg_catalog.jsonb_build_object(
      'schema_version','knowledge-evidence-hit@1.0.0','scope',base.revision_json->'scope',
      'knowledge_base_ref',requested_request->'knowledge_base_ref',
      'generation_ref',requested_request->'generation_ref',
      'chunk_ref',pg_catalog.jsonb_build_object('chunk_id',chunk.chunk_id,'chunk_hash',chunk.chunk_hash),
      'source_file_ref',chunk.chunk_json->'source_file_ref',
      'score',(candidate->>'score')::double precision,
      'query_projection_receipt_hash',requested_query_projection_hash,'acl_decision','ALLOW',
      'citation',pg_catalog.jsonb_build_object(
        'start_byte',chunk.start_byte,'end_byte',chunk.end_byte,
        'excerpt_hash',app_data_agent.u2_canonical_sha256(pg_catalog.to_jsonb(chunk.normalized_text))
      )
    );
    hit:=hit||pg_catalog.jsonb_build_object('evidence_hash',app_data_agent.u2_canonical_sha256(hit));
    hits:=hits||pg_catalog.jsonb_build_array(hit);
  end loop;
  receipt:=pg_catalog.jsonb_build_object(
    'schema_version','knowledge-retrieval-receipt@1.0.0','receipt_id',receipt_id,
    'scope',base.revision_json->'scope','knowledge_base_ref',requested_request->'knowledge_base_ref',
    'generation_ref',requested_request->'generation_ref','checkpoint',generation.generation_json->'checkpoint',
    'query_hash',requested_query_hash,'query_projection_receipt_hash',requested_query_projection_hash,
    'principal_id',authority.principal_id,'hits',hits,
    'retrieved_at',app_data_agent.knowledge_utc_millis(now_at)
  );
  receipt:=receipt||pg_catalog.jsonb_build_object('receipt_hash',app_data_agent.u2_canonical_sha256(receipt));
  insert into app_data_agent.knowledge_retrieval_receipts(
    app_id,tenant_id,environment,receipt_id,principal_id,knowledge_base_id,generation_id,
    generation_hash,query_hash,receipt_hash,receipt_json,retrieved_at
  ) values (
    base.app_id,base.tenant_id,base.environment,receipt_id,authority.principal_id,
    base.knowledge_base_id,generation.generation_id,generation.generation_hash,requested_query_hash,
    receipt->>'receipt_hash',receipt,now_at
  );
  return receipt;
exception when no_data_found or invalid_text_representation or numeric_value_out_of_range then
  raise exception using errcode='40001',message='KNOWLEDGE_AUTHORITY_CHANGED';
end
$function$;
create or replace function app_data_agent.build_requested_optional_resource_bindings(request jsonb)
returns jsonb
language plpgsql stable security definer set search_path=''
as $function$
declare authority record; candidate record; current_file app_data_agent.workspace_files%rowtype;
  revision app_data_agent.workspace_file_revisions%rowtype; bindings jsonb:='[]'::jsonb; binding jsonb;
begin
  select * into strict authority from platform.current_backend_authority(false);
  for candidate in
    with overridden as (
      select kind.resource_kind,'OVERRIDE'::text as source,null::jsonb as mention_id,item.document
      from (values ('files','FILE'),('knowledge','KNOWLEDGE'),('mcp_servers','MCP_SERVER'),('skills','SKILL'))
        kind(selection_name,resource_kind)
      cross join lateral pg_catalog.jsonb_array_elements(case
        when request#>>array['overrides',kind.selection_name,'mode']='RESOURCE_IDS'
          then request#>array['overrides',kind.selection_name,'resources'] else '[]'::jsonb end) item(document)
    ), mentioned as (
      select mention.document->>'resource_kind' as resource_kind,'MENTION'::text as source,
        mention.document->'mention_id' as mention_id,mention.document
      from pg_catalog.jsonb_array_elements(request->'mentions') mention(document)
    ) select * from (select * from overridden union all select * from mentioned) all_candidates
      order by resource_kind,document->>'resource_id',source,mention_id
  loop
    current_file:=null;revision:=null;
    if candidate.resource_kind='KNOWLEDGE' then
      binding:=app_data_agent.knowledge_build_resource_binding(
        authority.app_id,authority.tenant_id,authority.environment,authority.principal_id,
        (candidate.document->>'resource_id')::uuid,(candidate.document->>'expected_revision')::bigint,
        candidate.source,candidate.mention_id
      );
    else
      if candidate.resource_kind='FILE' then
        select file_record.* into current_file from app_data_agent.workspace_files file_record
        where file_record.app_id=authority.app_id and file_record.tenant_id=authority.tenant_id
          and file_record.environment=authority.environment
          and file_record.file_id=(candidate.document->>'resource_id')::uuid;
        if found then
          select file_revision.* into revision
          from app_data_agent.workspace_file_revisions file_revision
          where file_revision.app_id=current_file.app_id
            and file_revision.tenant_id=current_file.tenant_id
            and file_revision.environment=current_file.environment
            and file_revision.file_id=current_file.file_id
            and file_revision.revision=(candidate.document->>'expected_revision')::bigint
            and file_revision.revision_hash=current_file.current_revision_hash
            and file_revision.revision=current_file.current_revision and file_revision.status='READY'
            and (file_revision.visibility='WORKSPACE' or file_revision.owner_principal_id=authority.principal_id);
        end if;
      end if;
      binding:=pg_catalog.jsonb_build_object(
        'resource_kind',candidate.resource_kind,'mention_id',candidate.mention_id,
        'requested_resource_id',candidate.document->'resource_id',
        'requested_revision',(candidate.document->>'expected_revision')::bigint,
        'effective_resource',case when revision.file_id is null then null else pg_catalog.jsonb_build_object(
          'resource_id',revision.file_id,'resource_revision',revision.revision,'resource_hash',revision.revision_hash
        ) end,'source',candidate.source,
        'availability',case when revision.file_id is null then 'UNAVAILABLE' else 'AVAILABLE' end,
        'unavailable_reason',case when revision.file_id is null then 'RESOURCE_NOT_FOUND_OR_FORBIDDEN' else null end
      );
    end if;
    bindings:=bindings||pg_catalog.jsonb_build_array(binding);
  end loop;
  return bindings;
exception when invalid_text_representation or numeric_value_out_of_range then
  raise exception using errcode='22023',message='EFFECTIVE_CONFIG_REQUEST_INVALID';
end
$function$;

create or replace function app_data_agent.build_inherited_optional_resource_bindings(
  request jsonb,defaults_document jsonb
)
returns jsonb
language plpgsql stable security definer set search_path=''
as $function$
declare authority record; candidate record; current_file app_data_agent.workspace_files%rowtype;
  revision app_data_agent.workspace_file_revisions%rowtype; bindings jsonb:='[]'::jsonb; binding jsonb;
begin
  select * into strict authority from platform.current_backend_authority(false);
  for candidate in
    select kind.resource_kind,item.document as reference
    from (values ('files','FILE'),('knowledge','KNOWLEDGE'),('mcp_servers','MCP_SERVER'),('skills','SKILL'))
      kind(selection_name,resource_kind)
    cross join lateral pg_catalog.jsonb_array_elements(case
      when request#>>array['overrides',kind.selection_name,'mode']='INHERIT_DEFAULT'
        and pg_catalog.jsonb_typeof(defaults_document->kind.selection_name)='array'
        then defaults_document->kind.selection_name else '[]'::jsonb end) item(document)
    order by kind.resource_kind,item.document->>'resource_id'
  loop
    current_file:=null;revision:=null;
    if candidate.resource_kind='KNOWLEDGE' then
      binding:=app_data_agent.knowledge_build_resource_binding(
        authority.app_id,authority.tenant_id,authority.environment,authority.principal_id,
        (candidate.reference->>'resource_id')::uuid,(candidate.reference->>'resource_revision')::bigint,
        'DEFAULT',null
      );
    else
      if candidate.resource_kind='FILE' then
        select * into current_file from app_data_agent.workspace_files
        where app_id=authority.app_id and tenant_id=authority.tenant_id and environment=authority.environment
          and file_id=(candidate.reference->>'resource_id')::uuid;
        if found then
          select file_revision.* into revision
          from app_data_agent.workspace_file_revisions file_revision
          where file_revision.app_id=current_file.app_id
            and file_revision.tenant_id=current_file.tenant_id
            and file_revision.environment=current_file.environment
            and file_revision.file_id=current_file.file_id
            and file_revision.revision=(candidate.reference->>'resource_revision')::bigint
            and file_revision.revision_hash=candidate.reference->>'resource_hash'
            and current_file.current_revision=file_revision.revision
            and current_file.current_revision_hash=file_revision.revision_hash
            and file_revision.status='READY'
            and (file_revision.visibility='WORKSPACE' or file_revision.owner_principal_id=authority.principal_id);
        end if;
      end if;
      binding:=pg_catalog.jsonb_build_object(
        'resource_kind',candidate.resource_kind,'mention_id',null,
        'requested_resource_id',candidate.reference->'resource_id',
        'requested_revision',(candidate.reference->>'resource_revision')::bigint,
        'effective_resource',case when revision.file_id is null then null else pg_catalog.jsonb_build_object(
          'resource_id',revision.file_id,'resource_revision',revision.revision,'resource_hash',revision.revision_hash
        ) end,'source','DEFAULT',
        'availability',case when revision.file_id is null then 'UNAVAILABLE' else 'AVAILABLE' end,
        'unavailable_reason',case when revision.file_id is null then 'RESOURCE_NOT_FOUND_OR_FORBIDDEN' else null end
      );
    end if;
    bindings:=bindings||pg_catalog.jsonb_build_array(binding);
  end loop;
  return bindings;
exception when invalid_text_representation or numeric_value_out_of_range then
  raise exception using errcode='22023',message='EFFECTIVE_CONFIG_REQUEST_INVALID';
end
$function$;
create or replace function app_data_agent.update_workspace_run_defaults(command jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
  authority record;
  app_user_record app_data_agent.app_users%rowtype;
  workspace_record app_data_agent.workspaces%rowtype;
  current_defaults app_data_agent.workspace_run_defaults%rowtype;
  existing_revision app_data_agent.workspace_run_default_revisions%rowtype;
  model_record app_data_agent.model_catalog_entries%rowtype;
  datasource_record app_data_agent.datasource_connections%rowtype;
  domain_record semantic.semantic_domain_registry%rowtype;
  release_record semantic.semantic_source_release%rowtype;
  snapshot_record catalog.physical_schema_snapshot%rowtype;
  requested_operation_id uuid;
  requested_workspace_id uuid;
  requested_expected_revision bigint;
  requested_idempotency_key text;
  requested_hash text;
  requested_defaults jsonb;
  resolved_defaults jsonb;
  model_reference jsonb := 'null'::jsonb;
  datasource_reference jsonb := 'null'::jsonb;
  semantic_reference jsonb := 'null'::jsonb;
  snapshot_reference jsonb := 'null'::jsonb;
  context_reference jsonb;
  egress_reference jsonb;
  safety_reference jsonb;
  knowledge_reference jsonb := '[]'::jsonb;
  knowledge_selection jsonb;
  knowledge_revision app_data_agent.knowledge_base_revisions%rowtype;
  computed_request_hash text;
  computed_defaults_hash text;
  selected_defaults_id uuid;
  revision_document jsonb;
  parent_revision bigint;
  parent_hash text;
  next_revision bigint;
  commit_at timestamptz;
begin
  if not pg_catalog.pg_has_role(session_user, 'data_agent_backend', 'USAGE') then
    raise exception using errcode = '42501', message = 'DA_BACKEND_ROLE_REQUIRED';
  end if;
  if command is null
    or pg_catalog.jsonb_typeof(command) <> 'object'
    or command ->> 'schema_version' <> 'workspace-defaults-cas-update@1.0.0'
    or not command ?& array[
      'schema_version','operation_id','workspace_id','expected_defaults_revision','idempotency_key','request_hash','defaults'
    ]
    or exists (
      select 1 from pg_catalog.jsonb_object_keys(command) as key(name)
      where key.name not in (
        'schema_version','operation_id','workspace_id','expected_defaults_revision','idempotency_key','request_hash','defaults'
      )
    )
    or not app_data_agent.canonical_uuid_json_string_is_valid(command -> 'operation_id')
    or not app_data_agent.canonical_uuid_json_string_is_valid(command -> 'workspace_id')
    or pg_catalog.jsonb_typeof(command -> 'expected_defaults_revision') <> 'number'
    or pg_catalog.jsonb_typeof(command -> 'idempotency_key') <> 'string'
    or pg_catalog.jsonb_typeof(command -> 'request_hash') <> 'string'
    or not app_data_agent.workspace_run_defaults_document_is_valid(command -> 'defaults')
    or app_data_agent.contains_potential_plaintext_secret(command)
  then
    raise exception using errcode = '22023', message = 'WORKSPACE_RUN_DEFAULTS_INPUT_INVALID';
  end if;

  begin
    requested_operation_id := (command ->> 'operation_id')::uuid;
    requested_workspace_id := (command ->> 'workspace_id')::uuid;
    requested_expected_revision := (command ->> 'expected_defaults_revision')::bigint;
  exception when others then
    raise exception using errcode = '22023', message = 'WORKSPACE_RUN_DEFAULTS_INPUT_INVALID';
  end;
  requested_idempotency_key := command ->> 'idempotency_key';
  requested_hash := command ->> 'request_hash';
  requested_defaults := command -> 'defaults';
  computed_request_hash := app_data_agent.u2_canonical_sha256(command - 'request_hash');
  if requested_expected_revision < 0
    or pg_catalog.length(requested_idempotency_key) not between 8 and 128
    or requested_idempotency_key !~ '^[A-Za-z0-9][A-Za-z0-9._:@/-]*$'
    or requested_hash is distinct from computed_request_hash
  then
    raise exception using errcode = '22023', message = 'WORKSPACE_RUN_DEFAULTS_INPUT_INVALID';
  end if;

  select * into strict authority from platform.current_backend_authority(true);
  if requested_workspace_id <> authority.tenant_id then
    raise exception using errcode = '42501', message = 'WORKSPACE_RUN_DEFAULTS_SCOPE_MISMATCH';
  end if;
  if authority.membership_role <> 'owner' then
    raise exception using errcode = '42501', message = 'WORKSPACE_RUN_DEFAULTS_ADMIN_REQUIRED';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'data-agent:workspace-defaults-idempotency:' || authority.app_id::text || ':' ||
    authority.tenant_id::text || ':' || authority.environment || ':' ||
    authority.principal_id::text || ':' || requested_idempotency_key,
    0
  ));
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'data-agent:workspace-defaults:' || authority.app_id::text || ':' ||
    authority.tenant_id::text || ':' || authority.environment,
    0
  ));

  select revision.* into existing_revision
  from app_data_agent.workspace_run_default_revisions as revision
  where revision.app_id = authority.app_id
    and revision.tenant_id = authority.tenant_id
    and revision.environment = authority.environment
    and revision.principal_id = authority.principal_id
    and revision.idempotency_key = requested_idempotency_key;
  if found then
    if existing_revision.request_hash <> requested_hash
      or existing_revision.revision_id <> requested_operation_id
    then
      raise exception using errcode = '23505', message = 'WORKSPACE_RUN_DEFAULTS_IDEMPOTENCY_CONFLICT';
    end if;
    return pg_catalog.jsonb_build_object(
      'revision',existing_revision.revision_document || pg_catalog.jsonb_build_object('defaults_hash',existing_revision.defaults_hash),
      'defaults_ref',pg_catalog.jsonb_build_object(
        'defaults_id',existing_revision.defaults_id,'defaults_revision',existing_revision.defaults_revision,
        'defaults_hash',existing_revision.defaults_hash),
      'request_hash',existing_revision.request_hash,
      'committed_at',existing_revision.revision_document ->> 'created_at',
      'replayed',true
    );
  end if;

  select defaults.* into current_defaults
  from app_data_agent.workspace_run_defaults as defaults
  where defaults.app_id = authority.app_id
    and defaults.tenant_id = authority.tenant_id
    and defaults.environment = authority.environment
  for update;
  if found then
    if current_defaults.defaults_revision <> requested_expected_revision then
      raise exception using errcode = '40001', message = 'WORKSPACE_RUN_DEFAULTS_CAS_CONFLICT';
    end if;
    next_revision := current_defaults.defaults_revision + 1;
    selected_defaults_id := current_defaults.defaults_id;
    parent_revision := current_defaults.defaults_revision;
    parent_hash := current_defaults.defaults_hash;
  else
    if requested_expected_revision <> 0 then
      raise exception using errcode = '40001', message = 'WORKSPACE_RUN_DEFAULTS_CAS_CONFLICT';
    end if;
    next_revision := 1;
    selected_defaults_id := requested_operation_id;
    parent_revision := null;
    parent_hash := null;
  end if;

  select * into strict app_user_record
  from app_data_agent.app_users as app_user
  where app_user.app_id = authority.app_id
    and app_user.environment = authority.environment
    and app_user.principal_id = authority.principal_id
    and app_user.status = 'ACTIVE'
  for share;
  select * into strict workspace_record
  from app_data_agent.workspaces as workspace
  where workspace.app_id = authority.app_id
    and workspace.workspace_id = authority.tenant_id
    and workspace.environment = authority.environment
    and workspace.lifecycle = 'ACTIVE'
  for share;

  if pg_catalog.jsonb_array_length(requested_defaults -> 'files') > 0
    or pg_catalog.jsonb_array_length(requested_defaults -> 'mcp_servers') > 0
    or pg_catalog.jsonb_array_length(requested_defaults -> 'skills') > 0
  then
    raise exception using errcode = '23503', message = 'WORKSPACE_RUN_DEFAULTS_RESOURCE_NOT_AVAILABLE';
  end if;

  for knowledge_selection in
    select item.value from pg_catalog.jsonb_array_elements(requested_defaults -> 'knowledge') item(value)
    order by item.value ->> 'resource_id'
  loop
    knowledge_revision := null;
    select revision.* into knowledge_revision
    from app_data_agent.knowledge_bases base
    join app_data_agent.knowledge_base_revisions revision
      on revision.app_id=base.app_id and revision.tenant_id=base.tenant_id
      and revision.environment=base.environment and revision.knowledge_base_id=base.knowledge_base_id
      and revision.revision=base.current_revision and revision.revision_hash=base.current_revision_hash
    join app_data_agent.knowledge_embedding_profile_revisions profile
      on profile.app_id=revision.app_id and profile.tenant_id=revision.tenant_id
      and profile.environment=revision.environment and profile.profile_id=revision.profile_id
      and profile.revision=revision.profile_revision and profile.profile_hash=revision.profile_hash
      and profile.status='READY'
    where base.app_id=authority.app_id and base.tenant_id=authority.tenant_id
      and base.environment=authority.environment
      and base.knowledge_base_id=(knowledge_selection ->> 'resource_id')::uuid
      and base.current_revision=(knowledge_selection ->> 'expected_revision')::bigint
      and base.current_status='READY' and revision.status='READY'
      and exists (
        select 1 from app_data_agent.knowledge_index_generations generation
        where generation.app_id=revision.app_id and generation.tenant_id=revision.tenant_id
          and generation.environment=revision.environment
          and generation.knowledge_base_id=revision.knowledge_base_id
          and generation.generation_id=(revision.revision_json#>>'{active_generation_ref,generation_id}')::uuid
          and generation.generation_revision=(revision.revision_json#>>'{active_generation_ref,generation_revision}')::bigint
          and generation.generation_hash=revision.revision_json#>>'{active_generation_ref,generation_hash}'
          and generation.state='READY'
      )
    for share of base;
    if not found then
      raise exception using errcode = '23503', message = 'WORKSPACE_RUN_DEFAULTS_RESOURCE_NOT_AVAILABLE';
    end if;
    begin
      perform app_data_agent.knowledge_assert_source_refs(
        knowledge_revision.source_refs_json,authority.app_id,authority.tenant_id,
        authority.environment,authority.principal_id
      );
    exception when others then
      raise exception using errcode = '23503', message = 'WORKSPACE_RUN_DEFAULTS_RESOURCE_NOT_AVAILABLE';
    end;
    knowledge_reference:=knowledge_reference||pg_catalog.jsonb_build_array(
      pg_catalog.jsonb_build_object(
        'resource_id',knowledge_revision.knowledge_base_id,
        'resource_revision',knowledge_revision.revision,
        'resource_hash',knowledge_revision.revision_hash
      )
    );
  end loop;

  if requested_defaults -> 'model' <> 'null'::jsonb then
    select catalog.* into model_record
    from platform.list_active_model_catalog(authority.deployment_id,authority.principal_id) as catalog
    where catalog.model_profile_id = (requested_defaults #>> '{model,resource_id}')::uuid
      and catalog.config_version = (requested_defaults #>> '{model,expected_revision}')::bigint;
    if not found then
      raise exception using errcode = '23503', message = 'WORKSPACE_RUN_DEFAULTS_RESOURCE_NOT_AVAILABLE';
    end if;
    model_reference := pg_catalog.jsonb_build_object(
      'resource_id',model_record.model_profile_id,'resource_revision',model_record.config_version,
      'resource_hash',app_data_agent.u2_canonical_sha256(pg_catalog.to_jsonb(model_record) - 'credential_ref'));
  end if;

  if requested_defaults -> 'datasource' <> 'null'::jsonb then
    select datasource.* into datasource_record
    from app_data_agent.datasource_connections as datasource
    where datasource.app_id = authority.app_id and datasource.tenant_id = authority.tenant_id
      and datasource.environment = authority.environment
      and datasource.datasource_id = (requested_defaults #>> '{datasource,resource_id}')::uuid
      and datasource.status = 'ACTIVE'
    for share;
    if not found then
      raise exception using errcode = '23503', message = 'WORKSPACE_RUN_DEFAULTS_RESOURCE_NOT_AVAILABLE';
    end if;
    if (requested_defaults #>> '{datasource,expected_revision}')::bigint <>
      datasource_record.resource_version then
      raise exception using errcode = '40001', message = 'WORKSPACE_RUN_DEFAULTS_RESOURCE_REVISION_MISMATCH';
    end if;
    datasource_reference := pg_catalog.jsonb_build_object(
      'resource_id',datasource_record.datasource_id,
      'resource_revision',datasource_record.resource_version,
      'resource_hash',app_data_agent.u2_canonical_sha256(pg_catalog.jsonb_build_object(
        'datasource_id',datasource_record.datasource_id,'datasource_type',datasource_record.datasource_type,
        'status',datasource_record.status,'resource_version',datasource_record.resource_version)));
  end if;

  if requested_defaults -> 'semantic_release' <> 'null'::jsonb then
    select release.* into release_record
    from semantic.semantic_source_release as release
    join semantic.semantic_domain_registry as domain
      on domain.app_id = release.app_id and domain.tenant_id = release.tenant_id
     and domain.environment = release.environment and domain.semantic_domain = release.semantic_domain
     and domain.is_active
    join semantic.semantic_active_pointer as pointer
      on pointer.app_id = release.app_id and pointer.tenant_id = release.tenant_id
     and pointer.environment = release.environment and pointer.semantic_domain = release.semantic_domain
     and pointer.current_release_id = release.release_id
     and pointer.current_release_generation = release.release_generation
     and pointer.current_release_digest = release.release_digest
    where release.app_id = authority.app_id and release.tenant_id = authority.tenant_id
      and release.environment = authority.environment
      and release.release_id = (requested_defaults #>> '{semantic_release,resource_id}')::uuid
      and release.release_generation = (requested_defaults #>> '{semantic_release,expected_revision}')::bigint
    for share of release,domain,pointer;
    if not found then
      raise exception using errcode = '23503', message = 'WORKSPACE_RUN_DEFAULTS_RESOURCE_NOT_AVAILABLE';
    end if;
    select domain.* into strict domain_record
    from semantic.semantic_domain_registry as domain
    where domain.app_id = release_record.app_id and domain.tenant_id = release_record.tenant_id
      and domain.environment = release_record.environment
      and domain.semantic_domain = release_record.semantic_domain and domain.is_active
    for share;
    semantic_reference := pg_catalog.jsonb_build_object(
      'resource_id',release_record.release_id,'resource_revision',release_record.release_generation,
      'resource_hash',release_record.release_digest);
  end if;

  if requested_defaults -> 'schema_snapshot' <> 'null'::jsonb then
    if (requested_defaults #>> '{schema_snapshot,expected_revision}')::bigint <> 1 then
      raise exception using errcode = '40001', message = 'WORKSPACE_RUN_DEFAULTS_RESOURCE_REVISION_MISMATCH';
    end if;
    select snapshot.* into snapshot_record
    from catalog.physical_schema_snapshot as snapshot
    where snapshot.app_id = authority.app_id and snapshot.tenant_id = authority.tenant_id
      and snapshot.environment = authority.environment
      and exists (
        select 1 from catalog.schema_scan_run as scan
        where scan.app_id = snapshot.app_id and scan.tenant_id = snapshot.tenant_id
          and scan.environment = snapshot.environment and scan.datasource_id = snapshot.datasource_id
          and scan.datasource_fingerprint = snapshot.datasource_fingerprint
          and scan.snapshot_content_hash = snapshot.snapshot_content_hash
          and scan.snapshot_id = (requested_defaults #>> '{schema_snapshot,resource_id}')::uuid
          and scan.terminal = 'SUCCEEDED'
      )
    order by snapshot.committed_at desc limit 1
    for share;
    if not found then
      raise exception using errcode = '23503', message = 'WORKSPACE_RUN_DEFAULTS_RESOURCE_NOT_AVAILABLE';
    end if;
    snapshot_reference := pg_catalog.jsonb_build_object(
      'resource_id',(requested_defaults #>> '{schema_snapshot,resource_id}')::uuid,
      'resource_revision',1,'resource_hash',snapshot_record.snapshot_content_hash);
  end if;

  if datasource_reference <> 'null'::jsonb and semantic_reference <> 'null'::jsonb
    and domain_record.datasource_id is distinct from datasource_record.datasource_id then
    raise exception using errcode = '23514', message = 'WORKSPACE_RUN_DEFAULTS_RESOURCE_BINDING_MISMATCH';
  end if;
  if datasource_reference <> 'null'::jsonb and snapshot_reference <> 'null'::jsonb
    and snapshot_record.datasource_connection_id is distinct from datasource_record.datasource_id then
    raise exception using errcode = '23514', message = 'WORKSPACE_RUN_DEFAULTS_RESOURCE_BINDING_MISMATCH';
  end if;

  context_reference := app_data_agent.builtin_effective_config_policy('CONTEXT_POLICY')
    - array['max_context_tokens','max_resource_bindings'];
  egress_reference := app_data_agent.builtin_effective_config_policy('EGRESS_POLICY')
    - array['allowed_providers','allowed_audiences','classification'];
  safety_reference := app_data_agent.builtin_effective_config_policy('EXECUTION_SAFETY_POLICY')
    - array['max_tool_calls','max_provider_calls','max_elapsed_ms'];
  if requested_defaults #>> '{context_policy,resource_id}' <> context_reference ->> 'resource_id'
    or (requested_defaults #>> '{context_policy,expected_revision}')::bigint <>
      (context_reference ->> 'resource_revision')::bigint
    or requested_defaults #>> '{egress_policy,resource_id}' <> egress_reference ->> 'resource_id'
    or (requested_defaults #>> '{egress_policy,expected_revision}')::bigint <>
      (egress_reference ->> 'resource_revision')::bigint
    or requested_defaults #>> '{execution_safety_policy,resource_id}' <> safety_reference ->> 'resource_id'
    or (requested_defaults #>> '{execution_safety_policy,expected_revision}')::bigint <>
      (safety_reference ->> 'resource_revision')::bigint
  then
    raise exception using errcode = '40001', message = 'WORKSPACE_RUN_DEFAULTS_RESOURCE_REVISION_MISMATCH';
  end if;

  resolved_defaults := pg_catalog.jsonb_build_object(
    'model',model_reference,'datasource',datasource_reference,
    'files','[]'::jsonb,'knowledge',knowledge_reference,'mcp_servers','[]'::jsonb,'skills','[]'::jsonb,
    'semantic_release',semantic_reference,'schema_snapshot',snapshot_reference,
    'context_policy',context_reference,'egress_policy',egress_reference,
    'execution_safety_policy',safety_reference);
  requested_defaults := resolved_defaults;

  commit_at := pg_catalog.clock_timestamp();
  revision_document := pg_catalog.jsonb_build_object(
    'schema_version','workspace-defaults-revision@1.0.0',
    'scope',pg_catalog.jsonb_build_object(
      'app_id',authority.app_id,'tenant_id',authority.tenant_id,
      'environment',authority.environment,'workspace_id',authority.tenant_id),
    'defaults_id',selected_defaults_id,'defaults_revision',next_revision,
    'parent_revision',parent_revision,'parent_hash',parent_hash,
    'defaults',requested_defaults,'created_by_principal_id',authority.principal_id,
    'created_at',app_data_agent.runtime_iso_timestamp(commit_at)
  );
  computed_defaults_hash := app_data_agent.u2_canonical_sha256(revision_document);
  insert into app_data_agent.workspace_run_default_revisions (
    app_id,tenant_id,environment,defaults_id,defaults_revision,revision_id,principal_id,
    idempotency_key,request_hash,defaults_json,revision_document,defaults_hash,membership_version,
    user_authz_epoch,workspace_lifecycle_version,app_epoch,committed_at
  ) values (
    authority.app_id,authority.tenant_id,authority.environment,selected_defaults_id,next_revision,
    requested_operation_id,authority.principal_id,requested_idempotency_key,requested_hash,
    requested_defaults,revision_document,computed_defaults_hash,authority.membership_version,
    app_user_record.authz_epoch,workspace_record.lifecycle_version,authority.app_epoch,commit_at
  );

  insert into app_data_agent.workspace_run_defaults (
    app_id,tenant_id,environment,defaults_id,defaults_revision,revision_id,defaults_hash,
    updated_by_principal_id,updated_at
  ) values (
    authority.app_id,authority.tenant_id,authority.environment,selected_defaults_id,next_revision,
    requested_operation_id,computed_defaults_hash,authority.principal_id,commit_at
  ) on conflict (app_id,tenant_id,environment) do update set
    defaults_revision = excluded.defaults_revision,
    revision_id = excluded.revision_id,
    defaults_hash = excluded.defaults_hash,
    updated_by_principal_id = excluded.updated_by_principal_id,
    updated_at = excluded.updated_at;

  return pg_catalog.jsonb_build_object(
    'revision',revision_document || pg_catalog.jsonb_build_object('defaults_hash',computed_defaults_hash),
    'defaults_ref',pg_catalog.jsonb_build_object(
      'defaults_id',selected_defaults_id,'defaults_revision',next_revision,
      'defaults_hash',computed_defaults_hash),
    'request_hash',requested_hash,
    'committed_at',app_data_agent.runtime_iso_timestamp(commit_at),
    'replayed',false
  );
end
$function$;
create function app_data_agent.reject_knowledge_immutable_mutation()
returns trigger language plpgsql set search_path=''
as $function$
begin
  raise exception using errcode='55000',message='KNOWLEDGE_AUTHORITY_IMMUTABLE';
end
$function$;

create trigger knowledge_embedding_profile_revisions_immutable
before update or delete on app_data_agent.knowledge_embedding_profile_revisions
for each row execute function app_data_agent.reject_knowledge_immutable_mutation();
create trigger knowledge_base_revisions_immutable
before update or delete on app_data_agent.knowledge_base_revisions
for each row execute function app_data_agent.reject_knowledge_immutable_mutation();
create trigger knowledge_projection_receipts_immutable
before update or delete on app_data_agent.knowledge_projection_receipts
for each row execute function app_data_agent.reject_knowledge_immutable_mutation();
create trigger knowledge_chunks_immutable
before update or delete on app_data_agent.knowledge_chunks
for each row execute function app_data_agent.reject_knowledge_immutable_mutation();
create trigger knowledge_retrieval_receipts_immutable
before update or delete on app_data_agent.knowledge_retrieval_receipts
for each row execute function app_data_agent.reject_knowledge_immutable_mutation();
create trigger knowledge_idempotency_immutable
before update or delete on app_data_agent.knowledge_idempotency
for each row execute function app_data_agent.reject_knowledge_immutable_mutation();
alter function app_data_agent.reject_knowledge_immutable_mutation() owner to data_agent_u15_knowledge_owner;
alter function app_data_agent.knowledge_utc_millis(timestamptz) owner to data_agent_u15_knowledge_owner;
alter function app_data_agent.knowledge_assert_source_refs(jsonb,uuid,uuid,text,uuid) owner to data_agent_u15_knowledge_owner;
alter function app_data_agent.knowledge_enqueue_index_job(uuid,uuid,text,uuid,jsonb,jsonb,text) owner to data_agent_u15_knowledge_owner;
alter function app_data_agent.knowledge_build_resource_binding(uuid,uuid,text,uuid,uuid,bigint,text,jsonb) owner to data_agent_u15_knowledge_owner;
alter function app_data_agent.register_knowledge_embedding_profile(jsonb) owner to data_agent_u15_knowledge_owner;
alter function app_data_agent.list_knowledge_embedding_profiles(integer) owner to data_agent_u15_knowledge_owner;
alter function app_data_agent.create_knowledge_base(jsonb) owner to data_agent_u15_knowledge_owner;
alter function app_data_agent.rebuild_knowledge_base(jsonb) owner to data_agent_u15_knowledge_owner;
alter function app_data_agent.list_knowledge_bases(integer) owner to data_agent_u15_knowledge_owner;
alter function app_data_agent.load_knowledge_index_target(jsonb) owner to data_agent_u15_knowledge_owner;
alter function app_data_agent.commit_knowledge_blocked_projection(jsonb,jsonb) owner to data_agent_u15_knowledge_owner;
alter function app_data_agent.stage_knowledge_generation(jsonb,jsonb) owner to data_agent_u15_knowledge_owner;
alter function app_data_agent.commit_knowledge_generation_ready(jsonb,jsonb) owner to data_agent_u15_knowledge_owner;
alter function app_data_agent.load_knowledge_search_snapshot(jsonb) owner to data_agent_u15_knowledge_owner;
alter function app_data_agent.commit_knowledge_query_projection(jsonb) owner to data_agent_u15_knowledge_owner;
alter function app_data_agent.commit_knowledge_retrieval(jsonb,jsonb,text,text) owner to data_agent_u15_knowledge_owner;

grant usage on schema app_data_agent,platform to data_agent_u15_knowledge_owner;
grant execute on function
  platform.current_backend_authority(boolean),
  platform.backend_context_matches(uuid,uuid,text,boolean),
  app_data_agent.provider_json_object_has_exact_keys(jsonb,text[]),
  app_data_agent.contains_potential_plaintext_secret(jsonb,text),
  app_data_agent.u2_canonical_sha256(jsonb),
  app_data_agent.assert_job_active_lease(jsonb),
  app_data_agent.job_append_event(app_data_agent.jobs,text,jsonb)
to data_agent_u15_knowledge_owner;
grant select,insert,update on app_data_agent.jobs to data_agent_u15_knowledge_owner;
grant select on app_data_agent.job_attempts,
  app_data_agent.workspace_files,app_data_agent.workspace_file_revisions,
  app_data_agent.workspace_content_blobs
to data_agent_u15_knowledge_owner;

create policy jobs_u15_knowledge_all on app_data_agent.jobs
  as permissive for all to data_agent_u15_knowledge_owner
  using (platform.backend_context_matches(app_id,tenant_id,environment,false))
  with check (platform.backend_context_matches(app_id,tenant_id,environment,true));
create policy job_attempts_u15_knowledge_select on app_data_agent.job_attempts
  as permissive for select to data_agent_u15_knowledge_owner
  using (platform.backend_context_matches(app_id,tenant_id,environment,false));
create policy workspace_files_u15_knowledge_select on app_data_agent.workspace_files
  as permissive for select to data_agent_u15_knowledge_owner
  using (platform.backend_context_matches(app_id,tenant_id,environment,false));
create policy workspace_file_revisions_u15_knowledge_select on app_data_agent.workspace_file_revisions
  as permissive for select to data_agent_u15_knowledge_owner
  using (platform.backend_context_matches(app_id,tenant_id,environment,false));
create policy workspace_content_blobs_u15_knowledge_select on app_data_agent.workspace_content_blobs
  as permissive for select to data_agent_u15_knowledge_owner
  using (platform.backend_context_matches(app_id,tenant_id,environment,false));

grant select on app_data_agent.knowledge_index_generations to data_agent_u10_job_owner;
create policy knowledge_generations_u10_job_select on app_data_agent.knowledge_index_generations
  as permissive for select to data_agent_u10_job_owner
  using (platform.backend_context_matches(app_id,tenant_id,environment,false));

grant execute on function
  app_data_agent.knowledge_build_resource_binding(uuid,uuid,text,uuid,uuid,bigint,text,jsonb)
to data_agent_u6_file_owner;
grant execute on function
  app_data_agent.knowledge_assert_source_refs(jsonb,uuid,uuid,text,uuid),
  platform.backend_context_matches(uuid,uuid,text,boolean)
to data_agent_effective_config_rpc_owner;
grant select on app_data_agent.knowledge_embedding_profile_revisions,
  app_data_agent.knowledge_bases,app_data_agent.knowledge_base_revisions,
  app_data_agent.knowledge_index_generations
to data_agent_effective_config_rpc_owner;
grant update on app_data_agent.knowledge_bases to data_agent_effective_config_rpc_owner;
create policy knowledge_profiles_effective_select on app_data_agent.knowledge_embedding_profile_revisions
  as permissive for select to data_agent_effective_config_rpc_owner
  using (platform.backend_context_matches(app_id,tenant_id,environment,false));
create policy knowledge_bases_effective_select on app_data_agent.knowledge_bases
  as permissive for select to data_agent_effective_config_rpc_owner
  using (platform.backend_context_matches(app_id,tenant_id,environment,false));
create policy knowledge_bases_effective_update on app_data_agent.knowledge_bases
  as permissive for update to data_agent_effective_config_rpc_owner
  using (platform.backend_context_matches(app_id,tenant_id,environment,false))
  with check (false);
create policy knowledge_base_revisions_effective_select on app_data_agent.knowledge_base_revisions
  as permissive for select to data_agent_effective_config_rpc_owner
  using (platform.backend_context_matches(app_id,tenant_id,environment,false));
create policy knowledge_generations_effective_select on app_data_agent.knowledge_index_generations
  as permissive for select to data_agent_effective_config_rpc_owner
  using (platform.backend_context_matches(app_id,tenant_id,environment,false));

revoke all on app_data_agent.knowledge_embedding_profile_revisions,
  app_data_agent.knowledge_bases,app_data_agent.knowledge_base_revisions,
  app_data_agent.knowledge_index_generations,app_data_agent.knowledge_projection_receipts,
  app_data_agent.knowledge_chunks,app_data_agent.knowledge_retrieval_receipts,
  app_data_agent.knowledge_idempotency
from public,anon,authenticated,service_role,data_agent_backend;

revoke all on function
  app_data_agent.register_knowledge_embedding_profile(jsonb),
  app_data_agent.list_knowledge_embedding_profiles(integer),
  app_data_agent.create_knowledge_base(jsonb),
  app_data_agent.rebuild_knowledge_base(jsonb),
  app_data_agent.list_knowledge_bases(integer),
  app_data_agent.load_knowledge_index_target(jsonb),
  app_data_agent.commit_knowledge_blocked_projection(jsonb,jsonb),
  app_data_agent.stage_knowledge_generation(jsonb,jsonb),
  app_data_agent.commit_knowledge_generation_ready(jsonb,jsonb),
  app_data_agent.load_knowledge_search_snapshot(jsonb),
  app_data_agent.commit_knowledge_query_projection(jsonb),
  app_data_agent.commit_knowledge_retrieval(jsonb,jsonb,text,text)
from public,anon,authenticated,service_role,data_agent_backend;

grant execute on function
  app_data_agent.register_knowledge_embedding_profile(jsonb),
  app_data_agent.list_knowledge_embedding_profiles(integer),
  app_data_agent.create_knowledge_base(jsonb),
  app_data_agent.rebuild_knowledge_base(jsonb),
  app_data_agent.list_knowledge_bases(integer),
  app_data_agent.load_knowledge_index_target(jsonb),
  app_data_agent.commit_knowledge_blocked_projection(jsonb,jsonb),
  app_data_agent.stage_knowledge_generation(jsonb,jsonb),
  app_data_agent.commit_knowledge_generation_ready(jsonb,jsonb),
  app_data_agent.load_knowledge_search_snapshot(jsonb),
  app_data_agent.commit_knowledge_query_projection(jsonb),
  app_data_agent.commit_knowledge_retrieval(jsonb,jsonb,text,text)
to data_agent_backend;

grant execute on function
  app_data_agent.build_requested_optional_resource_bindings(jsonb),
  app_data_agent.build_inherited_optional_resource_bindings(jsonb,jsonb)
to data_agent_effective_config_rpc_owner;

do $postconditions$
declare relation_name text;
begin
  foreach relation_name in array array[
    'knowledge_embedding_profile_revisions','knowledge_bases','knowledge_base_revisions',
    'knowledge_index_generations','knowledge_projection_receipts','knowledge_chunks',
    'knowledge_retrieval_receipts','knowledge_idempotency'
  ] loop
    if not exists (
      select 1 from pg_catalog.pg_class relation
      join pg_catalog.pg_namespace namespace on namespace.oid=relation.relnamespace
      where namespace.nspname='app_data_agent' and relation.relname=relation_name
        and relation.relrowsecurity and relation.relforcerowsecurity
        and relation.relowner=(select oid from pg_catalog.pg_roles where rolname='data_agent_u15_knowledge_owner')
    ) then raise exception using errcode='P0001',message='KNOWLEDGE_FORCE_RLS_OR_OWNER_MISSING'; end if;
  end loop;
  if not exists (
    select 1 from pg_catalog.pg_roles where rolname='data_agent_u15_knowledge_owner'
      and not rolcanlogin and not rolsuper and not rolcreatedb and not rolcreaterole
      and not rolreplication and not rolinherit and not rolbypassrls
  ) or pg_catalog.pg_has_role('data_agent_u15_knowledge_owner','data_agent_backend','MEMBER')
  then raise exception using errcode='P0001',message='KNOWLEDGE_OWNER_FLAGS_UNSAFE'; end if;
  if not exists (
    select 1 from app_data_agent.job_handler_revisions
    where kind='KNOWLEDGE_INDEX' and handler_revision='knowledge-index-handler@1.0.0'
      and enabled and dependencies_ready and output_receipt_required
  ) then raise exception using errcode='P0001',message='KNOWLEDGE_JOB_HANDLER_MISSING'; end if;
  if pg_catalog.has_table_privilege('data_agent_backend','app_data_agent.knowledge_bases','INSERT,UPDATE,DELETE')
    or not pg_catalog.has_function_privilege('data_agent_backend','app_data_agent.create_knowledge_base(jsonb)','EXECUTE')
    or not pg_catalog.has_function_privilege('data_agent_backend','app_data_agent.commit_knowledge_generation_ready(jsonb,jsonb)','EXECUTE')
    or not pg_catalog.has_function_privilege('data_agent_backend','app_data_agent.commit_knowledge_retrieval(jsonb,jsonb,text,text)','EXECUTE')
    or pg_catalog.has_function_privilege('anon','app_data_agent.list_knowledge_bases(integer)','EXECUTE')
  then raise exception using errcode='P0001',message='KNOWLEDGE_GRANT_POSTCONDITION_FAILED'; end if;
end
$postconditions$;
select platform.assert_migration_checksum(
  'app',
  '00000000-0000-4000-8000-00000000da01'::uuid,
  '20260725010661_app_data_agent_knowledge_base',
  'sha256:b628dcb85fd659327a9fc1a5b931774cb685ea7565281140d7b1452ab1b89887'
);

commit;
