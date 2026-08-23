create function app_data_agent.provider_json_object_has_exact_keys(
  requested_document jsonb,
  requested_keys text[]
)
returns boolean
language sql
immutable
set search_path = ''
as $function$
  select pg_catalog.jsonb_typeof(requested_document) = 'object'
    and (select pg_catalog.array_agg(key order by key)
         from pg_catalog.jsonb_object_keys(requested_document) as key)
      = (select pg_catalog.array_agg(key order by key)
         from pg_catalog.unnest(requested_keys) as key);
$function$;

create function app_data_agent.assert_provider_active_worker_lease(
  requested_lease jsonb
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
  authority record;
  locked_fence bigint;
  attempt_record app_data_agent.run_attempts%rowtype;
  requested_run_id uuid;
  requested_attempt_id uuid;
  requested_outbox_id uuid;
  requested_command_id uuid;
  requested_worker_id text;
  requested_lease_token bigint;
  requested_worker_fence bigint;
  requested_attempt_no bigint;
begin
  if not pg_catalog.pg_has_role(session_user,'data_agent_backend','USAGE') then
    raise exception using errcode = '42501', message = 'DA_BACKEND_ROLE_REQUIRED';
  end if;
  if not app_data_agent.provider_json_object_has_exact_keys(requested_lease,array[
      'scope','principal_id','outbox_id','run_id','command_id','command_kind','attempt_id',
      'attempt_no','delivery_attempt_no','lease_duration_ms','worker_id','lease_token',
      'worker_fence','expires_at','payload'
    ]::text[])
    or not app_data_agent.provider_json_object_has_exact_keys(
      requested_lease -> 'payload',array['kind','effective_config_ref']::text[])
    or not app_data_agent.provider_json_object_has_exact_keys(
      requested_lease -> 'scope',array['app_id','tenant_id','environment']::text[])
    or not app_data_agent.provider_json_object_has_exact_keys(
      requested_lease #> '{payload,effective_config_ref}',
      array['config_id','config_revision','config_hash']::text[])
    or requested_lease ->> 'command_kind' <> 'START_L2_RESEARCH'
    or requested_lease #>> '{payload,kind}' <> 'START_L2_RESEARCH'
    or app_data_agent.contains_potential_plaintext_secret(requested_lease -> 'payload')
  then
    raise exception using errcode = '22023', message = 'PROVIDER_WORKER_LEASE_INVALID';
  end if;
  begin
    requested_run_id := (requested_lease ->> 'run_id')::uuid;
    requested_attempt_id := (requested_lease ->> 'attempt_id')::uuid;
    requested_outbox_id := (requested_lease ->> 'outbox_id')::uuid;
    requested_command_id := (requested_lease ->> 'command_id')::uuid;
    requested_worker_id := requested_lease ->> 'worker_id';
    requested_lease_token := (requested_lease ->> 'lease_token')::bigint;
    requested_worker_fence := (requested_lease ->> 'worker_fence')::bigint;
    requested_attempt_no := (requested_lease ->> 'attempt_no')::bigint;
  exception when invalid_text_representation or numeric_value_out_of_range then
    raise exception using errcode = '22023', message = 'PROVIDER_WORKER_LEASE_INVALID';
  end;
  if requested_worker_id is null
    or requested_worker_id !~ '^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,127}$'
    or requested_lease_token not between 1 and 9007199254740991
    or requested_worker_fence not between 1 and 9007199254740991
    or requested_attempt_no not between 1 and 9007199254740991
  then
    raise exception using errcode = '22023', message = 'PROVIDER_WORKER_LEASE_INVALID';
  end if;

  select * into strict authority from platform.current_backend_authority(true);
  if requested_lease #>> '{scope,app_id}' <> authority.app_id::text
    or requested_lease #>> '{scope,tenant_id}' <> authority.tenant_id::text
    or requested_lease #>> '{scope,environment}' <> authority.environment
    or requested_lease ->> 'principal_id' <> authority.principal_id::text
  then
    raise exception using errcode = '42501', message = 'PROVIDER_WORKER_LEASE_NOT_OWNED';
  end if;

  locked_fence := app_data_agent.lock_owned_run_fence(requested_run_id);
  if locked_fence is null or locked_fence <> requested_worker_fence then
    raise exception using errcode = '40001', message = 'PROVIDER_WORKER_LEASE_STALE';
  end if;
  select attempt.* into attempt_record
  from app_data_agent.run_attempts as attempt
  join app_data_agent.outbox as message
    on message.app_id = attempt.app_id
   and message.tenant_id = attempt.tenant_id
   and message.environment = attempt.environment
   and message.outbox_id = attempt.outbox_id
   and message.run_id = attempt.run_id
   and message.command_id = attempt.command_id
  where attempt.app_id = authority.app_id
    and attempt.tenant_id = authority.tenant_id
    and attempt.environment = authority.environment
    and attempt.run_id = requested_run_id
    and attempt.attempt_id = requested_attempt_id
    and attempt.attempt_no = requested_attempt_no
    and attempt.outbox_id = requested_outbox_id
    and attempt.command_id = requested_command_id
    and attempt.worker_id = requested_worker_id
    and attempt.lease_token = requested_lease_token
    and attempt.worker_fence = requested_worker_fence
    and attempt.status = 'ACTIVE'
    and attempt.lease_expires_at > pg_catalog.clock_timestamp()
    and message.status = 'LEASED'
    and message.active_attempt_id = requested_attempt_id
    and message.lease_owner = requested_worker_id
    and message.lease_token = requested_lease_token
    and message.run_fence = requested_worker_fence
    and message.lease_expires_at > pg_catalog.clock_timestamp()
  for update of attempt,message;
  if not found then
    raise exception using errcode = '40001', message = 'PROVIDER_WORKER_LEASE_STALE';
  end if;
  return pg_catalog.jsonb_build_object(
    'app_id',authority.app_id,
    'tenant_id',authority.tenant_id,
    'environment',authority.environment,
    'deployment_id',authority.deployment_id,
    'workspace_id',authority.tenant_id,
    'principal_id',authority.principal_id,
    'run_id',attempt_record.run_id,
    'attempt_id',attempt_record.attempt_id,
    'attempt_no',attempt_record.attempt_no,
    'outbox_id',attempt_record.outbox_id,
    'command_id',attempt_record.command_id,
    'worker_id',attempt_record.worker_id,
    'lease_token',attempt_record.lease_token,
    'worker_fence',attempt_record.worker_fence
  );
end
$function$;

create function app_data_agent.mark_provider_invocation_dispatched(
  requested_lease jsonb,
  requested_command jsonb
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
  lease_authority jsonb;
  intent_record app_data_agent.provider_invocation_intents%rowtype;
  permit_record app_data_agent.provider_invocation_dispatch_permits%rowtype;
  existing_marker app_data_agent.provider_invocation_outcomes%rowtype;
  previous_outcome app_data_agent.provider_invocation_outcomes%rowtype;
  marker_document jsonb;
  projection_document jsonb;
  marker_id uuid;
  marked_at timestamptz;
begin
  if not app_data_agent.provider_json_object_has_exact_keys(requested_command,array[
      'schema_version','intent_id','invocation_id','scope','run_id','dispatch_hash',
      'attempt_id','worker_fence'
    ]::text[])
    or requested_command ->> 'schema_version' <> 'provider-invocation-mark-started@1.0.0'
  then
    raise exception using errcode = '22023', message = 'PROVIDER_DISPATCH_MARK_COMMAND_INVALID';
  end if;
  lease_authority := app_data_agent.assert_provider_active_worker_lease(requested_lease);
  select intent.* into intent_record
  from app_data_agent.provider_invocation_intents as intent
  where intent.app_id = (lease_authority ->> 'app_id')::uuid
    and intent.tenant_id = (lease_authority ->> 'tenant_id')::uuid
    and intent.environment = lease_authority ->> 'environment'
    and intent.intent_id = (requested_command ->> 'intent_id')::uuid
    and intent.invocation_id = (requested_command ->> 'invocation_id')::uuid
    and intent.run_id = (requested_command ->> 'run_id')::uuid
    and intent.admission = 'READY'
  for update;
  if not found then
    raise exception using errcode = '55000', message = 'PROVIDER_INVOCATION_INTENT_NOT_FOUND_OR_FORBIDDEN';
  end if;
  select permit.* into permit_record
  from app_data_agent.provider_invocation_dispatch_permits as permit
  where permit.app_id = intent_record.app_id
    and permit.tenant_id = intent_record.tenant_id
    and permit.environment = intent_record.environment
    and permit.intent_id = intent_record.intent_id
    and permit.invocation_id = intent_record.invocation_id
    and permit.run_id = intent_record.run_id
    and permit.dispatch_hash = requested_command ->> 'dispatch_hash'
    and permit.attempt_id = (requested_command ->> 'attempt_id')::uuid
    and permit.attempt_id = (lease_authority ->> 'attempt_id')::uuid
    and permit.worker_fence = (requested_command ->> 'worker_fence')::bigint
    and permit.worker_fence = (lease_authority ->> 'worker_fence')::bigint
    and permit.outbox_id = (lease_authority ->> 'outbox_id')::uuid
    and permit.command_id = (lease_authority ->> 'command_id')::uuid
    and permit.worker_id = lease_authority ->> 'worker_id'
    and permit.lease_token = (lease_authority ->> 'lease_token')::bigint
  for share;
  if not found or requested_command -> 'scope' <> permit_record.envelope_json -> 'scope' then
    raise exception using errcode = '55000', message = 'PROVIDER_DISPATCH_PERMIT_NOT_COMMITTED';
  end if;
  projection_document := pg_catalog.jsonb_build_object(
    'schema_version','provider-invocation-public@1.0.0',
    'invocation_id',intent_record.invocation_id,'run_id',intent_record.run_id,
    'provider',intent_record.provider,'model_profile_id',intent_record.model_profile_id,
    'model_config_version',intent_record.model_config_version,
    'profile_version',intent_record.profile_version,'model_id',intent_record.model_id,
    'certification_receipt_ref',pg_catalog.jsonb_build_object(
      'artifact_id',intent_record.certification_artifact_id,
      'artifact_type','ModelCertificationReceipt','app_id',intent_record.app_id,
      'tenant_id',intent_record.tenant_id,'environment',intent_record.environment,
      'run_id',intent_record.certification_run_id,'revision',intent_record.certification_revision,
      'content_hash',intent_record.certification_hash),
    'attempt_id',permit_record.attempt_id,'attempt_no',permit_record.attempt_no,
    'recovery_action',null,'status','STARTED','reason_code',null,
    'dispatch_hash',permit_record.dispatch_hash,'response_hash',null,
    'usage_availability',null,'usage_source',null,'input_tokens',null,
    'output_tokens',null,'total_tokens',null,'tool_calls',null,'provider_call_count',1,
    'retry_after_ms',null,'latency_ms',null,
    'receipt_deep_link','/w/' || intent_record.workspace_id::text || '/runs/' ||
      intent_record.run_id::text || '/provider-invocations/' || intent_record.invocation_id::text,
    'terminal_at',null);
  select outcome.* into existing_marker
  from app_data_agent.provider_invocation_outcomes as outcome
  where outcome.app_id = intent_record.app_id
    and outcome.tenant_id = intent_record.tenant_id
    and outcome.environment = intent_record.environment
    and outcome.intent_id = intent_record.intent_id
    and outcome.state = 'DISPATCH_MARKED'
    and outcome.dispatch_attempt_no = (lease_authority ->> 'attempt_no')::bigint;
  if found then
    if existing_marker.dispatch_hash <> permit_record.dispatch_hash
      or existing_marker.attempt_id <> permit_record.attempt_id
      or existing_marker.worker_fence <> permit_record.worker_fence
    then
      raise exception using errcode = '23505', message = 'PROVIDER_DISPATCH_MARK_CONFLICT';
    end if;
    return pg_catalog.jsonb_build_object(
      'schema_version','provider-invocation-mark-started-result@1.0.0',
      'disposition','REPLAYED','intent',intent_record.intent_json,
      'permit',permit_record.permit_json,'marker',existing_marker.outcome_json,
      'projection',projection_document);
  end if;
  if exists (select 1 from app_data_agent.provider_invocation_outcomes outcome
    where outcome.app_id = intent_record.app_id and outcome.tenant_id = intent_record.tenant_id
      and outcome.environment = intent_record.environment and outcome.intent_id = intent_record.intent_id
      and outcome.state in ('COMPLETED','FAILED','THROTTLED','OUTCOME_UNKNOWN')) then
    raise exception using errcode = '55000', message = 'PROVIDER_INVOCATION_ALREADY_TERMINAL';
  end if;
  select outcome.* into previous_outcome
  from app_data_agent.provider_invocation_outcomes outcome
  where outcome.app_id = intent_record.app_id and outcome.tenant_id = intent_record.tenant_id
    and outcome.environment = intent_record.environment and outcome.intent_id = intent_record.intent_id
  order by outcome.transition_revision desc
  limit 1
  for share;
  if previous_outcome.outcome_id is not null
    and previous_outcome.state <> 'DISPATCH_MARKED'
  then
    raise exception using errcode = '55000', message = 'PROVIDER_INVOCATION_ALREADY_TERMINAL';
  end if;
  if previous_outcome.outcome_id is not null
    and not ('IDEMPOTENT_REQUEST' = any(intent_record.recovery_capabilities))
  then
    raise exception using errcode = '55000',
      message = 'PROVIDER_REDISPATCH_REQUIRES_RECONCILIATION';
  end if;
  marker_id := pg_catalog.gen_random_uuid();
  marked_at := pg_catalog.clock_timestamp();
  marker_document := pg_catalog.jsonb_build_object(
    'schema_version','provider-invocation-dispatch-marker@1.0.0',
    'marker_id',marker_id,'intent_id',intent_record.intent_id,
    'invocation_id',intent_record.invocation_id,
    'scope',permit_record.envelope_json -> 'scope',
    'run_id',intent_record.run_id,'dispatch_hash',permit_record.dispatch_hash,
    'state','DISPATCH_MARKED',
    'dispatch_marked_at',app_data_agent.runtime_iso_timestamp(marked_at));
  marker_document := marker_document || pg_catalog.jsonb_build_object(
    'marker_hash',app_data_agent.u2_canonical_sha256(marker_document));
  insert into app_data_agent.provider_invocation_outcomes (
    app_id,tenant_id,environment,outcome_id,intent_id,invocation_id,run_id,dispatch_hash,
    transition_revision,parent_transition_revision,parent_outcome_hash,state,actor_kind,
    transition_from,recovery_action,dispatch_attempt_no,attempt_id,outbox_id,command_id,
    worker_id,lease_token,worker_fence,dispatch_marked,provider_call_may_have_started,
    provider_call_count,delivery_certainty,started_at,terminal_at,outcome_json,outcome_hash,committed_at
  ) values (
    intent_record.app_id,intent_record.tenant_id,intent_record.environment,marker_id,
    intent_record.intent_id,intent_record.invocation_id,intent_record.run_id,permit_record.dispatch_hash,
    coalesce(previous_outcome.transition_revision,0) + 1,
    previous_outcome.transition_revision,previous_outcome.outcome_hash,
    'DISPATCH_MARKED','WORKER',
    case when previous_outcome.outcome_id is null then 'INTENT_COMMITTED' else 'DISPATCH_MARKED' end,
    case when previous_outcome.outcome_id is null then 'NONE' else 'SAFE_RETRY' end,
    permit_record.attempt_no,permit_record.attempt_id,permit_record.outbox_id,
    permit_record.command_id,permit_record.worker_id,permit_record.lease_token,permit_record.worker_fence,
    true,true,1,'DISPATCHED_OUTCOME_UNKNOWN',marked_at,null,
    marker_document,marker_document ->> 'marker_hash',marked_at
  );
  return pg_catalog.jsonb_build_object(
    'schema_version','provider-invocation-mark-started-result@1.0.0',
    'disposition','CREATED','intent',intent_record.intent_json,
    'permit',permit_record.permit_json,'marker',marker_document,
    'projection',projection_document);
exception when invalid_text_representation or numeric_value_out_of_range then
  raise exception using errcode = '22023', message = 'PROVIDER_DISPATCH_MARK_COMMAND_INVALID';
end
$function$;

create function app_data_agent.mark_provider_invocation_response_observed(
  requested_lease jsonb,
  requested_command jsonb
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
  lease_authority jsonb;
  intent_record app_data_agent.provider_invocation_intents%rowtype;
  permit_record app_data_agent.provider_invocation_dispatch_permits%rowtype;
  dispatch_marker app_data_agent.provider_invocation_outcomes%rowtype;
  existing_marker app_data_agent.provider_invocation_outcomes%rowtype;
  marker_document jsonb;
  projection_document jsonb;
  marker_id uuid;
  observed_at timestamptz;
begin
  if not app_data_agent.provider_json_object_has_exact_keys(requested_command,array[
      'schema_version','intent_id','invocation_id','scope','run_id','dispatch_hash',
      'attempt_id','worker_fence','observation_kind','response_hash','delivery_certainty'
    ]::text[])
    or requested_command ->> 'schema_version' <>
      'provider-invocation-mark-response-observed@1.0.0'
    or requested_command ->> 'observation_kind' not in (
      'COMPLETED','FAILED','THROTTLED','OUTCOME_UNKNOWN'
    )
    or ((requested_command ->> 'observation_kind') = 'COMPLETED') <>
      ((requested_command ->> 'response_hash') ~ '^sha256:[0-9a-f]{64}$')
    or ((requested_command ->> 'observation_kind') = 'OUTCOME_UNKNOWN') <>
      ((requested_command ->> 'delivery_certainty') = 'DISPATCHED_OUTCOME_UNKNOWN')
    or requested_command ->> 'delivery_certainty' not in (
      'DISPATCHED_OUTCOME_KNOWN','DISPATCHED_OUTCOME_UNKNOWN'
    )
  then
    raise exception using errcode = '22023',
      message = 'PROVIDER_RESPONSE_OBSERVED_COMMAND_INVALID';
  end if;
  lease_authority := app_data_agent.assert_provider_active_worker_lease(requested_lease);
  select intent.* into intent_record
  from app_data_agent.provider_invocation_intents intent
  where intent.app_id = (lease_authority ->> 'app_id')::uuid
    and intent.tenant_id = (lease_authority ->> 'tenant_id')::uuid
    and intent.environment = lease_authority ->> 'environment'
    and intent.intent_id = (requested_command ->> 'intent_id')::uuid
    and intent.invocation_id = (requested_command ->> 'invocation_id')::uuid
    and intent.run_id = (requested_command ->> 'run_id')::uuid
    and intent.admission = 'READY'
  for update;
  if not found or requested_command -> 'scope' <> pg_catalog.jsonb_build_object(
      'app_id',intent_record.app_id,'tenant_id',intent_record.tenant_id,
      'environment',intent_record.environment,'workspace_id',intent_record.workspace_id,
      'principal_id',intent_record.principal_id)
  then
    raise exception using errcode = '55000',
      message = 'PROVIDER_INVOCATION_INTENT_NOT_FOUND_OR_FORBIDDEN';
  end if;
  select permit.* into permit_record
  from app_data_agent.provider_invocation_dispatch_permits permit
  where permit.app_id = intent_record.app_id
    and permit.tenant_id = intent_record.tenant_id
    and permit.environment = intent_record.environment
    and permit.intent_id = intent_record.intent_id
    and permit.dispatch_hash = requested_command ->> 'dispatch_hash'
    and permit.attempt_id = (requested_command ->> 'attempt_id')::uuid
    and permit.attempt_id = (lease_authority ->> 'attempt_id')::uuid
    and permit.worker_fence = (requested_command ->> 'worker_fence')::bigint
    and permit.worker_fence = (lease_authority ->> 'worker_fence')::bigint
    and permit.outbox_id = (lease_authority ->> 'outbox_id')::uuid
    and permit.command_id = (lease_authority ->> 'command_id')::uuid
    and permit.worker_id = lease_authority ->> 'worker_id'
    and permit.lease_token = (lease_authority ->> 'lease_token')::bigint;
  if not found then
    raise exception using errcode = '55000', message = 'PROVIDER_DISPATCH_PERMIT_NOT_COMMITTED';
  end if;
  select outcome.* into dispatch_marker
  from app_data_agent.provider_invocation_outcomes outcome
  where outcome.app_id = intent_record.app_id
    and outcome.tenant_id = intent_record.tenant_id
    and outcome.environment = intent_record.environment
    and outcome.intent_id = intent_record.intent_id
    and outcome.dispatch_hash = permit_record.dispatch_hash
    and outcome.attempt_id = permit_record.attempt_id
    and outcome.worker_fence = permit_record.worker_fence
    and outcome.state = 'DISPATCH_MARKED'
  for share;
  if not found then
    raise exception using errcode = '55000', message = 'PROVIDER_DISPATCH_MARK_NOT_COMMITTED';
  end if;
  select outcome.* into existing_marker
  from app_data_agent.provider_invocation_outcomes outcome
  where outcome.app_id = intent_record.app_id
    and outcome.tenant_id = intent_record.tenant_id
    and outcome.environment = intent_record.environment
    and outcome.intent_id = intent_record.intent_id
    and outcome.dispatch_attempt_no = permit_record.attempt_no
    and outcome.state = 'RESPONSE_OBSERVED';
  if found then
    if not app_data_agent.provider_json_object_has_exact_keys(
        existing_marker.outcome_json,array[
          'schema_version','marker_id','intent_id','invocation_id','scope','run_id',
          'dispatch_hash','attempt_id','worker_fence','state','observation_kind',
          'response_hash','delivery_certainty','response_observed_at','marker_hash'
        ]::text[])
      or existing_marker.outcome_json ->> 'schema_version' <>
        'provider-invocation-response-observed-marker@1.0.0'
      or existing_marker.outcome_json ->> 'intent_id' <> intent_record.intent_id::text
      or existing_marker.outcome_json ->> 'invocation_id' <> intent_record.invocation_id::text
      or existing_marker.outcome_json -> 'scope' <> requested_command -> 'scope'
      or existing_marker.outcome_json ->> 'run_id' <> intent_record.run_id::text
      or existing_marker.outcome_json ->> 'dispatch_hash' <> permit_record.dispatch_hash
      or existing_marker.outcome_json ->> 'attempt_id' <> permit_record.attempt_id::text
      or existing_marker.outcome_json ->> 'worker_fence' <> permit_record.worker_fence::text
      or existing_marker.outcome_json ->> 'state' <> 'RESPONSE_OBSERVED'
      or existing_marker.outcome_json ->> 'marker_hash' <>
        app_data_agent.u2_canonical_sha256(existing_marker.outcome_json - 'marker_hash')
      or existing_marker.outcome_json ->> 'observation_kind' <>
        requested_command ->> 'observation_kind'
      or existing_marker.outcome_json -> 'response_hash' <>
        requested_command -> 'response_hash'
      or existing_marker.delivery_certainty <> requested_command ->> 'delivery_certainty'
      or existing_marker.parent_outcome_hash <> dispatch_marker.outcome_hash
    then
      raise exception using errcode = '23505', message = 'PROVIDER_RESPONSE_OBSERVED_CONFLICT';
    end if;
    marker_document := existing_marker.outcome_json;
  else
    if exists (select 1 from app_data_agent.provider_invocation_outcomes outcome
      where outcome.app_id = intent_record.app_id
        and outcome.tenant_id = intent_record.tenant_id
        and outcome.environment = intent_record.environment
        and outcome.intent_id = intent_record.intent_id
        and outcome.state in ('COMPLETED','FAILED','THROTTLED','OUTCOME_UNKNOWN'))
    then
      raise exception using errcode = '55000', message = 'PROVIDER_INVOCATION_ALREADY_TERMINAL';
    end if;
    marker_id := pg_catalog.gen_random_uuid();
    observed_at := pg_catalog.clock_timestamp();
    marker_document := pg_catalog.jsonb_build_object(
      'schema_version','provider-invocation-response-observed-marker@1.0.0',
      'marker_id',marker_id,'intent_id',intent_record.intent_id,
      'invocation_id',intent_record.invocation_id,
      'scope',requested_command -> 'scope','run_id',intent_record.run_id,
      'dispatch_hash',permit_record.dispatch_hash,
      'attempt_id',permit_record.attempt_id,'worker_fence',permit_record.worker_fence,
      'state','RESPONSE_OBSERVED',
      'observation_kind',requested_command -> 'observation_kind',
      'response_hash',requested_command -> 'response_hash',
      'delivery_certainty',requested_command -> 'delivery_certainty',
      'response_observed_at',app_data_agent.runtime_iso_timestamp(observed_at));
    marker_document := marker_document || pg_catalog.jsonb_build_object(
      'marker_hash',app_data_agent.u2_canonical_sha256(marker_document));
    insert into app_data_agent.provider_invocation_outcomes (
      app_id,tenant_id,environment,outcome_id,intent_id,invocation_id,run_id,dispatch_hash,
      transition_revision,parent_transition_revision,parent_outcome_hash,state,observation_kind,
      actor_kind,transition_from,recovery_action,dispatch_attempt_no,attempt_id,outbox_id,
      command_id,worker_id,lease_token,worker_fence,dispatch_marked,
      provider_call_may_have_started,provider_call_count,delivery_certainty,started_at,
      terminal_at,outcome_json,outcome_hash,committed_at
    ) values (
      intent_record.app_id,intent_record.tenant_id,intent_record.environment,marker_id,
      intent_record.intent_id,intent_record.invocation_id,intent_record.run_id,
      permit_record.dispatch_hash,dispatch_marker.transition_revision + 1,
      dispatch_marker.transition_revision,dispatch_marker.outcome_hash,'RESPONSE_OBSERVED',
      requested_command ->> 'observation_kind','WORKER','DISPATCH_MARKED','NONE',
      permit_record.attempt_no,permit_record.attempt_id,permit_record.outbox_id,
      permit_record.command_id,permit_record.worker_id,permit_record.lease_token,
      permit_record.worker_fence,true,true,1,requested_command ->> 'delivery_certainty',
      dispatch_marker.started_at,null,marker_document,marker_document ->> 'marker_hash',observed_at
    );
  end if;
  projection_document := pg_catalog.jsonb_build_object(
    'schema_version','provider-invocation-public@1.0.0',
    'invocation_id',intent_record.invocation_id,'run_id',intent_record.run_id,
    'provider',intent_record.provider,'model_profile_id',intent_record.model_profile_id,
    'model_config_version',intent_record.model_config_version,
    'profile_version',intent_record.profile_version,'model_id',intent_record.model_id,
    'certification_receipt_ref',pg_catalog.jsonb_build_object(
      'artifact_id',intent_record.certification_artifact_id,
      'artifact_type','ModelCertificationReceipt','app_id',intent_record.app_id,
      'tenant_id',intent_record.tenant_id,'environment',intent_record.environment,
      'run_id',intent_record.certification_run_id,'revision',intent_record.certification_revision,
      'content_hash',intent_record.certification_hash),
    'attempt_id',permit_record.attempt_id,'attempt_no',permit_record.attempt_no,
    'recovery_action',null,'status','STARTED','reason_code',null,
    'dispatch_hash',permit_record.dispatch_hash,'response_hash',null,
    'usage_availability',null,'usage_source',null,'input_tokens',null,
    'output_tokens',null,'total_tokens',null,'tool_calls',null,'provider_call_count',1,
    'retry_after_ms',null,'latency_ms',null,
    'receipt_deep_link','/w/' || intent_record.workspace_id::text || '/runs/' ||
      intent_record.run_id::text || '/provider-invocations/' || intent_record.invocation_id::text,
    'terminal_at',null);
  return pg_catalog.jsonb_build_object(
    'schema_version','provider-invocation-mark-response-observed-result@1.0.0',
    'disposition',case when existing_marker.outcome_id is null then 'CREATED' else 'REPLAYED' end,
    'intent',intent_record.intent_json,'permit',permit_record.permit_json,
    'marker',marker_document,'projection',projection_document);
exception when invalid_text_representation or numeric_value_out_of_range then
  raise exception using errcode = '22023', message = 'PROVIDER_RESPONSE_OBSERVED_COMMAND_INVALID';
end
$function$;

-- Remaining U3 invocation RPCs are defined below this common fixed-lock lease gate.

create function app_data_agent.begin_provider_invocation(
  requested_lease jsonb,
  requested_command jsonb
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $function$
declare
  lease_authority jsonb;
  envelope jsonb;
  scope_document jsonb;
  invocation_key_draft jsonb;
  intent_document jsonb;
  permit_document jsonb;
  existing_intent app_data_agent.provider_invocation_intents%rowtype;
  existing_permit app_data_agent.provider_invocation_dispatch_permits%rowtype;
  existing_outcome app_data_agent.provider_invocation_outcomes%rowtype;
  existing_usage app_data_agent.provider_invocation_usage_receipts%rowtype;
  response_record app_data_agent.artifacts%rowtype;
  config_record app_data_agent.effective_run_config_receipts%rowtype;
  context_record app_data_agent.effective_config_context_receipts%rowtype;
  model_record app_data_agent.model_catalog_entries%rowtype;
  model_revision app_data_agent.model_config_versions%rowtype;
  task_record app_data_agent.artifacts%rowtype;
  certification_record app_data_agent.artifacts%rowtype;
  projection_record app_data_agent.artifacts%rowtype;
  connection_record app_data_agent.model_provider_connections%rowtype;
  connection_revision app_data_agent.model_provider_connection_versions%rowtype;
  deployment_record platform.deployment_mappings%rowtype;
  intent_id uuid;
  permit_id uuid;
  committed_at timestamptz;
  intent_committed_at timestamptz;
  model_resource_hash text;
  connection_hash text;
  expected_deployment_hash text;
  invocation_key_hash text;
  dispatch_hash text;
  recovery_capabilities text[];
  result_disposition text;
  rejection_reason text;
  rejection_outcome_document jsonb;
  rejection_usage_document jsonb;
  rejection_projection_document jsonb;
  rejection_outcome_id uuid;
  rejection_usage_id uuid;
  terminal_projection_document jsonb;
  terminal_response_ref jsonb;
  terminal_replay_action text;
begin
  if not app_data_agent.provider_json_object_has_exact_keys(
      requested_command,array['schema_version','envelope']::text[])
    or requested_command ->> 'schema_version' <> 'provider-invocation-begin@1.0.0'
  then
    raise exception using errcode = '22023', message = 'PROVIDER_INVOCATION_COMMAND_INVALID';
  end if;
  envelope := requested_command -> 'envelope';
  if not app_data_agent.provider_json_object_has_exact_keys(envelope,array[
      'schema_version','invocation_id','idempotency_key','scope','run_id','logical_call_id',
      'task_ref','effective_config_ref','context_receipt_ref','lease','model_profile',
      'certification','connection','request_policy','projection','invocation_key_hash','dispatch_hash'
    ]::text[])
    or envelope ->> 'schema_version' <> 'provider-dispatch-envelope@1.0.0'
    or app_data_agent.contains_potential_plaintext_secret(
      envelope
        #- '{lease,lease_token}'
        #- '{request_policy,budget,max_input_tokens}'
        #- '{request_policy,budget,max_output_tokens}'
        #- '{certification,certified_context_window,max_context_tokens}'
        #- '{certification,certified_context_window,max_output_tokens}'
        #- '{projection,token_bound_policy_version}'
        #- '{projection,trusted_input_token_upper_bound}'
        #- '{projection,reserved_output_tokens}'
        #- '{projection,effective_context_ceiling_tokens}'
        #- '{projection,effective_output_ceiling_tokens}'
    )
  then
    raise exception using errcode = '22023', message = 'PROVIDER_DISPATCH_ENVELOPE_INVALID';
  end if;
  if pg_catalog.length(envelope ->> 'idempotency_key') not between 8 and 256
    or envelope ->> 'idempotency_key' !~ '^[A-Za-z0-9][A-Za-z0-9._:@/-]*$'
    or envelope ->> 'invocation_id' <> pg_catalog.lower((envelope ->> 'invocation_id')::uuid::text)
    or envelope ->> 'run_id' <> pg_catalog.lower((envelope ->> 'run_id')::uuid::text)
    or envelope ->> 'logical_call_id' <>
      pg_catalog.lower((envelope ->> 'logical_call_id')::uuid::text)
    or envelope #>> '{model_profile,profile_version}' <>
      'model-profile@' || (envelope #>> '{model_profile,model_config_version}')::bigint::text
    or envelope #>> '{model_profile,adapter_version}' !~
      '^[A-Za-z0-9][A-Za-z0-9._@/-]{0,127}$'
    or (envelope #>> '{request_policy,budget,timeout_ms}')::bigint not between 1 and 600000
    or (envelope #>> '{request_policy,budget,max_input_tokens}')::bigint not between 1 and 9007199254740991
    or (envelope #>> '{request_policy,budget,max_output_tokens}')::bigint not between 1 and 9007199254740991
    or (envelope #>> '{request_policy,budget,max_tool_calls}')::bigint not between 0 and 9007199254740991
    or (envelope #>> '{request_policy,budget,provider_call_limit}')::integer <> 1
    or pg_catalog.jsonb_array_length(envelope #> '{request_policy,tool_allowlist}') > 64
    or exists (
      select 1 from (
        select value,pg_catalog.lag(value) over (order by ordinal) as previous_value
        from pg_catalog.jsonb_array_elements_text(envelope #> '{request_policy,tool_allowlist}')
          with ordinality as tool(value,ordinal)
      ) ordered_tool
      where value !~ '^[A-Za-z0-9][A-Za-z0-9._@/-]{0,127}$'
        or previous_value is not null and previous_value >= value
    )
  then
    raise exception using errcode = '22023', message = 'PROVIDER_DISPATCH_ENVELOPE_INVALID';
  end if;
  if not app_data_agent.provider_json_object_has_exact_keys(
      envelope -> 'scope',array['app_id','tenant_id','environment','workspace_id','principal_id']::text[])
    or not app_data_agent.provider_json_object_has_exact_keys(envelope -> 'task_ref',array[
      'artifact_id','artifact_type','app_id','tenant_id','environment','run_id','revision','content_hash'
    ]::text[])
    or not app_data_agent.provider_json_object_has_exact_keys(envelope -> 'effective_config_ref',array[
      'config_id','config_revision','config_hash'
    ]::text[])
    or not app_data_agent.provider_json_object_has_exact_keys(envelope -> 'context_receipt_ref',array[
      'receipt_id','receipt_hash'
    ]::text[])
    or not app_data_agent.provider_json_object_has_exact_keys(envelope -> 'lease',array[
      'outbox_id','command_id','attempt_id','attempt_no','worker_id','lease_token','worker_fence'
    ]::text[])
    or not app_data_agent.provider_json_object_has_exact_keys(envelope -> 'model_profile',array[
      'profile_id','model_config_version','resource_hash','profile_version','provider','model_id',
      'adapter_version'
    ]::text[])
    or not app_data_agent.provider_json_object_has_exact_keys(envelope -> 'certification',array[
      'receipt_ref','execution_profile_hash','recovery_capabilities','certified_context_window'
    ]::text[])
    or not app_data_agent.provider_json_object_has_exact_keys(envelope #> '{certification,receipt_ref}',array[
      'artifact_id','artifact_type','app_id','tenant_id','environment','run_id','revision','content_hash'
    ]::text[])
    or not app_data_agent.provider_json_object_has_exact_keys(
      envelope #> '{certification,certified_context_window}',array[
        'verification_status','max_context_tokens','max_output_tokens'
      ]::text[])
    or pg_catalog.jsonb_typeof(envelope #> '{certification,recovery_capabilities}') <> 'array'
    or not app_data_agent.provider_json_object_has_exact_keys(envelope -> 'request_policy',array[
      'response_schema_version','tool_allowlist','budget'
    ]::text[])
    or pg_catalog.jsonb_typeof(envelope #> '{request_policy,tool_allowlist}') <> 'array'
    or not app_data_agent.provider_json_object_has_exact_keys(envelope #> '{request_policy,budget}',array[
      'timeout_ms','max_input_tokens','max_output_tokens','max_tool_calls','provider_call_limit'
    ]::text[])
    or not app_data_agent.provider_json_object_has_exact_keys(envelope -> 'projection',array[
      'projection_version','receipt_ref','payload_hash','token_bound_policy_version',
      'trusted_input_token_upper_bound',
      'reserved_output_tokens','effective_context_ceiling_tokens',
      'effective_output_ceiling_tokens','capacity_status','taint_hash'
    ]::text[])
    or not app_data_agent.provider_json_object_has_exact_keys(envelope #> '{projection,receipt_ref}',array[
      'artifact_id','artifact_type','app_id','tenant_id','environment','run_id','revision','content_hash'
    ]::text[])
    or ((envelope #>> '{connection,kind}') = 'SYSTEM_DEPLOYMENT' and not
      app_data_agent.provider_json_object_has_exact_keys(envelope -> 'connection',array[
        'kind','deployment_id','deployment_revision','deployment_hash'
      ]::text[]))
    or ((envelope #>> '{connection,kind}') = 'MANAGED_CONNECTION' and not
      app_data_agent.provider_json_object_has_exact_keys(envelope -> 'connection',array[
        'kind','provider_connection_id','config_version','connection_hash'
      ]::text[]))
    or envelope #>> '{connection,kind}' not in ('SYSTEM_DEPLOYMENT','MANAGED_CONNECTION')
  then
    raise exception using errcode = '22023', message = 'PROVIDER_DISPATCH_ENVELOPE_INVALID';
  end if;
  lease_authority := app_data_agent.assert_provider_active_worker_lease(requested_lease);
  scope_document := envelope -> 'scope';
  if scope_document <> pg_catalog.jsonb_build_object(
      'app_id',lease_authority -> 'app_id',
      'tenant_id',lease_authority -> 'tenant_id',
      'environment',lease_authority -> 'environment',
      'workspace_id',lease_authority -> 'workspace_id',
      'principal_id',lease_authority -> 'principal_id')
    or envelope ->> 'run_id' <> lease_authority ->> 'run_id'
    or envelope -> 'lease' <> pg_catalog.jsonb_build_object(
      'outbox_id',lease_authority -> 'outbox_id',
      'command_id',lease_authority -> 'command_id',
      'attempt_id',lease_authority -> 'attempt_id',
      'attempt_no',lease_authority -> 'attempt_no',
      'worker_id',lease_authority -> 'worker_id',
      'lease_token',lease_authority -> 'lease_token',
      'worker_fence',lease_authority -> 'worker_fence')
  then
    raise exception using errcode = '40001', message = 'PROVIDER_WORKER_LEASE_MISMATCH';
  end if;

  -- Logical identity excludes attempt-bound ContextReceipt and lease. Dispatch identity includes both.
  invocation_key_draft := pg_catalog.jsonb_build_object(
    'schema_version','provider-invocation-spec@1.0.0',
    'invocation_id',envelope -> 'invocation_id',
    'idempotency_key',envelope -> 'idempotency_key',
    'scope',envelope -> 'scope','run_id',envelope -> 'run_id',
    'logical_call_id',envelope -> 'logical_call_id','task_ref',envelope -> 'task_ref',
    'effective_config_ref',envelope -> 'effective_config_ref',
    'model_profile',envelope -> 'model_profile','certification',envelope -> 'certification',
    'connection',envelope -> 'connection','request_policy',envelope -> 'request_policy',
    'projection',envelope -> 'projection');
  invocation_key_hash := app_data_agent.u2_canonical_sha256(invocation_key_draft);
  dispatch_hash := app_data_agent.u2_canonical_sha256(envelope - 'dispatch_hash');
  if envelope ->> 'invocation_key_hash' <> invocation_key_hash then
    raise exception using errcode = '22023', message = 'PROVIDER_INVOCATION_KEY_HASH_MISMATCH';
  end if;
  if envelope ->> 'dispatch_hash' <> dispatch_hash then
    raise exception using errcode = '22023', message = 'PROVIDER_DISPATCH_HASH_MISMATCH';
  end if;

  select config.* into config_record
  from app_data_agent.effective_run_config_receipts as config
  where config.app_id = (lease_authority ->> 'app_id')::uuid
    and config.tenant_id = (lease_authority ->> 'tenant_id')::uuid
    and config.environment = lease_authority ->> 'environment'
    and config.run_id = (lease_authority ->> 'run_id')::uuid
    and config.principal_id = (lease_authority ->> 'principal_id')::uuid
    and config.config_id = (envelope #>> '{effective_config_ref,config_id}')::uuid
    and config.config_revision = (envelope #>> '{effective_config_ref,config_revision}')::bigint
    and config.config_hash = envelope #>> '{effective_config_ref,config_hash}'
  for share;
  if not found then
    raise exception using errcode = '55000', message = 'PROVIDER_EFFECTIVE_CONFIG_MISMATCH';
  end if;
  perform app_data_agent.revalidate_effective_run_config_internal(
    config_record.config_id,config_record.config_revision,config_record.config_hash,
    config_record.run_id,true);

  select context.* into context_record
  from app_data_agent.effective_config_context_receipts as context
  where context.app_id = config_record.app_id
    and context.tenant_id = config_record.tenant_id
    and context.environment = config_record.environment
    and context.context_receipt_id = (envelope #>> '{context_receipt_ref,receipt_id}')::uuid
    and context.receipt_hash = envelope #>> '{context_receipt_ref,receipt_hash}'
    and context.consumer_kind = 'WORKER_START'
    and context.config_id = config_record.config_id
    and context.config_revision = config_record.config_revision
    and context.config_hash = config_record.config_hash
    and context.run_id = config_record.run_id
    and context.principal_id = config_record.principal_id
    and context.attempt_id = (lease_authority ->> 'attempt_id')::uuid
    and context.outbox_id = (lease_authority ->> 'outbox_id')::uuid
    and context.command_id = (lease_authority ->> 'command_id')::uuid
    and context.worker_id = lease_authority ->> 'worker_id'
    and context.lease_token = (lease_authority ->> 'lease_token')::bigint
    and context.worker_fence = (lease_authority ->> 'worker_fence')::bigint
  for share;
  if not found or context_record.receipt_hash <> app_data_agent.u2_canonical_sha256(context_record.receipt_json) then
    raise exception using errcode = '55000', message = 'PROVIDER_CONTEXT_RECEIPT_MISMATCH';
  end if;

  if envelope #>> '{model_profile,profile_id}' <> config_record.model_profile_id::text
    or (envelope #>> '{model_profile,model_config_version}')::bigint <> config_record.model_config_version
    or envelope #>> '{model_profile,profile_version}' <>
      'model-profile@' || config_record.model_config_version::text
    or envelope #>> '{model_profile,provider}' <> config_record.provider
    or envelope #>> '{model_profile,model_id}' <> config_record.model_id
  then
    raise exception using errcode = '55000', message = 'PROVIDER_PROFILE_NOT_AVAILABLE';
  end if;
  if config_record.provider = 'anthropic' then
    rejection_reason := 'PROVIDER_PROFILE_NOT_AVAILABLE';
  end if;
  select catalog.* into model_record
  from app_data_agent.model_catalog_entries as catalog
  where catalog.app_id = config_record.app_id
    and catalog.environment = config_record.environment
    and catalog.model_profile_id = config_record.model_profile_id
    and catalog.config_version = config_record.model_config_version
    and catalog.provider = config_record.provider
    and catalog.model_id = config_record.model_id
    and catalog.status = 'ACTIVE'
  for share;
  select revision.* into model_revision
  from app_data_agent.model_config_versions as revision
  where revision.app_id = config_record.app_id
    and revision.environment = config_record.environment
    and revision.model_profile_id = config_record.model_profile_id
    and revision.config_version = config_record.model_config_version;
  select binding.effective_hash into model_resource_hash
  from app_data_agent.effective_run_config_resource_bindings as binding
  where binding.app_id = config_record.app_id
    and binding.tenant_id = config_record.tenant_id
    and binding.environment = config_record.environment
    and binding.config_id = config_record.config_id
    and binding.config_revision = config_record.config_revision
    and binding.resource_kind = 'MODEL_PROFILE'
    and binding.availability = 'AVAILABLE';
  if model_revision.model_profile_id is null or model_resource_hash is null
    or envelope #>> '{model_profile,resource_hash}' <> model_resource_hash
    or config_record.effective_config_json #>> '{model,resource_hash}' <> model_resource_hash
  then
    raise exception using errcode = '55000', message = 'PROVIDER_PROFILE_NOT_AVAILABLE';
  end if;
  if model_record.model_profile_id is null then
    rejection_reason := coalesce(rejection_reason,'PROVIDER_PROFILE_NOT_AVAILABLE');
  end if;

  select artifact.* into task_record
  from app_data_agent.artifacts as artifact
  where artifact.app_id = config_record.app_id
    and artifact.tenant_id = config_record.tenant_id
    and artifact.environment = config_record.environment
    and artifact.run_id = config_record.run_id
    and artifact.artifact_id = (envelope #>> '{task_ref,artifact_id}')::uuid
    and artifact.artifact_type = envelope #>> '{task_ref,artifact_type}'
    and artifact.revision = (envelope #>> '{task_ref,revision}')::integer
    and artifact.content_hash = envelope #>> '{task_ref,content_hash}'
    and artifact.is_active
  for share;
  if not found then
    raise exception using errcode = '55000', message = 'PROVIDER_TASK_REFERENCE_INVALID';
  end if;
  if envelope -> 'task_ref' <> pg_catalog.jsonb_build_object(
      'artifact_id',task_record.artifact_id,'artifact_type',task_record.artifact_type,
      'app_id',task_record.app_id,'tenant_id',task_record.tenant_id,
      'environment',task_record.environment,'run_id',task_record.run_id,
      'revision',task_record.revision,'content_hash',task_record.content_hash)
  then
    raise exception using errcode = '55000', message = 'PROVIDER_TASK_REFERENCE_INVALID';
  end if;

  select artifact.* into projection_record
  from app_data_agent.artifacts as artifact
  where artifact.app_id = config_record.app_id
    and artifact.tenant_id = config_record.tenant_id
    and artifact.environment = config_record.environment
    and artifact.run_id = config_record.run_id
    and artifact.artifact_id = (envelope #>> '{projection,receipt_ref,artifact_id}')::uuid
    and artifact.artifact_type = 'AgentDataProjectionReceipt'
    and artifact.revision = (envelope #>> '{projection,receipt_ref,revision}')::integer
    and artifact.content_hash = envelope #>> '{projection,receipt_ref,content_hash}'
    and artifact.is_active
  for share;
  if not found
    or not app_data_agent.provider_json_object_has_exact_keys(projection_record.document_json,array[
      'artifact_type','protocol_version','receipt_id','scope','run_id','request_id',
      'principal_id','model_execution_profile_hash','input_refs','approved_fields','classification',
      'payload_hash','token_bound_policy_version','trusted_input_token_upper_bound',
      'redaction','dlp','taint','receipt_hash'
    ]::text[])
    or projection_record.document_json ->> 'artifact_type' <> 'AgentDataProjectionReceipt'
    or projection_record.document_json ->> 'protocol_version' <> 'agent-data-projection@2.0.0'
    or envelope #>> '{projection,projection_version}' <> 'agent-data-projection@2.0.0'
    or projection_record.revision <> 1
    or projection_record.artifact_id::text <> projection_record.document_json ->> 'receipt_id'
    or projection_record.artifact_id::text <> envelope #>> '{projection,receipt_ref,artifact_id}'
    or projection_record.content_hash <> projection_record.document_json ->> 'receipt_hash'
    or envelope #> '{projection,receipt_ref}' <> pg_catalog.jsonb_build_object(
      'artifact_id',projection_record.artifact_id,'artifact_type','AgentDataProjectionReceipt',
      'app_id',projection_record.app_id,'tenant_id',projection_record.tenant_id,
      'environment',projection_record.environment,'run_id',projection_record.run_id,
      'revision',projection_record.revision,'content_hash',projection_record.content_hash)
    or not app_data_agent.provider_json_object_has_exact_keys(
      projection_record.document_json -> 'scope',array['app_id','tenant_id','environment']::text[])
    or not app_data_agent.provider_json_object_has_exact_keys(
      projection_record.document_json -> 'redaction',array['count','policy_version']::text[])
    or not app_data_agent.provider_json_object_has_exact_keys(
      projection_record.document_json -> 'dlp',array['status','policy_version']::text[])
    or not app_data_agent.provider_json_object_has_exact_keys(
      projection_record.document_json -> 'taint',array['policy_version','taint_hash']::text[])
    or pg_catalog.jsonb_typeof(projection_record.document_json -> 'input_refs') <> 'array'
    or pg_catalog.jsonb_array_length(projection_record.document_json -> 'input_refs') not between 1 and 64
    or pg_catalog.jsonb_typeof(projection_record.document_json -> 'approved_fields') <> 'array'
    or pg_catalog.jsonb_array_length(projection_record.document_json -> 'approved_fields') not between 1 and 256
    or projection_record.document_json ->> 'classification' not in (
      'PUBLIC','INTERNAL','RESTRICTED','SECRET'
    )
    or projection_record.document_json #>> '{dlp,status}' <> 'PASS'
    or projection_record.document_json #>> '{scope,app_id}' <> config_record.app_id::text
    or projection_record.document_json #>> '{scope,tenant_id}' <> config_record.tenant_id::text
    or projection_record.document_json #>> '{scope,environment}' <> config_record.environment
    or projection_record.document_json ->> 'run_id' <> config_record.run_id::text
    or projection_record.document_json ->> 'receipt_id' <> envelope ->> 'invocation_id'
    or projection_record.document_json ->> 'request_id' <> envelope ->> 'invocation_id'
    or projection_record.document_json ->> 'principal_id' <> config_record.principal_id::text
    or projection_record.document_json ->> 'model_execution_profile_hash' <>
      envelope #>> '{certification,execution_profile_hash}'
    or projection_record.document_json ->> 'payload_hash' <> envelope #>> '{projection,payload_hash}'
    or projection_record.document_json ->> 'token_bound_policy_version' <>
      'utf8-byte-upper-bound@1.0.0'
    or envelope #>> '{projection,token_bound_policy_version}' <>
      'utf8-byte-upper-bound@1.0.0'
    or projection_record.document_json ->> 'trusted_input_token_upper_bound' <>
      envelope #>> '{projection,trusted_input_token_upper_bound}'
    or projection_record.document_json #>> '{taint,taint_hash}' <> envelope #>> '{projection,taint_hash}'
    or projection_record.document_json ->> 'receipt_hash' <>
      app_data_agent.u2_canonical_sha256(projection_record.document_json - 'receipt_hash')
    or exists (
      select 1
      from pg_catalog.jsonb_array_elements(projection_record.document_json -> 'input_refs')
        with ordinality as input_ref(reference,ordinal)
      where not app_data_agent.provider_json_object_has_exact_keys(reference,array[
          'artifact_id','artifact_type','app_id','tenant_id','environment','run_id','revision','content_hash'
        ]::text[])
        or reference ->> 'app_id' <> config_record.app_id::text
        or reference ->> 'tenant_id' <> config_record.tenant_id::text
        or reference ->> 'environment' <> config_record.environment
        or reference ->> 'run_id' <> config_record.run_id::text
        or reference ->> 'content_hash' !~ '^sha256:[0-9a-f]{64}$'
        or (reference ->> 'revision')::bigint not between 1 and 9007199254740991
    )
    or exists (
      select 1 from (
        select reference::text as identity,
          pg_catalog.lag(reference::text) over (order by ordinal) as previous_identity
        from pg_catalog.jsonb_array_elements(projection_record.document_json -> 'input_refs')
          with ordinality as input_ref(reference,ordinal)
      ) ordered_reference
      where previous_identity is not null and previous_identity >= identity
    )
    or exists (
      select 1 from (
        select value,
          pg_catalog.lag(value) over (order by ordinal) as previous_value
        from pg_catalog.jsonb_array_elements_text(projection_record.document_json -> 'approved_fields')
          with ordinality as approved_field(value,ordinal)
      ) ordered_field
      where pg_catalog.length(pg_catalog.btrim(value)) = 0
        or previous_value is not null and previous_value >= value
    )
  then
    raise exception using errcode = '55000', message = 'PROVIDER_DATA_PROJECTION_RECEIPT_INVALID';
  end if;

  select artifact.* into certification_record
  from app_data_agent.artifacts as artifact
  where artifact.app_id = config_record.app_id
    and artifact.tenant_id = config_record.tenant_id
    and artifact.environment = config_record.environment
    and artifact.run_id = (envelope #>> '{certification,receipt_ref,run_id}')::uuid
    and artifact.artifact_id = (envelope #>> '{certification,receipt_ref,artifact_id}')::uuid
    and artifact.artifact_type = 'ModelCertificationReceipt'
    and artifact.revision = (envelope #>> '{certification,receipt_ref,revision}')::integer
    and artifact.content_hash = envelope #>> '{certification,receipt_ref,content_hash}'
    and artifact.is_active
  for share;
  if found and (
      certification_record.document_json #>>
        '{execution_profile_snapshot,context_window,verification_status}' <> 'VERIFIED'
      or envelope #>> '{certification,certified_context_window,verification_status}' <> 'VERIFIED'
    )
  then
    rejection_reason := coalesce(rejection_reason,'PROVIDER_CONTEXT_WINDOW_UNVERIFIED');
  end if;
  if not found
    or not app_data_agent.provider_json_object_has_exact_keys(certification_record.document_json,array[
      'schema_version','receipt_ref','profile_id','model_config_version','provider','model_id',
      'profile_version','adapter_version','execution_profile_hash','execution_profile_snapshot',
      'recovery_capabilities','connection','certification_basis','verdict'
    ]::text[])
    or not app_data_agent.provider_json_object_has_exact_keys(
      certification_record.document_json -> 'receipt_ref',array[
        'artifact_id','artifact_type','app_id','tenant_id','environment','run_id','revision','content_hash'
      ]::text[])
    or not app_data_agent.provider_json_object_has_exact_keys(
      certification_record.document_json -> 'execution_profile_snapshot',array[
        'profile_id','scope','provider','model_id','model_config_version','profile_version',
        'adapter_version','recovery_capabilities','connection','capabilities','context_window',
        'region_privacy','fallback_compatibility'
      ]::text[])
    or not app_data_agent.provider_json_object_has_exact_keys(
      certification_record.document_json #> '{execution_profile_snapshot,scope}',
      array['app_id','tenant_id','environment']::text[])
    or certification_record.document_json #>> '{execution_profile_snapshot,scope,app_id}' <>
      certification_record.app_id::text
    or certification_record.document_json #>> '{execution_profile_snapshot,scope,tenant_id}' <>
      certification_record.tenant_id::text
    or certification_record.document_json #>> '{execution_profile_snapshot,scope,environment}' <>
      certification_record.environment
    or envelope #> '{certification,receipt_ref}' <> pg_catalog.jsonb_build_object(
      'artifact_id',certification_record.artifact_id,'artifact_type','ModelCertificationReceipt',
      'app_id',certification_record.app_id,'tenant_id',certification_record.tenant_id,
      'environment',certification_record.environment,'run_id',certification_record.run_id,
      'revision',certification_record.revision,'content_hash',certification_record.content_hash)
    or certification_record.content_hash <>
      app_data_agent.u2_canonical_sha256(
        certification_record.document_json #- '{receipt_ref,content_hash}'
      )
    or certification_record.document_json ->> 'schema_version' <>
      'model-execution-certification@1.0.0'
    or certification_record.document_json ->> 'verdict' <> 'PASS'
    or certification_record.document_json #>> '{receipt_ref,app_id}' <> certification_record.app_id::text
    or certification_record.document_json #>> '{receipt_ref,tenant_id}' <> certification_record.tenant_id::text
    or certification_record.document_json #>> '{receipt_ref,environment}' <> certification_record.environment
    or certification_record.document_json #>> '{receipt_ref,run_id}' <> certification_record.run_id::text
    or certification_record.document_json #>> '{receipt_ref,artifact_id}' <> certification_record.artifact_id::text
    or certification_record.document_json #>> '{receipt_ref,artifact_type}' <> 'ModelCertificationReceipt'
    or certification_record.document_json #>> '{receipt_ref,revision}' <> certification_record.revision::text
    or certification_record.document_json #>> '{receipt_ref,content_hash}' <> certification_record.content_hash
    or certification_record.document_json ->> 'profile_id' <> config_record.model_profile_id::text
    or certification_record.document_json ->> 'provider' <> config_record.provider
    or certification_record.document_json ->> 'model_id' <> config_record.model_id
    or certification_record.document_json ->> 'profile_version' <>
      envelope #>> '{model_profile,profile_version}'
    or certification_record.document_json ->> 'execution_profile_hash' <>
      envelope #>> '{certification,execution_profile_hash}'
    or certification_record.document_json ->> 'model_config_version' <>
      config_record.model_config_version::text
    or certification_record.document_json ->> 'adapter_version' <>
      envelope #>> '{model_profile,adapter_version}'
    or certification_record.document_json #>> '{execution_profile_snapshot,profile_id}' <>
      config_record.model_profile_id::text
    or certification_record.document_json #>> '{execution_profile_snapshot,model_config_version}' <>
      config_record.model_config_version::text
    or certification_record.document_json #>> '{execution_profile_snapshot,provider}' <>
      config_record.provider
    or certification_record.document_json #>> '{execution_profile_snapshot,model_id}' <>
      config_record.model_id
    or certification_record.document_json #>> '{execution_profile_snapshot,profile_version}' <>
      envelope #>> '{model_profile,profile_version}'
    or certification_record.document_json #>> '{execution_profile_snapshot,adapter_version}' <>
      envelope #>> '{model_profile,adapter_version}'
    or certification_record.document_json #> '{execution_profile_snapshot,recovery_capabilities}' <>
      envelope #> '{certification,recovery_capabilities}'
    or certification_record.document_json #> '{execution_profile_snapshot,connection}' <>
      envelope -> 'connection'
    or certification_record.document_json -> 'recovery_capabilities' <>
      envelope #> '{certification,recovery_capabilities}'
    or certification_record.document_json -> 'connection' <> envelope -> 'connection'
    or certification_record.document_json ->> 'execution_profile_hash' <>
      app_data_agent.u2_canonical_sha256(certification_record.document_json -> 'execution_profile_snapshot')
    or certification_record.document_json #> '{execution_profile_snapshot,capabilities}' <>
      model_record.capabilities
    or certification_record.document_json #> '{execution_profile_snapshot,context_window}' <>
      envelope #> '{certification,certified_context_window}'
    or (certification_record.document_json #>> '{certification_basis,kind}' = 'GOAL_PREFLIGHT_ATTESTATION'
      and (certification_record.document_json #>> '{certification_basis,observed_provider}' <>
          config_record.provider
        or certification_record.document_json #>> '{certification_basis,observed_model_id}' <>
          config_record.model_id))
  then
    rejection_reason := coalesce(rejection_reason,'PROVIDER_PROFILE_NOT_AVAILABLE');
  end if;
  select pg_catalog.array_agg(value order by ordinal) into recovery_capabilities
  from pg_catalog.jsonb_array_elements_text(envelope #> '{certification,recovery_capabilities}')
    with ordinality as capability(value,ordinal);
  if recovery_capabilities is null
    or not (
      recovery_capabilities = array['IDEMPOTENT_REQUEST']::text[]
      or recovery_capabilities = array['INVOCATION_STATUS_QUERY']::text[]
      or recovery_capabilities = array['INVOCATION_RECONCILIATION']::text[]
      or recovery_capabilities = array['AT_LEAST_ONCE_ONLY']::text[]
      or recovery_capabilities = array['IDEMPOTENT_REQUEST','INVOCATION_STATUS_QUERY']::text[]
      or recovery_capabilities = array['IDEMPOTENT_REQUEST','INVOCATION_RECONCILIATION']::text[]
      or recovery_capabilities = array['INVOCATION_STATUS_QUERY','INVOCATION_RECONCILIATION']::text[]
      or recovery_capabilities = array[
        'IDEMPOTENT_REQUEST','INVOCATION_STATUS_QUERY','INVOCATION_RECONCILIATION'
      ]::text[]
    )
  then
    raise exception using errcode = '22023', message = 'PROVIDER_RECOVERY_CAPABILITIES_INVALID';
  end if;
  if config_record.provider <> 'deepseek'
    or recovery_capabilities <> array['AT_LEAST_ONCE_ONLY']::text[]
    or envelope #>> '{connection,kind}' <> 'SYSTEM_DEPLOYMENT'
    or envelope #>> '{connection,deployment_id}' <> lease_authority ->> 'deployment_id'
  then
    -- Certification describes protocol capability; it does not prove that this
    -- deployment has the matching recovery driver. The installed U3 driver is
    -- intentionally limited to the exact DeepSeek ALO profile.
    rejection_reason := coalesce(
      rejection_reason,'PROVIDER_PROFILE_NOT_AVAILABLE'
    );
  end if;

  if envelope #>> '{connection,kind}' = 'MANAGED_CONNECTION' then
    select connection.* into connection_record
    from app_data_agent.model_provider_connections as connection
    where connection.app_id = config_record.app_id
      and connection.environment = config_record.environment
      and connection.provider_connection_id = model_record.provider_connection_id
      and connection.provider_connection_id = (envelope #>> '{connection,provider_connection_id}')::uuid
      and connection.config_version = (envelope #>> '{connection,config_version}')::bigint
      and connection.runtime_provider = config_record.provider
      and connection.status = 'ACTIVE'
      and connection.credential_ref ->> 'rotation_state' = 'ACTIVE'
    for share;
    select revision.* into connection_revision
    from app_data_agent.model_provider_connection_versions as revision
    where revision.app_id = config_record.app_id
      and revision.environment = config_record.environment
      and revision.provider_connection_id = connection_record.provider_connection_id
      and revision.config_version = connection_record.config_version;
    connection_hash := app_data_agent.u2_canonical_sha256(connection_revision.snapshot);
    if connection_record.provider_connection_id is null
      or connection_revision.provider_connection_id is null
      or envelope #>> '{connection,connection_hash}' <> connection_hash
    then
      rejection_reason := coalesce(rejection_reason,'PROVIDER_PROFILE_NOT_AVAILABLE');
    end if;
  elsif envelope #>> '{connection,kind}' = 'SYSTEM_DEPLOYMENT' then
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
      'provider-system-deployment:' || config_record.app_id::text || ':' ||
      config_record.environment || ':' || (envelope #>> '{connection,deployment_id}'),0));
    select deployment.* into deployment_record
    from platform.deployment_mappings as deployment
    where deployment.app_id = config_record.app_id
      and deployment.environment = config_record.environment
      and deployment.deployment_id = (envelope #>> '{connection,deployment_id}')::uuid
      and deployment.deployment_id = (lease_authority ->> 'deployment_id')::uuid
      and deployment.is_active
    ;
    expected_deployment_hash := app_data_agent.u2_canonical_sha256(pg_catalog.jsonb_build_object(
      'deployment_id',deployment_record.deployment_id,
      'app_id',deployment_record.app_id,
      'environment',deployment_record.environment,
      'deployment_key_hash',deployment_record.deployment_key_hash));
    if deployment_record.deployment_id is null
      or (envelope #>> '{connection,deployment_revision}')::bigint <> 1
      or envelope #>> '{connection,deployment_hash}' <> expected_deployment_hash
    then
      rejection_reason := coalesce(rejection_reason,'PROVIDER_PROFILE_NOT_AVAILABLE');
    end if;
  else
    raise exception using errcode = '22023', message = 'PROVIDER_CONNECTION_PROOF_INVALID';
  end if;

  if (envelope #>> '{request_policy,budget,provider_call_limit}')::integer <> 1 then
    rejection_reason := coalesce(rejection_reason,'PROVIDER_CALL_LIMIT_EXCEEDED');
  elsif (envelope #>> '{projection,reserved_output_tokens}')::bigint >
      (envelope #>> '{request_policy,budget,max_output_tokens}')::bigint
    or (envelope #>> '{projection,reserved_output_tokens}')::bigint >
      (envelope #>> '{projection,effective_output_ceiling_tokens}')::bigint
  then
    rejection_reason := coalesce(rejection_reason,'PROVIDER_OUTPUT_LIMIT_EXCEEDED');
  elsif envelope #>> '{projection,capacity_status}' <> 'WITHIN_LIMIT'
    or (envelope #>> '{projection,trusted_input_token_upper_bound}')::bigint >
      (envelope #>> '{request_policy,budget,max_input_tokens}')::bigint
    or (envelope #>> '{projection,trusted_input_token_upper_bound}')::bigint +
      (envelope #>> '{projection,reserved_output_tokens}')::bigint >
      (envelope #>> '{projection,effective_context_ceiling_tokens}')::bigint
  then
    rejection_reason := coalesce(rejection_reason,'PROVIDER_CONTEXT_LIMIT_EXCEEDED');
  end if;
  if not (config_record.effective_config_json #> '{effective_egress,allowed_providers}') ?
      config_record.provider then
    raise exception using errcode = '55000', message = 'PROVIDER_EGRESS_DENIED';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'provider-invocation:' || config_record.app_id::text || ':' || config_record.tenant_id::text || ':' ||
    config_record.environment || ':' || config_record.principal_id::text || ':' ||
    (envelope ->> 'idempotency_key'),0));
  select intent.* into existing_intent
  from app_data_agent.provider_invocation_intents as intent
  where intent.app_id = config_record.app_id
    and intent.tenant_id = config_record.tenant_id
    and intent.environment = config_record.environment
    and intent.principal_id = config_record.principal_id
    and intent.idempotency_key = envelope ->> 'idempotency_key';
  if found then
    if existing_intent.invocation_id <> (envelope ->> 'invocation_id')::uuid
      or existing_intent.invocation_key_hash <> invocation_key_hash
    then
      raise exception using errcode = '23505', message = 'PROVIDER_INVOCATION_IDEMPOTENCY_CONFLICT';
    end if;
    if existing_intent.admission = 'REJECTED' then
      select outcome.* into strict existing_outcome
      from app_data_agent.provider_invocation_outcomes as outcome
      where outcome.app_id = existing_intent.app_id
        and outcome.tenant_id = existing_intent.tenant_id
        and outcome.environment = existing_intent.environment
        and outcome.intent_id = existing_intent.intent_id
        and outcome.state = 'FAILED'
        and outcome.transition_from = 'INTENT_COMMITTED';
      select usage.* into strict existing_usage
      from app_data_agent.provider_invocation_usage_receipts as usage
      where usage.app_id = existing_outcome.app_id
        and usage.tenant_id = existing_outcome.tenant_id
        and usage.environment = existing_outcome.environment
        and usage.outcome_id = existing_outcome.outcome_id;
      rejection_projection_document := pg_catalog.jsonb_build_object(
        'schema_version','provider-invocation-public@1.0.0',
        'invocation_id',existing_intent.invocation_id,'run_id',existing_intent.run_id,
        'provider',existing_intent.provider,'model_profile_id',existing_intent.model_profile_id,
        'model_config_version',existing_intent.model_config_version,
        'profile_version',existing_intent.profile_version,'model_id',existing_intent.model_id,
        'certification_receipt_ref',existing_intent.intent_json #>
          '{invocation_spec,certification,receipt_ref}',
        'attempt_id',existing_outcome.attempt_id,
        'attempt_no',existing_outcome.dispatch_attempt_no,
        'recovery_action',existing_outcome.outcome_json #> '{candidate,recovery_action}',
        'status','FAILED','reason_code',existing_outcome.outcome_json #> '{candidate,reason_code}',
        'dispatch_hash',existing_outcome.dispatch_hash,'response_hash',null,
        'usage_availability',existing_usage.usage_json -> 'availability',
        'usage_source',existing_usage.usage_json -> 'source',
        'input_tokens',null,'output_tokens',null,'total_tokens',null,'tool_calls',null,
        'provider_call_count',0,'retry_after_ms',null,'latency_ms',null,
        'receipt_deep_link','/w/' || existing_intent.workspace_id::text || '/runs/' ||
          existing_intent.run_id::text || '/provider-invocations/' ||
          existing_intent.invocation_id::text,
        'terminal_at',existing_outcome.outcome_json -> 'terminal_at');
      return pg_catalog.jsonb_build_object(
        'schema_version','provider-invocation-begin-result@1.0.0',
        'admission','REJECTED','disposition','REPLAYED',
        'rejection_reason',existing_intent.rejection_reason,
        'intent',existing_intent.intent_json,'permit',null,
        'outcome',existing_outcome.outcome_json,'usage',existing_usage.usage_json,
        'projection',rejection_projection_document);
    end if;
    if rejection_reason is not null then
      raise exception using errcode = '55000', message = rejection_reason;
    end if;
    select permit.* into existing_permit
    from app_data_agent.provider_invocation_dispatch_permits as permit
    where permit.app_id = existing_intent.app_id
      and permit.tenant_id = existing_intent.tenant_id
      and permit.environment = existing_intent.environment
      and permit.intent_id = existing_intent.intent_id
      and permit.dispatch_hash = dispatch_hash
      and permit.attempt_id = (lease_authority ->> 'attempt_id')::uuid
      and permit.worker_fence = (lease_authority ->> 'worker_fence')::bigint;
    if found then
      return pg_catalog.jsonb_build_object(
        'schema_version','provider-invocation-begin-result@1.0.0',
        'admission','READY','disposition','REPLAYED','intent',existing_intent.intent_json,
        'permit',existing_permit.permit_json);
    end if;
    select outcome.* into existing_outcome
    from app_data_agent.provider_invocation_outcomes as outcome
      where outcome.app_id = existing_intent.app_id
        and outcome.tenant_id = existing_intent.tenant_id
        and outcome.environment = existing_intent.environment
        and outcome.intent_id = existing_intent.intent_id
        and outcome.state in ('COMPLETED','FAILED','THROTTLED','OUTCOME_UNKNOWN')
      order by outcome.transition_revision desc
      limit 1;
    if found then
      select permit.* into strict existing_permit
      from app_data_agent.provider_invocation_dispatch_permits permit
      where permit.app_id = existing_outcome.app_id
        and permit.tenant_id = existing_outcome.tenant_id
        and permit.environment = existing_outcome.environment
        and permit.intent_id = existing_outcome.intent_id
        and permit.dispatch_hash = existing_outcome.dispatch_hash
        and permit.attempt_id = existing_outcome.attempt_id
        and permit.worker_fence = existing_outcome.worker_fence;
      select usage.* into strict existing_usage
      from app_data_agent.provider_invocation_usage_receipts usage
      where usage.app_id = existing_outcome.app_id
        and usage.tenant_id = existing_outcome.tenant_id
        and usage.environment = existing_outcome.environment
        and usage.outcome_id = existing_outcome.outcome_id;
      terminal_response_ref := existing_outcome.outcome_json #>
        '{candidate,response_artifact_ref}';
      terminal_replay_action := case existing_outcome.state
        when 'COMPLETED' then 'RETURN_RECORDED'
        when 'FAILED' then 'NEW_LOGICAL_INVOCATION_REQUIRED'
        when 'THROTTLED' then 'NEW_LOGICAL_INVOCATION_AFTER_RETRY_DELAY'
        when 'OUTCOME_UNKNOWN' then 'RECONCILIATION_REQUIRED'
      end;
      if existing_outcome.state = 'COMPLETED' then
        select artifact.* into strict response_record
        from app_data_agent.artifacts artifact
        where artifact.app_id = existing_outcome.app_id
          and artifact.tenant_id = existing_outcome.tenant_id
          and artifact.environment = existing_outcome.environment
          and artifact.run_id = existing_outcome.run_id
          and artifact.artifact_id = existing_outcome.response_artifact_id
          and artifact.artifact_type = 'ProviderResponseArtifact'
          and artifact.revision = existing_outcome.response_artifact_revision
          and artifact.content_hash = existing_outcome.response_artifact_content_hash
          and artifact.is_active;
        if terminal_response_ref <> pg_catalog.jsonb_build_object(
            'artifact_id',response_record.artifact_id,
            'artifact_type','ProviderResponseArtifact',
            'app_id',response_record.app_id,'tenant_id',response_record.tenant_id,
            'environment',response_record.environment,'run_id',response_record.run_id,
            'revision',response_record.revision,'content_hash',response_record.content_hash)
          or response_record.document_json ->> 'response_hash' <>
            existing_outcome.response_hash
          or response_record.content_hash <>
            app_data_agent.u2_canonical_sha256(response_record.document_json - 'content_hash')
        then
          raise exception using errcode = 'P0001',
            message = 'PROVIDER_TERMINAL_REPLAY_CLOSURE_INVALID';
        end if;
      elsif terminal_response_ref <> 'null'::jsonb then
        raise exception using errcode = 'P0001',
          message = 'PROVIDER_TERMINAL_REPLAY_CLOSURE_INVALID';
      end if;
      terminal_projection_document := pg_catalog.jsonb_build_object(
        'schema_version','provider-invocation-public@1.0.0',
        'invocation_id',existing_intent.invocation_id,'run_id',existing_intent.run_id,
        'provider',existing_intent.provider,
        'model_profile_id',existing_intent.model_profile_id,
        'model_config_version',existing_intent.model_config_version,
        'profile_version',existing_intent.profile_version,'model_id',existing_intent.model_id,
        'certification_receipt_ref',pg_catalog.jsonb_build_object(
          'artifact_id',existing_intent.certification_artifact_id,
          'artifact_type','ModelCertificationReceipt','app_id',existing_intent.app_id,
          'tenant_id',existing_intent.tenant_id,'environment',existing_intent.environment,
          'run_id',existing_intent.certification_run_id,
          'revision',existing_intent.certification_revision,
          'content_hash',existing_intent.certification_hash),
        'attempt_id',existing_permit.attempt_id,'attempt_no',existing_permit.attempt_no,
        'recovery_action',existing_outcome.outcome_json #> '{candidate,recovery_action}',
        'status',existing_outcome.state,
        'reason_code',existing_outcome.outcome_json #> '{candidate,reason_code}',
        'dispatch_hash',existing_outcome.dispatch_hash,
        'response_hash',existing_outcome.outcome_json #> '{candidate,response_hash}',
        'usage_availability',existing_usage.usage_json -> 'availability',
        'usage_source',existing_usage.usage_json -> 'source',
        'input_tokens',existing_usage.usage_json -> 'input_tokens',
        'output_tokens',existing_usage.usage_json -> 'output_tokens',
        'total_tokens',existing_usage.usage_json -> 'total_tokens',
        'tool_calls',existing_usage.usage_json -> 'tool_calls',
        'provider_call_count',existing_usage.usage_json -> 'provider_call_count',
        'retry_after_ms',existing_outcome.outcome_json #> '{candidate,retry_after_ms}',
        'latency_ms',existing_outcome.outcome_json -> 'latency_ms',
        'receipt_deep_link','/w/' || existing_intent.workspace_id::text || '/runs/' ||
          existing_intent.run_id::text || '/provider-invocations/' ||
          existing_intent.invocation_id::text,
        'terminal_at',existing_outcome.outcome_json -> 'terminal_at');
      if existing_outcome.outcome_json #>> '{candidate,intent_id}' <>
          existing_intent.intent_id::text
        or existing_outcome.outcome_json #>> '{candidate,invocation_id}' <>
          existing_intent.invocation_id::text
        or existing_outcome.outcome_json #>> '{candidate,run_id}' <> existing_intent.run_id::text
        or existing_outcome.outcome_json #> '{candidate,scope}' <>
          existing_intent.intent_json #> '{invocation_spec,scope}'
        or existing_outcome.outcome_json #>> '{candidate,dispatch_hash}' <>
          existing_permit.dispatch_hash
        or existing_usage.usage_json ->> 'intent_id' <> existing_intent.intent_id::text
        or existing_usage.usage_json ->> 'invocation_id' <> existing_intent.invocation_id::text
        or existing_usage.usage_json ->> 'run_id' <> existing_intent.run_id::text
        or existing_usage.usage_json -> 'scope' <>
          existing_intent.intent_json #> '{invocation_spec,scope}'
        or (existing_outcome.state = 'THROTTLED' and
          (existing_outcome.outcome_json #>> '{candidate,retry_after_ms}')::bigint not between 1 and 86400000)
      then
        raise exception using errcode = 'P0001',
          message = 'PROVIDER_TERMINAL_REPLAY_CLOSURE_INVALID';
      end if;
      return pg_catalog.jsonb_build_object(
        'schema_version','provider-invocation-begin-result@1.0.0',
        'admission','TERMINAL_REPLAY','disposition','REPLAYED',
        'replay_action',terminal_replay_action,'intent',existing_intent.intent_json,
        'original_permit',existing_permit.permit_json,
        'response_artifact_ref',terminal_response_ref,
        'outcome',existing_outcome.outcome_json,'usage',existing_usage.usage_json,
        'projection',terminal_projection_document);
    end if;
    if exists (
      select 1 from app_data_agent.provider_invocation_outcomes as outcome
      where outcome.app_id = existing_intent.app_id
        and outcome.tenant_id = existing_intent.tenant_id
        and outcome.environment = existing_intent.environment
        and outcome.intent_id = existing_intent.intent_id
        and outcome.state = 'DISPATCH_MARKED'
    ) and not ('IDEMPOTENT_REQUEST' = any(existing_intent.recovery_capabilities)) then
      raise exception using errcode = '55000',
        message = 'PROVIDER_REDISPATCH_REQUIRES_RECONCILIATION';
    end if;
    intent_id := existing_intent.intent_id;
    intent_document := existing_intent.intent_json;
    result_disposition := 'REPLAYED';
  else
    intent_id := pg_catalog.gen_random_uuid();
    intent_committed_at := pg_catalog.clock_timestamp();
    intent_document := pg_catalog.jsonb_build_object(
      'schema_version','provider-invocation-intent@1.0.0',
      'intent_id',intent_id,
      'invocation_spec',invocation_key_draft,
      'invocation_key_hash',invocation_key_hash,
      'state','INTENT_COMMITTED',
      'committed_at',app_data_agent.runtime_iso_timestamp(intent_committed_at));
    intent_document := intent_document || pg_catalog.jsonb_build_object(
      'intent_hash',app_data_agent.u2_canonical_sha256(intent_document));
    result_disposition := 'CREATED';
  end if;
  committed_at := pg_catalog.clock_timestamp();
  permit_id := pg_catalog.gen_random_uuid();
  permit_document := pg_catalog.jsonb_build_object(
    'schema_version','provider-dispatch-permit@1.0.0',
    'permit_id',permit_id,
    'intent_id',intent_id,
    'invocation_id',(envelope ->> 'invocation_id')::uuid,
    'scope',scope_document,
    'run_id',config_record.run_id,
    'dispatch_hash',dispatch_hash,
    'context_receipt_ref',envelope -> 'context_receipt_ref',
    'lease',envelope -> 'lease',
    'attempt_id',(lease_authority ->> 'attempt_id')::uuid,
    'worker_fence',(lease_authority ->> 'worker_fence')::bigint,
    'committed_at',app_data_agent.runtime_iso_timestamp(committed_at));
  permit_document := permit_document || pg_catalog.jsonb_build_object(
    'permit_hash',app_data_agent.u2_canonical_sha256(permit_document));
  if permit_document ->> 'intent_id' <> intent_document ->> 'intent_id'
    or permit_document ->> 'invocation_id' <>
      intent_document #>> '{invocation_spec,invocation_id}'
    or permit_document -> 'scope' <> intent_document #> '{invocation_spec,scope}'
    or permit_document ->> 'run_id' <> intent_document #>> '{invocation_spec,run_id}'
  then
    raise exception using errcode = 'P0001',
      message = 'PROVIDER_BEGIN_RESULT_CLOSURE_INVALID';
  end if;
  if result_disposition = 'CREATED' then
    insert into app_data_agent.provider_invocation_intents (
    app_id,tenant_id,environment,intent_id,invocation_id,logical_call_id,run_id,
    workspace_id,principal_id,idempotency_key,invocation_key_hash,
    config_id,config_revision,config_hash,
    model_profile_id,model_config_version,model_config_hash,profile_version,provider,model_id,
    adapter_version,binding_kind,provider_connection_id,provider_connection_version,
    provider_connection_hash,system_binding_hash,system_deployment_id,system_deployment_revision,
    certification_run_id,certification_artifact_id,certification_artifact_type,
    certification_revision,certification_hash,certification_execution_profile_hash,
    task_artifact_id,task_artifact_type,task_artifact_revision,task_artifact_hash,
    projection_artifact_id,projection_artifact_type,projection_artifact_revision,
    projection_artifact_hash,projection_receipt_hash,
    recovery_capabilities,token_bound_policy_version,trusted_input_token_upper_bound,
    reserved_output_tokens,
    effective_max_context_tokens,effective_max_output_tokens,provider_call_limit,
    admission,rejection_reason,intent_json,intent_hash,committed_at
  ) values (
    config_record.app_id,config_record.tenant_id,config_record.environment,intent_id,
    (envelope ->> 'invocation_id')::uuid,(envelope ->> 'logical_call_id')::uuid,config_record.run_id,
    config_record.tenant_id,config_record.principal_id,envelope ->> 'idempotency_key',invocation_key_hash,
    config_record.config_id,config_record.config_revision,config_record.config_hash,
    config_record.model_profile_id,config_record.model_config_version,model_resource_hash,
    envelope #>> '{model_profile,profile_version}',config_record.provider,config_record.model_id,
    envelope #>> '{model_profile,adapter_version}',envelope #>> '{connection,kind}',
    connection_record.provider_connection_id,connection_record.config_version,connection_hash,
    case when envelope #>> '{connection,kind}' = 'SYSTEM_DEPLOYMENT'
      then expected_deployment_hash else null end,
    deployment_record.deployment_id,
    case when deployment_record.deployment_id is not null then 1 else null end,
    certification_record.run_id,certification_record.artifact_id,'ModelCertificationReceipt',
    certification_record.revision,certification_record.content_hash,
    envelope #>> '{certification,execution_profile_hash}',task_record.artifact_id,task_record.artifact_type,
    task_record.revision,task_record.content_hash,projection_record.artifact_id,
    'AgentDataProjectionReceipt',projection_record.revision,projection_record.content_hash,
    projection_record.document_json ->> 'receipt_hash',recovery_capabilities,
    envelope #>> '{projection,token_bound_policy_version}',
    (envelope #>> '{projection,trusted_input_token_upper_bound}')::bigint,
    (envelope #>> '{projection,reserved_output_tokens}')::bigint,
    (envelope #>> '{projection,effective_context_ceiling_tokens}')::bigint,
    (envelope #>> '{projection,effective_output_ceiling_tokens}')::bigint,1,
    case when rejection_reason is null then 'READY' else 'REJECTED' end,
    rejection_reason,intent_document,intent_document ->> 'intent_hash',intent_committed_at
    );
  end if;
  if rejection_reason is not null then
    rejection_outcome_id := pg_catalog.gen_random_uuid();
    rejection_usage_id := pg_catalog.gen_random_uuid();
    committed_at := pg_catalog.clock_timestamp();
    rejection_outcome_document := pg_catalog.jsonb_build_object(
      'schema_version','provider-invocation-outcome@1.0.0',
      'outcome_id',rejection_outcome_id,
      'candidate',pg_catalog.jsonb_build_object(
        'schema_version','provider-invocation-outcome-candidate@1.0.0',
        'intent_id',intent_id,'invocation_id',(envelope ->> 'invocation_id')::uuid,
        'scope',scope_document,'run_id',config_record.run_id,'dispatch_hash',dispatch_hash,
        'status','FAILED','reason_code','PROVIDER_INVOCATION_FAILED',
        'response_artifact_ref',null,'response_hash',null,
        'delivery_certainty','NOT_DISPATCHED','transition_from','INTENT_COMMITTED',
        'recovery_action','NONE','provider_call_count',0,'retry_after_ms',null,
        'reconciliation_of',null),
      'dispatch_marked_at',null,
      'terminal_at',app_data_agent.runtime_iso_timestamp(committed_at),
      'latency_ms',null);
    rejection_outcome_document := rejection_outcome_document || pg_catalog.jsonb_build_object(
      'outcome_hash',app_data_agent.u2_canonical_sha256(rejection_outcome_document));
    rejection_usage_document := pg_catalog.jsonb_build_object(
      'schema_version','provider-invocation-usage@1.0.0',
      'usage_receipt_id',rejection_usage_id,'outcome_id',rejection_outcome_id,
      'intent_id',intent_id,'invocation_id',(envelope ->> 'invocation_id')::uuid,
      'scope',scope_document,'run_id',config_record.run_id,
      'availability','NOT_APPLICABLE','source','UNAVAILABLE',
      'input_tokens',null,'output_tokens',null,'total_tokens',null,'tool_calls',null,
      'provider_call_count',0,'capacity_status','NOT_APPLICABLE',
      'unavailable_reason','PROVIDER_NOT_DISPATCHED',
      'observed_at',app_data_agent.runtime_iso_timestamp(committed_at));
    rejection_usage_document := rejection_usage_document || pg_catalog.jsonb_build_object(
      'usage_hash',app_data_agent.u2_canonical_sha256(rejection_usage_document));
    insert into app_data_agent.provider_invocation_outcomes (
      app_id,tenant_id,environment,outcome_id,intent_id,invocation_id,run_id,dispatch_hash,
      transition_revision,parent_transition_revision,parent_outcome_hash,state,actor_kind,
      transition_from,recovery_action,dispatch_attempt_no,attempt_id,outbox_id,command_id,
      worker_id,lease_token,worker_fence,dispatch_marked,provider_call_may_have_started,
      reason_code,provider_call_count,retry_after_ms,delivery_certainty,started_at,terminal_at,
      latency_ms,reconciliation_of,outcome_json,outcome_hash,committed_at
    ) values (
      config_record.app_id,config_record.tenant_id,config_record.environment,
      rejection_outcome_id,intent_id,(envelope ->> 'invocation_id')::uuid,config_record.run_id,
      dispatch_hash,1,null,null,'FAILED','WORKER','INTENT_COMMITTED','NONE',
      (lease_authority ->> 'attempt_no')::bigint,(lease_authority ->> 'attempt_id')::uuid,
      (lease_authority ->> 'outbox_id')::uuid,(lease_authority ->> 'command_id')::uuid,
      lease_authority ->> 'worker_id',(lease_authority ->> 'lease_token')::bigint,
      (lease_authority ->> 'worker_fence')::bigint,false,false,
      'PROVIDER_INVOCATION_FAILED',0,null,'NOT_DISPATCHED',null,committed_at,null,null,
      rejection_outcome_document,rejection_outcome_document ->> 'outcome_hash',committed_at
    );
    insert into app_data_agent.provider_invocation_usage_receipts (
      app_id,tenant_id,environment,usage_receipt_id,intent_id,invocation_id,outcome_id,
      outcome_transition_revision,outcome_hash,availability,token_source,input_tokens,output_tokens,
      total_tokens,tool_calls,provider_call_count,capacity_status,unavailable_reason,
      usage_json,usage_hash,observed_at,committed_at
    ) values (
      config_record.app_id,config_record.tenant_id,config_record.environment,rejection_usage_id,
      intent_id,(envelope ->> 'invocation_id')::uuid,rejection_outcome_id,1,
      rejection_outcome_document ->> 'outcome_hash','NOT_APPLICABLE','UNAVAILABLE',
      null,null,null,null,0,'NOT_APPLICABLE','PROVIDER_NOT_DISPATCHED',
      rejection_usage_document,rejection_usage_document ->> 'usage_hash',committed_at,committed_at
    );
    rejection_projection_document := pg_catalog.jsonb_build_object(
      'schema_version','provider-invocation-public@1.0.0',
      'invocation_id',(envelope ->> 'invocation_id')::uuid,'run_id',config_record.run_id,
      'provider',config_record.provider,'model_profile_id',config_record.model_profile_id,
      'model_config_version',config_record.model_config_version,
      'profile_version',envelope #>> '{model_profile,profile_version}',
      'model_id',config_record.model_id,
      'certification_receipt_ref',envelope #> '{certification,receipt_ref}',
      'attempt_id',(lease_authority ->> 'attempt_id')::uuid,
      'attempt_no',(lease_authority ->> 'attempt_no')::bigint,
      'recovery_action','NONE','status','FAILED','reason_code','PROVIDER_INVOCATION_FAILED',
      'dispatch_hash',dispatch_hash,'response_hash',null,
      'usage_availability','NOT_APPLICABLE','usage_source','UNAVAILABLE',
      'input_tokens',null,'output_tokens',null,'total_tokens',null,'tool_calls',null,
      'provider_call_count',0,'retry_after_ms',null,'latency_ms',null,
      'receipt_deep_link','/w/' || config_record.tenant_id::text || '/runs/' ||
        config_record.run_id::text || '/provider-invocations/' ||
        (envelope ->> 'invocation_id'),
      'terminal_at',rejection_outcome_document -> 'terminal_at');
    return pg_catalog.jsonb_build_object(
      'schema_version','provider-invocation-begin-result@1.0.0',
      'admission','REJECTED','disposition','CREATED','rejection_reason',rejection_reason,
      'intent',intent_document,'permit',null,'outcome',rejection_outcome_document,
      'usage',rejection_usage_document,'projection',rejection_projection_document);
  end if;
  insert into app_data_agent.provider_invocation_dispatch_permits (
    app_id,tenant_id,environment,permit_id,intent_id,invocation_id,run_id,dispatch_hash,
    context_receipt_id,context_receipt_hash,attempt_id,outbox_id,command_id,attempt_no,
    worker_id,lease_token,worker_fence,envelope_json,permit_json,permit_hash,committed_at
  ) values (
    config_record.app_id,config_record.tenant_id,config_record.environment,permit_id,intent_id,
    (envelope ->> 'invocation_id')::uuid,config_record.run_id,dispatch_hash,
    context_record.context_receipt_id,context_record.receipt_hash,
    (lease_authority ->> 'attempt_id')::uuid,(lease_authority ->> 'outbox_id')::uuid,
    (lease_authority ->> 'command_id')::uuid,(lease_authority ->> 'attempt_no')::bigint,
    lease_authority ->> 'worker_id',(lease_authority ->> 'lease_token')::bigint,
    (lease_authority ->> 'worker_fence')::bigint,envelope,permit_document,
    permit_document ->> 'permit_hash',committed_at
  );
  return pg_catalog.jsonb_build_object(
    'schema_version','provider-invocation-begin-result@1.0.0',
    'admission','READY','disposition',result_disposition,
    'intent',intent_document,'permit',permit_document);
exception
  when invalid_text_representation or numeric_value_out_of_range then
    raise exception using errcode = '22023', message = 'PROVIDER_DISPATCH_ENVELOPE_INVALID';
end
$function$;
