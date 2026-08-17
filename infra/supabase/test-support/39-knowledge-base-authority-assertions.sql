\set ON_ERROR_STOP on

do $surface$
declare relation_name text; definition text;
begin
  if not exists (
    select 1 from platform.migration_ledger
    where owner_kind='app' and app_id='00000000-0000-4000-8000-00000000da01'::uuid
      and migration_version='20260725010661_app_data_agent_knowledge_base'
  ) then raise exception 'KNOWLEDGE_LEDGER_MISSING'; end if;
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
    ) or pg_catalog.has_table_privilege(
      'data_agent_backend',pg_catalog.format('app_data_agent.%I',relation_name),'SELECT,INSERT,UPDATE,DELETE'
    ) then raise exception 'KNOWLEDGE_RELATION_SURFACE_INVALID:%',relation_name; end if;
  end loop;
  if exists (
    select 1 from pg_catalog.pg_roles where rolname='data_agent_u15_knowledge_owner'
      and (rolcanlogin or rolsuper or rolcreatedb or rolcreaterole or rolreplication or rolinherit or rolbypassrls)
  ) then raise exception 'KNOWLEDGE_OWNER_UNSAFE'; end if;
  if not exists (
    select 1 from app_data_agent.job_handler_revisions
    where kind='KNOWLEDGE_INDEX' and handler_revision='knowledge-index-handler@1.0.0'
      and enabled and dependencies_ready and output_receipt_required
  ) then raise exception 'KNOWLEDGE_HANDLER_MISSING'; end if;
  if pg_catalog.to_regprocedure('app_data_agent.create_knowledge_base(jsonb)') is null
    or pg_catalog.to_regprocedure('app_data_agent.list_knowledge_embedding_profiles(integer)') is null
    or pg_catalog.to_regprocedure('app_data_agent.rebuild_knowledge_base(jsonb)') is null
    or pg_catalog.to_regprocedure('app_data_agent.load_knowledge_index_target(jsonb)') is null
    or pg_catalog.to_regprocedure('app_data_agent.commit_knowledge_blocked_projection(jsonb,jsonb)') is null
    or pg_catalog.to_regprocedure('app_data_agent.stage_knowledge_generation(jsonb,jsonb)') is null
    or pg_catalog.to_regprocedure('app_data_agent.commit_knowledge_generation_ready(jsonb,jsonb)') is null
    or pg_catalog.to_regprocedure('app_data_agent.commit_knowledge_retrieval(jsonb,jsonb,text,text)') is null
  then raise exception 'KNOWLEDGE_RPC_SURFACE_INCOMPLETE'; end if;
  select pg_catalog.pg_get_functiondef(procedure.oid) into strict definition
  from pg_catalog.pg_proc procedure join pg_catalog.pg_namespace namespace on namespace.oid=procedure.pronamespace
  where namespace.nspname='app_data_agent' and procedure.proname='build_requested_optional_resource_bindings';
  if definition not like '%knowledge_build_resource_binding%'
  then raise exception 'KNOWLEDGE_EFFECTIVE_CONFIG_SUCCESSOR_MISSING'; end if;
end
$surface$;

begin;
insert into app_data_agent.workspaces(app_id,workspace_id,environment,slug,display_name)
values ('00000000-0000-4000-8000-00000000da01','00000000-0000-4000-8000-000000006701',
  'local','u15-knowledge-smoke','U15 Knowledge smoke');
insert into app_data_agent.memberships(
  app_id,tenant_id,environment,principal_id,membership_role,workspace_role,membership_source
) values ('00000000-0000-4000-8000-00000000da01','00000000-0000-4000-8000-000000006701',
  'local','00000000-0000-4000-8000-000000006702','owner','WORKSPACE_ADMIN','EXPLICIT');
insert into data_agent_auth."user"("id","name","email","emailVerified","username","displayUsername")
values ('00000000-0000-4000-8000-000000006702','U15 fixture','u15-fixture@example.invalid',true,
  'u15_fixture','u15_fixture');
insert into app_data_agent.app_users(
  app_id,environment,principal_id,auth_user_id,email,display_name,system_role
) values ('00000000-0000-4000-8000-00000000da01','local',
  '00000000-0000-4000-8000-000000006702','00000000-0000-4000-8000-000000006702',
  'u15-fixture@example.invalid','U15 fixture','USER');

insert into app_data_agent.workspace_content_blobs(
  app_id,tenant_id,environment,blob_hash,storage_key,byte_size,detected_mime,
  active_reference_count,status,created_at,updated_at
) values (
  '00000000-0000-4000-8000-00000000da01','00000000-0000-4000-8000-000000006701','local',
  'sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
  'workspace-content/u15-fixture.txt',15,'text/plain',1,'AVAILABLE',
  pg_catalog.clock_timestamp(),pg_catalog.clock_timestamp()
);
insert into app_data_agent.workspace_files(
  app_id,tenant_id,environment,file_id,owner_principal_id,current_revision,
  current_revision_hash,current_status,created_at,updated_at
) values (
  '00000000-0000-4000-8000-00000000da01','00000000-0000-4000-8000-000000006701','local',
  '00000000-0000-4000-8000-000000006703','00000000-0000-4000-8000-000000006702',1,
  'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa','READY',
  pg_catalog.clock_timestamp(),pg_catalog.clock_timestamp()
);
insert into app_data_agent.workspace_file_revisions(
  app_id,tenant_id,environment,file_id,revision,revision_hash,blob_hash,owner_principal_id,
  visibility,session_id,status,scan_receipt_id,deletion_receipt_id,revision_json,created_at
) values (
  '00000000-0000-4000-8000-00000000da01','00000000-0000-4000-8000-000000006701','local',
  '00000000-0000-4000-8000-000000006703',1,
  'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  'sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
  '00000000-0000-4000-8000-000000006702','WORKSPACE',null,'READY',null,null,
  pg_catalog.jsonb_build_object('byte_size',15,'detected_mime','text/plain'),pg_catalog.clock_timestamp()
);
create role data_agent_u15_behavior_session login inherit;
grant data_agent_backend to data_agent_u15_behavior_session with inherit true;
grant execute on function app_data_agent.u2_canonical_sha256(jsonb),app_data_agent.job_utc_millis(timestamptz)
to data_agent_u15_behavior_session;
grant execute on function app_data_agent.build_requested_optional_resource_bindings(jsonb)
to data_agent_u15_behavior_session;
set session authorization data_agent_u15_behavior_session;
select pg_catalog.set_config('data_agent.app_id','00000000-0000-4000-8000-00000000da01',true);
select pg_catalog.set_config('data_agent.tenant_id','00000000-0000-4000-8000-000000006701',true);
select pg_catalog.set_config('data_agent.environment','local',true);
select pg_catalog.set_config('data_agent.deployment_id','00000000-0000-4000-8000-000000000001',true);
select pg_catalog.set_config('data_agent.principal_id','00000000-0000-4000-8000-000000006702',true);
select pg_catalog.set_config('data_agent.role','owner',true);

do $behavior$
declare
  scope jsonb:=pg_catalog.jsonb_build_object(
    'app_id','00000000-0000-4000-8000-00000000da01',
    'tenant_id','00000000-0000-4000-8000-000000006701','environment','local'
  );
  file_ref jsonb:=pg_catalog.jsonb_build_object(
    'file_id','00000000-0000-4000-8000-000000006703','revision',1,
    'revision_hash','sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
  );
  profile jsonb; create_command jsonb; created jsonb; heartbeat jsonb; lease jsonb; target jsonb;
  projection jsonb; blocked_projection jsonb; chunk jsonb; stage jsonb; staged jsonb;
  checkpoint jsonb; ready_command jsonb;
  ready_generation jsonb;
  terminal jsonb; listed jsonb; bindings jsonb; query_projection jsonb; search_request jsonb;
  retrieval jsonb; defaults_command jsonb; defaults_result jsonb;
begin
  profile:=pg_catalog.jsonb_build_object(
    'schema_version','embedding-profile-revision@1.0.0','scope',scope,
    'profile_id','00000000-0000-4000-8000-000000006704','revision',1,
    'provider','fixture-embedding','model_id','fixture-2d','dimensions',2,'normalization','L2',
    'parser_version','knowledge-parser@1.0.0','chunker_version','knowledge-chunker@1.0.0',
    'projection_policy_version','knowledge-projection@1.0.0','status','READY',
    'created_at',app_data_agent.knowledge_utc_millis(pg_catalog.clock_timestamp())
  );
  profile:=profile||pg_catalog.jsonb_build_object('profile_hash',app_data_agent.u2_canonical_sha256(profile));
  perform app_data_agent.register_knowledge_embedding_profile(profile);

  create_command:=pg_catalog.jsonb_build_object(
    'schema_version','knowledge-base-create@1.0.0',
    'operation_id','00000000-0000-4000-8000-000000006705',
    'workspace_id','00000000-0000-4000-8000-000000006701','name','U15 fixture knowledge',
    'source_file_refs',pg_catalog.jsonb_build_array(file_ref),
    'embedding_profile_ref',pg_catalog.jsonb_build_object(
      'profile_id',profile->>'profile_id','revision',1,'profile_hash',profile->>'profile_hash'
    ),'acl',pg_catalog.jsonb_build_object('visibility','WORKSPACE','principal_ids','[]'::jsonb),
    'idempotency_key','u15-create-0001'
  );
  create_command:=create_command||pg_catalog.jsonb_build_object(
    'request_hash',app_data_agent.u2_canonical_sha256(create_command)
  );
  created:=app_data_agent.create_knowledge_base(create_command);
  if created#>>'{knowledge_base,status}'<>'INDEXING'
    or app_data_agent.create_knowledge_base(create_command)<>created
  then raise exception 'KNOWLEDGE_CREATE_OR_REPLAY_INVALID'; end if;

  heartbeat:=pg_catalog.jsonb_build_object(
    'schema_version','job-worker-heartbeat@1.0.0',
    'heartbeat_id','00000000-0000-4000-8000-000000006706','scope',scope,
    'worker_id','u15-index-worker','handlers',pg_catalog.jsonb_build_array(
      pg_catalog.jsonb_build_object('kind','KNOWLEDGE_INDEX','handler_revision','knowledge-index-handler@1.0.0')
    ),'capacity',1,'observed_at',app_data_agent.job_utc_millis(pg_catalog.clock_timestamp()),
    'expires_at',app_data_agent.job_utc_millis(pg_catalog.clock_timestamp()+interval '2 minutes')
  );
  heartbeat:=heartbeat||pg_catalog.jsonb_build_object(
    'heartbeat_hash',app_data_agent.u2_canonical_sha256(heartbeat)
  );
  perform app_data_agent.publish_job_worker_heartbeat(heartbeat);
  lease:=app_data_agent.claim_job_work('u15-index-worker',heartbeat->'handlers',30000);
  perform app_data_agent.start_job_work(lease);
  target:=app_data_agent.load_knowledge_index_target(lease);
  if target#>>'{knowledge_base,revision_hash}'<>created#>>'{knowledge_base,revision_hash}'
    or target#>>'{embedding_profile,profile_hash}'<>profile->>'profile_hash'
  then raise exception 'KNOWLEDGE_INDEX_TARGET_INVALID'; end if;

  blocked_projection:=pg_catalog.jsonb_build_object(
    'schema_version','knowledge-data-projection-receipt@1.0.0',
    'receipt_id','00000000-0000-4000-8000-00000000670d','scope',scope,
    'knowledge_base_ref',pg_catalog.jsonb_build_object(
      'knowledge_base_id',created#>>'{knowledge_base,knowledge_base_id}',
      'revision',(created#>>'{knowledge_base,revision}')::bigint,
      'revision_hash',created#>>'{knowledge_base,revision_hash}'
    ),'source_file_ref',file_ref,'chunk_id','00000000-0000-4000-8000-00000000670e',
    'classification','INTERNAL','provider','fixture-embedding',
    'projection_policy_version','knowledge-projection@1.0.0','redaction_count',1,
    'pii_finding_count',0,'credential_finding_count',1,'prompt_injection_detected',false,
    'decision','POLICY_BLOCKED',
    'payload_hash',app_data_agent.u2_canonical_sha256(pg_catalog.to_jsonb('redacted'::text)),
    'projected_at',app_data_agent.knowledge_utc_millis(pg_catalog.clock_timestamp())
  );
  blocked_projection:=blocked_projection||pg_catalog.jsonb_build_object(
    'receipt_hash',app_data_agent.u2_canonical_sha256(blocked_projection)
  );
  if app_data_agent.commit_knowledge_blocked_projection(lease,blocked_projection)<>blocked_projection
    or app_data_agent.commit_knowledge_blocked_projection(lease,blocked_projection)<>blocked_projection
  then raise exception 'KNOWLEDGE_BLOCKED_PROJECTION_REPLAY_INVALID'; end if;

  projection:=pg_catalog.jsonb_build_object(
    'schema_version','knowledge-data-projection-receipt@1.0.0',
    'receipt_id','00000000-0000-4000-8000-000000006707','scope',scope,
    'knowledge_base_ref',pg_catalog.jsonb_build_object(
      'knowledge_base_id',created#>>'{knowledge_base,knowledge_base_id}',
      'revision',(created#>>'{knowledge_base,revision}')::bigint,
      'revision_hash',created#>>'{knowledge_base,revision_hash}'
    ),'source_file_ref',file_ref,'chunk_id','00000000-0000-4000-8000-000000006708',
    'classification','INTERNAL','provider','fixture-embedding',
    'projection_policy_version','knowledge-projection@1.0.0','redaction_count',0,
    'pii_finding_count',0,'credential_finding_count',0,'prompt_injection_detected',false,
    'decision','ALLOW','payload_hash',app_data_agent.u2_canonical_sha256(pg_catalog.to_jsonb('hello knowledge'::text)),
    'projected_at',app_data_agent.knowledge_utc_millis(pg_catalog.clock_timestamp())
  );
  projection:=projection||pg_catalog.jsonb_build_object(
    'receipt_hash',app_data_agent.u2_canonical_sha256(projection)
  );
  chunk:=pg_catalog.jsonb_build_object(
    'schema_version','knowledge-chunk@1.0.0','scope',scope,
    'generation_id',created#>>'{generation,generation_id}',
    'generation_revision',(created#>>'{generation,generation_revision}')::bigint,
    'knowledge_base_ref',projection->'knowledge_base_ref',
    'chunk_id','00000000-0000-4000-8000-000000006708','source_file_ref',file_ref,
    'ordinal',0,'start_byte',0,'end_byte',15,
    'text_hash',app_data_agent.u2_canonical_sha256(pg_catalog.to_jsonb('hello knowledge'::text)),
    'projection_receipt_hash',projection->>'receipt_hash',
    'embedding_hash',app_data_agent.u2_canonical_sha256('[1,0]'::jsonb),'dimensions',2
  );
  chunk:=chunk||pg_catalog.jsonb_build_object('chunk_hash',app_data_agent.u2_canonical_sha256(chunk));
  stage:=pg_catalog.jsonb_build_object(
    'schema_version','knowledge-generation-stage@1.0.0',
    'generation_ref',pg_catalog.jsonb_build_object(
      'generation_id',created#>>'{generation,generation_id}',
      'generation_revision',(created#>>'{generation,generation_revision}')::bigint,
      'generation_hash',created#>>'{generation,generation_hash}'
    ),'chunks',pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
      'chunk',chunk,'normalized_text','hello knowledge','vector','[1,0]'::jsonb,
      'projection_receipt',projection
    )),'manifest_hash',app_data_agent.u2_canonical_sha256(pg_catalog.jsonb_build_array(chunk->>'chunk_hash'))
  );
  staged:=app_data_agent.stage_knowledge_generation(lease,stage);
  if app_data_agent.stage_knowledge_generation(lease,stage)<>staged then
    raise exception 'KNOWLEDGE_GENERATION_STAGE_REPLAY_INVALID';
  end if;
  checkpoint:=pg_catalog.jsonb_build_object(
    'index_kind','NEO4J_VECTOR','build_id','00000000-0000-4000-8000-000000006709',
    'manifest_hash',staged->>'manifest_hash','dimensions',2,
    'sealed_at',app_data_agent.knowledge_utc_millis(pg_catalog.clock_timestamp())
  );
  ready_command:=pg_catalog.jsonb_build_object(
    'schema_version','knowledge-generation-ready@1.0.0',
    'generation_ref',pg_catalog.jsonb_build_object(
      'generation_id',staged->>'generation_id',
      'generation_revision',(staged->>'generation_revision')::bigint,
      'generation_hash',staged->>'generation_hash'
    ),'checkpoint',checkpoint
  );
  ready_generation:=app_data_agent.commit_knowledge_generation_ready(lease,ready_command);
  if app_data_agent.commit_knowledge_generation_ready(lease,ready_command)<>ready_generation then
    raise exception 'KNOWLEDGE_GENERATION_READY_REPLAY_INVALID';
  end if;
  terminal:=app_data_agent.succeed_job_work(lease,pg_catalog.jsonb_build_array(
    pg_catalog.jsonb_build_object(
      'schema_version','job-domain-output-reference@1.0.0',
      'resource_kind','KNOWLEDGE_INDEX_GENERATION','app_id',scope->>'app_id',
      'tenant_id',scope->>'tenant_id','environment',scope->>'environment',
      'resource_id',ready_generation->>'generation_id',
      'resource_revision',(ready_generation->>'generation_revision')::bigint,
      'resource_hash',ready_generation->>'generation_hash'
    )
  ));
  if terminal->>'terminal'<>'SUCCEEDED' then raise exception 'KNOWLEDGE_JOB_TERMINAL_INVALID'; end if;

  listed:=app_data_agent.list_knowledge_bases(20);
  if pg_catalog.jsonb_array_length(listed)<>1 or listed#>>'{0,status}'<>'READY'
  then raise exception 'KNOWLEDGE_LIST_READY_INVALID'; end if;
  bindings:=app_data_agent.build_requested_optional_resource_bindings(
    pg_catalog.jsonb_build_object(
      'overrides',pg_catalog.jsonb_build_object(
        'files',pg_catalog.jsonb_build_object('mode','EXPLICIT_NONE'),
        'knowledge',pg_catalog.jsonb_build_object(
          'mode','RESOURCE_IDS','resources',pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
            'resource_id',listed#>>'{0,knowledge_base_id}',
            'expected_revision',(listed#>>'{0,revision}')::bigint
          ))
        ),'mcp_servers',pg_catalog.jsonb_build_object('mode','EXPLICIT_NONE'),
        'skills',pg_catalog.jsonb_build_object('mode','EXPLICIT_NONE')
      ),'mentions','[]'::jsonb
    )
  );
  if pg_catalog.jsonb_array_length(bindings)<>1 or bindings#>>'{0,availability}'<>'AVAILABLE'
    or bindings#>>'{0,effective_resource,resource_hash}'<>listed#>>'{0,revision_hash}'
  then raise exception 'KNOWLEDGE_EFFECTIVE_BINDING_INVALID'; end if;

  search_request:=pg_catalog.jsonb_build_object(
    'schema_version','knowledge-debug-search-request@1.0.0',
    'knowledge_base_ref',pg_catalog.jsonb_build_object(
      'knowledge_base_id',listed#>>'{0,knowledge_base_id}',
      'revision',(listed#>>'{0,revision}')::bigint,'revision_hash',listed#>>'{0,revision_hash}'
    ),'generation_ref',listed#>'{0,active_generation_ref}','query','hello','limit',5
  );
  query_projection:=pg_catalog.jsonb_build_object(
    'schema_version','knowledge-query-projection-receipt@1.0.0',
    'receipt_id','00000000-0000-4000-8000-000000006710','scope',scope,
    'knowledge_base_ref',search_request->'knowledge_base_ref',
    'generation_ref',search_request->'generation_ref','classification','INTERNAL',
    'provider','fixture-embedding','projection_policy_version','knowledge-projection@1.0.0',
    'pii_finding_count',0,'credential_finding_count',0,'prompt_injection_detected',false,
    'decision','ALLOW','payload_hash',app_data_agent.u2_canonical_sha256(pg_catalog.to_jsonb('hello'::text)),
    'projected_at',app_data_agent.knowledge_utc_millis(pg_catalog.clock_timestamp())
  );
  query_projection:=query_projection||pg_catalog.jsonb_build_object(
    'receipt_hash',app_data_agent.u2_canonical_sha256(query_projection)
  );
  perform app_data_agent.load_knowledge_search_snapshot(search_request);
  perform app_data_agent.commit_knowledge_query_projection(query_projection);
  retrieval:=app_data_agent.commit_knowledge_retrieval(
    search_request,pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
      'chunk_id','00000000-0000-4000-8000-000000006708','score',1.0
    )),app_data_agent.u2_canonical_sha256(pg_catalog.to_jsonb('hello'::text)),
    query_projection->>'receipt_hash'
  );
  if pg_catalog.jsonb_array_length(retrieval->'hits')<>1
    or retrieval#>>'{hits,0,acl_decision}'<>'ALLOW'
    or retrieval->>'receipt_hash'<>app_data_agent.u2_canonical_sha256(retrieval-'receipt_hash')
  then raise exception 'KNOWLEDGE_RETRIEVAL_RECEIPT_INVALID'; end if;

  defaults_command:=pg_catalog.jsonb_build_object(
    'schema_version','workspace-defaults-cas-update@1.0.0',
    'operation_id','00000000-0000-4000-8000-000000006711',
    'workspace_id','00000000-0000-4000-8000-000000006701','expected_defaults_revision',0,
    'idempotency_key','u15-defaults-0001','defaults',pg_catalog.jsonb_build_object(
      'model',null,'datasource',null,'files','[]'::jsonb,
      'knowledge',pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
        'resource_id',listed#>>'{0,knowledge_base_id}',
        'expected_revision',(listed#>>'{0,revision}')::bigint
      )),'mcp_servers','[]'::jsonb,'skills','[]'::jsonb,'semantic_release',null,
      'schema_snapshot',null,
      'context_policy',pg_catalog.jsonb_build_object(
        'resource_id','00000000-0000-4000-8000-0000000053c1','expected_revision',1
      ),'egress_policy',pg_catalog.jsonb_build_object(
        'resource_id','00000000-0000-4000-8000-0000000053e1','expected_revision',1
      ),'execution_safety_policy',pg_catalog.jsonb_build_object(
        'resource_id','00000000-0000-4000-8000-0000000053f1','expected_revision',1
      )
    )
  );
  defaults_command:=defaults_command||pg_catalog.jsonb_build_object(
    'request_hash',app_data_agent.u2_canonical_sha256(defaults_command)
  );
  defaults_result:=app_data_agent.update_workspace_run_defaults(defaults_command);
  if defaults_result#>>'{revision,defaults,knowledge,0,resource_hash}'<>listed#>>'{0,revision_hash}'
  then raise exception 'KNOWLEDGE_DEFAULTS_AUTHORITY_INVALID'; end if;
end
$behavior$;

reset session authorization;
rollback;

select 'KNOWLEDGE_BASE_AUTHORITY_ASSERTIONS_PASSED' as result;
