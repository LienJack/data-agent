-- semantic_explicit_revision_migration_checksum: sha256:1f2bc790fee14e7f41652da2c464582adb67a01c2fd13330c3c48f965dc7c7ee
-- 10674 separates Working ChangeSets from explicit, recoverable Candidate Revisions.
begin;

do $bootstrap$
begin
  if pg_catalog.current_setting('server_version_num')::integer not between 170000 and 179999 then
    raise exception using errcode='0A000',message='SEMANTIC_EXPLICIT_REVISION_POSTGRES_VERSION_UNSUPPORTED';
  end if;
  if session_user<>'postgres' or current_user<>'postgres' then
    raise exception using errcode='42501',message='SEMANTIC_EXPLICIT_REVISION_MIGRATION_EXECUTOR_UNSAFE';
  end if;
  if not exists(select 1 from platform.migration_ledger where owner_kind='app'
    and app_id='00000000-0000-4000-8000-00000000da01'::uuid
    and migration_version='20260725010673_app_data_agent_knowledge_documents')
  then raise exception using errcode='P0001',message='SEMANTIC_EXPLICIT_REVISION_BASELINE_10673_MISSING'; end if;
end
$bootstrap$;

set local lock_timeout='2000ms';
set local statement_timeout='300000ms';
set local idle_in_transaction_session_timeout='60000ms';
select platform.acquire_migration_lock('app','00000000-0000-4000-8000-00000000da01'::uuid);
do $replace_terminal_constraint$
declare constraint_name text;
begin
  select constraint_record.conname into strict constraint_name
  from pg_catalog.pg_constraint constraint_record
  where constraint_record.conrelid='semantic.semantic_authoring_run'::regclass
    and constraint_record.contype='c'
    and pg_catalog.pg_get_constraintdef(constraint_record.oid) like '%READY_FOR_REVIEW%materialized_source_revision_id%';
  execute pg_catalog.format(
    'alter table semantic.semantic_authoring_run drop constraint %I',constraint_name
  );
end
$replace_terminal_constraint$;

alter table semantic.semantic_authoring_run
  add constraint semantic_authoring_run_terminal_closure check (
    (status='READY_FOR_REVIEW' and failure_code is null)
    or (status='FAILED' and materialized_source_revision_id is null and failure_code is not null)
    or (status not in ('READY_FOR_REVIEW','FAILED')
      and materialized_source_revision_id is null and failure_code is null)
  );

create table semantic.semantic_candidate_revision_save_idempotency (
  app_id uuid not null,
  tenant_id uuid not null,
  environment text not null,
  semantic_domain text not null,
  principal_id uuid not null,
  idempotency_key uuid not null,
  command_hash text not null check (command_hash~'^sha256:[0-9a-f]{64}$'),
  candidate_id uuid not null,
  source_revision_id uuid not null,
  candidate_revision_id uuid not null,
  revision_number integer not null check (revision_number between 1 and 2147483647),
  result_json jsonb not null check (pg_catalog.jsonb_typeof(result_json)='object'),
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  primary key (app_id,tenant_id,environment,semantic_domain,principal_id,idempotency_key),
  foreign key (app_id,tenant_id,environment,semantic_domain,candidate_id,candidate_revision_id)
    references semantic.semantic_candidate_revision(
      app_id,tenant_id,environment,semantic_domain,candidate_id,revision_id
    )
);

create table app_data_agent.knowledge_semantic_usage_references (
  app_id uuid not null,
  tenant_id uuid not null,
  environment text not null,
  usage_id uuid not null,
  selection_id uuid not null,
  selection_hash text not null check (selection_hash~'^sha256:[0-9a-f]{64}$'),
  semantic_domain text not null,
  usage_kind text not null check (usage_kind in ('CANDIDATE_REVISION','PUBLISHED_SEMANTIC_OBJECT')),
  subject_id uuid not null,
  subject_revision integer not null check (subject_revision between 1 and 2147483647),
  subject_hash text not null check (subject_hash~'^sha256:[0-9a-f]{64}$'),
  created_by_principal_id uuid not null,
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  primary key (app_id,tenant_id,environment,usage_id),
  unique (app_id,tenant_id,environment,selection_id,usage_kind,subject_id,subject_revision),
  foreign key (app_id,tenant_id,environment,selection_id,selection_hash)
    references app_data_agent.knowledge_evidence_selections(
      app_id,tenant_id,environment,selection_id,selection_hash
    )
);

alter table semantic.semantic_candidate_revision_save_idempotency enable row level security;
alter table semantic.semantic_candidate_revision_save_idempotency force row level security;
alter table semantic.semantic_candidate_revision_save_idempotency owner to data_agent_u6_data_owner;
create policy semantic_candidate_revision_save_idempotency_scope
  on semantic.semantic_candidate_revision_save_idempotency for all to data_agent_u6_rpc_owner
  using (app_id=nullif(pg_catalog.current_setting('data_agent.app_id',true),'')::uuid
    and tenant_id=nullif(pg_catalog.current_setting('data_agent.tenant_id',true),'')::uuid
    and environment=nullif(pg_catalog.current_setting('data_agent.environment',true),'')
    and semantic_domain=nullif(pg_catalog.current_setting('app.semantic_domain',true),''))
  with check (app_id=nullif(pg_catalog.current_setting('data_agent.app_id',true),'')::uuid
    and tenant_id=nullif(pg_catalog.current_setting('data_agent.tenant_id',true),'')::uuid
    and environment=nullif(pg_catalog.current_setting('data_agent.environment',true),'')
    and semantic_domain=nullif(pg_catalog.current_setting('app.semantic_domain',true),''));

alter table app_data_agent.knowledge_semantic_usage_references enable row level security;
alter table app_data_agent.knowledge_semantic_usage_references force row level security;
alter table app_data_agent.knowledge_semantic_usage_references owner to data_agent_u15_knowledge_owner;
create policy knowledge_semantic_usage_references_owner_all
  on app_data_agent.knowledge_semantic_usage_references for all to data_agent_u15_knowledge_owner
  using (platform.backend_context_matches(app_id,tenant_id,environment,false))
  with check (platform.backend_context_matches(app_id,tenant_id,environment,true));
create trigger knowledge_semantic_usage_references_immutable
  before update or delete on app_data_agent.knowledge_semantic_usage_references
  for each statement execute function app_data_agent.reject_knowledge_immutable_mutation();

create index knowledge_semantic_usage_selection_idx
  on app_data_agent.knowledge_semantic_usage_references(
    app_id,tenant_id,environment,selection_id,created_at desc
  );
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
create function semantic.save_semantic_candidate_revision(p_command jsonb)
returns jsonb language plpgsql volatile security definer set search_path='' as $function$
declare scope_value jsonb; app_id_value uuid; tenant_id_value uuid; environment_value text;
  domain_value text; principal_value uuid; run_record semantic.semantic_authoring_run%rowtype;
  candidate_record semantic.semantic_candidate%rowtype;
  idempotency_record semantic.semantic_candidate_revision_save_idempotency%rowtype;
  source_revision_id_value uuid:=extensions.gen_random_uuid();
  candidate_revision_id_value uuid:=extensions.gen_random_uuid();
  source_revision_number_value integer; candidate_revision_number_value integer;
  source_digest_value text; revision_payload_value jsonb; revision_digest_value text;
  result_value jsonb; evidence_value jsonb;
begin
  if p_command is null or pg_catalog.jsonb_typeof(p_command)<>'object'
    or p_command-array[
      'schema_version','command_id','scope','semantic_domain','principal_id','authoring_run_id',
      'candidate_id','base_release_id','expected_working_revision','expected_graph_digest',
      'final_graph','final_graph_digest','manual_patch','operation_origins','evidence_selection_refs',
      'validation_receipt','summary','idempotency_key','saved_at','command_hash'
    ]<>'{}'::jsonb
    or p_command->>'schema_version'<>'semantic-candidate-revision-save-command@1.0.0'
    or p_command->>'command_hash'<>platform.canonical_sha256(p_command-'command_hash')
    or platform.canonical_sha256(p_command->'final_graph')<>p_command->>'final_graph_digest'
    or pg_catalog.jsonb_typeof(p_command->'operation_origins')<>'array'
    or pg_catalog.jsonb_typeof(p_command->'evidence_selection_refs')<>'array'
    or pg_catalog.jsonb_array_length(p_command->'operation_origins')>256
    or pg_catalog.jsonb_array_length(p_command->'evidence_selection_refs')>32
    or pg_catalog.length(p_command->>'summary') not between 1 and 2048
    or p_command#>>'{validation_receipt,graph_digest}'<>p_command->>'final_graph_digest'
    or coalesce((p_command#>>'{validation_receipt,valid}')::boolean,false) is not true
    or p_command#>>'{validation_receipt,receipt_digest}'<>
      platform.canonical_sha256((p_command->'validation_receipt')-'receipt_digest')
  then raise exception using errcode='22023',message='SEMANTIC_CANDIDATE_SAVE_INVALID'; end if;
  scope_value:=p_command->'scope'; app_id_value:=(scope_value->>'app_id')::uuid;
  tenant_id_value:=(scope_value->>'tenant_id')::uuid; environment_value:=scope_value->>'environment';
  domain_value:=p_command->>'semantic_domain'; principal_value:=(p_command->>'principal_id')::uuid;
  perform semantic.assert_explorer_scope(
    app_id_value,tenant_id_value,environment_value,principal_value,domain_value
  );
  perform semantic.lock_semantic_authority_fence(
    app_id_value,tenant_id_value,environment_value,domain_value
  );
  select item.* into idempotency_record
  from semantic.semantic_candidate_revision_save_idempotency item
  where item.app_id=app_id_value and item.tenant_id=tenant_id_value
    and item.environment=environment_value and item.semantic_domain=domain_value
    and item.principal_id=principal_value and item.idempotency_key=(p_command->>'idempotency_key')::uuid
  for update;
  if found then
    if idempotency_record.command_hash<>p_command->>'command_hash' then
      raise exception using errcode='23505',message='SEMANTIC_CANDIDATE_SAVE_CONFLICT';
    end if;
    return pg_catalog.jsonb_set(idempotency_record.result_json,'{disposition}','"REPLAYED"'::jsonb);
  end if;
  select run.* into run_record from semantic.semantic_authoring_run run
  where run.app_id=app_id_value and run.tenant_id=tenant_id_value
    and run.environment=environment_value and run.semantic_domain=domain_value
    and run.authoring_run_id=(p_command->>'authoring_run_id')::uuid
    and run.principal_id=principal_value for update;
  if not found or run_record.status<>'READY_FOR_REVIEW'
    or run_record.candidate_id<>(p_command->>'candidate_id')::uuid
    or run_record.base_release_id<>(p_command->>'base_release_id')::uuid
    or run_record.working_revision<>(p_command->>'expected_working_revision')::integer
    or run_record.graph_digest<>p_command->>'expected_graph_digest'
    or run_record.graph_id<>(p_command#>>'{final_graph,metadata,graph_id}')::uuid
  then raise exception using errcode='40001',message='SEMANTIC_CANDIDATE_SAVE_CONFLICT'; end if;
  perform 1 from semantic.semantic_active_pointer pointer
  where pointer.app_id=app_id_value and pointer.tenant_id=tenant_id_value
    and pointer.environment=environment_value and pointer.semantic_domain=domain_value
    and pointer.current_release_id=run_record.base_release_id
    and pointer.current_release_generation=run_record.base_release_generation for share;
  if not found then raise exception using errcode='40001',message='SEMANTIC_CANDIDATE_SAVE_STALE'; end if;
  select candidate.* into candidate_record from semantic.semantic_candidate candidate
  where candidate.app_id=app_id_value and candidate.tenant_id=tenant_id_value
    and candidate.environment=environment_value and candidate.semantic_domain=domain_value
    and candidate.candidate_id=run_record.candidate_id
    and candidate.proposer_principal=principal_value::text and candidate.candidate_status='DRAFT'
  for update;
  if not found then raise exception using errcode='42501',message='SEMANTIC_CANDIDATE_SAVE_FORBIDDEN'; end if;
  if exists(
    select 1 from pg_catalog.jsonb_array_elements(run_record.working_graph->'nodes') base_node
    where base_node.value->>'node_type' in ('PHYSICAL_TABLE','PHYSICAL_COLUMN')
      and not exists(select 1 from pg_catalog.jsonb_array_elements(p_command#>'{final_graph,nodes}') final_node
        where final_node.value=base_node.value)
  ) or exists(
    select 1 from pg_catalog.jsonb_array_elements(p_command#>'{final_graph,nodes}') final_node
    where final_node.value->>'node_type' in ('PHYSICAL_TABLE','PHYSICAL_COLUMN')
      and not exists(select 1 from pg_catalog.jsonb_array_elements(run_record.working_graph->'nodes') base_node
        where base_node.value=final_node.value)
  ) or exists(
    select 1 from pg_catalog.jsonb_array_elements(run_record.working_graph->'edges') base_edge
    where base_edge.value->>'edge_type' in ('CONTAINS_COLUMN','FOREIGN_KEY_TO')
      and not exists(select 1 from pg_catalog.jsonb_array_elements(p_command#>'{final_graph,edges}') final_edge
        where final_edge.value=base_edge.value)
  ) or exists(
    select 1 from pg_catalog.jsonb_array_elements(p_command#>'{final_graph,edges}') final_edge
    where final_edge.value->>'edge_type' in ('CONTAINS_COLUMN','FOREIGN_KEY_TO')
      and not exists(select 1 from pg_catalog.jsonb_array_elements(run_record.working_graph->'edges') base_edge
        where base_edge.value=final_edge.value)
  ) then raise exception using errcode='42501',message='SEMANTIC_CANDIDATE_SAVE_SYSTEM_MANAGED_MUTATION'; end if;
  for evidence_value in select value from pg_catalog.jsonb_array_elements(p_command->'evidence_selection_refs') loop
    if evidence_value-array['selection_id','selection_hash']<>'{}'::jsonb or not exists(
      select 1 from app_data_agent.knowledge_evidence_selections selection
      where selection.app_id=app_id_value and selection.tenant_id=tenant_id_value
        and selection.environment=environment_value
        and selection.selection_id=(evidence_value->>'selection_id')::uuid
        and selection.selection_hash=evidence_value->>'selection_hash'
        and selection.intended_semantic_domain=domain_value
    ) then raise exception using errcode='42501',message='SEMANTIC_CANDIDATE_SAVE_EVIDENCE_INVALID'; end if;
  end loop;
  select coalesce(pg_catalog.max(revision.revision_number),0)+1 into source_revision_number_value
  from semantic.semantic_source_revision revision
  where revision.app_id=app_id_value and revision.tenant_id=tenant_id_value
    and revision.environment=environment_value and revision.semantic_domain=domain_value;
  select coalesce(pg_catalog.max(revision.revision_number),0)+1 into candidate_revision_number_value
  from semantic.semantic_candidate_revision revision
  where revision.app_id=app_id_value and revision.tenant_id=tenant_id_value
    and revision.environment=environment_value and revision.semantic_domain=domain_value
    and revision.candidate_id=run_record.candidate_id;
  source_digest_value:=semantic.semantic_sha256(
    'semantic-explicit-candidate-source@1.0.0',
    pg_catalog.jsonb_build_object(
      'candidate_id',run_record.candidate_id,'revision_number',candidate_revision_number_value,
      'final_graph_digest',p_command->>'final_graph_digest','command_hash',p_command->>'command_hash'
    )
  );
  revision_payload_value:=pg_catalog.jsonb_build_object(
    'schema_version','semantic-explicit-candidate-revision@1.0.0',
    'title',p_command->>'summary','description',p_command->>'summary','risk_level','MEDIUM',
    'source_revision_id',source_revision_id_value,'base_release_id',run_record.base_release_id,
    'authoring_run_id',run_record.authoring_run_id,'source_graph',p_command->'final_graph',
    'source_graph_digest',p_command->>'final_graph_digest','manual_patch',p_command->'manual_patch',
    'operation_origins',p_command->'operation_origins',
    'evidence_selection_refs',p_command->'evidence_selection_refs',
    'validation_receipt',p_command->'validation_receipt',
    'diff',pg_catalog.jsonb_build_object(
      'schema_version','semantic-diff@1.0.0','summary',p_command->>'summary',
      'operations',coalesce(p_command#>'{manual_patch,operations}','[]'::jsonb)
    )
  );
  revision_digest_value:=semantic.semantic_sha256(
    run_record.candidate_id::text,
    pg_catalog.jsonb_build_object(
      'revision_number',candidate_revision_number_value,'source_revision_id',source_revision_id_value,
      'revision_payload',revision_payload_value,'author_principal',principal_value,
      'change_description',p_command->>'summary','change_class','MINOR'
    )
  );
  insert into semantic.semantic_source_revision(
    app_id,tenant_id,environment,semantic_domain,revision_id,revision_number,
    base_release_id,base_release_generation,source_payload,source_digest,
    author_principal,change_description,change_class
  ) values (
    app_id_value,tenant_id_value,environment_value,domain_value,source_revision_id_value,
    source_revision_number_value,run_record.base_release_id,run_record.base_release_generation,
    p_command->'final_graph',source_digest_value,principal_value::text,p_command->>'summary','MINOR'
  );
  insert into semantic.semantic_candidate_revision(
    app_id,tenant_id,environment,semantic_domain,candidate_id,revision_id,revision_number,
    source_revision_id,revision_payload,revision_digest,author_principal,change_description,change_class
  ) values (
    app_id_value,tenant_id_value,environment_value,domain_value,run_record.candidate_id,
    candidate_revision_id_value,candidate_revision_number_value,source_revision_id_value,
    revision_payload_value,revision_digest_value,principal_value::text,p_command->>'summary','MINOR'
  );
  update semantic.semantic_candidate set current_revision_id=candidate_revision_id_value,
    updated_at=pg_catalog.clock_timestamp()
  where app_id=app_id_value and tenant_id=tenant_id_value and environment=environment_value
    and semantic_domain=domain_value and candidate_id=run_record.candidate_id;
  update semantic.semantic_authoring_run set
    materialized_source_revision_id=source_revision_id_value,
    materialized_candidate_revision_id=candidate_revision_id_value,
    working_revision=case when p_command->'manual_patch'='null'::jsonb then working_revision
      else (p_command#>>'{manual_patch,to_working_revision}')::integer end,
    graph_digest=p_command->>'final_graph_digest',
    validation_receipt_digest=p_command#>>'{validation_receipt,receipt_digest}',
    working_graph=p_command->'final_graph',
    updated_at=pg_catalog.clock_timestamp()
  where app_id=app_id_value and tenant_id=tenant_id_value and environment=environment_value
    and semantic_domain=domain_value and authoring_run_id=run_record.authoring_run_id;
  for evidence_value in select value from pg_catalog.jsonb_array_elements(p_command->'evidence_selection_refs') loop
    insert into app_data_agent.knowledge_semantic_usage_references(
      app_id,tenant_id,environment,usage_id,selection_id,selection_hash,semantic_domain,
      usage_kind,subject_id,subject_revision,subject_hash,created_by_principal_id
    ) values (
      app_id_value,tenant_id_value,environment_value,extensions.gen_random_uuid(),
      (evidence_value->>'selection_id')::uuid,evidence_value->>'selection_hash',domain_value,
      'CANDIDATE_REVISION',candidate_revision_id_value,candidate_revision_number_value,
      revision_digest_value,principal_value
    );
  end loop;
  result_value:=pg_catalog.jsonb_build_object(
    'schema_version','semantic-candidate-revision-save-result@1.0.0','disposition','CREATED',
    'candidate_id',run_record.candidate_id,'source_revision_id',source_revision_id_value,
    'candidate_revision_id',candidate_revision_id_value,'revision_number',candidate_revision_number_value,
    'final_graph_digest',p_command->>'final_graph_digest',
    'validation_receipt_digest',p_command#>>'{validation_receipt,receipt_digest}',
    'saved_at',p_command->>'saved_at'
  );
  insert into semantic.semantic_candidate_revision_save_idempotency(
    app_id,tenant_id,environment,semantic_domain,principal_id,idempotency_key,command_hash,
    candidate_id,source_revision_id,candidate_revision_id,revision_number,result_json
  ) values (
    app_id_value,tenant_id_value,environment_value,domain_value,principal_value,
    (p_command->>'idempotency_key')::uuid,p_command->>'command_hash',run_record.candidate_id,
    source_revision_id_value,candidate_revision_id_value,candidate_revision_number_value,result_value
  );
  insert into app_data_agent.audit_log(
    app_id,tenant_id,environment,audit_id,principal_id,action,resource_type,resource_id,details
  ) values (
    app_id_value,tenant_id_value,environment_value,extensions.gen_random_uuid(),principal_value,
    'SEMANTIC_CANDIDATE_REVISION_SAVED','semantic_candidate_revision',candidate_revision_id_value::text,
    pg_catalog.jsonb_build_object(
      'candidate_id',run_record.candidate_id,'revision_number',candidate_revision_number_value,
      'final_graph_digest',p_command->>'final_graph_digest','base_release_id',run_record.base_release_id
    )
  );
  return result_value;
exception when invalid_text_representation or numeric_value_out_of_range or datetime_field_overflow then
  raise exception using errcode='22023',message='SEMANTIC_CANDIDATE_SAVE_INVALID';
end
$function$;

create function semantic.get_saved_semantic_candidate_revision(
  p_app_id uuid,p_tenant_id uuid,p_environment text,p_principal_id uuid,
  p_semantic_domain text,p_authoring_run_id uuid
) returns jsonb language plpgsql stable security definer set search_path='' as $function$
declare result_value jsonb;
begin
  perform semantic.assert_explorer_scope(
    p_app_id,p_tenant_id,p_environment,p_principal_id,p_semantic_domain
  );
  select saved.result_json into result_value
  from semantic.semantic_authoring_run run
  join semantic.semantic_candidate_revision_save_idempotency saved
    on saved.app_id=run.app_id and saved.tenant_id=run.tenant_id
    and saved.environment=run.environment and saved.semantic_domain=run.semantic_domain
    and saved.principal_id=run.principal_id
    and saved.candidate_id=run.candidate_id
    and saved.candidate_revision_id=run.materialized_candidate_revision_id
  where run.app_id=p_app_id and run.tenant_id=p_tenant_id
    and run.environment=p_environment and run.semantic_domain=p_semantic_domain
    and run.principal_id=p_principal_id and run.authoring_run_id=p_authoring_run_id
  order by saved.created_at desc
  limit 1;
  return result_value;
end
$function$;

create or replace function app_data_agent.get_knowledge_document(
  requested_document_id uuid,requested_revision bigint
) returns jsonb language plpgsql security definer set search_path='' as $function$
declare authority record; document app_data_agent.knowledge_document_revisions%rowtype;
begin
  select * into strict authority from platform.current_backend_authority(false);
  select * into strict document from app_data_agent.knowledge_document_revisions
  where app_id=authority.app_id and tenant_id=authority.tenant_id and environment=authority.environment
    and document_id=requested_document_id and revision=requested_revision;
  return pg_catalog.jsonb_build_object(
    'document',document.revision_json,
    'blocks',coalesce((select pg_catalog.jsonb_agg(block_json order by ordinal)
      from app_data_agent.knowledge_document_blocks block
      where block.app_id=document.app_id and block.tenant_id=document.tenant_id
        and block.environment=document.environment and block.document_id=document.document_id
        and block.document_revision=document.revision),'[]'::jsonb),
    'annotations',coalesce((select pg_catalog.jsonb_agg(annotation_json order by created_at,annotation_id)
      from app_data_agent.knowledge_correction_annotations annotation
      where annotation.app_id=document.app_id and annotation.tenant_id=document.tenant_id
        and annotation.environment=document.environment and annotation.document_id=document.document_id
        and annotation.document_revision=document.revision),'[]'::jsonb),
    'usage',coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
      'usage_kind',usage.usage_kind,'semantic_domain',usage.semantic_domain,
      'subject_id',usage.subject_id,'subject_revision',usage.subject_revision,
      'subject_hash',usage.subject_hash,'evidence_ref',block.block_json-
        array['schema_version','scope','knowledge_base_ref','source_file_ref','kind','ordinal',
          'start_byte','end_byte','start_line','end_line','heading_ancestry','canonical_text',
          'normalized_text_hash']
    ) order by usage.created_at,usage.usage_id,selected_block.ordinal)
      from app_data_agent.knowledge_semantic_usage_references usage
      join app_data_agent.knowledge_evidence_selection_blocks selected_block
        on selected_block.app_id=usage.app_id and selected_block.tenant_id=usage.tenant_id
        and selected_block.environment=usage.environment and selected_block.selection_id=usage.selection_id
      join app_data_agent.knowledge_document_blocks block
        on block.app_id=selected_block.app_id and block.tenant_id=selected_block.tenant_id
        and block.environment=selected_block.environment and block.document_id=selected_block.document_id
        and block.document_revision=selected_block.document_revision and block.block_id=selected_block.block_id
        and block.block_hash=selected_block.block_hash
      where usage.app_id=document.app_id and usage.tenant_id=document.tenant_id
        and usage.environment=document.environment and block.document_id=document.document_id
        and block.document_revision=document.revision),'[]'::jsonb)
  );
exception when no_data_found then
  raise exception using errcode='42501',message='KNOWLEDGE_DOCUMENT_NOT_FOUND_OR_DENIED';
end
$function$;
create policy knowledge_semantic_usage_references_semantic_writer
  on app_data_agent.knowledge_semantic_usage_references for insert to data_agent_u6_rpc_owner
  with check (app_id=nullif(pg_catalog.current_setting('data_agent.app_id',true),'')::uuid
    and tenant_id=nullif(pg_catalog.current_setting('data_agent.tenant_id',true),'')::uuid
    and environment=nullif(pg_catalog.current_setting('data_agent.environment',true),'')
    and semantic_domain=nullif(pg_catalog.current_setting('app.semantic_domain',true),''));

grant select,insert on semantic.semantic_candidate_revision_save_idempotency to data_agent_u6_rpc_owner;
grant insert on app_data_agent.knowledge_semantic_usage_references to data_agent_u6_rpc_owner;
grant select on app_data_agent.knowledge_semantic_usage_references to data_agent_u15_knowledge_owner;

alter function semantic.complete_semantic_authoring(
  uuid,uuid,text,uuid,text,uuid,bigint,integer,text,jsonb,jsonb,text,jsonb
) owner to data_agent_u6_rpc_owner;
alter function semantic.start_manual_semantic_authoring(jsonb) owner to data_agent_u6_rpc_owner;
alter function semantic.save_semantic_candidate_revision(jsonb) owner to data_agent_u6_rpc_owner;
alter function semantic.get_saved_semantic_candidate_revision(uuid,uuid,text,uuid,text,uuid)
  owner to data_agent_u6_rpc_owner;
alter function app_data_agent.get_knowledge_document(uuid,bigint) owner to data_agent_u15_knowledge_owner;

revoke all on semantic.semantic_candidate_revision_save_idempotency,
  app_data_agent.knowledge_semantic_usage_references
from public,anon,authenticated,service_role,data_agent_backend;
revoke all on function semantic.start_manual_semantic_authoring(jsonb),
  semantic.save_semantic_candidate_revision(jsonb),
  semantic.get_saved_semantic_candidate_revision(uuid,uuid,text,uuid,text,uuid)
from public,anon,authenticated,service_role,data_agent_backend;
grant execute on function semantic.start_manual_semantic_authoring(jsonb),
  semantic.save_semantic_candidate_revision(jsonb),
  semantic.get_saved_semantic_candidate_revision(uuid,uuid,text,uuid,text,uuid)
to data_agent_backend;

do $postconditions$
begin
  if not (select relation.relrowsecurity and relation.relforcerowsecurity
    from pg_catalog.pg_class relation where relation.oid=
      'semantic.semantic_candidate_revision_save_idempotency'::regclass)
    or not (select relation.relrowsecurity and relation.relforcerowsecurity
      from pg_catalog.pg_class relation where relation.oid=
        'app_data_agent.knowledge_semantic_usage_references'::regclass)
    or pg_catalog.has_table_privilege(
      'data_agent_backend','semantic.semantic_candidate_revision_save_idempotency',
      'SELECT,INSERT,UPDATE,DELETE'
    )
    or pg_catalog.has_table_privilege(
      'data_agent_backend','app_data_agent.knowledge_semantic_usage_references',
      'SELECT,INSERT,UPDATE,DELETE'
    )
    or not pg_catalog.has_function_privilege(
      'data_agent_backend','semantic.save_semantic_candidate_revision(jsonb)','EXECUTE'
    )
    or not pg_catalog.has_function_privilege(
      'data_agent_backend',
      'semantic.get_saved_semantic_candidate_revision(uuid,uuid,text,uuid,text,uuid)','EXECUTE'
    )
    or pg_catalog.has_function_privilege(
      'anon','semantic.start_manual_semantic_authoring(jsonb)','EXECUTE'
    )
    or pg_catalog.has_function_privilege(
      'anon',
      'semantic.get_saved_semantic_candidate_revision(uuid,uuid,text,uuid,text,uuid)','EXECUTE'
    )
  then raise exception using errcode='P0001',message='SEMANTIC_EXPLICIT_REVISION_HARDENING_FAILED'; end if;
end
$postconditions$;
select platform.assert_migration_checksum(
  'app','00000000-0000-4000-8000-00000000da01'::uuid,
  '20260725010674_app_data_agent_semantic_explicit_revisions',
  'sha256:1f2bc790fee14e7f41652da2c464582adb67a01c2fd13330c3c48f965dc7c7ee'
);
commit;
