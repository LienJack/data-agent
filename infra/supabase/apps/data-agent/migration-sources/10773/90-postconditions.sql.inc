do $postconditions$
declare stage_definition text; ui_stage_definition text; fence_definition text;
begin
  if not exists(select 1 from pg_catalog.pg_attribute attribute
    where attribute.attrelid='app_data_agent.falcon24_acceptance_campaign_runs'::pg_catalog.regclass
      and attribute.attname='ui_trace_gate_receipt_hash' and not attribute.attisdropped)
    or not exists(select 1 from pg_catalog.pg_attribute attribute
      where attribute.attrelid='app_data_agent.falcon24_acceptance_campaign_runs'::pg_catalog.regclass
        and attribute.attname='ui_trace_gate_receipt' and not attribute.attisdropped)
    or not exists(select 1 from pg_catalog.pg_constraint constraint_row
      where constraint_row.conrelid=
        'app_data_agent.falcon24_acceptance_campaign_runs'::pg_catalog.regclass
        and constraint_row.conname='falcon24_acceptance_campaign_runs_ui_trace_gate_check')
    or not exists(select 1 from pg_catalog.pg_trigger trigger_row
      where trigger_row.tgrelid=
        'app_data_agent.falcon24_acceptance_campaign_runs'::pg_catalog.regclass
        and trigger_row.tgname='falcon24_acceptance_campaign_runs_ui_trace_gate_fence'
        and not trigger_row.tgisinternal)
  then raise exception using errcode='P0001',message='FALCON24_UI_TRACE_GATE_SCHEMA_DRIFT'; end if;

  select procedure.prosrc into strict stage_definition from pg_catalog.pg_proc procedure
    where procedure.oid='app_data_agent.stage_falcon24_acceptance_trace(jsonb)'::pg_catalog.regprocedure;
  select procedure.prosrc into strict ui_stage_definition from pg_catalog.pg_proc procedure
    where procedure.oid=
      'app_data_agent.stage_falcon24_acceptance_ui_trace(jsonb)'::pg_catalog.regprocedure;
  select procedure.prosrc into strict fence_definition from pg_catalog.pg_proc procedure
    where procedure.oid='app_data_agent.falcon24_ui_trace_gate_fence()'::pg_catalog.regprocedure;
  if pg_catalog.strpos(stage_definition,
      'falcon24-resolution-trace-gate-receipt@2.0.0')=0
    or pg_catalog.strpos(stage_definition,'detail_closure')=0
    or pg_catalog.strpos(stage_definition,
      'falcon24-resolution-trace-gate-receipt@1.0.0')>0
    or pg_catalog.strpos(ui_stage_definition,
      'falcon24-resolution-trace-ui-gate-receipt@1.0.0')=0
    or pg_catalog.strpos(ui_stage_definition,
      'falcon24-agent-browser-trace-gate@1.0.0')=0
    or pg_catalog.strpos(ui_stage_definition,
      'opened_nodes')=0
    or pg_catalog.strpos(ui_stage_definition,
      'opened_artifact_refs')=0
    or pg_catalog.strpos(ui_stage_definition,
      'campaign_run.trace_gate_receipt->''detail_closure''')=0
    or pg_catalog.strpos(fence_definition,'FALCON24_UI_TRACE_STAGE_REQUIRED')=0
  then raise exception using errcode='P0001',message='FALCON24_UI_TRACE_GATE_FUNCTION_DRIFT'; end if;

  if (select pg_catalog.count(*) from pg_catalog.pg_proc procedure
      join pg_catalog.pg_namespace namespace on namespace.oid=procedure.pronamespace
      where namespace.nspname='app_data_agent'
        and procedure.proname='stage_falcon24_acceptance_ui_trace')<>1
    or (select pg_catalog.count(*) from pg_catalog.pg_proc procedure
      join pg_catalog.pg_namespace namespace on namespace.oid=procedure.pronamespace
      where namespace.nspname='app_data_agent'
        and procedure.proname='load_falcon24_acceptance_ui_trace_gate')<>1
    or exists(select 1 from pg_catalog.pg_proc procedure where procedure.oid in(
        'app_data_agent.stage_falcon24_acceptance_ui_trace(jsonb)'::pg_catalog.regprocedure,
        'app_data_agent.load_falcon24_acceptance_ui_trace_gate(jsonb)'::pg_catalog.regprocedure,
        'app_data_agent.stage_falcon24_acceptance_trace(jsonb)'::pg_catalog.regprocedure,
        'app_data_agent.falcon24_ui_trace_gate_fence()'::pg_catalog.regprocedure)
      and (pg_catalog.pg_get_userbyid(procedure.proowner)<>'data_agent_u6_rpc_owner'
        or not procedure.prosecdef or not procedure.proconfig@>array['search_path=""']::text[]))
  then raise exception using errcode='P0001',message='FALCON24_UI_TRACE_GATE_SECURITY_DRIFT'; end if;

  if not pg_catalog.has_function_privilege('data_agent_backend',
      'app_data_agent.stage_falcon24_acceptance_ui_trace(jsonb)','EXECUTE')
    or not pg_catalog.has_function_privilege('data_agent_backend',
      'app_data_agent.load_falcon24_acceptance_ui_trace_gate(jsonb)','EXECUTE')
    or exists(select 1 from pg_catalog.unnest(array[
        'public','anon','authenticated','service_role','data_agent_job_authority']::text[]) role_name
      where pg_catalog.has_function_privilege(role_name,
          'app_data_agent.stage_falcon24_acceptance_ui_trace(jsonb)','EXECUTE')
        or pg_catalog.has_function_privilege(role_name,
          'app_data_agent.load_falcon24_acceptance_ui_trace_gate(jsonb)','EXECUTE'))
  then raise exception using errcode='P0001',message='FALCON24_UI_TRACE_GATE_GRANT_DRIFT'; end if;
end
$postconditions$;
