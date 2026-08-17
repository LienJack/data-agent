\set ON_ERROR_STOP on

do $assertions$
declare relation_name text;
begin
  if not exists (
    select 1 from platform.migration_ledger
    where owner_kind='app' and app_id='00000000-0000-4000-8000-00000000da01'::uuid
      and migration_version='20260725010662_app_data_agent_semantic_induction'
  ) then raise exception 'SEMANTIC_INDUCTION_LEDGER_MISSING'; end if;
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
    ) then raise exception 'SEMANTIC_INDUCTION_RELATION_UNSAFE:%',relation_name; end if;
  end loop;
  if not exists (
    select 1 from pg_catalog.pg_roles where rolname='data_agent_u11_induction_owner'
      and not rolcanlogin and not rolsuper and not rolcreatedb and not rolcreaterole
      and not rolreplication and not rolinherit and not rolbypassrls
  ) then raise exception 'SEMANTIC_INDUCTION_OWNER_UNSAFE'; end if;
  if pg_catalog.has_table_privilege('data_agent_backend','app_data_agent.semantic_induction_receipts','INSERT,UPDATE,DELETE')
    or not pg_catalog.has_function_privilege('data_agent_backend','app_data_agent.load_semantic_induction_target(jsonb)','EXECUTE')
    or not pg_catalog.has_function_privilege('data_agent_backend','app_data_agent.commit_semantic_induction_candidate(jsonb,jsonb)','EXECUTE')
    or not pg_catalog.has_function_privilege('data_agent_backend','app_data_agent.record_semantic_induction_rejection(jsonb,jsonb)','EXECUTE')
  then raise exception 'SEMANTIC_INDUCTION_GRANTS_UNSAFE'; end if;
  if not exists (
    select 1 from app_data_agent.job_handler_revisions
    where kind='SEMANTIC_INDUCTION' and handler_revision='semantic-induction-handler@1.1.0'
      and enabled and dependencies_ready and output_receipt_required
  ) or not exists (
    select 1 from app_data_agent.job_handler_revisions
    where kind='METRIC_IMPORT' and handler_revision='metric-import-handler@1.1.0'
      and enabled and dependencies_ready and output_receipt_required
  ) then raise exception 'SEMANTIC_INDUCTION_JOB_HANDLERS_NOT_READY'; end if;
  if pg_catalog.to_regprocedure('app_data_agent.register_semantic_induction_source(text,jsonb,jsonb)') is null
    or pg_catalog.to_regprocedure('app_data_agent.load_semantic_induction_target(jsonb)') is null
    or pg_catalog.to_regprocedure('app_data_agent.commit_semantic_induction_candidate(jsonb,jsonb)') is null
    or pg_catalog.to_regprocedure('app_data_agent.record_semantic_induction_rejection(jsonb,jsonb)') is null
  then raise exception 'SEMANTIC_INDUCTION_RPCS_MISSING'; end if;
  if exists (
    select 1 from pg_catalog.pg_proc procedure
    join pg_catalog.pg_namespace namespace on namespace.oid=procedure.pronamespace
    where namespace.nspname='app_data_agent'
      and procedure.proname in (
        'register_semantic_induction_source','load_semantic_induction_target',
        'commit_semantic_induction_candidate','record_semantic_induction_rejection'
      ) and (not procedure.prosecdef or not procedure.proconfig @> array['search_path=""']::text[])
  ) then raise exception 'SEMANTIC_INDUCTION_RPC_SECURITY_UNSAFE'; end if;
end
$assertions$;

select 'SEMANTIC_INDUCTION_AUTHORITY_ASSERTIONS_PASSED' as status;

begin;
insert into app_data_agent.workspaces(app_id,workspace_id,environment,slug,display_name)
values (
  '00000000-0000-4000-8000-00000000da01','00000000-0000-4000-8000-000000006201',
  'local','u11-induction-smoke','U11 induction smoke'
);
insert into app_data_agent.memberships(
  app_id,tenant_id,environment,principal_id,membership_role,workspace_role,membership_source
) values (
  '00000000-0000-4000-8000-00000000da01','00000000-0000-4000-8000-000000006201',
  'local','00000000-0000-4000-8000-000000006202','owner','WORKSPACE_ADMIN','EXPLICIT'
);
insert into data_agent_auth."user"("id","name","email","emailVerified","username","displayUsername")
values (
  '00000000-0000-4000-8000-000000006202','U11 fixture user',
  'u11-fixture@example.invalid',true,'u11_fixture','u11_fixture'
);
insert into app_data_agent.app_users(
  app_id,environment,principal_id,auth_user_id,email,display_name,system_role
) values (
  '00000000-0000-4000-8000-00000000da01','local',
  '00000000-0000-4000-8000-000000006202','00000000-0000-4000-8000-000000006202',
  'u11-fixture@example.invalid','U11 fixture user','USER'
);
insert into app_data_agent.datasource_connections(
  app_id,tenant_id,environment,datasource_id,name,datasource_type,file_path,
  created_by_principal_id
) values (
  '00000000-0000-4000-8000-00000000da01','00000000-0000-4000-8000-000000006201',
  'local','00000000-0000-4000-8000-000000006220','U11 fixture datasource','sqlite',
  '/tmp/u11-fixture.sqlite','00000000-0000-4000-8000-000000006202'
);
insert into semantic.semantic_authority_fence(app_id,tenant_id,environment)
values (
  '00000000-0000-4000-8000-00000000da01','00000000-0000-4000-8000-000000006201','local'
);
insert into semantic.semantic_domain_registry(
  app_id,tenant_id,environment,semantic_domain,datasource_id,domain_display_name,created_by
) values (
  '00000000-0000-4000-8000-00000000da01','00000000-0000-4000-8000-000000006201',
  'local','u11_fixture','00000000-0000-4000-8000-000000006220','U11 Fixture',
  '00000000-0000-4000-8000-000000006202'
);
create role data_agent_u11_behavior_session login inherit;
grant data_agent_backend to data_agent_u11_behavior_session with inherit true;
grant execute on function app_data_agent.u2_canonical_sha256(jsonb),
  app_data_agent.job_utc_millis(timestamptz),
  app_data_agent.semantic_induction_stable_object_id(text)
to data_agent_u11_behavior_session;
set session authorization data_agent_u11_behavior_session;
select pg_catalog.set_config('data_agent.app_id','00000000-0000-4000-8000-00000000da01',true);
select pg_catalog.set_config('data_agent.tenant_id','00000000-0000-4000-8000-000000006201',true);
select pg_catalog.set_config('data_agent.environment','local',true);
select pg_catalog.set_config('data_agent.deployment_id','00000000-0000-4000-8000-000000000001',true);
select pg_catalog.set_config('data_agent.principal_id','00000000-0000-4000-8000-000000006202',true);
select pg_catalog.set_config('data_agent.role','owner',true);

do $behavior$
declare
  scope jsonb:=pg_catalog.jsonb_build_object(
    'app_id','00000000-0000-4000-8000-00000000da01',
    'tenant_id','00000000-0000-4000-8000-000000006201','environment','local'
  );
  source jsonb; request jsonb; submit jsonb; submission jsonb; heartbeat jsonb; lease jsonb;
  dry_run jsonb; rejection jsonb; result jsonb; replay jsonb;
  schema_source jsonb; schema_request jsonb; schema_submit jsonb; schema_submission jsonb;
  material jsonb; identity_hash text; object_id uuid; operation_hash text;
  proposal jsonb; impact jsonb; candidate_draft jsonb; commit_command jsonb; commit_result jsonb;
begin
  source:=pg_catalog.jsonb_build_object(
    'schema_version','semantic-induction-source@1.0.0','source_kind','METRIC_EXCHANGE',
    'source_ref',pg_catalog.jsonb_build_object(
      'resource_kind','METRIC_EXCHANGE_PACKAGE',
      'resource_id','00000000-0000-4000-8000-000000006203',
      'resource_revision',1,
      'resource_hash','sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
    ),
    'corpus_class','SEMANTIC_BOOTSTRAP_CORPUS',
    'taint',pg_catalog.jsonb_build_object(
      'contains_holdout_or_test',false,'contains_gold_or_expected_output',false,
      'contains_oracle_feedback',false,'sealed_benchmark',false
    )
  );
  request:=pg_catalog.jsonb_build_object(
    'schema_version','semantic-induction-request@1.0.0','scope',scope,
    'semantic_domain','u11_fixture','induction_id','00000000-0000-4000-8000-000000006204',
    'induction_kind','METRIC_IMPORT','base_release_ref',null,
    'sources',pg_catalog.jsonb_build_array(source),
    'idempotency_key','u11-metric-rejection-0001'
  );
  submit:=pg_catalog.jsonb_build_object(
    'schema_version','job-submit@1.0.0','scope',scope,'kind','METRIC_IMPORT',
    'idempotency_key','u11-metric-rejection-0001',
    'input',pg_catalog.jsonb_build_object(
      'schema_version','job-input@1.0.0','kind','METRIC_IMPORT','resource_refs','[]'::jsonb,
      'parameters',pg_catalog.jsonb_build_object('request',request)
    ),
    'priority',50,'max_attempts',1,'cancel_policy','COOPERATIVE'
  );
  submit:=submit||pg_catalog.jsonb_build_object('request_hash',app_data_agent.u2_canonical_sha256(submit));
  submission:=app_data_agent.enqueue_job(submit);
  heartbeat:=pg_catalog.jsonb_build_object(
    'schema_version','job-worker-heartbeat@1.0.0',
    'heartbeat_id','00000000-0000-4000-8000-000000006205','scope',scope,
    'worker_id','u11-induction-worker',
    'handlers',pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
      'kind','METRIC_IMPORT','handler_revision','metric-import-handler@1.1.0'
    )),
    'capacity',1,'observed_at',app_data_agent.job_utc_millis(pg_catalog.clock_timestamp()),
    'expires_at',app_data_agent.job_utc_millis(pg_catalog.clock_timestamp()+interval '2 minutes')
  );
  heartbeat:=heartbeat||pg_catalog.jsonb_build_object(
    'heartbeat_hash',app_data_agent.u2_canonical_sha256(heartbeat)
  );
  perform app_data_agent.publish_job_worker_heartbeat(heartbeat);
  lease:=app_data_agent.claim_job_work('u11-induction-worker',heartbeat->'handlers',30000);
  if lease is null or lease->>'job_id'<>submission->>'job_id'
    or not (app_data_agent.start_job_work(lease)->>'started')::boolean
  then raise exception 'SEMANTIC_INDUCTION_REJECTION_LEASE_INVALID'; end if;
  dry_run:=pg_catalog.jsonb_build_object(
    'schema_version','semantic-metric-dry-run-receipt@1.0.0','scope',scope,
    'semantic_domain','u11_fixture','import_id',request->>'induction_id',
    'source_hash','sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
    'status','INVALID','entries',pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
      'external_id','gmv','disposition','INVALID','stable_object_id',null,
      'issues',pg_catalog.jsonb_build_array('UNSUPPORTED_OR_UNSAFE_EXPRESSION')
    )),'candidate_patch_hash',null
  );
  dry_run:=dry_run||pg_catalog.jsonb_build_object(
    'receipt_hash',app_data_agent.u2_canonical_sha256(dry_run)
  );
  rejection:=pg_catalog.jsonb_build_object(
    'schema_version','semantic-induction-reject-command@1.0.0','request',request,
    'terminal','DRY_RUN_REJECTED','metric_dry_run',dry_run
  );
  result:=app_data_agent.record_semantic_induction_rejection(lease,rejection);
  replay:=app_data_agent.record_semantic_induction_rejection(lease,rejection);
  perform pg_catalog.set_config('u11.rejected_induction_id',request->>'induction_id',true);
  perform pg_catalog.set_config('u11.rejected_dry_run_hash',dry_run->>'receipt_hash',true);
  if result<>replay or result#>>'{receipt,terminal}'<>'DRY_RUN_REJECTED'
    or result#>>'{receipt,receipt_hash}'<>
      app_data_agent.u2_canonical_sha256((result->'receipt')-'receipt_hash')
  then raise exception 'SEMANTIC_INDUCTION_REJECTION_AUTHORITY_INVALID'; end if;
  perform app_data_agent.fail_job_work(
    lease,'SEMANTIC_METRIC_DRY_RUN_REJECTED',false,null
  );

  schema_source:=pg_catalog.jsonb_build_object(
    'schema_version','semantic-induction-source@1.0.0','source_kind','PHYSICAL_SCHEMA',
    'source_ref',pg_catalog.jsonb_build_object(
      'resource_kind','SCHEMA_SNAPSHOT','resource_id','00000000-0000-4000-8000-000000006206',
      'resource_revision',1,
      'resource_hash','sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc'
    ),'corpus_class','SEMANTIC_BOOTSTRAP_CORPUS',
    'taint',pg_catalog.jsonb_build_object(
      'contains_holdout_or_test',false,'contains_gold_or_expected_output',false,
      'contains_oracle_feedback',false,'sealed_benchmark',false
    )
  );
  schema_request:=pg_catalog.jsonb_build_object(
    'schema_version','semantic-induction-request@1.0.0','scope',scope,
    'semantic_domain','u11_fixture','induction_id','00000000-0000-4000-8000-000000006207',
    'induction_kind','SCHEMA_INDUCTION','base_release_ref',null,
    'sources',pg_catalog.jsonb_build_array(schema_source),
    'idempotency_key','u11-schema-commit-0002'
  );
  schema_submit:=pg_catalog.jsonb_build_object(
    'schema_version','job-submit@1.0.0','scope',scope,'kind','SEMANTIC_INDUCTION',
    'idempotency_key','u11-schema-commit-0002',
    'input',pg_catalog.jsonb_build_object(
      'schema_version','job-input@1.0.0','kind','SEMANTIC_INDUCTION','resource_refs','[]'::jsonb,
      'parameters',pg_catalog.jsonb_build_object('request',schema_request)
    ),'priority',50,'max_attempts',1,'cancel_policy','COOPERATIVE'
  );
  schema_submit:=schema_submit||pg_catalog.jsonb_build_object(
    'request_hash',app_data_agent.u2_canonical_sha256(schema_submit)
  );
  schema_submission:=app_data_agent.enqueue_job(schema_submit);
  heartbeat:=pg_catalog.jsonb_set(pg_catalog.jsonb_set(
    heartbeat-'heartbeat_hash','{handlers}',pg_catalog.jsonb_build_array(
      pg_catalog.jsonb_build_object(
        'kind','SEMANTIC_INDUCTION','handler_revision','semantic-induction-handler@1.1.0'
      )
    )), '{heartbeat_id}', pg_catalog.to_jsonb('00000000-0000-4000-8000-000000006209'::text)
  );
  heartbeat:=heartbeat||pg_catalog.jsonb_build_object(
    'heartbeat_hash',app_data_agent.u2_canonical_sha256(heartbeat)
  );
  perform app_data_agent.publish_job_worker_heartbeat(heartbeat);
  lease:=app_data_agent.claim_job_work('u11-induction-worker',heartbeat->'handlers',30000);
  if lease is null or lease->>'job_id'<>schema_submission->>'job_id'
    or not (app_data_agent.start_job_work(lease)->>'started')::boolean
  then raise exception 'SEMANTIC_INDUCTION_COMMIT_LEASE_INVALID'; end if;
  material:=pg_catalog.jsonb_build_object(
    'schema_version','semantic-stable-object-identity-material@1.0.0',
    'namespace','u11_fixture','object_role','ENTITY','normalized_name','orders',
    'mapping_identities',pg_catalog.jsonb_build_array('relation:public.orders'),
    'evidence_identities',pg_catalog.jsonb_build_array('physical-relation:public.orders')
  );
  identity_hash:=app_data_agent.u2_canonical_sha256(material);
  object_id:=app_data_agent.semantic_induction_stable_object_id(identity_hash);
  operation_hash:=app_data_agent.u2_canonical_sha256(pg_catalog.jsonb_build_object(
    'identity_hash',identity_hash,'relation_name','orders'
  ));
  proposal:=pg_catalog.jsonb_build_object(
    'schema_version','semantic-induction-proposal-envelope@1.0.0','scope',scope,
    'semantic_domain','u11_fixture','induction_id',schema_request->>'induction_id',
    'base_release_ref',null,
    'stable_objects',pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
      'schema_version','semantic-stable-object-identity@1.0.0','object_id',object_id,
      'identity_hash',identity_hash,'material',material,'aliases','[]'::jsonb
    )),
    'evidence',pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
      'evidence_id','physical-relation:public.orders','source_ref',schema_source->'source_ref',
      'locator','relation:public.orders',
      'observation_hash','sha256:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd',
      'signed_business_assertion',false
    )),
    'candidates',pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
      'operation_id','00000000-0000-8000-8000-000000006208','object_id',object_id,
      'tier','MANDATORY_PHYSICAL_CORE','operation_hash',operation_hash
    ))
  );
  proposal:=proposal||pg_catalog.jsonb_build_object(
    'proposal_hash',app_data_agent.u2_canonical_sha256(proposal)
  );
  impact:=pg_catalog.jsonb_build_object(
    'schema_version','semantic-impact-plan@1.0.0','scope',scope,
    'semantic_domain','u11_fixture','induction_id',schema_request->>'induction_id',
    'changed_object_ids',pg_catalog.jsonb_build_array(object_id),
    'affected_objects',pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
      'object_id',object_id,'object_kind','ENTITY',
      'previous_hash','sha256:0000000000000000000000000000000000000000000000000000000000000000',
      'next_hash',operation_hash
    )),'unchanged_object_hashes','[]'::jsonb
  );
  impact:=impact||pg_catalog.jsonb_build_object('plan_hash',app_data_agent.u2_canonical_sha256(impact));
  candidate_draft:=pg_catalog.jsonb_build_object(
    'schema_version','semantic-candidate-draft@1.0.0','title','U11 fixture candidate',
    'description','Review-only U11 fixture candidate.','semantic_domain','u11_fixture',
    'change_class','MINOR','risk_level','MEDIUM','idempotency_key',schema_request->>'induction_id',
    'source_payload',pg_catalog.jsonb_build_object(
      'schema_version','semantic-source-payload@1.0.0','source_kind','SCHEMA_DISCOVERY',
      'content',pg_catalog.jsonb_build_object(
        'induction_id',schema_request->>'induction_id','induction_kind','SCHEMA_INDUCTION',
        'proposal_hash',proposal->>'proposal_hash',
        'evidence_ids',pg_catalog.jsonb_build_array('physical-relation:public.orders'),
        'review_only',true
      )
    ),
    'diff',pg_catalog.jsonb_build_object(
      'schema_version','semantic-diff@1.0.0','summary','Add deterministic physical core.',
      'operations',pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
        'path','/induction/entity/'||object_id::text,'change_type','ADD',
        'after',pg_catalog.jsonb_build_object('identity_hash',identity_hash,'relation_name','orders')
      ))
    )
  );
  commit_command:=pg_catalog.jsonb_build_object(
    'schema_version','semantic-induction-commit-command@1.0.0','request',schema_request,
    'proposal',proposal,'impact_plan',impact,'metric_dry_run',null,'candidate_draft',candidate_draft
  );
  commit_result:=app_data_agent.commit_semantic_induction_candidate(lease,commit_command);
  if commit_result#>>'{receipt,terminal}'<>'CANDIDATE_CREATED'
    or commit_result#>>'{candidate,candidate_status}'<>'DRAFT'
    or commit_result#>>'{candidate,authority}'<>'POSTGRESQL'
    or commit_result#>>'{receipt,metric_dry_run_ref}' is not null
  then raise exception 'SEMANTIC_INDUCTION_CANDIDATE_COMMIT_INVALID'; end if;
end
$behavior$;

reset session authorization;
do $persisted$
begin
  if not exists (
    select 1 from app_data_agent.semantic_metric_dry_run_receipts receipt
    where receipt.import_id=pg_catalog.current_setting('u11.rejected_induction_id')::uuid
      and receipt.receipt_hash=pg_catalog.current_setting('u11.rejected_dry_run_hash')
  ) or exists (
    select 1 from app_data_agent.semantic_induction_proposals proposal
    where proposal.induction_id=pg_catalog.current_setting('u11.rejected_induction_id')::uuid
  ) then raise exception 'SEMANTIC_INDUCTION_REJECTION_PERSISTENCE_INVALID'; end if;
end
$persisted$;
rollback;

select 'SEMANTIC_INDUCTION_BEHAVIOR_ASSERTIONS_PASSED' as status;
