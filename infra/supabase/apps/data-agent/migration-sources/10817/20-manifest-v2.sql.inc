create or replace function app_data_agent.begin_falcon24_four_layer_gate(command jsonb)
returns jsonb language plpgsql volatile security definer set search_path='' as $function$
declare authority record;current_authority app_data_agent.falcon24_current_authority_epoch%rowtype;
  attempt app_data_agent.falcon24_four_layer_gate_attempts%rowtype;manifest jsonb;
  now_at timestamptz;layer_counts integer[];turns_hash text;
begin
  if command is null or pg_catalog.jsonb_typeof(command) is distinct from 'object'
    or app_data_agent.provider_json_object_has_exact_keys(command,array[
      'schema_version','manifest','command_hash']::text[]) is distinct from true
    or command->>'schema_version'<>'falcon24-four-layer-gate-begin@1.0.0'
    or command->>'command_hash'<>app_data_agent.u2_canonical_sha256(command-'command_hash')
    or pg_catalog.jsonb_typeof(command->'manifest') is distinct from 'object'
  then raise exception using errcode='22023',
    message='FALCON24_FOUR_LAYER_COMMAND_INVALID'; end if;
  manifest:=command->'manifest';
  select array[pg_catalog.count(*) filter(where item->>'layer'='L1'),
      pg_catalog.count(*) filter(where item->>'layer'='L2'),
      pg_catalog.count(*) filter(where item->>'layer'='L3'),
      pg_catalog.count(*) filter(where item->>'layer'='L4')]::integer[]
    into strict layer_counts from pg_catalog.jsonb_array_elements(
      case when pg_catalog.jsonb_typeof(manifest->'turns')='array'
        then manifest->'turns' else '[]'::jsonb end) item;
  turns_hash:=app_data_agent.u2_canonical_sha256(
    case when pg_catalog.jsonb_typeof(manifest->'turns')='array'
      then manifest->'turns' else '[]'::jsonb end);
  if app_data_agent.provider_json_object_has_exact_keys(manifest,array[
      'schema_version','gate_id','attempt_id','authority_epoch','authority_baseline_id',
      'authority_baseline_hash','authority_activation_attempt_id','source_commit',
      'worker_build_hash','worker_generation_hash','web_build_hash','web_generation_hash',
      'semantic_release_hash','datasource_binding_hash','model_config_hash',
      'runtime_attestation_hash','turns','manifest_hash']::text[]) is distinct from true
    or manifest->>'manifest_hash'<>app_data_agent.u2_canonical_sha256(manifest-'manifest_hash')
    or app_data_agent.canonical_uuid_json_string_is_valid(manifest->'attempt_id') is distinct from true
    or app_data_agent.canonical_uuid_json_string_is_valid(
      manifest->'authority_baseline_id') is distinct from true
    or app_data_agent.canonical_uuid_json_string_is_valid(
      manifest->'authority_activation_attempt_id') is distinct from true
    or manifest->>'authority_epoch'!~'^E[1-9][0-9]*$'
    or manifest->>'gate_id'<>manifest->>'authority_epoch'||'-FL1'
    or manifest->>'source_commit'!~'^[0-9a-f]{40}$'
    or exists(select 1 from pg_catalog.unnest(array[
      'authority_baseline_hash','worker_build_hash','worker_generation_hash','web_build_hash',
      'web_generation_hash','semantic_release_hash','datasource_binding_hash',
      'model_config_hash','runtime_attestation_hash','manifest_hash']::text[]) hash_key
      where manifest->>hash_key!~'^sha256:[0-9a-f]{64}$')
    or pg_catalog.jsonb_typeof(manifest->'turns') is distinct from 'array'
    or pg_catalog.jsonb_array_length(manifest->'turns')<>15
    or layer_counts<>array[5,2,2,6]::integer[]
    or not ((manifest->>'schema_version'='falcon24-four-layer-gate-manifest@1.0.0'
        and turns_hash='sha256:c01c7944368ebdd0ae9fb2e69c9b809cb0cb24a2de65076da934e95a23c396e9')
      or (manifest->>'schema_version'='falcon24-four-layer-gate-manifest@2.0.0'
        and turns_hash='sha256:4ecf4742d2f8a201b3abe9609177441a0672a629becb4f58a23c18b7c7251142'))
    or app_data_agent.contains_potential_plaintext_secret(manifest)
  then raise exception using errcode='22023',
    message='FALCON24_FOUR_LAYER_MANIFEST_INVALID'; end if;

  select * into strict authority from platform.current_backend_authority(true);
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'data-agent:falcon24-four-layer:'||authority.app_id::text||':'||
    authority.tenant_id::text||':'||authority.environment||':'||authority.principal_id::text,0));
  select * into current_authority from app_data_agent.falcon24_current_authority_epoch row
    where row.app_id=authority.app_id and row.tenant_id=authority.tenant_id
      and row.environment=authority.environment for share;
  if not found or current_authority.authority_epoch<>manifest->>'authority_epoch'
    or current_authority.baseline_id::text<>manifest->>'authority_baseline_id'
    or current_authority.baseline_hash<>manifest->>'authority_baseline_hash'
    or current_authority.activation_attempt_id::text<>
      manifest->>'authority_activation_attempt_id'
  then raise exception using errcode='55000',
    message='FALCON24_FOUR_LAYER_AUTHORITY_MISMATCH'; end if;

  select * into attempt from app_data_agent.falcon24_four_layer_gate_attempts row
    where row.app_id=authority.app_id and row.tenant_id=authority.tenant_id
      and row.environment=authority.environment and row.principal_id=authority.principal_id
      and row.attempt_id=(manifest->>'attempt_id')::uuid for update;
  if found then
    if attempt.manifest_hash<>manifest->>'manifest_hash'
      or attempt.worker_build_hash<>manifest->>'worker_build_hash'
      or attempt.web_build_hash<>manifest->>'web_build_hash'
    then raise exception using errcode='55000',
      message='FALCON24_FOUR_LAYER_REPLAY_MISMATCH'; end if;
    return pg_catalog.jsonb_build_object('attempt',pg_catalog.to_jsonb(attempt));
  end if;
  if exists(select 1 from app_data_agent.falcon24_four_layer_gate_attempts row
    where row.app_id=authority.app_id and row.tenant_id=authority.tenant_id
      and row.environment=authority.environment and row.principal_id=authority.principal_id
      and row.status in('READY','RUNNING','FINALIZING'))
  then raise exception using errcode='55000',
    message='FALCON24_FOUR_LAYER_ACTIVE_ATTEMPT_EXISTS'; end if;
  now_at:=pg_catalog.clock_timestamp();
  insert into app_data_agent.falcon24_four_layer_gate_attempts(
    app_id,tenant_id,environment,principal_id,gate_id,attempt_id,authority_epoch,
    authority_baseline_id,authority_baseline_hash,authority_activation_attempt_id,
    source_commit,worker_build_hash,worker_generation_hash,web_build_hash,
    web_generation_hash,semantic_release_hash,datasource_binding_hash,model_config_hash,
    runtime_attestation_hash,manifest_hash,manifest_document,status,current_layer,
    next_turn_ordinal,created_at,updated_at)
  values(authority.app_id,authority.tenant_id,authority.environment,authority.principal_id,
    manifest->>'gate_id',(manifest->>'attempt_id')::uuid,manifest->>'authority_epoch',
    (manifest->>'authority_baseline_id')::uuid,manifest->>'authority_baseline_hash',
    (manifest->>'authority_activation_attempt_id')::uuid,manifest->>'source_commit',
    manifest->>'worker_build_hash',manifest->>'worker_generation_hash',
    manifest->>'web_build_hash',manifest->>'web_generation_hash',
    manifest->>'semantic_release_hash',manifest->>'datasource_binding_hash',
    manifest->>'model_config_hash',manifest->>'runtime_attestation_hash',
    manifest->>'manifest_hash',manifest,'READY','L1',0,now_at,now_at)
  returning * into strict attempt;
  insert into app_data_agent.falcon24_four_layer_gate_turns(
    app_id,tenant_id,environment,principal_id,attempt_id,turn_ordinal,turn_id,layer,
    scenario_id,scenario_turn_index,conversation_group,conversation_mode,question,
    question_hash,expected_agents,rubric,status,created_at,updated_at)
  select authority.app_id,authority.tenant_id,authority.environment,authority.principal_id,
    attempt.attempt_id,(entry.ordinality-1)::integer,entry.item->>'turn_id',
    entry.item->>'layer',entry.item->>'scenario_id',
    (entry.item->>'scenario_turn_index')::integer,entry.item->>'conversation_group',
    entry.item->>'conversation_mode',entry.item->>'question',entry.item->>'question_hash',
    entry.item->'expected_agents',entry.item->'rubric','PLANNED',now_at,now_at
  from pg_catalog.jsonb_array_elements(manifest->'turns')
    with ordinality entry(item,ordinality);
  return pg_catalog.jsonb_build_object('attempt',pg_catalog.to_jsonb(attempt));
exception when invalid_text_representation or numeric_value_out_of_range then
  raise exception using errcode='22023',message='FALCON24_FOUR_LAYER_COMMAND_INVALID';
end
$function$;

alter function app_data_agent.begin_falcon24_four_layer_gate(jsonb)
  owner to data_agent_u6_rpc_owner;
revoke all on function app_data_agent.begin_falcon24_four_layer_gate(jsonb) from public;
grant execute on function app_data_agent.begin_falcon24_four_layer_gate(jsonb)
  to data_agent_backend;
