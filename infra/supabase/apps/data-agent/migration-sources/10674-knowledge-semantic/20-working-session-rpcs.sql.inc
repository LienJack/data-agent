create or replace function semantic.complete_semantic_authoring(
  p_app_id uuid,p_tenant_id uuid,p_environment text,p_principal_id uuid,
  p_semantic_domain text,p_authoring_run_id uuid,p_expected_writer_fence bigint,
  p_expected_working_revision integer,p_expected_graph_digest text,
  p_validation_receipt jsonb,p_final_graph jsonb,p_summary text,p_event jsonb
) returns jsonb language plpgsql volatile security definer set search_path='' as $function$
declare run_record semantic.semantic_authoring_run%rowtype; v_event_sequence bigint;
begin
  perform semantic.assert_explorer_scope(
    p_app_id,p_tenant_id,p_environment,p_principal_id,p_semantic_domain
  );
  perform semantic.lock_semantic_authority_fence(
    p_app_id,p_tenant_id,p_environment,p_semantic_domain
  );
  select run.* into run_record from semantic.semantic_authoring_run run
  where run.app_id=p_app_id and run.tenant_id=p_tenant_id and run.environment=p_environment
    and run.semantic_domain=p_semantic_domain and run.authoring_run_id=p_authoring_run_id
    and run.principal_id=p_principal_id for update;
  if not found or run_record.status<>'RUNNING'
    or run_record.writer_fence<>p_expected_writer_fence
    or run_record.working_revision<>p_expected_working_revision
    or run_record.graph_digest<>p_expected_graph_digest
    or p_validation_receipt->>'receipt_digest' is distinct from run_record.validation_receipt_digest
    or p_validation_receipt->>'graph_digest'<>run_record.graph_digest
    or coalesce((p_validation_receipt->>'valid')::boolean,false) is not true
    or platform.canonical_sha256(p_final_graph)<>run_record.graph_digest
    or p_final_graph<>run_record.working_graph
    or pg_catalog.length(p_summary) not between 1 and 2048
  then raise exception using errcode='40001',message='SEMANTIC_AUTHORING_COMPLETE_CONFLICT'; end if;
  perform 1 from semantic.semantic_candidate candidate
  where candidate.app_id=p_app_id and candidate.tenant_id=p_tenant_id
    and candidate.environment=p_environment and candidate.semantic_domain=p_semantic_domain
    and candidate.candidate_id=run_record.candidate_id
    and candidate.proposer_principal=p_principal_id::text and candidate.candidate_status='DRAFT'
  for update;
  if not found then
    raise exception using errcode='40001',message='SEMANTIC_AUTHORING_CANDIDATE_STALE';
  end if;
  v_event_sequence:=semantic.append_authoring_events(
    p_app_id,p_tenant_id,p_environment,p_semantic_domain,p_authoring_run_id,
    run_record.event_sequence,pg_catalog.jsonb_build_array(p_event)
  );
  update semantic.semantic_authoring_run set status='READY_FOR_REVIEW',
    event_sequence=v_event_sequence,updated_at=pg_catalog.clock_timestamp()
  where app_id=p_app_id and tenant_id=p_tenant_id and environment=p_environment
    and semantic_domain=p_semantic_domain and authoring_run_id=p_authoring_run_id;
  insert into app_data_agent.audit_log(
    app_id,tenant_id,environment,audit_id,principal_id,action,resource_type,resource_id,details
  ) values (
    p_app_id,p_tenant_id,p_environment,extensions.gen_random_uuid(),p_principal_id,
    'SEMANTIC_AUTHORING_READY_TO_SAVE','semantic_authoring_run',p_authoring_run_id::text,
    pg_catalog.jsonb_build_object(
      'candidate_id',run_record.candidate_id,'working_revision',run_record.working_revision,
      'graph_digest',run_record.graph_digest,'candidate_revision_created',false
    )
  );
  return semantic.build_authoring_state(
    p_app_id,p_tenant_id,p_environment,p_semantic_domain,p_authoring_run_id
  );
end
$function$;

create function semantic.start_manual_semantic_authoring(p_command jsonb)
returns jsonb language plpgsql volatile security definer set search_path='' as $function$
declare app_id_value uuid; tenant_id_value uuid; environment_value text; domain_value text;
  principal_value uuid; run_id_value uuid; candidate_id_value uuid; active_graph jsonb;
  checkpoint_value jsonb; existing semantic.semantic_authoring_run%rowtype;
begin
  if p_command is null or pg_catalog.jsonb_typeof(p_command)<>'object'
    or p_command-array[
      'schema_version','command_id','scope','semantic_domain','principal_id','authoring_run_id',
      'candidate_id','base_release_id','base_release_generation','base_graph','base_graph_digest',
      'idempotency_key','started_at','command_hash'
    ]<>'{}'::jsonb
    or p_command->>'schema_version'<>'semantic-manual-session-start-command@1.0.0'
    or p_command->>'command_hash'<>platform.canonical_sha256(p_command-'command_hash')
    or platform.canonical_sha256(p_command->'base_graph')<>p_command->>'base_graph_digest'
  then raise exception using errcode='22023',message='SEMANTIC_MANUAL_SESSION_START_INVALID'; end if;
  app_id_value:=(p_command#>>'{scope,app_id}')::uuid;
  tenant_id_value:=(p_command#>>'{scope,tenant_id}')::uuid;
  environment_value:=p_command#>>'{scope,environment}';
  domain_value:=p_command->>'semantic_domain'; principal_value:=(p_command->>'principal_id')::uuid;
  run_id_value:=(p_command->>'authoring_run_id')::uuid;
  candidate_id_value:=(p_command->>'candidate_id')::uuid;
  perform semantic.assert_explorer_scope(
    app_id_value,tenant_id_value,environment_value,principal_value,domain_value
  );
  perform semantic.lock_semantic_authority_fence(
    app_id_value,tenant_id_value,environment_value,domain_value
  );
  select run.* into existing from semantic.semantic_authoring_run run
  where run.app_id=app_id_value and run.tenant_id=tenant_id_value
    and run.environment=environment_value and run.semantic_domain=domain_value
    and run.principal_id=principal_value and run.idempotency_key=p_command->>'idempotency_key'
  for update;
  if found then
    if existing.input_digest<>p_command->>'command_hash' then
      raise exception using errcode='23505',message='SEMANTIC_MANUAL_SESSION_IDEMPOTENCY_CONFLICT';
    end if;
    return semantic.build_authoring_state(
      app_id_value,tenant_id_value,environment_value,domain_value,existing.authoring_run_id
    );
  end if;
  active_graph:=semantic.get_active_semantic_graph_studio(
    app_id_value,tenant_id_value,environment_value,principal_value,domain_value
  );
  if active_graph is null
    or active_graph->>'release_id'<>p_command->>'base_release_id'
    or (active_graph->>'release_generation')::bigint<>(p_command->>'base_release_generation')::bigint
    or active_graph->'source_graph'<>p_command->'base_graph'
  then raise exception using errcode='40001',message='SEMANTIC_MANUAL_SESSION_BASE_STALE'; end if;
  insert into semantic.semantic_candidate(
    app_id,tenant_id,environment,semantic_domain,candidate_id,proposer_principal,
    current_revision_id,candidate_status
  ) values (
    app_id_value,tenant_id_value,environment_value,domain_value,candidate_id_value,
    principal_value::text,run_id_value,'DRAFT'
  );
  checkpoint_value:=pg_catalog.jsonb_build_object(
    'checkpoint_version','semantic-authoring-checkpoint@1.0.0',
    'messages',pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
      'role','user','content','用户创建了直接编辑 Working ChangeSet。'
    )),
    'pending_agent_request',null,'read_node_ids','[]'::jsonb,'read_edge_ids','[]'::jsonb,
    'searches','[]'::jsonb,'pending_tool_calls','[]'::jsonb,'last_validation',null
  );
  insert into semantic.semantic_authoring_run(
    app_id,tenant_id,environment,semantic_domain,authoring_run_id,candidate_id,graph_id,
    base_release_id,base_release_generation,principal_id,policy_version,status,
    working_revision,graph_digest,writer_fence,current_turn,used_tool_calls,max_turns,max_tool_calls,
    working_graph,checkpoint,event_sequence,idempotency_key,input_digest
  ) values (
    app_id_value,tenant_id_value,environment_value,domain_value,run_id_value,candidate_id_value,
    (p_command#>>'{base_graph,metadata,graph_id}')::uuid,(p_command->>'base_release_id')::uuid,
    (p_command->>'base_release_generation')::bigint,principal_value,
    'semantic-authoring-policy@1.0.0','READY_FOR_REVIEW',0,p_command->>'base_graph_digest',
    1,0,0,1,256,p_command->'base_graph',checkpoint_value,0,
    p_command->>'idempotency_key',p_command->>'command_hash'
  );
  insert into app_data_agent.audit_log(
    app_id,tenant_id,environment,audit_id,principal_id,action,resource_type,resource_id,details
  ) values (
    app_id_value,tenant_id_value,environment_value,extensions.gen_random_uuid(),principal_value,
    'SEMANTIC_MANUAL_SESSION_STARTED','semantic_authoring_run',run_id_value::text,
    pg_catalog.jsonb_build_object('candidate_id',candidate_id_value,'base_release_id',p_command->>'base_release_id')
  );
  return semantic.build_authoring_state(
    app_id_value,tenant_id_value,environment_value,domain_value,run_id_value
  );
exception when invalid_text_representation or numeric_value_out_of_range or datetime_field_overflow then
  raise exception using errcode='22023',message='SEMANTIC_MANUAL_SESSION_START_INVALID';
end
$function$;
