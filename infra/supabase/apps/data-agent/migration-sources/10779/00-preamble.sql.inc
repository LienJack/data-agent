begin;

select platform.acquire_migration_lock(
  'app','00000000-0000-4000-8000-00000000da01'::uuid);

do $preflight$
begin
  if not exists(select 1 from platform.migration_ledger
    where migration_version='20260725010778_app_data_agent_e1_legacy_runtime_retirement')
  then raise exception using errcode='P0001',message='FALCON24_E1_GATE_BASELINE_10778_MISSING'; end if;
  if exists(select 1 from app_data_agent.falcon24_qualifications)
    or exists(select 1 from app_data_agent.falcon24_qualification_slots)
    or exists(select 1 from app_data_agent.falcon24_acceptance_campaigns)
    or exists(select 1 from app_data_agent.falcon24_acceptance_campaign_runs)
  then raise exception using errcode='55000',message='FALCON24_E1_GATE_LEGACY_STATE_PRESENT'; end if;
end
$preflight$;
