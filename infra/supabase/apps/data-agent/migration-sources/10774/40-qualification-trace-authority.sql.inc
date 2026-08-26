create function app_data_agent.stage_falcon24_qualification_trace(command jsonb)
returns jsonb language plpgsql volatile security definer set search_path='' as $function$
declare authority record; qualification app_data_agent.falcon24_qualifications%rowtype;
  slot app_data_agent.falcon24_qualification_slots%rowtype; receipt jsonb;
begin
  if command is null or pg_catalog.jsonb_typeof(command) is distinct from 'object'
    or app_data_agent.provider_json_object_has_exact_keys(command,array[
      'schema_version','qualification_id','run_id','trace_closure_hash',
      'trace_gate_receipt_hash','trace_gate_receipt','command_hash']::text[]) is distinct from true
    or command->>'schema_version' is distinct from 'falcon24-qualification-trace-stage@1.0.0'
    or command->>'command_hash' is distinct from
      app_data_agent.u2_canonical_sha256(command-'command_hash')
    or pg_catalog.jsonb_typeof(command->'qualification_id') is distinct from 'string'
    or pg_catalog.jsonb_typeof(command->'run_id') is distinct from 'string'
    or pg_catalog.jsonb_typeof(command->'trace_closure_hash') is distinct from 'string'
    or command->>'trace_closure_hash'!~'^sha256:[0-9a-f]{64}$'
    or pg_catalog.jsonb_typeof(command->'trace_gate_receipt_hash') is distinct from 'string'
    or command->>'trace_gate_receipt_hash'!~'^sha256:[0-9a-f]{64}$'
    or pg_catalog.jsonb_typeof(command->'trace_gate_receipt') is distinct from 'object'
  then raise exception using errcode='22023',message='FALCON24_QUALIFICATION_STAGE_INVALID'; end if;
  receipt:=command->'trace_gate_receipt';
  if app_data_agent.provider_json_object_has_exact_keys(receipt,array[
      'schema_version','campaign_id','run_id','trace_hash','node_count','edge_count',
      'detail_count','sql_node_count','query_evidence_node_count',
      'analysis_evidence_node_count','chart_node_count','report_node_count',
      'detail_closure','verified_at','receipt_hash']::text[]) is distinct from true
    or receipt->>'schema_version' is distinct from
      'falcon24-resolution-trace-gate-receipt@2.0.0'
    or receipt->>'campaign_id' is distinct from command->>'qualification_id'
    or receipt->>'run_id' is distinct from command->>'run_id'
    or receipt->>'trace_hash' is distinct from command->>'trace_closure_hash'
    or receipt->>'receipt_hash' is distinct from command->>'trace_gate_receipt_hash'
    or receipt->>'receipt_hash' is distinct from
      app_data_agent.u2_canonical_sha256(receipt-'receipt_hash')
    or exists(select 1 from pg_catalog.unnest(array[
        'node_count','edge_count','detail_count','sql_node_count',
        'query_evidence_node_count','analysis_evidence_node_count','chart_node_count',
        'report_node_count']::text[]) count_key
      where pg_catalog.jsonb_typeof(receipt->count_key) is distinct from 'number'
        or receipt->>count_key!~'^[1-9][0-9]*$'
        or (receipt->>count_key)::numeric not between 1 and 9007199254740991)
    or receipt->>'detail_count' is distinct from receipt->>'node_count'
    or (receipt->>'node_count')::numeric <
      (receipt->>'sql_node_count')::numeric+(receipt->>'query_evidence_node_count')::numeric
      +(receipt->>'analysis_evidence_node_count')::numeric
      +(receipt->>'chart_node_count')::numeric+(receipt->>'report_node_count')::numeric
    or pg_catalog.jsonb_typeof(receipt->'detail_closure') is distinct from 'array'
    or pg_catalog.jsonb_array_length(receipt->'detail_closure')<1
    or pg_catalog.jsonb_array_length(receipt->'detail_closure')<>
      (receipt->>'detail_count')::integer
    or exists(
      with elements as (
        select item,ordinality,
          pg_catalog.lag(item->>'node_id') over(order by ordinality) previous_node_id
        from pg_catalog.jsonb_array_elements(receipt->'detail_closure')
          with ordinality element(item,ordinality))
      select 1 from elements where
        app_data_agent.provider_json_object_has_exact_keys(item,array[
          'node_id','detail_hash']::text[]) is distinct from true
        or pg_catalog.jsonb_typeof(item->'node_id') is distinct from 'string'
        or pg_catalog.length(item->>'node_id') not between 1 and 320
        or pg_catalog.jsonb_typeof(item->'detail_hash') is distinct from 'string'
        or item->>'detail_hash'!~'^sha256:[0-9a-f]{64}$'
        or (previous_node_id is not null and previous_node_id>=item->>'node_id'))
    or pg_catalog.jsonb_typeof(receipt->'verified_at') is distinct from 'string'
    or (receipt->>'verified_at')::timestamptz is null
  then raise exception using errcode='22023',message='FALCON24_QUALIFICATION_STAGE_INVALID'; end if;
  select * into strict authority from platform.current_backend_authority(true);
  select * into qualification from app_data_agent.falcon24_qualifications row
    where row.app_id=authority.app_id and row.tenant_id=authority.tenant_id
      and row.environment=authority.environment and row.principal_id=authority.principal_id
      and row.qualification_id=command->>'qualification_id' for update;
  if not found then raise exception using errcode='02000',message='FALCON24_QUALIFICATION_NOT_FOUND'; end if;
  select * into slot from app_data_agent.falcon24_qualification_slots row
    where row.app_id=authority.app_id and row.tenant_id=authority.tenant_id
      and row.environment=authority.environment and row.principal_id=authority.principal_id
      and row.qualification_id=qualification.qualification_id
      and row.run_id=(command->>'run_id')::uuid for update;
  if not found or qualification.status<>'RUNNING' or slot.status<>'CLAIMED' then
    raise exception using errcode='55000',message='FALCON24_QUALIFICATION_ORDER_OR_STATE_INVALID'; end if;
  if slot.claim_fence_consumed_at is null then
    raise exception using errcode='55000',message='FALCON24_QUALIFICATION_SUBMIT_FENCE_INVALID'; end if;
  if not exists(select 1 from app_data_agent.runs actual
    where actual.app_id=authority.app_id and actual.tenant_id=authority.tenant_id
      and actual.environment=authority.environment and actual.principal_id=authority.principal_id
      and actual.run_id=slot.run_id and actual.status='SUCCEEDED')
  then raise exception using errcode='55000',message='FALCON24_QUALIFICATION_ORDER_OR_STATE_INVALID'; end if;
  if slot.trace_gate_receipt_hash is not null then
    if slot.trace_closure_hash<>command->>'trace_closure_hash'
      or slot.trace_gate_receipt_hash<>command->>'trace_gate_receipt_hash'
      or slot.trace_gate_receipt<>receipt
    then raise exception using errcode='55000',message='FALCON24_QUALIFICATION_STAGE_REPLAY_MISMATCH'; end if;
    return pg_catalog.to_jsonb(slot);
  end if;
  update app_data_agent.falcon24_qualification_slots set
    trace_closure_hash=command->>'trace_closure_hash',
    trace_gate_receipt_hash=command->>'trace_gate_receipt_hash',trace_gate_receipt=receipt
    where app_id=authority.app_id and tenant_id=authority.tenant_id
      and environment=authority.environment and principal_id=authority.principal_id
      and qualification_id=qualification.qualification_id and run_id=slot.run_id
      and status='CLAIMED' and trace_gate_receipt_hash is null
    returning * into strict slot;
  return pg_catalog.to_jsonb(slot);
exception when invalid_text_representation or numeric_value_out_of_range
  or invalid_datetime_format or datetime_field_overflow then
  raise exception using errcode='22023',message='FALCON24_QUALIFICATION_STAGE_INVALID';
end
$function$;

create function app_data_agent.stage_falcon24_qualification_ui_trace(command jsonb)
returns jsonb language plpgsql volatile security definer set search_path='' as $function$
declare authority record; qualification app_data_agent.falcon24_qualifications%rowtype;
  slot app_data_agent.falcon24_qualification_slots%rowtype; receipt jsonb;
begin
  if command is null or pg_catalog.jsonb_typeof(command) is distinct from 'object'
    or app_data_agent.provider_json_object_has_exact_keys(command,array[
      'schema_version','qualification_id','run_id','trace_closure_hash',
      'ui_trace_gate_receipt_hash','ui_trace_gate_receipt','command_hash']::text[])
      is distinct from true
    or command->>'schema_version' is distinct from 'falcon24-qualification-ui-trace-stage@1.0.0'
    or command->>'command_hash' is distinct from
      app_data_agent.u2_canonical_sha256(command-'command_hash')
    or pg_catalog.jsonb_typeof(command->'qualification_id') is distinct from 'string'
    or pg_catalog.jsonb_typeof(command->'run_id') is distinct from 'string'
    or pg_catalog.jsonb_typeof(command->'trace_closure_hash') is distinct from 'string'
    or command->>'trace_closure_hash'!~'^sha256:[0-9a-f]{64}$'
    or pg_catalog.jsonb_typeof(command->'ui_trace_gate_receipt_hash') is distinct from 'string'
    or command->>'ui_trace_gate_receipt_hash'!~'^sha256:[0-9a-f]{64}$'
    or pg_catalog.jsonb_typeof(command->'ui_trace_gate_receipt') is distinct from 'object'
  then raise exception using errcode='22023',message='FALCON24_QUALIFICATION_STAGE_INVALID'; end if;
  receipt:=command->'ui_trace_gate_receipt';
  if app_data_agent.provider_json_object_has_exact_keys(receipt,array[
      'schema_version','campaign_id','run_id','workspace_id','conversation_id','trace_hash',
      'web_build','browser_harness_version','opened_nodes','opened_artifact_refs','chart_ref',
      'chart_renderer_version','chart_rendered','source_table_visible','error_banner',
      'dom_snapshot_hash','screenshot_hash','observed_at','receipt_hash']::text[])
      is distinct from true
    or receipt->>'schema_version' is distinct from
      'falcon24-resolution-trace-ui-gate-receipt@1.0.0'
    or receipt->>'campaign_id' is distinct from command->>'qualification_id'
    or receipt->>'run_id' is distinct from command->>'run_id'
    or receipt->>'trace_hash' is distinct from command->>'trace_closure_hash'
    or receipt->>'receipt_hash' is distinct from command->>'ui_trace_gate_receipt_hash'
    or receipt->>'receipt_hash' is distinct from
      app_data_agent.u2_canonical_sha256(receipt-'receipt_hash')
    or pg_catalog.jsonb_typeof(receipt->'workspace_id') is distinct from 'string'
    or (receipt->>'workspace_id')::uuid::text is distinct from receipt->>'workspace_id'
    or pg_catalog.jsonb_typeof(receipt->'conversation_id') is distinct from 'string'
    or (receipt->>'conversation_id')::uuid::text is distinct from receipt->>'conversation_id'
    or pg_catalog.jsonb_typeof(receipt->'web_build') is distinct from 'object'
    or app_data_agent.provider_json_object_has_exact_keys(receipt->'web_build',array[
      'build_id','generation_id']::text[]) is distinct from true
    or exists(select 1 from pg_catalog.unnest(array[
      receipt->'web_build'->>'build_id',receipt->'web_build'->>'generation_id',
      receipt->>'dom_snapshot_hash',receipt->>'screenshot_hash']::text[]) value
      where value!~'^sha256:[0-9a-f]{64}$')
    or receipt->>'browser_harness_version' is distinct from
      'falcon24-agent-browser-trace-gate@1.0.0'
    or receipt->>'chart_renderer_version' is distinct from 'governed-vchart@1.0.0'
    or receipt->'chart_rendered' is distinct from 'true'::jsonb
    or receipt->'source_table_visible' is distinct from 'true'::jsonb
    or receipt->'error_banner' is distinct from 'null'::jsonb
    or pg_catalog.jsonb_typeof(receipt->'opened_nodes') is distinct from 'array'
    or pg_catalog.jsonb_array_length(receipt->'opened_nodes')<1
    or pg_catalog.jsonb_typeof(receipt->'opened_artifact_refs') is distinct from 'array'
    or pg_catalog.jsonb_array_length(receipt->'opened_artifact_refs')<>5
    or exists(
      with elements as (
        select item,ordinality,
          pg_catalog.concat_ws(chr(31),item->>'app_id',item->>'tenant_id',
            item->>'environment',item->>'run_id',item->>'artifact_id',
            item->>'artifact_type',item->>'revision',item->>'content_hash') identity,
          pg_catalog.lag(pg_catalog.concat_ws(chr(31),item->>'app_id',item->>'tenant_id',
            item->>'environment',item->>'run_id',item->>'artifact_id',
            item->>'artifact_type',item->>'revision',item->>'content_hash'))
            over(order by ordinality) previous_identity
        from pg_catalog.jsonb_array_elements(receipt->'opened_artifact_refs')
          with ordinality element(item,ordinality))
      select 1 from elements where
        app_data_agent.provider_json_object_has_exact_keys(item,array[
          'artifact_id','artifact_type','app_id','tenant_id','environment','run_id',
          'revision','content_hash']::text[]) is distinct from true
        or pg_catalog.jsonb_typeof(item->'artifact_id') is distinct from 'string'
        or (item->>'artifact_id')::uuid::text is distinct from item->>'artifact_id'
        or pg_catalog.jsonb_typeof(item->'app_id') is distinct from 'string'
        or (item->>'app_id')::uuid::text is distinct from item->>'app_id'
        or pg_catalog.jsonb_typeof(item->'tenant_id') is distinct from 'string'
        or (item->>'tenant_id')::uuid::text is distinct from item->>'tenant_id'
        or item->>'tenant_id' is distinct from receipt->>'workspace_id'
        or pg_catalog.jsonb_typeof(item->'environment') is distinct from 'string'
        or pg_catalog.length(item->>'environment') not between 1 and 64
        or pg_catalog.jsonb_typeof(item->'run_id') is distinct from 'string'
        or (item->>'run_id')::uuid::text is distinct from item->>'run_id'
        or item->>'run_id' is distinct from receipt->>'run_id'
        or item->>'artifact_type' not in('SqlArtifact','QueryEvidence',
          'DerivedAnalysisEvidence','ArtifactWorkspaceDocument','AnalysisReport')
        or pg_catalog.jsonb_typeof(item->'revision') is distinct from 'number'
        or item->>'revision'!~'^[1-9][0-9]*$'
        or (item->>'revision')::numeric not between 1 and 9007199254740991
        or pg_catalog.jsonb_typeof(item->'content_hash') is distinct from 'string'
        or item->>'content_hash'!~'^sha256:[0-9a-f]{64}$'
        or (previous_identity is not null and previous_identity>=identity))
    or exists(select 1 from pg_catalog.unnest(array[
        'SqlArtifact','QueryEvidence','DerivedAnalysisEvidence',
        'ArtifactWorkspaceDocument','AnalysisReport']::text[]) required_type
      where (select pg_catalog.count(*) from pg_catalog.jsonb_array_elements(
          receipt->'opened_artifact_refs') item
        where item->>'artifact_type'=required_type)<>1)
    or pg_catalog.jsonb_typeof(receipt->'chart_ref') is distinct from 'object'
    or receipt->'chart_ref'->>'artifact_type' is distinct from 'ArtifactWorkspaceDocument'
    or not receipt->'opened_artifact_refs' @> pg_catalog.jsonb_build_array(receipt->'chart_ref')
    or pg_catalog.jsonb_typeof(receipt->'observed_at') is distinct from 'string'
    or (receipt->>'observed_at')::timestamptz is null
  then raise exception using errcode='22023',message='FALCON24_QUALIFICATION_STAGE_INVALID'; end if;
  select * into strict authority from platform.current_backend_authority(true);
  select * into qualification from app_data_agent.falcon24_qualifications row
    where row.app_id=authority.app_id and row.tenant_id=authority.tenant_id
      and row.environment=authority.environment and row.principal_id=authority.principal_id
      and row.qualification_id=command->>'qualification_id' for update;
  if not found then raise exception using errcode='02000',message='FALCON24_QUALIFICATION_NOT_FOUND'; end if;
  select * into slot from app_data_agent.falcon24_qualification_slots row
    where row.app_id=authority.app_id and row.tenant_id=authority.tenant_id
      and row.environment=authority.environment and row.principal_id=authority.principal_id
      and row.qualification_id=qualification.qualification_id
      and row.run_id=(command->>'run_id')::uuid for update;
  if not found or qualification.status<>'RUNNING' or slot.status<>'CLAIMED' then
    raise exception using errcode='55000',message='FALCON24_QUALIFICATION_ORDER_OR_STATE_INVALID'; end if;
  if slot.trace_closure_hash is null or slot.trace_gate_receipt_hash is null
    or slot.trace_gate_receipt is null
    or slot.trace_closure_hash<>command->>'trace_closure_hash'
    or receipt->>'workspace_id'<>slot.tenant_id::text
    or receipt->'opened_nodes' is distinct from slot.trace_gate_receipt->'detail_closure'
    or app_data_agent.u2_canonical_sha256(receipt->'web_build')
      is distinct from qualification.web_build_hash
  then raise exception using errcode='55000',message='FALCON24_QUALIFICATION_TRACE_REQUIRED'; end if;
  if slot.ui_trace_gate_receipt_hash is not null then
    if slot.ui_trace_gate_receipt_hash<>command->>'ui_trace_gate_receipt_hash'
      or slot.ui_trace_gate_receipt<>receipt
    then raise exception using errcode='55000',message='FALCON24_QUALIFICATION_STAGE_REPLAY_MISMATCH'; end if;
    return pg_catalog.to_jsonb(slot);
  end if;
  update app_data_agent.falcon24_qualification_slots set
    ui_trace_gate_receipt_hash=command->>'ui_trace_gate_receipt_hash',
    ui_trace_gate_receipt=receipt
    where app_id=authority.app_id and tenant_id=authority.tenant_id
      and environment=authority.environment and principal_id=authority.principal_id
      and qualification_id=qualification.qualification_id and run_id=slot.run_id
      and status='CLAIMED' and ui_trace_gate_receipt_hash is null
    returning * into strict slot;
  return pg_catalog.to_jsonb(slot);
exception when invalid_text_representation or numeric_value_out_of_range
  or invalid_datetime_format or datetime_field_overflow then
  raise exception using errcode='22023',message='FALCON24_QUALIFICATION_STAGE_INVALID';
end
$function$;
