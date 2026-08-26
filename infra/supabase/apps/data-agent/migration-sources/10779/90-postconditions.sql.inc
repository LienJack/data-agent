do $postconditions$
begin
  if pg_catalog.to_regclass('app_data_agent.falcon24_e1_gate_attempt_history') is null
    or not exists(select 1 from pg_catalog.pg_attribute
      where attrelid='app_data_agent.falcon24_qualifications'::pg_catalog.regclass
        and attname='attempt_id' and attnotnull and not attisdropped)
    or not exists(select 1 from pg_catalog.pg_attribute
      where attrelid='app_data_agent.falcon24_acceptance_campaigns'::pg_catalog.regclass
        and attname='winning_qualification_attempt_id' and attnotnull and not attisdropped)
  then raise exception using errcode='P0001',message='FALCON24_E1_GATE_ATTEMPT_SCHEMA_DRIFT'; end if;
  if (select pg_catalog.count(*) from pg_catalog.pg_trigger trigger_row
      where trigger_row.tgname in('falcon24_e1_gate_attempt_history_immutable',
        'falcon24_000_e1_qualification_slot_attempt_fence',
        'falcon24_000_e1_campaign_run_attempt_fence') and not trigger_row.tgisinternal)<>3
  then raise exception using errcode='P0001',message='FALCON24_E1_GATE_ATTEMPT_TRIGGER_DRIFT'; end if;
  if exists(select 1 from pg_catalog.pg_proc procedure
      join pg_catalog.pg_namespace namespace on namespace.oid=procedure.pronamespace
      where namespace.nspname='app_data_agent'
        and procedure.prosrc like '%^falcon24-[a-z0-9._-]*v[1-9][0-9]*[a-z0-9._-]*$%')
  then raise exception using errcode='P0001',message='FALCON24_E1_LEGACY_GATE_ID_VALIDATOR_PRESENT'; end if;
  if pg_catalog.strpos(pg_catalog.pg_get_functiondef(
      'app_data_agent.begin_falcon24_qualification(jsonb)'::pg_catalog.regprocedure),'E1-Q1')=0
    or pg_catalog.strpos(pg_catalog.pg_get_functiondef(
      'app_data_agent.begin_falcon24_acceptance_campaign(jsonb)'::pg_catalog.regprocedure),'E1-C1')=0
  then raise exception using errcode='P0001',message='FALCON24_E1_GATE_BEGIN_DEFINITION_DRIFT'; end if;
  if pg_catalog.has_table_privilege('data_agent_backend',
      'app_data_agent.falcon24_e1_gate_attempt_history','SELECT')
  then raise exception using errcode='P0001',message='FALCON24_E1_GATE_HISTORY_GRANT_DRIFT'; end if;
end
$postconditions$;
