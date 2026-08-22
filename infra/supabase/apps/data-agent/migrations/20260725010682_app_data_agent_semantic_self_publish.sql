-- semantic_self_publish_migration_checksum: sha256:fc5a300730469124d37d7bce35073e0395baf407934a5ec41ebb60604599050b
-- 10682 adds an atomic creator self-review + publish path for an explicitly saved revision.
begin;

do $bootstrap$
begin
  if pg_catalog.current_setting('server_version_num')::integer not between 170000 and 179999 then
    raise exception using errcode='0A000',message='SEMANTIC_SELF_PUBLISH_POSTGRES_VERSION_UNSUPPORTED';
  end if;
  if session_user<>'postgres' or current_user<>'postgres' then
    raise exception using errcode='42501',message='SEMANTIC_SELF_PUBLISH_MIGRATION_EXECUTOR_UNSAFE';
  end if;
  if not exists(select 1 from platform.migration_ledger where owner_kind='app'
    and app_id='00000000-0000-4000-8000-00000000da01'::uuid
    and migration_version='20260725010681_app_data_agent_semantic_explicit_revisions')
  then raise exception using errcode='P0001',message='SEMANTIC_SELF_PUBLISH_BASELINE_10681_MISSING'; end if;
  if not exists(select 1 from pg_catalog.pg_roles where rolname='data_agent_u5_self_publish_owner') then
    create role data_agent_u5_self_publish_owner
      nologin noinherit nosuperuser nocreatedb nocreaterole noreplication nobypassrls;
  end if;
end
$bootstrap$;

set local lock_timeout='2000ms';
set local statement_timeout='300000ms';
set local idle_in_transaction_session_timeout='60000ms';
select platform.acquire_migration_lock('app','00000000-0000-4000-8000-00000000da01'::uuid);
create table semantic.semantic_candidate_self_publish_idempotency (
  app_id uuid not null,
  tenant_id uuid not null,
  environment text not null,
  semantic_domain text not null,
  principal_id uuid not null,
  idempotency_key uuid not null,
  command_hash text not null check (command_hash~'^sha256:[0-9a-f]{64}$'),
  candidate_id uuid not null,
  candidate_revision_id uuid not null,
  release_id uuid not null,
  result_json jsonb not null check (pg_catalog.jsonb_typeof(result_json)='object'),
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  primary key (app_id,tenant_id,environment,semantic_domain,principal_id,idempotency_key),
  foreign key (app_id,tenant_id,environment,semantic_domain,release_id)
    references semantic.semantic_source_release(app_id,tenant_id,environment,semantic_domain,release_id)
);

alter table semantic.semantic_candidate_self_publish_idempotency enable row level security;
alter table semantic.semantic_candidate_self_publish_idempotency force row level security;
alter table semantic.semantic_candidate_self_publish_idempotency owner to data_agent_u6_data_owner;
create policy semantic_candidate_self_publish_idempotency_scope
  on semantic.semantic_candidate_self_publish_idempotency for all to data_agent_u6_rpc_owner
  using (app_id=nullif(pg_catalog.current_setting('data_agent.app_id',true),'')::uuid
    and tenant_id=nullif(pg_catalog.current_setting('data_agent.tenant_id',true),'')::uuid
    and environment=nullif(pg_catalog.current_setting('data_agent.environment',true),'')
    and semantic_domain=nullif(pg_catalog.current_setting('app.semantic_domain',true),''))
  with check (app_id=nullif(pg_catalog.current_setting('data_agent.app_id',true),'')::uuid
    and tenant_id=nullif(pg_catalog.current_setting('data_agent.tenant_id',true),'')::uuid
    and environment=nullif(pg_catalog.current_setting('data_agent.environment',true),'')
    and semantic_domain=nullif(pg_catalog.current_setting('app.semantic_domain',true),''));
create function semantic.self_review_and_publish_semantic_candidate(p_command jsonb)
returns jsonb language plpgsql volatile security definer set search_path='' as $function$
declare scope_value jsonb; app_id_value uuid; tenant_id_value uuid; environment_value text;
  domain_value text; principal_value uuid; candidate_record semantic.semantic_candidate%rowtype;
  revision_record semantic.semantic_candidate_revision%rowtype;
  source_record semantic.semantic_source_revision%rowtype;
  pointer_record semantic.semantic_active_pointer%rowtype;
  dependency_record semantic.semantic_dependency_pointer%rowtype;
  existing_record semantic.semantic_candidate_self_publish_idempotency%rowtype;
  packet_id_value uuid:=extensions.gen_random_uuid(); decision_id_value uuid:=extensions.gen_random_uuid();
  attempt_id_value uuid:=extensions.gen_random_uuid(); release_id_value uuid:=extensions.gen_random_uuid();
  release_generation_value bigint; release_digest_value text; decision_digest_value text;
  datasource_id_value uuid; result_value jsonb; evidence_value jsonb;
  published_at_value timestamptz:=pg_catalog.clock_timestamp();
begin
  if p_command is null or pg_catalog.jsonb_typeof(p_command)<>'object'
    or p_command-array[
      'schema_version','command_id','scope','semantic_domain','principal_id','candidate_id',
      'candidate_revision_id','revision_number','source_revision_id','source_graph_digest',
      'base_release_id','graph_projection_id','graph_projection','executable_projection_id',
      'executable_projection_hash','executable_projection','relationship_projection_id',
      'relationship_projection_hash','relationship_projection','runtime_restriction_projection_id',
      'runtime_restriction_projection_hash','runtime_restriction_projection','compiler_bundle_digest',
      'review_reason','idempotency_key','reviewed_at','command_hash'
    ]<>'{}'::jsonb
    or p_command->>'schema_version'<>'semantic-candidate-self-publish-command@1.0.0'
    or p_command->>'command_hash'<>platform.canonical_sha256(p_command-'command_hash')
    or p_command->>'source_graph_digest'<>p_command#>>'{graph_projection,source_digest}'
    or p_command->>'executable_projection_hash'<>platform.canonical_sha256(p_command->'executable_projection')
    or p_command->>'relationship_projection_hash'<>platform.canonical_sha256(p_command->'relationship_projection')
    or p_command->>'runtime_restriction_projection_hash'<>
      platform.canonical_sha256(p_command->'runtime_restriction_projection')
    or p_command->>'compiler_bundle_digest'<>p_command#>>'{executable_projection,sourceDigest}'
    or p_command->>'compiler_bundle_digest'<>p_command#>>'{relationship_projection,sourceDigest}'
    or p_command->>'compiler_bundle_digest'<>p_command#>>'{runtime_restriction_projection,sourceDigest}'
    or pg_catalog.length(p_command->>'review_reason') not between 1 and 2048
  then raise exception using errcode='22023',message='SEMANTIC_CANDIDATE_SELF_PUBLISH_INVALID'; end if;
  scope_value:=p_command->'scope'; app_id_value:=(scope_value->>'app_id')::uuid;
  tenant_id_value:=(scope_value->>'tenant_id')::uuid; environment_value:=scope_value->>'environment';
  domain_value:=p_command->>'semantic_domain'; principal_value:=(p_command->>'principal_id')::uuid;
  perform semantic.assert_explorer_scope(app_id_value,tenant_id_value,environment_value,principal_value,domain_value);
  if nullif(pg_catalog.current_setting('data_agent.role',true),'') is distinct from 'owner' then
    raise exception using errcode='42501',message='SEMANTIC_CANDIDATE_SELF_PUBLISH_OWNER_REQUIRED';
  end if;
  perform semantic.lock_semantic_authority_fence(app_id_value,tenant_id_value,environment_value,domain_value);
  select item.* into existing_record from semantic.semantic_candidate_self_publish_idempotency item
  where item.app_id=app_id_value and item.tenant_id=tenant_id_value
    and item.environment=environment_value and item.semantic_domain=domain_value
    and item.principal_id=principal_value and item.idempotency_key=(p_command->>'idempotency_key')::uuid;
  if found then
    if existing_record.command_hash<>p_command->>'command_hash' then
      raise exception using errcode='23505',message='SEMANTIC_CANDIDATE_SELF_PUBLISH_CONFLICT';
    end if;
    return pg_catalog.jsonb_set(existing_record.result_json,'{disposition}','"REPLAYED"'::jsonb);
  end if;
  select candidate.* into candidate_record from semantic.semantic_candidate candidate
  where candidate.app_id=app_id_value and candidate.tenant_id=tenant_id_value
    and candidate.environment=environment_value and candidate.semantic_domain=domain_value
    and candidate.candidate_id=(p_command->>'candidate_id')::uuid
    and candidate.current_revision_id=(p_command->>'candidate_revision_id')::uuid
    and candidate.proposer_principal=principal_value::text and candidate.candidate_status='DRAFT'
  for update;
  if not found then raise exception using errcode='42501',message='SEMANTIC_CANDIDATE_SELF_PUBLISH_FORBIDDEN'; end if;
  select revision.* into revision_record from semantic.semantic_candidate_revision revision
  where revision.app_id=candidate_record.app_id and revision.tenant_id=candidate_record.tenant_id
    and revision.environment=candidate_record.environment and revision.semantic_domain=candidate_record.semantic_domain
    and revision.candidate_id=candidate_record.candidate_id and revision.revision_id=candidate_record.current_revision_id
    and revision.revision_number=(p_command->>'revision_number')::integer
    and revision.source_revision_id=(p_command->>'source_revision_id')::uuid;
  if not found or revision_record.revision_payload->>'source_graph_digest'<>p_command->>'source_graph_digest'
    or revision_record.revision_payload->>'base_release_id'<>p_command->>'base_release_id'
  then raise exception using errcode='40001',message='SEMANTIC_CANDIDATE_SELF_PUBLISH_STALE'; end if;
  select source.* into source_record from semantic.semantic_source_revision source
  where source.app_id=revision_record.app_id and source.tenant_id=revision_record.tenant_id
    and source.environment=revision_record.environment and source.semantic_domain=revision_record.semantic_domain
    and source.revision_id=revision_record.source_revision_id
    and source.source_payload=revision_record.revision_payload->'source_graph';
  if not found then raise exception using errcode='40001',message='SEMANTIC_CANDIDATE_SELF_PUBLISH_SOURCE_MISMATCH'; end if;
  select pointer.* into pointer_record from semantic.semantic_active_pointer pointer
  where pointer.app_id=app_id_value and pointer.tenant_id=tenant_id_value
    and pointer.environment=environment_value and pointer.semantic_domain=domain_value for update;
  if not found or pointer_record.current_release_id<>(p_command->>'base_release_id')::uuid then
    raise exception using errcode='40001',message='SEMANTIC_CANDIDATE_SELF_PUBLISH_STALE_BASE';
  end if;
  select dependency.* into dependency_record from semantic.semantic_dependency_pointer dependency
  where dependency.app_id=app_id_value and dependency.tenant_id=tenant_id_value
    and dependency.environment=environment_value and dependency.semantic_domain=domain_value;
  if not found then raise exception using errcode='P0001',message='SEMANTIC_DEPENDENCY_POINTER_MISSING'; end if;
  select registry.datasource_id into datasource_id_value from semantic.semantic_domain_registry registry
  where registry.app_id=app_id_value and registry.tenant_id=tenant_id_value
    and registry.environment=environment_value and registry.semantic_domain=domain_value and registry.is_active;
  if not found then raise exception using errcode='P0001',message='SEMANTIC_DOMAIN_NOT_ACTIVE'; end if;
  perform semantic.commit_semantic_graph_projection(
    app_id_value,tenant_id_value,environment_value,principal_value,domain_value,
    (p_command->>'graph_projection_id')::uuid,source_record.revision_id,p_command->'graph_projection'
  );
  decision_digest_value:=semantic.semantic_sha256(packet_id_value::text||principal_value::text,
    pg_catalog.jsonb_build_object('decision','APPROVE','revision_digest',revision_record.revision_digest));
  insert into semantic.semantic_review_task(
    app_id,tenant_id,environment,semantic_domain,packet_id,packet_kind,approval_mode,
    packet_digest,packet_payload,candidate_id,decision_window_status,review_outcome,
    decision_expires_at,publish_expires_at,quorum_rules_snapshot,veto_rules_snapshot,
    exclusion_set,created_by,closed_at
  ) values (
    app_id_value,tenant_id_value,environment_value,domain_value,packet_id_value,'CANDIDATE_REVIEW','HUMAN_REVIEW',
    semantic.semantic_sha256(packet_id_value::text,p_command-'graph_projection'-'executable_projection'-
      'relationship_projection'-'runtime_restriction_projection'),
    pg_catalog.jsonb_build_object(
      'schema_version','semantic-explicit-revision-review@1.0.0','candidate_revision_id',revision_record.revision_id,
      'revision_number',revision_record.revision_number,'revision_digest',revision_record.revision_digest,
      'source_graph_digest',p_command->>'source_graph_digest','base_release_id',p_command->>'base_release_id',
      'review_reason',p_command->>'review_reason','self_review',true
    ),candidate_record.candidate_id,'CLOSED','APPROVED',published_at_value,published_at_value+interval '7 days',
    pg_catalog.jsonb_build_object('required_approvals',1,'min_reviewers',1,'self_review_allowed',true),
    pg_catalog.jsonb_build_object('min_veto_count',1),'[]'::jsonb,principal_value::text,published_at_value
  );
  insert into semantic.semantic_review_decision(
    app_id,tenant_id,environment,semantic_domain,packet_id,decision_id,principal,semantic_role,
    decision,decision_reason,decision_digest
  ) values (
    app_id_value,tenant_id_value,environment_value,domain_value,packet_id_value,decision_id_value,
    principal_value::text,'admin_reviewer','APPROVE',p_command->>'review_reason',decision_digest_value
  );
  release_generation_value:=pointer_record.current_release_generation+1;
  release_digest_value:=semantic.semantic_sha256(release_id_value::text,
    pg_catalog.jsonb_build_object(
      'candidate_revision_id',revision_record.revision_id,'revision_digest',revision_record.revision_digest,
      'source_graph_digest',p_command->>'source_graph_digest','generation',release_generation_value
    ));
  insert into semantic.semantic_publish_attempt(
    app_id,tenant_id,environment,semantic_domain,attempt_id,packet_id,candidate_id,attempt_state,
    approval_mode,compiler_bundle_digest,catalog_fence_epoch,dependency_generation,
    executable_projection_ref,executable_projection_hash,relationship_projection_ref,
    relationship_projection_hash,runtime_restriction_projection_ref,runtime_restriction_projection_hash,
    target_generation,idempotency_digest,committed_release_ref
  ) values (
    app_id_value,tenant_id_value,environment_value,domain_value,attempt_id_value,packet_id_value,
    candidate_record.candidate_id,'COMMITTED','HUMAN_REVIEW',p_command->>'compiler_bundle_digest',
    dependency_record.current_catalog_epoch,dependency_record.pointer_generation,
    (p_command->>'executable_projection_id')::uuid,p_command->>'executable_projection_hash',
    (p_command->>'relationship_projection_id')::uuid,p_command->>'relationship_projection_hash',
    (p_command->>'runtime_restriction_projection_id')::uuid,p_command->>'runtime_restriction_projection_hash',
    release_generation_value,p_command->>'command_hash',release_id_value
  );
  insert into semantic.semantic_source_release(
    app_id,tenant_id,environment,semantic_domain,release_id,release_generation,attempt_id,packet_id,
    candidate_id,release_digest,compiler_bundle_digest,executable_projection_ref,executable_projection_hash,
    relationship_projection_ref,relationship_projection_hash,runtime_restriction_projection_ref,
    runtime_restriction_projection_hash,profile_child_manifest,quorum_snapshot,decision_set_digest,
    published_at,published_by,approval_mode
  ) values (
    app_id_value,tenant_id_value,environment_value,domain_value,release_id_value,release_generation_value,
    attempt_id_value,packet_id_value,candidate_record.candidate_id,release_digest_value,
    p_command->>'compiler_bundle_digest',(p_command->>'executable_projection_id')::uuid,
    p_command->>'executable_projection_hash',(p_command->>'relationship_projection_id')::uuid,
    p_command->>'relationship_projection_hash',(p_command->>'runtime_restriction_projection_id')::uuid,
    p_command->>'runtime_restriction_projection_hash',pg_catalog.jsonb_build_object(
      'candidate_revision_id',revision_record.revision_id,'source_graph_digest',p_command->>'source_graph_digest',
      'graph_projection_id',p_command->>'graph_projection_id'),
    pg_catalog.jsonb_build_object('required_approvals',1,'approvals',1,'self_review_allowed',true),
    decision_digest_value,published_at_value,principal_value::text,'HUMAN_REVIEW'
  );
  insert into semantic.semantic_executable_projection(
    app_id,tenant_id,environment,semantic_domain,projection_id,release_id,projection_digest,projection_payload
  ) values (app_id_value,tenant_id_value,environment_value,domain_value,
    (p_command->>'executable_projection_id')::uuid,release_id_value,
    p_command->>'executable_projection_hash',p_command->'executable_projection');
  insert into semantic.semantic_relationship_projection(
    app_id,tenant_id,environment,semantic_domain,projection_id,release_id,datasource_id,catalog_epoch,
    projection_digest,projection_payload
  ) values (app_id_value,tenant_id_value,environment_value,domain_value,
    (p_command->>'relationship_projection_id')::uuid,release_id_value,datasource_id_value,
    dependency_record.current_catalog_epoch,p_command->>'relationship_projection_hash',
    p_command->'relationship_projection');
  insert into semantic.semantic_runtime_restriction_projection(
    app_id,tenant_id,environment,semantic_domain,projection_id,release_id,projection_digest,
    platform_policy_digest,compiler_bundle_digest,pointer_generation,restriction_payload
  ) values (app_id_value,tenant_id_value,environment_value,domain_value,
    (p_command->>'runtime_restriction_projection_id')::uuid,release_id_value,
    p_command->>'runtime_restriction_projection_hash',dependency_record.current_closure_policy_digest,
    p_command->>'compiler_bundle_digest',pointer_record.pointer_generation+1,
    p_command->'runtime_restriction_projection');
  perform semantic.bind_semantic_graph_release(
    app_id_value,tenant_id_value,environment_value,principal_value,domain_value,
    release_id_value,(p_command->>'graph_projection_id')::uuid
  );
  update semantic.semantic_candidate set candidate_status='PUBLISHED',updated_at=published_at_value
  where app_id=app_id_value and tenant_id=tenant_id_value and environment=environment_value
    and semantic_domain=domain_value and candidate_id=candidate_record.candidate_id;
  update semantic.semantic_active_pointer set current_release_id=release_id_value,
    current_release_generation=release_generation_value,current_release_digest=release_digest_value,
    pointer_generation=pointer_generation+1,updated_at=published_at_value,updated_by=principal_value::text
  where app_id=app_id_value and tenant_id=tenant_id_value and environment=environment_value
    and semantic_domain=domain_value and current_release_id=pointer_record.current_release_id
    and pointer_generation=pointer_record.pointer_generation;
  if not found then raise exception using errcode='40001',message='SEMANTIC_CANDIDATE_SELF_PUBLISH_STALE_BASE'; end if;
  update semantic.semantic_runtime_activation set current_release_id=release_id_value,
    current_release_generation=release_generation_value,updated_at=published_at_value
  where app_id=app_id_value and tenant_id=tenant_id_value and environment=environment_value
    and semantic_domain=domain_value;
  if not found then
    raise exception using errcode='P0001',message='SEMANTIC_RUNTIME_ACTIVATION_REQUIRED';
  end if;
  for evidence_value in select value from pg_catalog.jsonb_array_elements(
    coalesce(revision_record.revision_payload->'evidence_selection_refs','[]'::jsonb)
  ) loop
    insert into app_data_agent.knowledge_semantic_usage_references(
      app_id,tenant_id,environment,usage_id,selection_id,selection_hash,semantic_domain,
      usage_kind,subject_id,subject_revision,subject_hash,created_by_principal_id
    ) values (
      app_id_value,tenant_id_value,environment_value,extensions.gen_random_uuid(),
      (evidence_value->>'selection_id')::uuid,evidence_value->>'selection_hash',domain_value,
      'PUBLISHED_SEMANTIC_OBJECT',release_id_value,release_generation_value,
      release_digest_value,principal_value
    );
  end loop;
  insert into app_data_agent.audit_log(
    app_id,tenant_id,environment,audit_id,principal_id,action,resource_type,resource_id,details
  ) values (
    app_id_value,tenant_id_value,environment_value,extensions.gen_random_uuid(),principal_value,
    'SEMANTIC_CANDIDATE_SELF_REVIEW_APPROVED','semantic_review_decision',decision_id_value::text,
    pg_catalog.jsonb_build_object('packet_id',packet_id_value,'candidate_id',candidate_record.candidate_id,
      'candidate_revision_id',revision_record.revision_id,'decision_digest',decision_digest_value)
  ),(
    app_id_value,tenant_id_value,environment_value,extensions.gen_random_uuid(),principal_value,
    'SEMANTIC_RELEASE_PUBLISHED','semantic_source_release',release_id_value::text,
    pg_catalog.jsonb_build_object('packet_id',packet_id_value,'candidate_id',candidate_record.candidate_id,
      'candidate_revision_id',revision_record.revision_id,'release_generation',release_generation_value,
      'release_digest',release_digest_value,'graph_projection_id',p_command->>'graph_projection_id')
  );
  result_value:=pg_catalog.jsonb_build_object(
    'schema_version','semantic-candidate-self-publish-result@1.0.0','disposition','PUBLISHED',
    'candidate_id',candidate_record.candidate_id,'candidate_revision_id',revision_record.revision_id,
    'packet_id',packet_id_value,'decision_id',decision_id_value,'publish_attempt_id',attempt_id_value,
    'release_id',release_id_value,'release_generation',release_generation_value,
    'release_digest',release_digest_value,'graph_projection_id',p_command->>'graph_projection_id',
    'source_graph_digest',p_command->>'source_graph_digest','reviewed_at',p_command->>'reviewed_at',
    'published_at',published_at_value
  );
  insert into semantic.semantic_candidate_self_publish_idempotency(
    app_id,tenant_id,environment,semantic_domain,principal_id,idempotency_key,command_hash,
    candidate_id,candidate_revision_id,release_id,result_json
  ) values (
    app_id_value,tenant_id_value,environment_value,domain_value,principal_value,
    (p_command->>'idempotency_key')::uuid,p_command->>'command_hash',candidate_record.candidate_id,
    revision_record.revision_id,release_id_value,result_value
  );
  return result_value;
exception when invalid_text_representation or numeric_value_out_of_range or datetime_field_overflow then
  raise exception using errcode='22023',message='SEMANTIC_CANDIDATE_SELF_PUBLISH_INVALID';
end
$function$;
-- Preserve the bootstrap package readers, then add exact Graph-v2 release fallbacks.
alter function app_data_agent.resolved_context_metric_projection(uuid,uuid,text,text,uuid)
  rename to resolved_context_metric_projection_initial;
alter function app_data_agent.resolved_context_ontology_projection(uuid,uuid,text,text,uuid)
  rename to resolved_context_ontology_projection_initial;
alter function app_data_agent.resolved_context_relationship_projection(uuid,uuid,text,text,uuid)
  rename to resolved_context_relationship_projection_initial;

create function app_data_agent.resolved_context_metric_projection(
  p_app_id uuid,p_tenant_id uuid,p_environment text,p_semantic_domain text,p_release_id uuid
) returns jsonb language plpgsql stable set search_path='' as $function$
declare initial_value jsonb;
begin
  initial_value:=app_data_agent.resolved_context_metric_projection_initial(
    p_app_id,p_tenant_id,p_environment,p_semantic_domain,p_release_id
  );
  if pg_catalog.jsonb_array_length(initial_value)>0 then return initial_value; end if;
  return coalesce((
    select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
      'metric_id',metric.value->>'metric_id','name',metric.value->>'name',
      'aliases',coalesce(metric.value->'aliases','[]'::jsonb),
      'mapping_refs',coalesce((select pg_catalog.jsonb_agg(to_jsonb(reference.value) order by reference.value)
        from (select distinct item.value#>>'{}' value
          from pg_catalog.jsonb_array_elements(
            pg_catalog.jsonb_build_array(metric.value->>'column_id')||
              coalesce(metric.value->'dependency_column_ids','[]'::jsonb)
          ) item(value) where item.value#>>'{}' is not null) reference),'[]'::jsonb),
      'mapping_hash',app_data_agent.u2_canonical_sha256(metric.value),
      'formula_hash',app_data_agent.u2_canonical_sha256(coalesce(metric.value->'formula','null'::jsonb))
    ) order by metric.value->>'metric_id')
    from semantic.semantic_source_release release
    join semantic.semantic_executable_projection projection
      on projection.app_id=release.app_id and projection.tenant_id=release.tenant_id
      and projection.environment=release.environment and projection.semantic_domain=release.semantic_domain
      and projection.release_id=release.release_id and projection.projection_id=release.executable_projection_ref
      and projection.projection_digest=release.executable_projection_hash
    cross join lateral pg_catalog.jsonb_array_elements(
      coalesce(projection.projection_payload->'metrics','[]'::jsonb)
    ) metric(value)
    where release.app_id=p_app_id and release.tenant_id=p_tenant_id
      and release.environment=p_environment and release.semantic_domain=p_semantic_domain
      and release.release_id=p_release_id
  ),'[]'::jsonb);
end
$function$;

create function app_data_agent.resolved_context_ontology_projection(
  p_app_id uuid,p_tenant_id uuid,p_environment text,p_semantic_domain text,p_release_id uuid
) returns jsonb language plpgsql stable set search_path='' as $function$
declare initial_value jsonb;
begin
  initial_value:=app_data_agent.resolved_context_ontology_projection_initial(
    p_app_id,p_tenant_id,p_environment,p_semantic_domain,p_release_id
  );
  if pg_catalog.jsonb_array_length(initial_value)>0 then return initial_value; end if;
  return coalesce((
    select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
      'object_id',node.value->>'node_id',
      'object_kind',case node.value->>'node_type' when 'BUSINESS_SUBJECT' then 'ENTITY'
        when 'GLOSSARY_TERM' then 'TERM' else 'DIMENSION' end,
      'name',node.value->>'name','aliases',coalesce(node.value->'aliases','[]'::jsonb),
      'queryable',dimension.value is not null,
      'mapping_refs',case when dimension.value is null then '[]'::jsonb
        else pg_catalog.jsonb_build_array(dimension.value->>'column_id') end,
      'object_hash',app_data_agent.u2_canonical_sha256(node.value)
    ) order by node.value->>'node_id')
    from semantic.semantic_source_release release
    join semantic.semantic_source_release_graph_projection binding
      on binding.app_id=release.app_id and binding.tenant_id=release.tenant_id
      and binding.environment=release.environment and binding.semantic_domain=release.semantic_domain
      and binding.release_id=release.release_id
    join semantic.semantic_graph_projection graph
      on graph.app_id=binding.app_id and graph.tenant_id=binding.tenant_id
      and graph.environment=binding.environment and graph.semantic_domain=binding.semantic_domain
      and graph.projection_id=binding.projection_id
    join semantic.semantic_executable_projection executable
      on executable.app_id=release.app_id and executable.tenant_id=release.tenant_id
      and executable.environment=release.environment and executable.semantic_domain=release.semantic_domain
      and executable.release_id=release.release_id and executable.projection_id=release.executable_projection_ref
      and executable.projection_digest=release.executable_projection_hash
    cross join lateral pg_catalog.jsonb_array_elements(graph.projection_payload->'nodes') node(value)
    left join lateral (
      select item.value from pg_catalog.jsonb_array_elements(
        coalesce(executable.projection_payload->'dimensions','[]'::jsonb)
      ) item(value) where item.value->>'dimension_id'=node.value->>'node_id' limit 1
    ) dimension on true
    where release.app_id=p_app_id and release.tenant_id=p_tenant_id
      and release.environment=p_environment and release.semantic_domain=p_semantic_domain
      and release.release_id=p_release_id and node.value->>'lifecycle'='ACTIVE'
      and node.value->>'node_type' in ('BUSINESS_SUBJECT','DIMENSION','GLOSSARY_TERM')
  ),'[]'::jsonb);
end
$function$;

create function app_data_agent.resolved_context_relationship_projection(
  p_app_id uuid,p_tenant_id uuid,p_environment text,p_semantic_domain text,p_release_id uuid
) returns jsonb language plpgsql stable set search_path='' as $function$
declare initial_value jsonb;
begin
  initial_value:=app_data_agent.resolved_context_relationship_projection_initial(
    p_app_id,p_tenant_id,p_environment,p_semantic_domain,p_release_id
  );
  if pg_catalog.jsonb_array_length(initial_value)>0 then return initial_value; end if;
  return coalesce((
    select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
      'relationship_id',edge.value->>'edge_id','source_object_id',edge.value->>'source_node_id',
      'target_object_id',edge.value->>'target_node_id','relationship_kind',edge.value->>'edge_type',
      'relationship_hash',app_data_agent.u2_canonical_sha256(edge.value)
    ) order by edge.value->>'edge_id')
    from semantic.semantic_source_release release
    join semantic.semantic_source_release_graph_projection binding
      on binding.app_id=release.app_id and binding.tenant_id=release.tenant_id
      and binding.environment=release.environment and binding.semantic_domain=release.semantic_domain
      and binding.release_id=release.release_id
    join semantic.semantic_graph_projection graph
      on graph.app_id=binding.app_id and graph.tenant_id=binding.tenant_id
      and graph.environment=binding.environment and graph.semantic_domain=binding.semantic_domain
      and graph.projection_id=binding.projection_id
    cross join lateral pg_catalog.jsonb_array_elements(graph.projection_payload->'edges') edge(value)
    where release.app_id=p_app_id and release.tenant_id=p_tenant_id
      and release.environment=p_environment and release.semantic_domain=p_semantic_domain
      and release.release_id=p_release_id and edge.value->>'lifecycle'='ACTIVE'
  ),'[]'::jsonb);
end
$function$;
grant usage on schema semantic,app_data_agent,platform,extensions to data_agent_u5_self_publish_owner;
grant select,insert on semantic.semantic_candidate_self_publish_idempotency
  to data_agent_u5_self_publish_owner;
grant select,update on semantic.semantic_candidate,
  semantic.semantic_active_pointer,semantic.semantic_runtime_activation
  to data_agent_u5_self_publish_owner;
grant select on semantic.semantic_candidate_revision,semantic.semantic_source_revision,
  semantic.semantic_dependency_pointer,semantic.semantic_domain_registry
  to data_agent_u5_self_publish_owner;
grant select,insert on semantic.semantic_review_task,semantic.semantic_review_decision,
  semantic.semantic_publish_attempt,semantic.semantic_source_release,
  semantic.semantic_executable_projection,semantic.semantic_relationship_projection,
  semantic.semantic_runtime_restriction_projection
  to data_agent_u5_self_publish_owner;
grant insert on app_data_agent.knowledge_semantic_usage_references,app_data_agent.audit_log
  to data_agent_u5_self_publish_owner;

grant execute on function semantic.assert_explorer_scope(uuid,uuid,text,uuid,text),
  semantic.lock_semantic_authority_fence(uuid,uuid,text,text),
  semantic.commit_semantic_graph_projection(uuid,uuid,text,uuid,text,uuid,uuid,jsonb),
  semantic.bind_semantic_graph_release(uuid,uuid,text,uuid,text,uuid,uuid),
  semantic.semantic_sha256(text,jsonb),platform.canonical_sha256(jsonb),
  platform.backend_context_matches(uuid,uuid,text,boolean),
  app_data_agent.runtime_canonical_json(jsonb),
  app_data_agent.contains_potential_plaintext_secret(jsonb,text)
  to data_agent_u5_self_publish_owner;

create policy semantic_candidate_self_publish_owner_scope
  on semantic.semantic_candidate_self_publish_idempotency for all
  to data_agent_u5_self_publish_owner
  using (platform.backend_context_matches(app_id,tenant_id,environment,false)
    and semantic_domain=nullif(pg_catalog.current_setting('app.semantic_domain',true),''))
  with check (platform.backend_context_matches(app_id,tenant_id,environment,true)
    and semantic_domain=nullif(pg_catalog.current_setting('app.semantic_domain',true),''));
create policy semantic_candidate_self_publish_candidate_scope on semantic.semantic_candidate
  for all to data_agent_u5_self_publish_owner
  using (platform.backend_context_matches(app_id,tenant_id,environment,false)
    and semantic_domain=nullif(pg_catalog.current_setting('app.semantic_domain',true),''))
  with check (platform.backend_context_matches(app_id,tenant_id,environment,true)
    and semantic_domain=nullif(pg_catalog.current_setting('app.semantic_domain',true),''));
create policy semantic_candidate_self_publish_revision_scope on semantic.semantic_candidate_revision
  for select to data_agent_u5_self_publish_owner
  using (platform.backend_context_matches(app_id,tenant_id,environment,false)
    and semantic_domain=nullif(pg_catalog.current_setting('app.semantic_domain',true),''));
create policy semantic_candidate_self_publish_source_scope on semantic.semantic_source_revision
  for select to data_agent_u5_self_publish_owner
  using (platform.backend_context_matches(app_id,tenant_id,environment,false)
    and semantic_domain=nullif(pg_catalog.current_setting('app.semantic_domain',true),''));
create policy semantic_candidate_self_publish_pointer_scope on semantic.semantic_active_pointer
  for all to data_agent_u5_self_publish_owner
  using (platform.backend_context_matches(app_id,tenant_id,environment,false)
    and semantic_domain=nullif(pg_catalog.current_setting('app.semantic_domain',true),''))
  with check (platform.backend_context_matches(app_id,tenant_id,environment,true)
    and semantic_domain=nullif(pg_catalog.current_setting('app.semantic_domain',true),''));
create policy semantic_candidate_self_publish_activation_scope on semantic.semantic_runtime_activation
  for all to data_agent_u5_self_publish_owner
  using (platform.backend_context_matches(app_id,tenant_id,environment,false)
    and semantic_domain=nullif(pg_catalog.current_setting('app.semantic_domain',true),''))
  with check (platform.backend_context_matches(app_id,tenant_id,environment,true)
    and semantic_domain=nullif(pg_catalog.current_setting('app.semantic_domain',true),''));
create policy semantic_candidate_self_publish_dependency_scope on semantic.semantic_dependency_pointer
  for select to data_agent_u5_self_publish_owner
  using (platform.backend_context_matches(app_id,tenant_id,environment,false)
    and semantic_domain=nullif(pg_catalog.current_setting('app.semantic_domain',true),''));
create policy semantic_candidate_self_publish_domain_scope on semantic.semantic_domain_registry
  for select to data_agent_u5_self_publish_owner
  using (platform.backend_context_matches(app_id,tenant_id,environment,false)
    and semantic_domain=nullif(pg_catalog.current_setting('app.semantic_domain',true),''));
create policy semantic_candidate_self_publish_review_task_scope on semantic.semantic_review_task
  for all to data_agent_u5_self_publish_owner
  using (platform.backend_context_matches(app_id,tenant_id,environment,false)
    and semantic_domain=nullif(pg_catalog.current_setting('app.semantic_domain',true),''))
  with check (platform.backend_context_matches(app_id,tenant_id,environment,true)
    and semantic_domain=nullif(pg_catalog.current_setting('app.semantic_domain',true),''));
create policy semantic_candidate_self_publish_decision_scope on semantic.semantic_review_decision
  for all to data_agent_u5_self_publish_owner
  using (platform.backend_context_matches(app_id,tenant_id,environment,false)
    and semantic_domain=nullif(pg_catalog.current_setting('app.semantic_domain',true),''))
  with check (platform.backend_context_matches(app_id,tenant_id,environment,true)
    and semantic_domain=nullif(pg_catalog.current_setting('app.semantic_domain',true),''));
create policy semantic_candidate_self_publish_attempt_scope on semantic.semantic_publish_attempt
  for all to data_agent_u5_self_publish_owner
  using (platform.backend_context_matches(app_id,tenant_id,environment,false)
    and semantic_domain=nullif(pg_catalog.current_setting('app.semantic_domain',true),''))
  with check (platform.backend_context_matches(app_id,tenant_id,environment,true)
    and semantic_domain=nullif(pg_catalog.current_setting('app.semantic_domain',true),''));
create policy semantic_candidate_self_publish_release_scope on semantic.semantic_source_release
  for all to data_agent_u5_self_publish_owner
  using (platform.backend_context_matches(app_id,tenant_id,environment,false)
    and semantic_domain=nullif(pg_catalog.current_setting('app.semantic_domain',true),''))
  with check (platform.backend_context_matches(app_id,tenant_id,environment,true)
    and semantic_domain=nullif(pg_catalog.current_setting('app.semantic_domain',true),''));
create policy semantic_candidate_self_publish_executable_scope on semantic.semantic_executable_projection
  for all to data_agent_u5_self_publish_owner
  using (platform.backend_context_matches(app_id,tenant_id,environment,false)
    and semantic_domain=nullif(pg_catalog.current_setting('app.semantic_domain',true),''))
  with check (platform.backend_context_matches(app_id,tenant_id,environment,true)
    and semantic_domain=nullif(pg_catalog.current_setting('app.semantic_domain',true),''));
create policy semantic_candidate_self_publish_relationship_scope on semantic.semantic_relationship_projection
  for all to data_agent_u5_self_publish_owner
  using (platform.backend_context_matches(app_id,tenant_id,environment,false)
    and semantic_domain=nullif(pg_catalog.current_setting('app.semantic_domain',true),''))
  with check (platform.backend_context_matches(app_id,tenant_id,environment,true)
    and semantic_domain=nullif(pg_catalog.current_setting('app.semantic_domain',true),''));
create policy semantic_candidate_self_publish_restriction_scope
  on semantic.semantic_runtime_restriction_projection for all
  to data_agent_u5_self_publish_owner
  using (platform.backend_context_matches(app_id,tenant_id,environment,false)
    and semantic_domain=nullif(pg_catalog.current_setting('app.semantic_domain',true),''))
  with check (platform.backend_context_matches(app_id,tenant_id,environment,true)
    and semantic_domain=nullif(pg_catalog.current_setting('app.semantic_domain',true),''));
create policy semantic_candidate_self_publish_usage_scope
  on app_data_agent.knowledge_semantic_usage_references for insert
  to data_agent_u5_self_publish_owner
  with check (platform.backend_context_matches(app_id,tenant_id,environment,true)
    and semantic_domain=nullif(pg_catalog.current_setting('app.semantic_domain',true),''));
create policy semantic_candidate_self_publish_audit_scope on app_data_agent.audit_log
  for insert to data_agent_u5_self_publish_owner
  with check (platform.backend_context_matches(app_id,tenant_id,environment,true));

grant select on semantic.semantic_graph_projection,
  semantic.semantic_source_release_graph_projection,
  semantic.semantic_executable_projection
to data_agent_u12_context_owner;
create policy semantic_graph_projection_u12_select on semantic.semantic_graph_projection
  for select to data_agent_u12_context_owner
  using (platform.backend_context_matches(app_id,tenant_id,environment,false));
create policy semantic_release_graph_projection_u12_select on semantic.semantic_source_release_graph_projection
  for select to data_agent_u12_context_owner
  using (platform.backend_context_matches(app_id,tenant_id,environment,false));
create policy semantic_executable_projection_u12_select on semantic.semantic_executable_projection
  for select to data_agent_u12_context_owner
  using (platform.backend_context_matches(app_id,tenant_id,environment,false));

alter function semantic.self_review_and_publish_semantic_candidate(jsonb)
  owner to data_agent_u5_self_publish_owner;
alter function app_data_agent.resolved_context_metric_projection_initial(uuid,uuid,text,text,uuid)
  owner to data_agent_u12_context_owner;
alter function app_data_agent.resolved_context_ontology_projection_initial(uuid,uuid,text,text,uuid)
  owner to data_agent_u12_context_owner;
alter function app_data_agent.resolved_context_relationship_projection_initial(uuid,uuid,text,text,uuid)
  owner to data_agent_u12_context_owner;
alter function app_data_agent.resolved_context_metric_projection(uuid,uuid,text,text,uuid)
  owner to data_agent_u12_context_owner;
alter function app_data_agent.resolved_context_ontology_projection(uuid,uuid,text,text,uuid)
  owner to data_agent_u12_context_owner;
alter function app_data_agent.resolved_context_relationship_projection(uuid,uuid,text,text,uuid)
  owner to data_agent_u12_context_owner;

revoke all on semantic.semantic_candidate_self_publish_idempotency
from public,anon,authenticated,service_role,data_agent_backend;
revoke all on function semantic.self_review_and_publish_semantic_candidate(jsonb)
from public,anon,authenticated,service_role,data_agent_backend;
grant execute on function semantic.self_review_and_publish_semantic_candidate(jsonb) to data_agent_backend;

do $postconditions$
begin
  if not (select relation.relrowsecurity and relation.relforcerowsecurity
    from pg_catalog.pg_class relation where relation.oid=
      'semantic.semantic_candidate_self_publish_idempotency'::regclass)
    or pg_catalog.has_table_privilege(
      'data_agent_backend','semantic.semantic_candidate_self_publish_idempotency','SELECT,INSERT,UPDATE,DELETE'
    )
    or not pg_catalog.has_function_privilege(
      'data_agent_backend','semantic.self_review_and_publish_semantic_candidate(jsonb)','EXECUTE'
    )
    or pg_catalog.has_function_privilege(
      'anon','semantic.self_review_and_publish_semantic_candidate(jsonb)','EXECUTE'
    )
    or exists(select 1 from pg_catalog.pg_roles where rolname='data_agent_u5_self_publish_owner'
      and (rolcanlogin or rolinherit or rolsuper or rolcreatedb or rolcreaterole
        or rolreplication or rolbypassrls))
    or not pg_catalog.has_table_privilege(
      'data_agent_u5_self_publish_owner','semantic.semantic_active_pointer','SELECT,UPDATE'
    )
    or pg_catalog.has_table_privilege(
      'data_agent_backend','semantic.semantic_candidate_self_publish_idempotency','SELECT,INSERT,UPDATE,DELETE'
    )
  then raise exception using errcode='P0001',message='SEMANTIC_SELF_PUBLISH_HARDENING_FAILED'; end if;
end
$postconditions$;
select platform.assert_migration_checksum(
  'app','00000000-0000-4000-8000-00000000da01'::uuid,
  '20260725010682_app_data_agent_semantic_self_publish',
  'sha256:fc5a300730469124d37d7bce35073e0395baf407934a5ec41ebb60604599050b'
);
commit;
