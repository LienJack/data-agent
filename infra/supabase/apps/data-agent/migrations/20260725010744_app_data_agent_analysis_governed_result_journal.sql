-- analysis_governed_result_journal_migration_checksum: sha256:ec472cf5f686216d4799dec26068a67764ed0c244a16d55a4943cd7f7edde72c
begin;

do $bootstrap$
begin
  if pg_catalog.current_setting('server_version_num')::integer not between 170000 and 179999 then
    raise exception using errcode='0A000',message='ANALYSIS_GOVERNED_RESULT_POSTGRES_VERSION_UNSUPPORTED';
  end if;
  if session_user<>'postgres' or current_user<>'postgres' then
    raise exception using errcode='42501',message='ANALYSIS_GOVERNED_RESULT_EXECUTOR_UNSAFE';
  end if;
  if not exists(select 1 from platform.migration_ledger
    where owner_kind='app' and app_id='00000000-0000-4000-8000-00000000da01'::uuid
      and migration_version='20260725010743_app_data_agent_opensandbox_analysis_cutover')
  then raise exception using errcode='P0001',message='ANALYSIS_GOVERNED_RESULT_BASELINE_10743_MISSING'; end if;
end
$bootstrap$;

set local lock_timeout='2000ms';
set local statement_timeout='300000ms';
set local idle_in_transaction_session_timeout='60000ms';
select platform.acquire_migration_lock('app','00000000-0000-4000-8000-00000000da01'::uuid);
create table app_data_agent.analysis_operator_results (
  app_id uuid not null,
  tenant_id uuid not null,
  environment text not null,
  run_id uuid not null,
  node_id text not null,
  attempt_id uuid not null,
  context_generation integer not null check (context_generation >= 1),
  call_id text not null,
  operator_id text not null,
  principal_id uuid not null,
  worker_fence bigint not null check (worker_fence >= 1),
  idempotency_key text not null check (pg_catalog.length(idempotency_key) between 8 and 256),
  request_sha256 text not null check (request_sha256 ~ '^sha256:[0-9a-f]{64}$'),
  result_sha256 text not null check (result_sha256 ~ '^sha256:[0-9a-f]{64}$'),
  result_bytes integer not null check (result_bytes between 1 and 16777216),
  result_ref_json jsonb not null check (pg_catalog.jsonb_typeof(result_ref_json)='object'),
  receipt_ref_json jsonb not null check (pg_catalog.jsonb_typeof(receipt_ref_json)='object'),
  receipt_payload_json jsonb not null check (pg_catalog.jsonb_typeof(receipt_payload_json)='object'),
  result_content bytea not null,
  commit_hash text not null check (commit_hash ~ '^sha256:[0-9a-f]{64}$'),
  committed_at timestamptz not null default pg_catalog.clock_timestamp(),
  primary key (app_id,tenant_id,environment,run_id,node_id,attempt_id,context_generation,call_id,operator_id),
  unique (app_id,tenant_id,environment,run_id,principal_id,idempotency_key),
  foreign key (app_id,tenant_id,environment,run_id)
    references app_data_agent.runs(app_id,tenant_id,environment,run_id) on delete restrict,
  foreign key (app_id,tenant_id,environment,attempt_id)
    references app_data_agent.run_attempts(app_id,tenant_id,environment,attempt_id) on delete restrict
);

create table app_data_agent.analysis_context_journal (
  app_id uuid not null,
  tenant_id uuid not null,
  environment text not null,
  run_id uuid not null,
  node_id text not null,
  attempt_id uuid not null,
  context_generation integer not null check (context_generation >= 1),
  seq integer not null check (seq >= 1),
  principal_id uuid not null,
  worker_fence bigint not null check (worker_fence >= 1),
  prev_entry_hash text,
  entry_hash text not null check (entry_hash ~ '^sha256:[0-9a-f]{64}$'),
  append_hash text not null check (append_hash ~ '^sha256:[0-9a-f]{64}$'),
  runtime_digest text not null check (runtime_digest ~ '^sha256:[0-9a-f]{64}$'),
  policy_version text not null,
  operator_registry_digest text not null check (operator_registry_digest ~ '^sha256:[0-9a-f]{64}$'),
  event_json jsonb not null check (pg_catalog.jsonb_typeof(event_json)='object'),
  entry_json jsonb not null check (pg_catalog.jsonb_typeof(entry_json)='object'),
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  primary key (app_id,tenant_id,environment,run_id,node_id,attempt_id,context_generation,seq),
  unique (app_id,tenant_id,environment,run_id,node_id,attempt_id,context_generation,entry_hash),
  unique (app_id,tenant_id,environment,run_id,node_id,attempt_id,context_generation,append_hash),
  foreign key (app_id,tenant_id,environment,run_id)
    references app_data_agent.runs(app_id,tenant_id,environment,run_id) on delete restrict,
  foreign key (app_id,tenant_id,environment,attempt_id)
    references app_data_agent.run_attempts(app_id,tenant_id,environment,attempt_id) on delete restrict
);

create function app_data_agent.analysis_governed_state_immutable()
returns trigger language plpgsql volatile set search_path=''
as $function$
begin
  raise exception using errcode='55000',message='ANALYSIS_GOVERNED_STATE_IMMUTABLE';
end
$function$;

create trigger analysis_operator_results_immutable before update or delete
on app_data_agent.analysis_operator_results for each row
execute function app_data_agent.analysis_governed_state_immutable();
create trigger analysis_context_journal_immutable before update or delete
on app_data_agent.analysis_context_journal for each row
execute function app_data_agent.analysis_governed_state_immutable();

create function app_data_agent.assert_analysis_lifecycle_fence(envelope_json jsonb, command_json jsonb)
returns void language plpgsql volatile security definer set search_path=''
as $function$
declare scope_json jsonb; target record;
begin
  scope_json:=command_json->'scope';
  perform app_data_agent.lock_u6_authority_capability(
    envelope_json,'RESEARCH_ARTIFACT_AUTHORITY','EVIDENCE',null,null,true
  );
  select attempts.attempt_id into target
  from app_data_agent.runs as runs
  join app_data_agent.run_attempts as attempts
    on attempts.app_id=runs.app_id and attempts.tenant_id=runs.tenant_id
    and attempts.environment=runs.environment and attempts.run_id=runs.run_id
  join app_data_agent.outbox as outbox
    on outbox.app_id=attempts.app_id and outbox.tenant_id=attempts.tenant_id
    and outbox.environment=attempts.environment and outbox.outbox_id=attempts.outbox_id
  where runs.app_id=(scope_json->>'app_id')::uuid
    and runs.tenant_id=(scope_json->>'tenant_id')::uuid
    and runs.environment=scope_json->>'environment'
    and runs.run_id=(command_json->>'run_id')::uuid
    and runs.principal_id=(command_json->>'principal_id')::uuid
    and attempts.attempt_id=(command_json->>'attempt_id')::uuid
    and attempts.status='ACTIVE'
    and attempts.worker_fence=(command_json->>'worker_fence')::bigint
    and attempts.lease_expires_at>pg_catalog.clock_timestamp()
    and outbox.active_attempt_id=attempts.attempt_id
    and outbox.run_fence=attempts.worker_fence
  for update of runs,attempts,outbox nowait;
  if target.attempt_id is null then
    raise exception using errcode='42501',message='DA_U6_CAPABILITY_REQUIRED';
  end if;
end
$function$;

create function app_data_agent.analysis_journal_transition_allowed(previous_event text,next_event text)
returns boolean language sql immutable strict set search_path=''
as $function$
  select case previous_event
    when 'MODEL_CELL_COMMITTED' then next_event in ('MODEL_CELL_COMMITTED','OPERATOR_INTENT_COMMITTED','PUBLISH_STAGE_CREATED')
    when 'OPERATOR_INTENT_COMMITTED' then next_event='OPERATOR_RESULT_COMMITTED'
    when 'OPERATOR_RESULT_COMMITTED' then next_event='SERVER_BINDING_COMMITTED'
    when 'SERVER_BINDING_COMMITTED' then next_event in ('MODEL_CELL_COMMITTED','OPERATOR_INTENT_COMMITTED','PUBLISH_STAGE_CREATED')
    when 'PUBLISH_STAGE_CREATED' then next_event='CONTEXT_FROZEN'
    when 'CONTEXT_FROZEN' then next_event='ORACLE_VERIFIED'
    when 'ORACLE_VERIFIED' then next_event='EXPLANATION_BOUND'
    when 'EXPLANATION_BOUND' then next_event='AUTHORITY_COMMITTED'
    when 'AUTHORITY_COMMITTED' then next_event='CLEANUP_VERIFIED'
    else false end
$function$;

create function app_data_agent.append_analysis_context_journal(envelope_json jsonb)
returns jsonb language plpgsql volatile security definer set search_path=''
as $function$
declare
  command_json jsonb; scope_json jsonb; event_json jsonb; previous record;
  next_seq integer; next_hash text; created_at timestamptz; entry_json jsonb;
begin
  command_json:=envelope_json->'command'; scope_json:=command_json->'scope'; event_json:=command_json->'event';
  if envelope_json->>'protocol_version'<>'u6-db-command@1.0.0'
    or pg_catalog.jsonb_typeof(command_json)<>'object'
    or (select pg_catalog.count(*) from pg_catalog.jsonb_object_keys(command_json))<>15
    or command_json->>'schema_version'<>'analysis-context-journal-append@1.0.0'
    or pg_catalog.jsonb_typeof(scope_json)<>'object'
    or pg_catalog.jsonb_typeof(event_json)<>'object'
    or command_json->>'run_id' is null or command_json->>'principal_id' is null
  then return pg_catalog.jsonb_build_object('ok',false,'error_code','ANALYSIS_CONTEXT_JOURNAL_CONTRACT_INVALID'); end if;

  perform app_data_agent.assert_analysis_lifecycle_fence(envelope_json,command_json);
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    (scope_json->>'app_id')||':'||(scope_json->>'tenant_id')||':'||(scope_json->>'environment')||':'||
    (command_json->>'run_id')||':'||(command_json->>'node_id')||':'||(command_json->>'attempt_id')||':'||
    (command_json->>'context_generation'),0
  ));

  select source.* into previous from app_data_agent.analysis_context_journal as source
  where source.app_id=(scope_json->>'app_id')::uuid and source.tenant_id=(scope_json->>'tenant_id')::uuid
    and source.environment=scope_json->>'environment' and source.run_id=(command_json->>'run_id')::uuid
    and source.node_id=command_json->>'node_id' and source.attempt_id=(command_json->>'attempt_id')::uuid
    and source.context_generation=(command_json->>'context_generation')::integer
  order by source.seq desc limit 1 for update;

  if previous.append_hash=command_json->>'append_hash' then
    return pg_catalog.jsonb_build_object('ok',true,'entry',previous.entry_json);
  end if;
  next_seq:=pg_catalog.coalesce(previous.seq,0)+1;
  if (command_json->>'expected_prev_seq')::integer<>next_seq-1
    or command_json->>'expected_prev_entry_hash' is distinct from previous.entry_hash
    or (previous.seq is null and event_json->>'event_type'<>'MODEL_CELL_COMMITTED')
    or (previous.seq is not null and not app_data_agent.analysis_journal_transition_allowed(
      previous.event_json->>'event_type',event_json->>'event_type'))
  then return pg_catalog.jsonb_build_object('ok',false,'error_code','ANALYSIS_CONTEXT_JOURNAL_CONFLICT'); end if;

  created_at:=pg_catalog.clock_timestamp();
  next_hash:=app_data_agent.u6_domain_sha256('analysis-context-journal-entry@1.0.0',
    pg_catalog.jsonb_build_object('command',command_json,'seq',next_seq,'prev_entry_hash',previous.entry_hash));
  entry_json:=command_json||pg_catalog.jsonb_build_object(
    'schema_version','analysis-context-journal-entry@1.0.0','seq',next_seq,
    'prev_entry_hash',previous.entry_hash,'entry_hash',next_hash,'created_at',created_at
  );
  insert into app_data_agent.analysis_context_journal(
    app_id,tenant_id,environment,run_id,node_id,attempt_id,context_generation,seq,
    principal_id,worker_fence,prev_entry_hash,entry_hash,append_hash,runtime_digest,
    policy_version,operator_registry_digest,event_json,entry_json,created_at
  ) values (
    (scope_json->>'app_id')::uuid,(scope_json->>'tenant_id')::uuid,scope_json->>'environment',
    (command_json->>'run_id')::uuid,command_json->>'node_id',(command_json->>'attempt_id')::uuid,
    (command_json->>'context_generation')::integer,next_seq,(command_json->>'principal_id')::uuid,
    (command_json->>'worker_fence')::bigint,previous.entry_hash,next_hash,command_json->>'append_hash',
    command_json->>'runtime_digest',command_json->>'policy_version',command_json->>'operator_registry_digest',
    event_json,entry_json,created_at
  );
  return pg_catalog.jsonb_build_object('ok',true,'entry',entry_json);
end
$function$;

create function app_data_agent.commit_governed_operator_result(envelope_json jsonb,content_bytes bytea)
returns jsonb language plpgsql volatile security definer set search_path=''
as $function$
declare
  command_json jsonb; journal_json jsonb; result_json jsonb; scope_json jsonb;
  existing record; observed_hash text; journal_result jsonb; created_count bigint;
begin
  command_json:=envelope_json->'command'; journal_json:=envelope_json->'journal_command';
  result_json:=command_json->'result'; scope_json:=result_json->'scope';
  if envelope_json->>'protocol_version'<>'u6-db-command@1.0.0'
    or pg_catalog.jsonb_typeof(command_json)<>'object' or pg_catalog.jsonb_typeof(journal_json)<>'object'
    or command_json->>'schema_version'<>'governed-operator-result-commit@1.0.0'
    or pg_catalog.octet_length(content_bytes) not between 1 and 16777216
    or journal_json->'event'->>'event_type'<>'OPERATOR_RESULT_COMMITTED'
    or journal_json->'event'->'governed_result' is distinct from result_json
  then return pg_catalog.jsonb_build_object('ok',false,'error_code','GOVERNED_OPERATOR_RESULT_CONTRACT_INVALID'); end if;
  observed_hash:='sha256:'||pg_catalog.encode(extensions.digest(content_bytes,'sha256'),'hex');
  if observed_hash<>result_json->>'result_sha256'
  then return pg_catalog.jsonb_build_object('ok',false,'error_code','GOVERNED_OPERATOR_RESULT_CONTENT_HASH_MISMATCH'); end if;

  perform app_data_agent.assert_analysis_lifecycle_fence(
    envelope_json,
    pg_catalog.jsonb_build_object(
      'scope',scope_json,'run_id',result_json->>'run_id','principal_id',command_json->>'principal_id',
      'attempt_id',result_json->>'attempt_id','worker_fence',result_json->>'worker_fence'
    )
  );
  select source.* into existing from app_data_agent.analysis_operator_results as source
  where source.app_id=(scope_json->>'app_id')::uuid and source.tenant_id=(scope_json->>'tenant_id')::uuid
    and source.environment=scope_json->>'environment' and source.run_id=(result_json->>'run_id')::uuid
    and source.principal_id=(command_json->>'principal_id')::uuid
    and source.idempotency_key=command_json->>'idempotency_key';
  if existing.call_id is not null and existing.commit_hash<>command_json->>'commit_hash'
  then return pg_catalog.jsonb_build_object('ok',false,'error_code','GOVERNED_OPERATOR_RESULT_IDEMPOTENCY_CONFLICT'); end if;

  begin
    if existing.call_id is null then
      insert into app_data_agent.analysis_operator_results(
        app_id,tenant_id,environment,run_id,node_id,attempt_id,context_generation,call_id,operator_id,
        principal_id,worker_fence,idempotency_key,request_sha256,result_sha256,result_bytes,
        result_ref_json,receipt_ref_json,receipt_payload_json,result_content,commit_hash
      ) values (
        (scope_json->>'app_id')::uuid,(scope_json->>'tenant_id')::uuid,scope_json->>'environment',
        (result_json->>'run_id')::uuid,result_json->>'node_id',(result_json->>'attempt_id')::uuid,
        (result_json->>'context_generation')::integer,result_json->>'call_id',result_json->>'operator_id',
        (command_json->>'principal_id')::uuid,(result_json->>'worker_fence')::bigint,
        command_json->>'idempotency_key',result_json->>'request_sha256',result_json->>'result_sha256',
        (result_json->>'result_bytes')::integer,result_json->'result_artifact_ref',result_json->'receipt_ref',
        command_json->'result_receipt_payload',content_bytes,command_json->>'commit_hash'
      );
      get diagnostics created_count=row_count;
    else created_count:=0; end if;
    journal_result:=app_data_agent.append_analysis_context_journal(
      pg_catalog.jsonb_build_object(
        'protocol_version','u6-db-command@1.0.0',
        'authority_capability_id',envelope_json->>'authority_capability_id',
        'command',journal_json
      )
    );
    if not (journal_result->>'ok')::boolean then
      raise exception using errcode='P0001',message='GOVERNED_OPERATOR_RESULT_JOURNAL_REJECTED';
    end if;
  exception when sqlstate 'P0001' then
    return pg_catalog.jsonb_build_object('ok',false,'error_code','ANALYSIS_CONTEXT_JOURNAL_CONFLICT');
  end;
  return pg_catalog.jsonb_build_object(
    'ok',true,'created',created_count=1,'result',result_json,'journal_entry',journal_result->'entry'
  );
end
$function$;

create function app_data_agent.read_governed_operator_result(envelope_json jsonb)
returns table(result jsonb,content_bytes bytea)
language plpgsql volatile security definer set search_path=''
as $function$
declare command_json jsonb; result_json jsonb; scope_json jsonb; stored record;
begin
  command_json:=envelope_json->'command'; result_json:=command_json->'result'; scope_json:=result_json->'scope';
  perform app_data_agent.lock_u6_authority_capability(
    envelope_json,'RESEARCH_ARTIFACT_AUTHORITY','EVIDENCE',null,null,false
  );
  select source.* into stored from app_data_agent.analysis_operator_results as source
  where source.app_id=(scope_json->>'app_id')::uuid and source.tenant_id=(scope_json->>'tenant_id')::uuid
    and source.environment=scope_json->>'environment' and source.run_id=(result_json->>'run_id')::uuid
    and source.node_id=result_json->>'node_id' and source.attempt_id=(result_json->>'attempt_id')::uuid
    and source.context_generation=(result_json->>'context_generation')::integer
    and source.call_id=result_json->>'call_id' and source.operator_id=result_json->>'operator_id'
    and source.result_sha256=result_json->>'result_sha256';
  if stored.call_id is null then
    return query select pg_catalog.jsonb_build_object('ok',false,'error_code','GOVERNED_OPERATOR_RESULT_NOT_FOUND'),null::bytea;
  else
    return query select pg_catalog.jsonb_build_object('ok',true),stored.result_content;
  end if;
end
$function$;

create function app_data_agent.read_analysis_context_journal(envelope_json jsonb)
returns jsonb language plpgsql volatile security definer set search_path=''
as $function$
declare command_json jsonb; scope_json jsonb; entries jsonb;
begin
  command_json:=envelope_json->'command'; scope_json:=command_json->'scope';
  perform app_data_agent.lock_u6_authority_capability(
    envelope_json,'RESEARCH_ARTIFACT_AUTHORITY','EVIDENCE',null,null,false
  );
  select pg_catalog.coalesce(pg_catalog.jsonb_agg(source.entry_json order by source.seq),'[]'::jsonb)
  into entries from app_data_agent.analysis_context_journal as source
  where source.app_id=(scope_json->>'app_id')::uuid and source.tenant_id=(scope_json->>'tenant_id')::uuid
    and source.environment=scope_json->>'environment' and source.run_id=(command_json->>'run_id')::uuid
    and source.node_id=command_json->>'node_id' and source.attempt_id=(command_json->>'attempt_id')::uuid
    and source.context_generation=(command_json->>'context_generation')::integer;
  return pg_catalog.jsonb_build_object('ok',true,'entries',entries);
end
$function$;

alter table app_data_agent.analysis_python_sources
  drop constraint analysis_python_sources_generation_attempt_check;
alter table app_data_agent.analysis_python_sources
  add constraint analysis_python_sources_generation_attempt_check
  check (generation_attempt between 0 and 31);

do $widen_model_cell_sequence$
declare function_definition text;
begin
  select pg_catalog.pg_get_functiondef(
    'app_data_agent.commit_analysis_python_source(jsonb,bytea)'::pg_catalog.regprocedure
  ) into strict function_definition;
  if pg_catalog.strpos(function_definition,'not in (0,1)')=0 then
    raise exception using errcode='P0001',message='ANALYSIS_MODEL_CELL_SEQUENCE_SOURCE_MISMATCH';
  end if;
  execute pg_catalog.replace(function_definition,'not in (0,1)','not between 0 and 31');
end
$widen_model_cell_sequence$;

create function app_data_agent.read_analysis_context_model_cell_source(envelope_json jsonb)
returns jsonb language plpgsql volatile security definer set search_path=''
as $function$
declare command_json jsonb; scope_json jsonb; source_ref jsonb; stored record;
begin
  command_json:=envelope_json->'command'; scope_json:=command_json->'scope'; source_ref:=command_json->'source_ref';
  if envelope_json->>'protocol_version'<>'u6-db-command@1.0.0'
    or pg_catalog.jsonb_typeof(command_json)<>'object'
    or (select pg_catalog.count(*) from pg_catalog.jsonb_object_keys(command_json))<>10
    or command_json->>'schema_version'<>'analysis-context-model-cell-source-read@1.0.0'
    or source_ref->>'artifact_type'<>'SensitiveExecutionArtifact'
    or source_ref->>'run_id'<>command_json->>'run_id'
  then return pg_catalog.jsonb_build_object('ok',false,'error_code','ANALYSIS_CONTEXT_MODEL_CELL_SOURCE_CONTRACT_INVALID'); end if;
  perform app_data_agent.assert_analysis_lifecycle_fence(envelope_json,command_json);
  select sources.* into stored
  from app_data_agent.analysis_context_journal as journal
  join app_data_agent.analysis_python_sources as sources
    on sources.app_id=journal.app_id and sources.tenant_id=journal.tenant_id
    and sources.environment=journal.environment and sources.run_id=journal.run_id
    and sources.artifact_id=(journal.event_json->'source_ref'->>'artifact_id')::uuid
    and sources.revision=(journal.event_json->'source_ref'->>'revision')::integer
    and sources.plaintext_hash=journal.event_json->>'source_sha256'
  where journal.app_id=(scope_json->>'app_id')::uuid
    and journal.tenant_id=(scope_json->>'tenant_id')::uuid
    and journal.environment=scope_json->>'environment'
    and journal.run_id=(command_json->>'run_id')::uuid
    and journal.node_id=command_json->>'node_id'
    and journal.attempt_id=(command_json->>'attempt_id')::uuid
    and journal.context_generation=(command_json->>'context_generation')::integer
    and journal.seq=(command_json->>'journal_seq')::integer
    and journal.event_json->>'event_type'='MODEL_CELL_COMMITTED'
    and journal.event_json->'source_ref'=source_ref
    and journal.principal_id=(command_json->>'principal_id')::uuid;
  if stored.artifact_id is null then
    return pg_catalog.jsonb_build_object('ok',false,'error_code','ANALYSIS_CONTEXT_MODEL_CELL_SOURCE_NOT_FOUND');
  end if;
  return pg_catalog.jsonb_build_object(
    'ok',true,'receipt',stored.receipt_json,
    'ciphertext_base64',pg_catalog.replace(pg_catalog.replace(
      pg_catalog.encode(stored.ciphertext_bytes,'base64'),pg_catalog.chr(10),''),pg_catalog.chr(13),'')
  );
exception when invalid_text_representation or numeric_value_out_of_range then
  return pg_catalog.jsonb_build_object('ok',false,'error_code','ANALYSIS_CONTEXT_MODEL_CELL_SOURCE_CONTRACT_INVALID');
end
$function$;

create table app_data_agent.analysis_result_stages (
  app_id uuid not null, tenant_id uuid not null, environment text not null, run_id uuid not null,
  node_id text not null, attempt_id uuid not null, context_generation integer not null check(context_generation>=1),
  stage_id uuid not null, principal_id uuid not null, worker_fence bigint not null check(worker_fence>=1),
  idempotency_key text not null check(pg_catalog.length(idempotency_key) between 8 and 256),
  publish_id text not null, contract_hash text not null check(contract_hash~'^sha256:[0-9a-f]{64}$'),
  manifest_hash text not null check(manifest_hash~'^sha256:[0-9a-f]{64}$'),
  closure_hash text not null check(closure_hash~'^sha256:[0-9a-f]{64}$'),
  stage_hash text not null check(stage_hash~'^sha256:[0-9a-f]{64}$'),
  governed_results_json jsonb not null check(pg_catalog.jsonb_typeof(governed_results_json)='array'),
  artifacts_json jsonb not null check(pg_catalog.jsonb_typeof(artifacts_json)='array'),
  command_json jsonb not null check(pg_catalog.jsonb_typeof(command_json)='object'),
  expires_at timestamptz not null, committed_at timestamptz not null default pg_catalog.clock_timestamp(),
  primary key(app_id,tenant_id,environment,run_id,node_id,attempt_id,context_generation,stage_id),
  unique(app_id,tenant_id,environment,run_id,principal_id,idempotency_key),
  foreign key(app_id,tenant_id,environment,run_id)
    references app_data_agent.runs(app_id,tenant_id,environment,run_id) on delete restrict,
  foreign key(app_id,tenant_id,environment,attempt_id)
    references app_data_agent.run_attempts(app_id,tenant_id,environment,attempt_id) on delete restrict
);

create table app_data_agent.analysis_result_stage_artifacts (
  app_id uuid not null, tenant_id uuid not null, environment text not null, run_id uuid not null,
  node_id text not null, attempt_id uuid not null, context_generation integer not null,
  stage_id uuid not null, artifact_name text not null, artifact_kind text not null check(artifact_kind in('RESULT','TABLE','CHART')),
  media_type text not null check(media_type='application/json'), content_sha256 text not null check(content_sha256~'^sha256:[0-9a-f]{64}$'),
  byte_count integer not null check(byte_count between 0 and 67108864), content_bytes bytea not null,
  primary key(app_id,tenant_id,environment,run_id,node_id,attempt_id,context_generation,stage_id,artifact_name),
  foreign key(app_id,tenant_id,environment,run_id,node_id,attempt_id,context_generation,stage_id)
    references app_data_agent.analysis_result_stages(app_id,tenant_id,environment,run_id,node_id,attempt_id,context_generation,stage_id)
    on delete restrict
);

create table app_data_agent.analysis_authority_commits (
  app_id uuid not null, tenant_id uuid not null, environment text not null, run_id uuid not null,
  node_id text not null, stage_id uuid not null, principal_id uuid not null, attempt_id uuid not null,
  worker_fence bigint not null, idempotency_key text not null,
  authority_commit_hash text not null check(authority_commit_hash~'^sha256:[0-9a-f]{64}$'),
  command_json jsonb not null, receipt_json jsonb not null, committed_at timestamptz not null default pg_catalog.clock_timestamp(),
  primary key(app_id,tenant_id,environment,run_id,node_id,stage_id),
  unique(app_id,tenant_id,environment,run_id,principal_id,idempotency_key)
);

create table app_data_agent.analysis_authority_current (
  app_id uuid not null, tenant_id uuid not null, environment text not null, run_id uuid not null,
  node_id text not null, stage_id uuid not null, stage_hash text not null,
  authority_commit_hash text not null, public_event_id uuid not null, committed_at timestamptz not null,
  primary key(app_id,tenant_id,environment,run_id,node_id)
);

create table app_data_agent.analysis_authority_outbox (
  app_id uuid not null, tenant_id uuid not null, environment text not null, run_id uuid not null,
  public_event_id uuid not null, node_id text not null, stage_id uuid not null,
  authority_commit_hash text not null, payload_json jsonb not null,
  delivery_status text not null default 'PENDING' check(delivery_status in('PENDING','DELIVERED')),
  created_at timestamptz not null default pg_catalog.clock_timestamp(), delivered_at timestamptz,
  primary key(app_id,tenant_id,environment,run_id,public_event_id)
);

create trigger analysis_result_stages_immutable before update or delete
on app_data_agent.analysis_result_stages for each row execute function app_data_agent.analysis_governed_state_immutable();
create trigger analysis_result_stage_artifacts_immutable before update or delete
on app_data_agent.analysis_result_stage_artifacts for each row execute function app_data_agent.analysis_governed_state_immutable();
create trigger analysis_authority_commits_immutable before update or delete
on app_data_agent.analysis_authority_commits for each row execute function app_data_agent.analysis_governed_state_immutable();
create trigger analysis_authority_current_immutable before update or delete
on app_data_agent.analysis_authority_current for each row execute function app_data_agent.analysis_governed_state_immutable();

create function app_data_agent.stage_analysis_result(envelope_json jsonb,contents_json jsonb)
returns jsonb language plpgsql volatile security definer set search_path=''
as $function$
declare
  command_json jsonb; journal_json jsonb; scope_json jsonb; existing record; journal_result jsonb;
  artifact_record record; content_bytes bytea; observed_hash text; created_count bigint; stage_result jsonb;
begin
  command_json:=envelope_json->'command'; journal_json:=envelope_json->'journal_command'; scope_json:=command_json->'scope';
  if envelope_json->>'protocol_version'<>'u6-db-command@1.0.0'
    or command_json->>'schema_version'<>'analysis-result-stage-command@1.0.0'
    or pg_catalog.jsonb_typeof(contents_json)<>'array'
    or pg_catalog.jsonb_array_length(contents_json)<>pg_catalog.jsonb_array_length(command_json->'artifacts')
    or journal_json->'event'->>'event_type'<>'PUBLISH_STAGE_CREATED'
    or journal_json->'event'->>'stage_id'<>command_json->>'stage_id'
    or journal_json->'event'->>'stage_hash'<>command_json->>'stage_hash'
    or journal_json->'event'->>'closure_hash'<>command_json->>'closure_hash'
  then return pg_catalog.jsonb_build_object('ok',false,'error_code','ANALYSIS_RESULT_STAGE_CONTRACT_INVALID'); end if;
  perform app_data_agent.assert_analysis_lifecycle_fence(envelope_json,command_json);
  select source.* into existing from app_data_agent.analysis_result_stages as source
  where source.app_id=(scope_json->>'app_id')::uuid and source.tenant_id=(scope_json->>'tenant_id')::uuid
    and source.environment=scope_json->>'environment' and source.run_id=(command_json->>'run_id')::uuid
    and source.principal_id=(command_json->>'principal_id')::uuid and source.idempotency_key=command_json->>'idempotency_key';
  if existing.stage_id is not null and existing.stage_hash<>command_json->>'stage_hash' then
    return pg_catalog.jsonb_build_object('ok',false,'error_code','ANALYSIS_RESULT_STAGE_IDEMPOTENCY_CONFLICT');
  end if;
  begin
    if existing.stage_id is null then
      insert into app_data_agent.analysis_result_stages(
        app_id,tenant_id,environment,run_id,node_id,attempt_id,context_generation,stage_id,principal_id,worker_fence,
        idempotency_key,publish_id,contract_hash,manifest_hash,closure_hash,stage_hash,governed_results_json,
        artifacts_json,command_json,expires_at
      ) values (
        (scope_json->>'app_id')::uuid,(scope_json->>'tenant_id')::uuid,scope_json->>'environment',
        (command_json->>'run_id')::uuid,command_json->>'node_id',(command_json->>'attempt_id')::uuid,
        (command_json->>'context_generation')::integer,(command_json->>'stage_id')::uuid,
        (command_json->>'principal_id')::uuid,(command_json->>'worker_fence')::bigint,command_json->>'idempotency_key',
        command_json->>'publish_id',command_json->>'contract_hash',command_json->>'manifest_hash',
        command_json->>'closure_hash',command_json->>'stage_hash',command_json->'governed_operator_results',
        command_json->'artifacts',command_json,(command_json->>'expires_at')::timestamptz
      );
      for artifact_record in
        select value,ordinality from pg_catalog.jsonb_array_elements(command_json->'artifacts') with ordinality
      loop
        content_bytes:=pg_catalog.decode(contents_json->>(artifact_record.ordinality-1),'base64');
        observed_hash:='sha256:'||pg_catalog.encode(extensions.digest(content_bytes,'sha256'),'hex');
        if observed_hash<>artifact_record.value->>'content_sha256'
          or pg_catalog.octet_length(content_bytes)<>(artifact_record.value->>'bytes')::integer
        then raise exception using errcode='P0001',message='ANALYSIS_RESULT_STAGE_CONTENT_HASH_MISMATCH'; end if;
        insert into app_data_agent.analysis_result_stage_artifacts(
          app_id,tenant_id,environment,run_id,node_id,attempt_id,context_generation,stage_id,
          artifact_name,artifact_kind,media_type,content_sha256,byte_count,content_bytes
        ) values (
          (scope_json->>'app_id')::uuid,(scope_json->>'tenant_id')::uuid,scope_json->>'environment',
          (command_json->>'run_id')::uuid,command_json->>'node_id',(command_json->>'attempt_id')::uuid,
          (command_json->>'context_generation')::integer,(command_json->>'stage_id')::uuid,
          artifact_record.value->>'artifact_name',artifact_record.value->>'artifact_kind',
          artifact_record.value->>'media_type',observed_hash,pg_catalog.octet_length(content_bytes),content_bytes
        );
      end loop;
      created_count:=1;
    else created_count:=0; end if;
    journal_result:=app_data_agent.append_analysis_context_journal(pg_catalog.jsonb_build_object(
      'protocol_version','u6-db-command@1.0.0','authority_capability_id',envelope_json->>'authority_capability_id','command',journal_json));
    if not (journal_result->>'ok')::boolean then
      raise exception using errcode='P0001',message='ANALYSIS_RESULT_STAGE_JOURNAL_REJECTED';
    end if;
  exception when sqlstate 'P0001' then
    return pg_catalog.jsonb_build_object('ok',false,'error_code',sqlerrm);
  end;
  stage_result:=pg_catalog.jsonb_build_object(
    'schema_version','analysis-result-stage@1.0.0','stage_id',command_json->>'stage_id',
    'stage_hash',command_json->>'stage_hash','closure_hash',command_json->>'closure_hash',
    'status','STAGED','created',created_count=1,'expires_at',command_json->>'expires_at');
  return pg_catalog.jsonb_build_object('ok',true,'stage',stage_result,'journal_entry',journal_result->'entry');
exception when invalid_text_representation or numeric_value_out_of_range or datetime_field_overflow then
  return pg_catalog.jsonb_build_object('ok',false,'error_code','ANALYSIS_RESULT_STAGE_CONTRACT_INVALID');
end
$function$;

create function app_data_agent.read_analysis_result_stage(envelope_json jsonb)
returns jsonb language plpgsql volatile security definer set search_path=''
as $function$
declare command_json jsonb; scope_json jsonb; stored record; artifacts jsonb;
begin
  command_json:=envelope_json->'command'; scope_json:=command_json->'scope';
  perform app_data_agent.assert_analysis_lifecycle_fence(envelope_json,command_json);
  select source.* into stored from app_data_agent.analysis_result_stages as source
  where source.app_id=(scope_json->>'app_id')::uuid and source.tenant_id=(scope_json->>'tenant_id')::uuid
    and source.environment=scope_json->>'environment' and source.run_id=(command_json->>'run_id')::uuid
    and source.node_id=command_json->>'node_id' and source.attempt_id=(command_json->>'attempt_id')::uuid
    and source.context_generation=(command_json->>'context_generation')::integer
    and source.stage_id=(command_json->>'stage_id')::uuid and source.stage_hash=command_json->>'stage_hash';
  if stored.stage_id is null then return pg_catalog.jsonb_build_object('ok',false,'error_code','ANALYSIS_RESULT_STAGE_NOT_FOUND'); end if;
  select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
    'artifact_name',source.artifact_name,'artifact_kind',source.artifact_kind,'media_type',source.media_type,
    'content_sha256',source.content_sha256,'bytes',source.byte_count,
    'content_base64',pg_catalog.replace(pg_catalog.replace(pg_catalog.encode(source.content_bytes,'base64'),pg_catalog.chr(10),''),pg_catalog.chr(13),'')
  ) order by source.artifact_name) into artifacts
  from app_data_agent.analysis_result_stage_artifacts as source
  where source.app_id=stored.app_id and source.tenant_id=stored.tenant_id and source.environment=stored.environment
    and source.run_id=stored.run_id and source.node_id=stored.node_id and source.attempt_id=stored.attempt_id
    and source.context_generation=stored.context_generation and source.stage_id=stored.stage_id;
  return pg_catalog.jsonb_build_object(
    'ok',true,'stage_command',stored.command_json,'artifacts',artifacts);
exception when invalid_text_representation then
  return pg_catalog.jsonb_build_object('ok',false,'error_code','ANALYSIS_RESULT_STAGE_READ_CONTRACT_INVALID');
end
$function$;

create function app_data_agent.commit_analysis_authority(envelope_json jsonb)
returns jsonb language plpgsql volatile security definer set search_path=''
as $function$
declare
  command_json jsonb; journal_json jsonb; scope_json jsonb; stage_record record; existing record;
  binding_record record; staged_artifact record; receipt_ref jsonb; journal_result jsonb; references_json jsonb;
  receipt_json jsonb; input_hash text; created_count bigint;
begin
  command_json:=envelope_json->'command'; journal_json:=envelope_json->'journal_command'; scope_json:=command_json->'scope';
  if envelope_json->>'protocol_version'<>'u6-db-command@1.0.0'
    or command_json->>'schema_version'<>'analysis-authority-commit@1.0.0'
    or journal_json->'event'->>'event_type'<>'AUTHORITY_COMMITTED'
    or journal_json->'event'->>'stage_id'<>command_json->>'stage_id'
    or journal_json->'event'->>'authority_commit_hash'<>command_json->>'authority_commit_hash'
    or app_data_agent.u2_canonical_sha256(command_json->'oracle_receipt_payload')<>command_json->>'oracle_receipt_hash'
    or app_data_agent.u2_canonical_sha256(command_json->'explanation')<>command_json->>'explanation_hash'
    or app_data_agent.u2_canonical_sha256(command_json->'sandbox_receipt_payload')<>command_json->>'sandbox_receipt_hash'
    or app_data_agent.u2_canonical_sha256(pg_catalog.jsonb_build_object(
      'hash_domain','analysis-authority-commit@1.0.0','value',command_json-'authority_commit_hash'))<>command_json->>'authority_commit_hash'
  then return pg_catalog.jsonb_build_object('ok',false,'error_code','ANALYSIS_AUTHORITY_COMMIT_CONTRACT_INVALID'); end if;
  perform app_data_agent.assert_analysis_lifecycle_fence(envelope_json,command_json);
  select source.* into stage_record from app_data_agent.analysis_result_stages as source
  where source.app_id=(scope_json->>'app_id')::uuid and source.tenant_id=(scope_json->>'tenant_id')::uuid
    and source.environment=scope_json->>'environment' and source.run_id=(command_json->>'run_id')::uuid
    and source.node_id=command_json->>'node_id' and source.attempt_id=(command_json->>'attempt_id')::uuid
    and source.stage_id=(command_json->>'stage_id')::uuid and source.stage_hash=command_json->>'stage_hash'
    and source.closure_hash=command_json->>'closure_hash' and source.expires_at>pg_catalog.clock_timestamp()
  for share of source;
  if stage_record.stage_id is null
    or pg_catalog.jsonb_array_length(command_json->'output_bindings')<>pg_catalog.jsonb_array_length(stage_record.artifacts_json)
  then return pg_catalog.jsonb_build_object('ok',false,'error_code','ANALYSIS_AUTHORITY_STAGE_INVALID'); end if;
  select source.* into existing from app_data_agent.analysis_authority_commits as source
  where source.app_id=stage_record.app_id and source.tenant_id=stage_record.tenant_id
    and source.environment=stage_record.environment and source.run_id=stage_record.run_id
    and source.principal_id=(command_json->>'principal_id')::uuid and source.idempotency_key=command_json->>'idempotency_key';
  if existing.stage_id is not null and existing.authority_commit_hash<>command_json->>'authority_commit_hash' then
    return pg_catalog.jsonb_build_object('ok',false,'error_code','ANALYSIS_AUTHORITY_IDEMPOTENCY_CONFLICT');
  end if;
  begin
    if existing.stage_id is null then
      for binding_record in select value from pg_catalog.jsonb_array_elements(command_json->'output_bindings') loop
        select source.* into staged_artifact from app_data_agent.analysis_result_stage_artifacts as source
        where source.app_id=stage_record.app_id and source.tenant_id=stage_record.tenant_id
          and source.environment=stage_record.environment and source.run_id=stage_record.run_id
          and source.node_id=stage_record.node_id and source.attempt_id=stage_record.attempt_id
          and source.context_generation=stage_record.context_generation and source.stage_id=stage_record.stage_id
          and source.artifact_name=binding_record.value->'stage_artifact'->>'artifact_name';
        if staged_artifact.artifact_name is null
          or staged_artifact.artifact_kind<>binding_record.value->'stage_artifact'->>'artifact_kind'
          or staged_artifact.content_sha256<>binding_record.value->'stage_artifact'->>'content_sha256'
          or staged_artifact.content_sha256<>binding_record.value->'reference'->>'content_hash'
        then raise exception using errcode='P0001',message='ANALYSIS_AUTHORITY_OUTPUT_BINDING_INVALID'; end if;
        input_hash:=app_data_agent.u6_domain_sha256('analysis-system-artifact-input@1.0.0',pg_catalog.jsonb_build_object(
          'command',binding_record.value,'content_hash',staged_artifact.content_sha256));
        insert into app_data_agent.analysis_system_artifacts(
          app_id,tenant_id,environment,run_id,artifact_id,artifact_type,revision,content_hash,principal_id,
          idempotency_key,attempt_id,worker_fence,input_hash,payload_json,content_bytes
        ) values (
          stage_record.app_id,stage_record.tenant_id,stage_record.environment,stage_record.run_id,
          (binding_record.value->'reference'->>'artifact_id')::uuid,'SandboxResult',1,staged_artifact.content_sha256,
          (command_json->>'principal_id')::uuid,(command_json->>'idempotency_key')||':'||staged_artifact.artifact_name,
          stage_record.attempt_id,stage_record.worker_fence,input_hash,
          pg_catalog.jsonb_build_object('stage_id',stage_record.stage_id,'artifact',binding_record.value->'stage_artifact'),
          staged_artifact.content_bytes
        );
      end loop;
      receipt_ref:=command_json->'sandbox_receipt_ref';
      input_hash:=app_data_agent.u6_domain_sha256('analysis-system-artifact-input@1.0.0',pg_catalog.jsonb_build_object(
        'command',command_json->'sandbox_receipt_payload','content_hash',command_json->>'sandbox_receipt_hash'));
      insert into app_data_agent.analysis_system_artifacts(
        app_id,tenant_id,environment,run_id,artifact_id,artifact_type,revision,content_hash,principal_id,
        idempotency_key,attempt_id,worker_fence,input_hash,payload_json,content_bytes
      ) values (
        stage_record.app_id,stage_record.tenant_id,stage_record.environment,stage_record.run_id,
        (receipt_ref->>'artifact_id')::uuid,'SandboxExecutionReceipt',1,command_json->>'sandbox_receipt_hash',
        (command_json->>'principal_id')::uuid,(command_json->>'idempotency_key')||':receipt',
        stage_record.attempt_id,stage_record.worker_fence,input_hash,command_json->'sandbox_receipt_payload',null
      );
      references_json:=(select pg_catalog.jsonb_agg(value->'reference') from pg_catalog.jsonb_array_elements(command_json->'output_bindings'))
        ||pg_catalog.jsonb_build_array(receipt_ref);
      receipt_json:=pg_catalog.jsonb_build_object(
        'schema_version','analysis-authority-commit-receipt@1.0.0','created',true,
        'authority_commit_hash',command_json->>'authority_commit_hash','stage_id',command_json->>'stage_id',
        'stage_hash',command_json->>'stage_hash','references',references_json,'public_event_id',command_json->>'public_event_id');
      insert into app_data_agent.analysis_authority_commits(
        app_id,tenant_id,environment,run_id,node_id,stage_id,principal_id,attempt_id,worker_fence,
        idempotency_key,authority_commit_hash,command_json,receipt_json
      ) values (
        stage_record.app_id,stage_record.tenant_id,stage_record.environment,stage_record.run_id,stage_record.node_id,
        stage_record.stage_id,(command_json->>'principal_id')::uuid,stage_record.attempt_id,stage_record.worker_fence,
        command_json->>'idempotency_key',command_json->>'authority_commit_hash',command_json,receipt_json);
      insert into app_data_agent.analysis_authority_current(
        app_id,tenant_id,environment,run_id,node_id,stage_id,stage_hash,authority_commit_hash,public_event_id,committed_at
      ) values (
        stage_record.app_id,stage_record.tenant_id,stage_record.environment,stage_record.run_id,stage_record.node_id,
        stage_record.stage_id,stage_record.stage_hash,command_json->>'authority_commit_hash',
        (command_json->>'public_event_id')::uuid,pg_catalog.clock_timestamp());
      insert into app_data_agent.analysis_authority_outbox(
        app_id,tenant_id,environment,run_id,public_event_id,node_id,stage_id,authority_commit_hash,payload_json
      ) values (
        stage_record.app_id,stage_record.tenant_id,stage_record.environment,stage_record.run_id,
        (command_json->>'public_event_id')::uuid,stage_record.node_id,stage_record.stage_id,
        command_json->>'authority_commit_hash',pg_catalog.jsonb_build_object(
          'event_name','analysis_authority_committed','stage_id',stage_record.stage_id,
          'references',references_json,'explanation',command_json->'explanation'));
      created_count:=1;
    else receipt_json:=existing.receipt_json; created_count:=0; end if;
    journal_result:=app_data_agent.append_analysis_context_journal(pg_catalog.jsonb_build_object(
      'protocol_version','u6-db-command@1.0.0','authority_capability_id',envelope_json->>'authority_capability_id','command',journal_json));
    if not (journal_result->>'ok')::boolean then
      raise exception using errcode='P0001',message='ANALYSIS_AUTHORITY_JOURNAL_REJECTED';
    end if;
  exception when sqlstate 'P0001' then
    return pg_catalog.jsonb_build_object('ok',false,'error_code',sqlerrm);
  end;
  if created_count=0 then receipt_json:=pg_catalog.jsonb_set(receipt_json,'{created}','false'::jsonb); end if;
  return pg_catalog.jsonb_build_object('ok',true,'receipt',receipt_json,'journal_entry',journal_result->'entry');
exception when invalid_text_representation or numeric_value_out_of_range then
  return pg_catalog.jsonb_build_object('ok',false,'error_code','ANALYSIS_AUTHORITY_COMMIT_CONTRACT_INVALID');
end
$function$;

alter table app_data_agent.analysis_operator_results enable row level security;
alter table app_data_agent.analysis_operator_results force row level security;
alter table app_data_agent.analysis_context_journal enable row level security;
alter table app_data_agent.analysis_context_journal force row level security;
alter table app_data_agent.analysis_result_stages enable row level security;
alter table app_data_agent.analysis_result_stages force row level security;
alter table app_data_agent.analysis_result_stage_artifacts enable row level security;
alter table app_data_agent.analysis_result_stage_artifacts force row level security;
alter table app_data_agent.analysis_authority_commits enable row level security;
alter table app_data_agent.analysis_authority_commits force row level security;
alter table app_data_agent.analysis_authority_current enable row level security;
alter table app_data_agent.analysis_authority_current force row level security;
alter table app_data_agent.analysis_authority_outbox enable row level security;
alter table app_data_agent.analysis_authority_outbox force row level security;
revoke all on table app_data_agent.analysis_operator_results,app_data_agent.analysis_context_journal,
  app_data_agent.analysis_result_stages,app_data_agent.analysis_result_stage_artifacts,
  app_data_agent.analysis_authority_commits,app_data_agent.analysis_authority_current,
  app_data_agent.analysis_authority_outbox from public;
grant select,insert on table app_data_agent.analysis_operator_results,app_data_agent.analysis_context_journal,
  app_data_agent.analysis_result_stages,app_data_agent.analysis_result_stage_artifacts,
  app_data_agent.analysis_authority_commits,app_data_agent.analysis_authority_current,
  app_data_agent.analysis_authority_outbox to data_agent_u6_rpc_owner;

create policy analysis_operator_results_rpc_select on app_data_agent.analysis_operator_results
for select to data_agent_u6_rpc_owner using(platform.backend_run_object_matches(app_id,tenant_id,environment,run_id,false));
create policy analysis_operator_results_rpc_insert on app_data_agent.analysis_operator_results
for insert to data_agent_u6_rpc_owner with check(platform.backend_run_object_matches(app_id,tenant_id,environment,run_id,true));
create policy analysis_context_journal_rpc_select on app_data_agent.analysis_context_journal
for select to data_agent_u6_rpc_owner using(platform.backend_run_object_matches(app_id,tenant_id,environment,run_id,false));
create policy analysis_context_journal_rpc_insert on app_data_agent.analysis_context_journal
for insert to data_agent_u6_rpc_owner with check(platform.backend_run_object_matches(app_id,tenant_id,environment,run_id,true));

create policy analysis_result_stages_rpc_select on app_data_agent.analysis_result_stages
for select to data_agent_u6_rpc_owner using(platform.backend_run_object_matches(app_id,tenant_id,environment,run_id,false));
create policy analysis_result_stages_rpc_insert on app_data_agent.analysis_result_stages
for insert to data_agent_u6_rpc_owner with check(platform.backend_run_object_matches(app_id,tenant_id,environment,run_id,true));
create policy analysis_result_stage_artifacts_rpc_select on app_data_agent.analysis_result_stage_artifacts
for select to data_agent_u6_rpc_owner using(platform.backend_run_object_matches(app_id,tenant_id,environment,run_id,false));
create policy analysis_result_stage_artifacts_rpc_insert on app_data_agent.analysis_result_stage_artifacts
for insert to data_agent_u6_rpc_owner with check(platform.backend_run_object_matches(app_id,tenant_id,environment,run_id,true));
create policy analysis_authority_commits_rpc_select on app_data_agent.analysis_authority_commits
for select to data_agent_u6_rpc_owner using(platform.backend_run_object_matches(app_id,tenant_id,environment,run_id,false));
create policy analysis_authority_commits_rpc_insert on app_data_agent.analysis_authority_commits
for insert to data_agent_u6_rpc_owner with check(platform.backend_run_object_matches(app_id,tenant_id,environment,run_id,true));
create policy analysis_authority_current_rpc_select on app_data_agent.analysis_authority_current
for select to data_agent_u6_rpc_owner using(platform.backend_run_object_matches(app_id,tenant_id,environment,run_id,false));
create policy analysis_authority_current_rpc_insert on app_data_agent.analysis_authority_current
for insert to data_agent_u6_rpc_owner with check(platform.backend_run_object_matches(app_id,tenant_id,environment,run_id,true));
create policy analysis_authority_outbox_rpc_select on app_data_agent.analysis_authority_outbox
for select to data_agent_u6_rpc_owner using(platform.backend_run_object_matches(app_id,tenant_id,environment,run_id,false));
create policy analysis_authority_outbox_rpc_insert on app_data_agent.analysis_authority_outbox
for insert to data_agent_u6_rpc_owner with check(platform.backend_run_object_matches(app_id,tenant_id,environment,run_id,true));

alter function app_data_agent.assert_analysis_lifecycle_fence(jsonb,jsonb) owner to data_agent_u6_rpc_owner;
alter function app_data_agent.analysis_journal_transition_allowed(text,text) owner to data_agent_u6_rpc_owner;
alter function app_data_agent.append_analysis_context_journal(jsonb) owner to data_agent_u6_rpc_owner;
alter function app_data_agent.commit_governed_operator_result(jsonb,bytea) owner to data_agent_u6_rpc_owner;
alter function app_data_agent.read_governed_operator_result(jsonb) owner to data_agent_u6_rpc_owner;
alter function app_data_agent.read_analysis_context_journal(jsonb) owner to data_agent_u6_rpc_owner;
alter function app_data_agent.read_analysis_context_model_cell_source(jsonb) owner to data_agent_u6_rpc_owner;
alter function app_data_agent.stage_analysis_result(jsonb,jsonb) owner to data_agent_u6_rpc_owner;
alter function app_data_agent.read_analysis_result_stage(jsonb) owner to data_agent_u6_rpc_owner;
alter function app_data_agent.commit_analysis_authority(jsonb) owner to data_agent_u6_rpc_owner;
revoke all on function app_data_agent.assert_analysis_lifecycle_fence(jsonb,jsonb),
  app_data_agent.analysis_journal_transition_allowed(text,text),
  app_data_agent.append_analysis_context_journal(jsonb),
  app_data_agent.commit_governed_operator_result(jsonb,bytea),
  app_data_agent.read_governed_operator_result(jsonb),
  app_data_agent.read_analysis_context_journal(jsonb) from public;
revoke all on function app_data_agent.read_analysis_context_model_cell_source(jsonb) from public;
revoke all on function app_data_agent.stage_analysis_result(jsonb,jsonb),
  app_data_agent.read_analysis_result_stage(jsonb),app_data_agent.commit_analysis_authority(jsonb) from public;
grant execute on function app_data_agent.append_analysis_context_journal(jsonb),
  app_data_agent.commit_governed_operator_result(jsonb,bytea),
  app_data_agent.read_governed_operator_result(jsonb),
  app_data_agent.read_analysis_context_journal(jsonb),
  app_data_agent.read_analysis_context_model_cell_source(jsonb),
  app_data_agent.stage_analysis_result(jsonb,jsonb),app_data_agent.read_analysis_result_stage(jsonb),
  app_data_agent.commit_analysis_authority(jsonb) to data_agent_backend;
do $postconditions$
begin
  if pg_catalog.to_regclass('app_data_agent.analysis_operator_results') is null
    or pg_catalog.to_regclass('app_data_agent.analysis_context_journal') is null
    or pg_catalog.to_regclass('app_data_agent.analysis_result_stages') is null
    or pg_catalog.to_regclass('app_data_agent.analysis_result_stage_artifacts') is null
    or pg_catalog.to_regclass('app_data_agent.analysis_authority_commits') is null
    or pg_catalog.to_regclass('app_data_agent.analysis_authority_current') is null
    or pg_catalog.to_regclass('app_data_agent.analysis_authority_outbox') is null
    or pg_catalog.to_regprocedure('app_data_agent.append_analysis_context_journal(jsonb)') is null
    or pg_catalog.to_regprocedure('app_data_agent.commit_governed_operator_result(jsonb,bytea)') is null
    or pg_catalog.to_regprocedure('app_data_agent.read_governed_operator_result(jsonb)') is null
    or pg_catalog.to_regprocedure('app_data_agent.read_analysis_context_journal(jsonb)') is null
    or pg_catalog.to_regprocedure('app_data_agent.read_analysis_context_model_cell_source(jsonb)') is null
    or pg_catalog.to_regprocedure('app_data_agent.stage_analysis_result(jsonb,jsonb)') is null
    or pg_catalog.to_regprocedure('app_data_agent.read_analysis_result_stage(jsonb)') is null
    or pg_catalog.to_regprocedure('app_data_agent.commit_analysis_authority(jsonb)') is null
  then raise exception using errcode='P0001',message='ANALYSIS_GOVERNED_RESULT_JOURNAL_NOT_INSTALLED'; end if;
  if not exists(select 1 from pg_catalog.pg_class where oid='app_data_agent.analysis_operator_results'::pg_catalog.regclass and relrowsecurity and relforcerowsecurity)
    or not exists(select 1 from pg_catalog.pg_class where oid='app_data_agent.analysis_context_journal'::pg_catalog.regclass and relrowsecurity and relforcerowsecurity)
    or not exists(select 1 from pg_catalog.pg_class where oid='app_data_agent.analysis_result_stages'::pg_catalog.regclass and relrowsecurity and relforcerowsecurity)
    or not exists(select 1 from pg_catalog.pg_class where oid='app_data_agent.analysis_result_stage_artifacts'::pg_catalog.regclass and relrowsecurity and relforcerowsecurity)
    or not exists(select 1 from pg_catalog.pg_class where oid='app_data_agent.analysis_authority_commits'::pg_catalog.regclass and relrowsecurity and relforcerowsecurity)
    or not exists(select 1 from pg_catalog.pg_class where oid='app_data_agent.analysis_authority_current'::pg_catalog.regclass and relrowsecurity and relforcerowsecurity)
    or not exists(select 1 from pg_catalog.pg_class where oid='app_data_agent.analysis_authority_outbox'::pg_catalog.regclass and relrowsecurity and relforcerowsecurity)
  then raise exception using errcode='P0001',message='ANALYSIS_GOVERNED_RESULT_RLS_NOT_FORCED'; end if;
end
$postconditions$;
select platform.assert_migration_checksum('app','00000000-0000-4000-8000-00000000da01'::uuid,
  '20260725010744_app_data_agent_analysis_governed_result_journal',
  'sha256:ec472cf5f686216d4799dec26068a67764ed0c244a16d55a4943cd7f7edde72c');
commit;
