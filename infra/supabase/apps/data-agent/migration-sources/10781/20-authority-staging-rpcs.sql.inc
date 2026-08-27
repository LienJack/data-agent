create function app_data_agent.falcon24_authority_epoch_is_canonical(authority_epoch text)
returns boolean language sql immutable strict security definer set search_path='' as $function$
  select authority_epoch~'^E[1-9][0-9]*$'
$function$;

create function app_data_agent.falcon24_authority_binding_document(
  current_epoch app_data_agent.falcon24_current_authority_epoch)
returns jsonb language sql immutable strict security definer set search_path='' as $function$
  select pg_catalog.jsonb_build_object(
    'schema_version',case when current_epoch.authority_epoch='E1'
      then 'falcon24-authority-binding@1.0.0'
      else 'falcon24-authority-binding@2.0.0' end,
    'authority_epoch',current_epoch.authority_epoch,
    'baseline_id',current_epoch.baseline_id,
    'baseline_hash',current_epoch.baseline_hash,
    'activation_attempt_id',current_epoch.activation_attempt_id)
$function$;

create function app_data_agent.falcon24_activation_attempt_document(
  attempt app_data_agent.falcon24_authority_activation_attempts)
returns jsonb language sql immutable strict security definer set search_path='' as $function$
  select pg_catalog.jsonb_build_object(
    'schema_version',case when attempt.authority_epoch='E1'
      then 'falcon24-e1-activation-attempt@1.0.0'
      else 'falcon24-activation-attempt@2.0.0' end,
    'authority_epoch',case when attempt.authority_epoch='E1' then null
      else attempt.authority_epoch end,
    'attempt_id',attempt.attempt_id,'baseline_id',attempt.baseline_id,
    'expected_baseline_hash',attempt.expected_baseline_hash,
    'status',attempt.status,'failure_code',attempt.failure_code)
    - case when attempt.authority_epoch='E1' then 'authority_epoch' else '' end
$function$;

create function app_data_agent.begin_falcon24_authority_staging_session(command jsonb)
returns jsonb language plpgsql volatile security definer set search_path='' as $function$
#variable_conflict use_variable
declare authority record; current_epoch app_data_agent.falcon24_current_authority_epoch%rowtype;
  existing app_data_agent.falcon24_authority_staging_sessions%rowtype;
  requested_staging_id uuid; requested_epoch text; now_at timestamptz;
begin
  if command is null or pg_catalog.jsonb_typeof(command) is distinct from 'object'
    or app_data_agent.provider_json_object_has_exact_keys(command,array[
      'schema_version','authority_epoch','staging_id','retained_assets_hash','command_hash']::text[])
      is distinct from true
    or command->>'schema_version' is distinct from 'falcon24-staging-session@2.0.0'
    or app_data_agent.falcon24_authority_epoch_is_canonical(command->>'authority_epoch')
      is distinct from true
    or command->>'authority_epoch'='E1'
    or app_data_agent.canonical_uuid_json_string_is_valid(command->'staging_id') is distinct from true
    or command->>'retained_assets_hash'!~'^sha256:[0-9a-f]{64}$'
    or command->>'command_hash' is distinct from
      app_data_agent.u2_canonical_sha256(command-'command_hash')
    or app_data_agent.contains_potential_plaintext_secret(command)
  then raise exception using errcode='22023',message='FALCON24_AUTHORITY_STAGING_SESSION_INVALID'; end if;
  requested_epoch:=command->>'authority_epoch';
  requested_staging_id:=(command->>'staging_id')::uuid;
  select * into strict authority from platform.current_backend_authority(true);
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'falcon24-authority-staging:'||authority.app_id::text||':'||authority.tenant_id::text||':'||
      authority.environment,0));
  select * into current_epoch from app_data_agent.falcon24_current_authority_epoch row
    where row.app_id=authority.app_id and row.tenant_id=authority.tenant_id
      and row.environment=authority.environment for share;
  if not found then raise exception using errcode='55000',
    message='FALCON24_CURRENT_AUTHORITY_NOT_FOUND'; end if;
  if pg_catalog.substr(requested_epoch,2)::numeric
      <>pg_catalog.substr(current_epoch.authority_epoch,2)::numeric+1
  then raise exception using errcode='55000',message='FALCON24_AUTHORITY_EPOCH_NOT_SUCCESSOR'; end if;
  select * into existing from app_data_agent.falcon24_authority_staging_sessions session
    where session.app_id=authority.app_id and session.tenant_id=authority.tenant_id
      and session.environment=authority.environment and session.staging_id=requested_staging_id
    for update;
  if found then
    if existing.authority_epoch is distinct from requested_epoch
      or existing.retained_assets_hash is distinct from command->>'retained_assets_hash'
    then raise exception using errcode='23505',
      message='FALCON24_AUTHORITY_STAGING_IDENTITY_CONFLICT'; end if;
  else
    now_at:=pg_catalog.clock_timestamp();
    insert into app_data_agent.falcon24_authority_staging_sessions(
      app_id,tenant_id,environment,staging_id,authority_epoch,retained_assets_hash,status,
      created_by,created_at,updated_at)
    values(authority.app_id,authority.tenant_id,authority.environment,requested_staging_id,
      requested_epoch,command->>'retained_assets_hash','STAGED',authority.principal_id,now_at,now_at)
    returning * into strict existing;
  end if;
  return pg_catalog.jsonb_build_object(
    'schema_version','falcon24-staging-session@2.0.0',
    'authority_epoch',existing.authority_epoch,'staging_id',existing.staging_id,
    'retained_assets_hash',existing.retained_assets_hash,'status',existing.status);
end
$function$;

create function app_data_agent.record_falcon24_authority_staging_receipt(command jsonb)
returns jsonb language plpgsql volatile security definer set search_path='' as $function$
#variable_conflict use_variable
declare authority record; session app_data_agent.falcon24_authority_staging_sessions%rowtype;
  existing app_data_agent.falcon24_authority_staging_receipts%rowtype;
  receipt jsonb; requested_staging_id uuid; requested_epoch text;
begin
  if command is null or pg_catalog.jsonb_typeof(command) is distinct from 'object'
    or app_data_agent.provider_json_object_has_exact_keys(command,array[
      'schema_version','authority_epoch','receipt','command_hash']::text[]) is distinct from true
    or command->>'schema_version' is distinct from 'falcon24-staging-receipt-record@2.0.0'
    or app_data_agent.falcon24_authority_epoch_is_canonical(command->>'authority_epoch')
      is distinct from true
    or command->>'authority_epoch'='E1'
    or command->>'command_hash' is distinct from
      app_data_agent.u2_canonical_sha256(command-'command_hash')
    or pg_catalog.jsonb_typeof(command->'receipt') is distinct from 'object'
  then raise exception using errcode='22023',message='FALCON24_AUTHORITY_STAGING_RECEIPT_INVALID'; end if;
  requested_epoch:=command->>'authority_epoch';receipt:=command->'receipt';
  if app_data_agent.provider_json_object_has_exact_keys(receipt,array[
      'schema_version','authority_epoch','staging_id','component','subject_hash','evidence_hash',
      'production_isolation_proven','receipt_hash']::text[]) is distinct from true
    or receipt->>'schema_version' is distinct from 'falcon24-staging-receipt@2.0.0'
    or receipt->>'authority_epoch' is distinct from requested_epoch
    or app_data_agent.canonical_uuid_json_string_is_valid(receipt->'staging_id') is distinct from true
    or receipt->>'component' not in('AGENT_PROFILES','DATASET','LLM_CONFIGURATION',
      'OPERATOR_REGISTRY','SANDBOX_RUNTIME','SEMANTIC_RELEASE')
    or receipt->>'subject_hash'!~'^sha256:[0-9a-f]{64}$'
    or receipt->>'evidence_hash'!~'^sha256:[0-9a-f]{64}$'
    or pg_catalog.jsonb_typeof(receipt->'production_isolation_proven') is distinct from 'boolean'
    or ((receipt->>'production_isolation_proven')::boolean
      and receipt->>'component'<>'SANDBOX_RUNTIME')
    or receipt->>'receipt_hash' is distinct from
      app_data_agent.u2_canonical_sha256(receipt-'receipt_hash')
    or app_data_agent.contains_potential_plaintext_secret(receipt)
  then raise exception using errcode='22023',message='FALCON24_AUTHORITY_STAGING_RECEIPT_INVALID'; end if;
  requested_staging_id:=(receipt->>'staging_id')::uuid;
  select * into strict authority from platform.current_backend_authority(true);
  select * into session from app_data_agent.falcon24_authority_staging_sessions row
    where row.app_id=authority.app_id and row.tenant_id=authority.tenant_id
      and row.environment=authority.environment and row.staging_id=requested_staging_id
      and row.authority_epoch=requested_epoch for update;
  if not found then raise exception using errcode='02000',
    message='FALCON24_AUTHORITY_STAGING_SESSION_NOT_FOUND'; end if;
  if session.status<>'STAGED' then raise exception using errcode='55000',
    message='FALCON24_AUTHORITY_STAGING_SESSION_TERMINAL'; end if;
  select * into existing from app_data_agent.falcon24_authority_staging_receipts row
    where row.app_id=authority.app_id and row.tenant_id=authority.tenant_id
      and row.environment=authority.environment and row.staging_id=requested_staging_id
      and row.authority_epoch=requested_epoch and row.component=receipt->>'component' for update;
  if found then
    if existing.receipt_hash is distinct from receipt->>'receipt_hash'
      or existing.receipt_document is distinct from receipt
    then raise exception using errcode='23505',
      message='FALCON24_AUTHORITY_STAGING_RECEIPT_CONFLICT'; end if;
  else
    insert into app_data_agent.falcon24_authority_staging_receipts(
      app_id,tenant_id,environment,staging_id,authority_epoch,component,subject_hash,
      evidence_hash,production_isolation_proven,receipt_hash,receipt_document,created_at)
    values(authority.app_id,authority.tenant_id,authority.environment,requested_staging_id,
      requested_epoch,receipt->>'component',receipt->>'subject_hash',receipt->>'evidence_hash',
      (receipt->>'production_isolation_proven')::boolean,receipt->>'receipt_hash',receipt,
      pg_catalog.clock_timestamp()) returning * into strict existing;
  end if;
  return existing.receipt_document;
end
$function$;

create function app_data_agent.stage_falcon24_authority_baseline(command jsonb)
returns jsonb language plpgsql volatile security definer set search_path='' as $function$
#variable_conflict use_variable
declare authority record; session app_data_agent.falcon24_authority_staging_sessions%rowtype;
  existing app_data_agent.falcon24_authority_baselines%rowtype;
  baseline jsonb; requested_staging_id uuid; requested_baseline_id uuid; requested_epoch text;
begin
  if command is null or pg_catalog.jsonb_typeof(command) is distinct from 'object'
    or app_data_agent.provider_json_object_has_exact_keys(command,array[
      'schema_version','authority_epoch','staging_id','baseline','command_hash']::text[])
      is distinct from true
    or command->>'schema_version' is distinct from 'falcon24-stage-baseline-request@2.0.0'
    or app_data_agent.falcon24_authority_epoch_is_canonical(command->>'authority_epoch')
      is distinct from true
    or command->>'authority_epoch'='E1'
    or app_data_agent.canonical_uuid_json_string_is_valid(command->'staging_id') is distinct from true
    or pg_catalog.jsonb_typeof(command->'baseline') is distinct from 'object'
    or command->>'command_hash' is distinct from
      app_data_agent.u2_canonical_sha256(command-'command_hash')
  then raise exception using errcode='22023',message='FALCON24_AUTHORITY_BASELINE_INVALID'; end if;
  requested_epoch:=command->>'authority_epoch';
  requested_staging_id:=(command->>'staging_id')::uuid;baseline:=command->'baseline';
  if app_data_agent.provider_json_object_has_exact_keys(baseline,array[
      'schema_version','baseline_id','authority_epoch','source_commit','retained_assets_hash',
      'web_build_hash','staging_receipts','acceptance_contracts','production_isolation_proven',
      'production_gate','baseline_hash']::text[]) is distinct from true
    or baseline->>'schema_version' is distinct from 'falcon24-authority-baseline@2.0.0'
    or baseline->>'authority_epoch' is distinct from requested_epoch
    or app_data_agent.canonical_uuid_json_string_is_valid(baseline->'baseline_id') is distinct from true
    or baseline->>'source_commit'!~'^[0-9a-f]{40}$'
    or baseline->>'retained_assets_hash'!~'^sha256:[0-9a-f]{64}$'
    or baseline->>'web_build_hash'!~'^sha256:[0-9a-f]{64}$'
    or pg_catalog.jsonb_typeof(baseline->'staging_receipts') is distinct from 'object'
    or app_data_agent.provider_json_object_has_exact_keys(baseline->'staging_receipts',array[
      'dataset','semantic_release','llm_configuration','agent_profiles','operator_registry',
      'sandbox_runtime']::text[]) is distinct from true
    or exists(select 1 from pg_catalog.jsonb_each(baseline->'staging_receipts') entry
      where pg_catalog.jsonb_typeof(entry.value) is distinct from 'string'
        or entry.value#>>'{}'!~'^sha256:[0-9a-f]{64}$')
    or pg_catalog.jsonb_typeof(baseline->'acceptance_contracts') is distinct from 'object'
    or app_data_agent.provider_json_object_has_exact_keys(baseline->'acceptance_contracts',array[
      'oracle','qualification','campaign','qa_e2e','trace_ui','reclamation']::text[])
      is distinct from true
    or exists(select 1 from pg_catalog.jsonb_each(baseline->'acceptance_contracts') entry
      where pg_catalog.jsonb_typeof(entry.value) is distinct from 'string'
        or entry.value#>>'{}'!~'^sha256:[0-9a-f]{64}$')
    or pg_catalog.jsonb_typeof(baseline->'production_isolation_proven') is distinct from 'boolean'
    or baseline->>'production_gate' not in('GO','HOLD')
    or ((baseline->>'production_isolation_proven')::boolean
      is distinct from (baseline->>'production_gate'='GO'))
    or baseline->>'baseline_hash' is distinct from
      app_data_agent.u2_canonical_sha256(baseline-'baseline_hash')
    or app_data_agent.contains_potential_plaintext_secret(baseline)
  then raise exception using errcode='22023',message='FALCON24_AUTHORITY_BASELINE_INVALID'; end if;
  requested_baseline_id:=(baseline->>'baseline_id')::uuid;
  select * into strict authority from platform.current_backend_authority(true);
  select * into session from app_data_agent.falcon24_authority_staging_sessions row
    where row.app_id=authority.app_id and row.tenant_id=authority.tenant_id
      and row.environment=authority.environment and row.staging_id=requested_staging_id
      and row.authority_epoch=requested_epoch for update;
  if not found then raise exception using errcode='02000',
    message='FALCON24_AUTHORITY_STAGING_SESSION_NOT_FOUND'; end if;
  if session.status<>'STAGED'
    or session.retained_assets_hash is distinct from baseline->>'retained_assets_hash'
    or (select pg_catalog.count(*) from app_data_agent.falcon24_authority_staging_receipts receipt
      where receipt.app_id=authority.app_id and receipt.tenant_id=authority.tenant_id
        and receipt.environment=authority.environment and receipt.staging_id=requested_staging_id
        and receipt.authority_epoch=requested_epoch)<>6
    or exists(select 1 from (values
        ('DATASET','dataset'),('SEMANTIC_RELEASE','semantic_release'),
        ('LLM_CONFIGURATION','llm_configuration'),('AGENT_PROFILES','agent_profiles'),
        ('OPERATOR_REGISTRY','operator_registry'),('SANDBOX_RUNTIME','sandbox_runtime'))
      expected(component,baseline_key)
      left join app_data_agent.falcon24_authority_staging_receipts receipt
        on receipt.app_id=authority.app_id and receipt.tenant_id=authority.tenant_id
        and receipt.environment=authority.environment and receipt.staging_id=requested_staging_id
        and receipt.authority_epoch=requested_epoch and receipt.component=expected.component
      where receipt.receipt_hash is distinct from
        baseline#>>array['staging_receipts',expected.baseline_key])
    or not exists(select 1 from app_data_agent.falcon24_authority_staging_receipts receipt
      where receipt.app_id=authority.app_id and receipt.tenant_id=authority.tenant_id
        and receipt.environment=authority.environment and receipt.staging_id=requested_staging_id
        and receipt.authority_epoch=requested_epoch and receipt.component='SANDBOX_RUNTIME'
        and receipt.production_isolation_proven=
          (baseline->>'production_isolation_proven')::boolean)
  then raise exception using errcode='55000',message='FALCON24_AUTHORITY_STAGING_INCOMPLETE'; end if;
  select * into existing from app_data_agent.falcon24_authority_baselines row
    where row.app_id=authority.app_id and row.tenant_id=authority.tenant_id
      and row.environment=authority.environment and row.baseline_id=requested_baseline_id for update;
  if found then
    if existing.authority_epoch is distinct from requested_epoch
      or existing.staging_id is distinct from requested_staging_id
      or existing.baseline_hash is distinct from baseline->>'baseline_hash'
      or existing.baseline_document is distinct from baseline
    then raise exception using errcode='23505',
      message='FALCON24_AUTHORITY_BASELINE_IDENTITY_CONFLICT'; end if;
  else
    insert into app_data_agent.falcon24_authority_baselines(
      app_id,tenant_id,environment,baseline_id,authority_epoch,staging_id,baseline_hash,
      baseline_document,source_commit,retained_assets_hash,web_build_hash,
      production_isolation_proven,production_gate,status,created_by,created_at)
    values(authority.app_id,authority.tenant_id,authority.environment,requested_baseline_id,
      requested_epoch,requested_staging_id,baseline->>'baseline_hash',baseline,
      baseline->>'source_commit',baseline->>'retained_assets_hash',baseline->>'web_build_hash',
      (baseline->>'production_isolation_proven')::boolean,baseline->>'production_gate','STAGED',
      authority.principal_id,pg_catalog.clock_timestamp()) returning * into strict existing;
  end if;
  return existing.baseline_document;
end
$function$;
