\set ON_ERROR_STOP on

begin isolation level repeatable read read only;
do $surface$
declare
  relation_name text;
  procedure_name text;
  procedure_definition text;
  procedure_oid oid;
begin
  if not exists (
    select 1 from platform.migration_ledger ledger
    where ledger.owner_kind='app'
      and ledger.app_id='00000000-0000-4000-8000-00000000da01'::uuid
      and ledger.migration_version='20260725010658_app_data_agent_agent_team_authority'
  ) then raise exception 'AGENT_TEAM_LEDGER_ASSERTION_FAILED'; end if;

  if (select pg_catalog.count(*) from app_data_agent.agent_profile_revisions)<>9
    or not exists (
      select 1 from app_data_agent.agent_profile_revisions
      where profile_id='data-agent-orchestrator' and profile_revision=1
        and profile_hash='sha256:c46b9eb899fe2dd1592b914b509268b8281736ad223181be5a4e998ecd9eddad'
    )
    or not exists (
      select 1 from app_data_agent.agent_profile_revisions
      where profile_id='data-agent-orchestrator' and profile_revision=2
        and profile_hash='sha256:bfe92aae492252be7667e3fe8631bf6cd4107db49a2f19edd29295dacd49d65d'
    )
    or not exists (
      select 1 from app_data_agent.agent_profile_revisions
      where profile_id='governed-analysis-agent' and profile_revision=1
        and profile_hash='sha256:265abb762fd9466d5ce8bee79bb43b823ff18621b1b728a645b84bb4356be7f6'
    )
    or not exists (
      select 1 from app_data_agent.agent_profile_revisions
      where profile_id='governed-analysis-agent' and profile_revision=2
        and profile_hash='sha256:e5f85f6b0a7e4b582f13cb9bb24a08e03c1c01e6721760afb94003d4c883b019'
    )
    or not exists (
      select 1 from app_data_agent.agent_profile_revisions
      where profile_id='semantic-management-agent'
        and profile_revision=1
        and profile_hash='sha256:92910b6741ada7b2e5377c0b00b3ff2c64be7f0fb5567161359dfbabd4814b38'
    )
    or not exists (
      select 1 from app_data_agent.agent_profile_revisions
      where profile_id='semantic-management-agent' and profile_revision=2
        and profile_hash='sha256:bae4ec47ca7c23a0ac046c0086051d3696752586f09534572440fb1af1edf3f3'
    )
    or not exists (
      select 1 from app_data_agent.agent_profile_revisions
      where profile_id='semantic-management-agent' and profile_revision=3
        and profile_hash='sha256:4deee7bace7d3b58dc5ea17849bd1ef965a8a417452dcae7cfd06b6fb5ab5ba9'
    )
    or not exists (
      select 1 from app_data_agent.agent_profile_revisions
      where profile_id='governed-text2sql-agent'
        and profile_hash='sha256:e283c8d3800ddc40b3d59580368d4334c69c7b54df4c455fdfd4c119d71b349c'
    )
    or not exists (
      select 1 from app_data_agent.agent_profile_revisions
      where profile_id='report-writing-agent'
        and profile_hash='sha256:7bcc21bc4933193b9f2f25791cfb694c90873525cc749e868b53a7ff79f2a26d'
    )
  then raise exception 'AGENT_TEAM_PROFILE_AUTHORITY_ASSERTION_FAILED'; end if;

  foreach relation_name in array array[
    'agent_team_tasks','agent_team_handoffs','agent_team_context_epochs',
    'agent_team_completion_receipts','agent_team_events','agent_team_verifier_decisions',
    'agent_team_task_capabilities','agent_team_acceptance_receipts',
    'sensitive_execution_artifacts','sensitive_execution_artifact_access_audit'
  ] loop
    if not exists (
      select 1 from pg_catalog.pg_class relation
      join pg_catalog.pg_namespace namespace on namespace.oid=relation.relnamespace
      where namespace.nspname='app_data_agent' and relation.relname=relation_name
        and relation.relrowsecurity and relation.relforcerowsecurity
    ) or pg_catalog.has_table_privilege(
      'data_agent_backend',pg_catalog.format('app_data_agent.%I',relation_name),
      'SELECT,INSERT,UPDATE,DELETE'
    ) then
      raise exception 'AGENT_TEAM_RELATION_SURFACE_ASSERTION_FAILED:%',relation_name;
    end if;
  end loop;

  foreach procedure_name in array array[
    'create_agent_team_task','prepare_agent_team_handoff','issue_agent_team_task_capability',
    'load_agent_team_task_capability','commit_agent_team_context_epoch',
    'commit_agent_team_completion','commit_agent_team_acceptance','load_agent_team_run',
    'record_agent_team_late_result',
    'commit_sensitive_execution_artifact','load_sensitive_execution_artifact'
  ] loop
    select procedure.oid,pg_catalog.pg_get_functiondef(procedure.oid)
      into strict procedure_oid,procedure_definition
    from pg_catalog.pg_proc procedure
    join pg_catalog.pg_namespace namespace on namespace.oid=procedure.pronamespace
    where namespace.nspname='app_data_agent' and procedure.proname=procedure_name;
    if procedure_definition not like '%SECURITY DEFINER%'
      or procedure_definition not like '%SET search_path TO ''''%'
      or not pg_catalog.has_function_privilege(
        'data_agent_backend',procedure_oid,'EXECUTE'
      )
    then raise exception 'AGENT_TEAM_RPC_SURFACE_ASSERTION_FAILED:%',procedure_name; end if;
  end loop;

  select pg_catalog.pg_get_functiondef(procedure.oid) into strict procedure_definition
  from pg_catalog.pg_proc procedure join pg_catalog.pg_namespace namespace
    on namespace.oid=procedure.pronamespace
  where namespace.nspname='app_data_agent'
    and procedure.proname='agent_team_assert_store_command';
  if procedure_definition not like '%assert_provider_active_worker_lease%'
    or procedure_definition not like '%AGENT_TEAM_SCOPE_MISMATCH%'
    or procedure_definition not like '%u2_canonical_sha256%'
  then raise exception 'AGENT_TEAM_ACTIVE_LEASE_CLOSURE_ASSERTION_FAILED'; end if;

  select pg_catalog.pg_get_functiondef(procedure.oid) into strict procedure_definition
  from pg_catalog.pg_proc procedure join pg_catalog.pg_namespace namespace
    on namespace.oid=procedure.pronamespace
  where namespace.nspname='app_data_agent'
    and procedure.proname='prepare_agent_team_handoff';
  if procedure_definition not like '%parent.depth<>0%'
    or procedure_definition not like '%agent_team_task_capabilities%'
    or procedure_definition not like '%expires_at>pg_catalog.clock_timestamp()%'
    or procedure_definition not like '%max_context_bytes%'
    or procedure_definition not like '%parent_reference=child_reference%'
    or procedure_definition not like '%sensitive_execution_artifacts%'
  then raise exception 'AGENT_TEAM_DEPTH_CAPABILITY_ASSERTION_FAILED'; end if;

  select pg_catalog.pg_get_functiondef(procedure.oid) into strict procedure_definition
  from pg_catalog.pg_proc procedure join pg_catalog.pg_namespace namespace
    on namespace.oid=procedure.pronamespace
  where namespace.nspname='app_data_agent'
    and procedure.proname='commit_agent_team_completion';
  if procedure_definition not like '%required_artifact_types%'
    or procedure_definition not like '%output_ref,tenant_id%'
    or procedure_definition not like '%profile_hash%'
  then raise exception 'AGENT_TEAM_COMPLETION_CLOSURE_ASSERTION_FAILED'; end if;

  select pg_catalog.pg_get_functiondef(procedure.oid) into strict procedure_definition
  from pg_catalog.pg_proc procedure join pg_catalog.pg_namespace namespace
    on namespace.oid=procedure.pronamespace
  where namespace.nspname='app_data_agent'
    and procedure.proname='commit_agent_team_acceptance';
  if procedure_definition not like '%oracle_verified%'
    or procedure_definition not like '%blocking_obligation_ids%'
    or procedure_definition not like '%semantic_status%'
  then raise exception 'AGENT_TEAM_ACCEPTANCE_CLOSURE_ASSERTION_FAILED'; end if;

  if exists (
    select 1 from pg_catalog.pg_class relation
    join pg_catalog.pg_namespace namespace on namespace.oid=relation.relnamespace
    where namespace.nspname='app_data_agent'
      and (relation.relname like 'agent_team%queue%' or relation.relname like 'agent_team%provider%')
  ) then raise exception 'AGENT_TEAM_SECOND_QUEUE_OR_PROVIDER_STORE_FORBIDDEN'; end if;

  if not exists (
    select 1 from pg_catalog.pg_roles where rolname='data_agent_u19_team_owner'
      and not rolcanlogin and not rolsuper and not rolcreatedb and not rolcreaterole
      and not rolreplication and not rolinherit and not rolbypassrls
  ) or pg_catalog.pg_has_role('data_agent_u19_team_owner','data_agent_backend','MEMBER')
  then raise exception 'AGENT_TEAM_OWNER_ASSERTION_FAILED'; end if;
end
$surface$;
rollback;

begin;
insert into app_data_agent.workspaces(app_id,workspace_id,environment,slug,display_name)
values (
  '00000000-0000-4000-8000-00000000da01','00000000-0000-4000-8000-000000005801',
  'local','u19-authority-fixture','U19 Authority fixture'
);
insert into app_data_agent.memberships(app_id,tenant_id,environment,principal_id,membership_role)
values (
  '00000000-0000-4000-8000-00000000da01','00000000-0000-4000-8000-000000005801',
  'local','00000000-0000-4000-8000-000000005802','owner'
);
insert into data_agent_auth."user"("id","name","email","emailVerified","username","displayUsername")
values (
  '00000000-0000-4000-8000-000000005802','U19 fixture user','u19-fixture@example.invalid',
  true,'u19_fixture','u19_fixture'
);
insert into app_data_agent.app_users(
  app_id,environment,principal_id,auth_user_id,email,display_name,system_role
) values (
  '00000000-0000-4000-8000-00000000da01','local',
  '00000000-0000-4000-8000-000000005802','00000000-0000-4000-8000-000000005802',
  'u19-fixture@example.invalid','U19 fixture user','USER'
);
insert into platform.deployment_mappings(deployment_id,app_id,environment,deployment_key_hash)
values (
  '00000000-0000-4000-8000-00000000589c','00000000-0000-4000-8000-00000000da01',
  'local','sha256:9999999999999999999999999999999999999999999999999999999999999999'
);
select test_support.activate_falcon24_e1_fixture(
  '00000000-0000-4000-8000-000000005801'::uuid,'local',
  '00000000-0000-4000-8000-000000005802'::uuid,
  '00000000-0000-4000-8000-00000000589c'::uuid,false,7);
select pg_catalog.set_config('data_agent.app_id','00000000-0000-4000-8000-00000000da01',true);
select pg_catalog.set_config('data_agent.tenant_id','00000000-0000-4000-8000-000000005801',true);
select pg_catalog.set_config('data_agent.environment','local',true);
select pg_catalog.set_config('data_agent.deployment_id','00000000-0000-4000-8000-00000000589c',true);
select pg_catalog.set_config('data_agent.principal_id','00000000-0000-4000-8000-000000005802',true);
select pg_catalog.set_config('data_agent.role','owner',true);
insert into app_data_agent.runs(
  app_id,tenant_id,environment,run_id,principal_id,status,active_fence,question
) values (
  '00000000-0000-4000-8000-00000000da01','00000000-0000-4000-8000-000000005801',
  'local','00000000-0000-4000-8000-000000005803',
  '00000000-0000-4000-8000-000000005802','RUNNING',7,'U19 authority fixture'
);
insert into app_data_agent.commands(
  app_id,tenant_id,environment,command_id,run_id,principal_id,idempotency_key,payload_json,payload_hash
) values (
  '00000000-0000-4000-8000-00000000da01','00000000-0000-4000-8000-000000005801',
  'local','00000000-0000-4000-8000-000000005804','00000000-0000-4000-8000-000000005803',
  '00000000-0000-4000-8000-000000005802','u19-authority-fixture',
  '{"kind":"START_L2_RESEARCH","effective_config_ref":{"config_id":"00000000-0000-4000-8000-000000005809","config_revision":1,"config_hash":"sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"}}',
  platform.canonical_sha256(
    '{"kind":"START_L2_RESEARCH","effective_config_ref":{"config_id":"00000000-0000-4000-8000-000000005809","config_revision":1,"config_hash":"sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"}}'::jsonb
  )
);
insert into app_data_agent.outbox(
  app_id,tenant_id,environment,outbox_id,run_id,command_id,topic,payload_json,queue_sequence
) values (
  '00000000-0000-4000-8000-00000000da01','00000000-0000-4000-8000-000000005801',
  'local','00000000-0000-4000-8000-000000005805','00000000-0000-4000-8000-000000005803',
  '00000000-0000-4000-8000-000000005804','run.command.accepted',
  '{"kind":"START_L2_RESEARCH"}',1
);
insert into app_data_agent.run_attempts(
  app_id,tenant_id,environment,run_id,outbox_id,command_id,attempt_id,attempt_no,
  worker_id,lease_token,worker_fence,status,lease_expires_at,last_heartbeat_at
) values (
  '00000000-0000-4000-8000-00000000da01','00000000-0000-4000-8000-000000005801',
  'local','00000000-0000-4000-8000-000000005803','00000000-0000-4000-8000-000000005805',
  '00000000-0000-4000-8000-000000005804','00000000-0000-4000-8000-000000005806',
  1,'u19-worker',1,7,'ACTIVE',pg_catalog.statement_timestamp()+interval '10 minutes',
  pg_catalog.statement_timestamp()
);
update app_data_agent.outbox set
  status='LEASED',attempt_count=1,lease_owner='u19-worker',lease_token=1,
  lease_expires_at=pg_catalog.statement_timestamp()+interval '10 minutes',
  active_attempt_id='00000000-0000-4000-8000-000000005806',run_fence=7,
  last_heartbeat_at=pg_catalog.statement_timestamp()
where outbox_id='00000000-0000-4000-8000-000000005805';
insert into app_data_agent.run_events(
  app_id,tenant_id,environment,event_id,run_id,sequence,event_type,payload_json,
  attempt_id,command_id,dedupe_key,worker_fence
) values
(
  '00000000-0000-4000-8000-00000000da01','00000000-0000-4000-8000-000000005801',
  'local','00000000-0000-4000-8000-000000005807','00000000-0000-4000-8000-000000005803',
  1,'run.accepted','{}',null,'00000000-0000-4000-8000-000000005804','u19-run-accepted',0
),(
  '00000000-0000-4000-8000-00000000da01','00000000-0000-4000-8000-000000005801',
  'local','00000000-0000-4000-8000-000000005808','00000000-0000-4000-8000-000000005803',
  2,'run.leased','{"attempt_no":1}','00000000-0000-4000-8000-000000005806',
  '00000000-0000-4000-8000-000000005804','u19-run-leased',7
);
with leased_event as (
  select event_id,created_at from app_data_agent.run_events
  where event_id='00000000-0000-4000-8000-000000005808'
), projected as (
  select event_id,created_at,pg_catalog.jsonb_build_object(
    'schema_version','1.0.0',
    'scope',pg_catalog.jsonb_build_object(
      'app_id','00000000-0000-4000-8000-00000000da01',
      'tenant_id','00000000-0000-4000-8000-000000005801','environment','local'),
    'run_id','00000000-0000-4000-8000-000000005803','status','RUNNING',
    'version',2,'worker_fence',7,'attempt_count',1,'last_event_id',event_id,
    'last_occurred_at',app_data_agent.runtime_iso_timestamp(created_at),
    'active_artifact_ref',null,'active_snapshot_ref',null,
    'last_side_effect_receipt_id',null,'terminal_event_id',null
  ) document from leased_event
)
insert into app_data_agent.run_projections(
  app_id,tenant_id,environment,run_id,version,status,worker_fence,event_id,
  projection_hash,projection_json,occurred_at
)
select '00000000-0000-4000-8000-00000000da01',
  '00000000-0000-4000-8000-000000005801','local',
  '00000000-0000-4000-8000-000000005803',2,'RUNNING',7,event_id,
  app_data_agent.runtime_canonical_sha256(document),document,created_at
from projected;
do $behavior$
declare
  lease jsonb;
  task jsonb;
  command jsonb;
  capability jsonb;
  artifact jsonb;
  result jsonb;
begin
  lease := pg_catalog.jsonb_build_object(
    'scope',pg_catalog.jsonb_build_object(
      'app_id','00000000-0000-4000-8000-00000000da01',
      'tenant_id','00000000-0000-4000-8000-000000005801','environment','local'),
    'principal_id','00000000-0000-4000-8000-000000005802',
    'outbox_id','00000000-0000-4000-8000-000000005805',
    'run_id','00000000-0000-4000-8000-000000005803',
    'command_id','00000000-0000-4000-8000-000000005804','command_kind','START_L2_RESEARCH',
    'attempt_id','00000000-0000-4000-8000-000000005806','attempt_no',1,
    'delivery_attempt_no',1,'lease_duration_ms',600000,'worker_id','u19-worker',
    'lease_token',1,'worker_fence',7,'expires_at',
    app_data_agent.runtime_iso_timestamp(pg_catalog.clock_timestamp()+interval '10 minutes'),
    'execution_policy',pg_catalog.jsonb_build_object(
      'schema_version','run-execution-policy@1.0.0',
      'campaign_id',null,'case_id',null,'run_variant',null,'repetition',null,
      'policy_id','default-run-retry@1.0.0','mode','DEFAULT',
      'max_run_attempts',5,'max_provider_attempts_per_call',2,'max_root_turns',4,
      'max_text2sql_candidate_attempts',2,'analysis_repair_budget_per_category',1,
      'max_file_transfer_attempts',5,'allow_stage_recovery',true,'hold_on_failure',false),
    'payload',pg_catalog.jsonb_build_object(
      'kind','START_L2_RESEARCH','effective_config_ref',pg_catalog.jsonb_build_object(
        'config_id','00000000-0000-4000-8000-000000005809','config_revision',1,
        'config_hash','sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'))
  );
  task := pg_catalog.jsonb_build_object(
    'schema_version','agent-team-task@2.0.0','task_id','00000000-0000-4000-8000-000000005810',
    'parent_task_id',null,'parent_handoff_id',null,'depth',0,
    'scope',lease -> 'scope','run_id',lease ->> 'run_id','profile_id','data-agent-orchestrator',
    'profile_revision',1,'profile_hash','sha256:c46b9eb899fe2dd1592b914b509268b8281736ad223181be5a4e998ecd9eddad',
    'task_revision',1,'goal_revision',1,'attempt_id',lease ->> 'attempt_id','worker_fence',7,
    'artifact_refs','[]'::jsonb,'context_epoch_ref',null,
    'bounds',pg_catalog.jsonb_build_object(
      'max_context_bytes',65536,'max_input_tokens',1000,'max_output_tokens',500,
      'max_tool_calls',4,'timeout_ms',30000),
    'acceptance',pg_catalog.jsonb_build_object(
      'required_artifact_types',pg_catalog.jsonb_build_array('ReportManifest'),
      'require_all_verifier_dimensions',true)
  );
  task := task || pg_catalog.jsonb_build_object('task_hash',app_data_agent.u2_canonical_sha256(task));
  if task ->> 'task_hash'<>'sha256:aa97e3490f63167df0851b429d284cfed403ecf5758909fd876f37fac21a7165'
  then raise exception 'AGENT_TEAM_CROSS_LANGUAGE_HASH_VECTOR_FAILED'; end if;
  command := pg_catalog.jsonb_build_object(
    'schema_version','agent-team-store-command@1.0.0','operation','CREATE_TASK',
    'command_id','00000000-0000-4000-8000-000000005811','scope',lease -> 'scope',
    'run_id',lease ->> 'run_id','task_id',task ->> 'task_id','expected_revision',null,
    'lease',lease,'selector',null,'document',task,
    'document_hash',app_data_agent.u2_canonical_sha256(task)
  );
  command := command || pg_catalog.jsonb_build_object(
    'request_hash',app_data_agent.u2_canonical_sha256(command)
  );
  result := app_data_agent.create_agent_team_task(command);
  if result ->> 'disposition'<>'CREATED'
    or app_data_agent.create_agent_team_task(command) ->> 'disposition'<>'REPLAYED'
  then raise exception 'AGENT_TEAM_CREATE_REPLAY_BEHAVIOR_FAILED'; end if;

  capability := pg_catalog.jsonb_build_object(
    'schema_version','task-capability-receipt@2.0.0',
    'capability_id','00000000-0000-4000-8000-000000005812','scope',lease -> 'scope',
    'run_id',lease ->> 'run_id','task_id',task ->> 'task_id','attempt_id',task ->> 'attempt_id',
    'worker_fence',7,'profile_id',task ->> 'profile_id','profile_revision',1,
    'profile_hash',task ->> 'profile_hash','artifact_ref_identities','[]'::jsonb,
    'operation_audiences',pg_catalog.jsonb_build_array('TOOL_INVOKE'),
    'issuer',pg_catalog.jsonb_build_object(
      'principal_id','00000000-0000-4000-8000-000000005802','key_id','u19-team-key@1'),
    'issued_at',app_data_agent.runtime_iso_timestamp(pg_catalog.clock_timestamp()),
    'expires_at',app_data_agent.runtime_iso_timestamp(pg_catalog.clock_timestamp()+interval '10 minutes'),
    'nonce','00000000-0000-4000-8000-000000005813','revocation_version',1
  );
  capability := capability || pg_catalog.jsonb_build_object(
    'capability_hash',app_data_agent.u2_canonical_sha256(capability)
  );
  command := pg_catalog.jsonb_build_object(
    'schema_version','agent-team-store-command@1.0.0','operation','ISSUE_TASK_CAPABILITY',
    'command_id','00000000-0000-4000-8000-000000005814','scope',lease -> 'scope',
    'run_id',lease ->> 'run_id','task_id',task ->> 'task_id','expected_revision',1,
    'lease',lease,'selector',null,'document',capability,
    'document_hash',app_data_agent.u2_canonical_sha256(capability)
  );
  command := command || pg_catalog.jsonb_build_object(
    'request_hash',app_data_agent.u2_canonical_sha256(command)
  );
  if app_data_agent.issue_agent_team_task_capability(command) ->> 'disposition'<>'CREATED'
  then raise exception 'AGENT_TEAM_CAPABILITY_BEHAVIOR_FAILED'; end if;

  artifact := pg_catalog.jsonb_build_object(
    'schema_version','sensitive-execution-artifact@2.0.0',
    'artifact_ref',pg_catalog.jsonb_build_object(
      'artifact_id','00000000-0000-4000-8000-000000005815',
      'artifact_type','SensitiveExecutionArtifact','app_id','00000000-0000-4000-8000-00000000da01',
      'tenant_id','00000000-0000-4000-8000-000000005801','environment','local',
      'run_id',lease ->> 'run_id','revision',1,
      'content_hash','sha256:1111111111111111111111111111111111111111111111111111111111111111'),
    'content_kind','ANALYSIS_INPUT',
    'plaintext_hash','sha256:1111111111111111111111111111111111111111111111111111111111111111',
    'ciphertext_hash','sha256:2222222222222222222222222222222222222222222222222222222222222222',
    'storage_key_hash','sha256:3333333333333333333333333333333333333333333333333333333333333333',
    'encryption',pg_catalog.jsonb_build_object('algorithm','AES-256-GCM','key_id','u19-kms@1'),
    'lifecycle',pg_catalog.jsonb_build_object(
      'status','ACTIVE','expires_at',
      app_data_agent.runtime_iso_timestamp(pg_catalog.clock_timestamp()+interval '1 day'),
      'legal_hold',false,'ref_count',1,'tombstoned_at',null,'backup_expires_at',
      app_data_agent.runtime_iso_timestamp(pg_catalog.clock_timestamp()+interval '8 days')),
    'committed_at',app_data_agent.runtime_iso_timestamp(pg_catalog.clock_timestamp())
  );
  artifact := artifact || pg_catalog.jsonb_build_object(
    'receipt_hash',app_data_agent.u2_canonical_sha256(artifact)
  );
  result := app_data_agent.commit_sensitive_execution_artifact(
    lease,pg_catalog.jsonb_build_object(
      'schema_version','sensitive-execution-artifact-commit@2.0.0',
      'receipt',artifact,'idempotency_key','u19-sensitive-fixture')
  );
  if result ->> 'disposition'<>'CREATED' then
    raise exception 'AGENT_TEAM_SENSITIVE_COMMIT_BEHAVIOR_FAILED';
  end if;
  result := app_data_agent.load_sensitive_execution_artifact(
    pg_catalog.jsonb_build_object(
      'schema_version','sensitive-execution-artifact-load@2.0.0',
      'artifact_ref',artifact -> 'artifact_ref',
      'ciphertext_hash',artifact ->> 'ciphertext_hash')
  );
  if result #>> '{receipt,receipt_hash}'<>artifact ->> 'receipt_hash'
    or (select pg_catalog.count(*) from app_data_agent.sensitive_execution_artifact_access_audit)<>2
  then raise exception 'AGENT_TEAM_SENSITIVE_LOAD_BEHAVIOR_FAILED'; end if;
end
$behavior$;
rollback;

\echo U19_AGENT_TEAM_AUTHORITY_ASSERTIONS_PASSED
