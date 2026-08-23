-- u20_team_acceptance_migration_checksum: sha256:5d68f486444ffa2100d5ff5217cf9c60cbf9325ca4d34af00d31fc736650c728
-- 10670 installs atomic Team command acceptance after the U20 profile registry.
begin;

do $bootstrap$
begin
  if pg_catalog.current_setting('server_version_num')::integer not between 170000 and 179999 then
    raise exception using errcode='0A000',message='U20_TEAM_ACCEPTANCE_POSTGRES_VERSION_UNSUPPORTED';
  end if;
  if session_user<>'postgres' or current_user<>'postgres' then
    raise exception using errcode='42501',message='U20_TEAM_ACCEPTANCE_MIGRATION_EXECUTOR_UNSAFE';
  end if;
  if not exists(select 1 from platform.migration_ledger where owner_kind='app'
    and app_id='00000000-0000-4000-8000-00000000da01'::uuid
    and migration_version='20260725010667_app_data_agent_agent_product_profiles')
  then raise exception using errcode='P0001',message='U20_TEAM_ACCEPTANCE_BASELINE_10667_MISSING'; end if;
end
$bootstrap$;

set local lock_timeout='2000ms';
set local statement_timeout='300000ms';
set local idle_in_transaction_session_timeout='60000ms';
select platform.acquire_migration_lock('app','00000000-0000-4000-8000-00000000da01'::uuid);
-- 10670 patches the reviewed acceptance function only when both exact source anchors match.
do $patch$
declare
  definition text;
  patched text;
  begin_anchor constant text := E'begin\n  if requested_command is null';
  kind_anchor constant text := E'or requested_payload ->> ''kind''\n      is distinct from ''START_L2_RESEARCH''';
  upgrade_block constant text := E'begin\n  -- QA_TEAM_ACCEPTANCE_ATOMIC_UPGRADE: update command, event and hashes before any insert.\n  if requested_command #>> ''{payload,kind}'' = ''START_L2_RESEARCH''\n    and app_data_agent.current_agent_product_profile_refs() is not null\n  then\n    requested_command := pg_catalog.jsonb_set(\n      requested_command,''{payload}'',pg_catalog.jsonb_build_object(\n        ''kind'',''START_DATA_AGENT_TEAM'',\n        ''effective_config_ref'',requested_command#>''{payload,effective_config_ref}'',\n        ''profile_refs'',app_data_agent.current_agent_product_profile_refs()),false);\n    requested_payload_hash := platform.canonical_sha256(requested_command->''payload'');\n    requested_event := pg_catalog.jsonb_set(\n      requested_event,''{payload,payload_hash}'',pg_catalog.to_jsonb(requested_payload_hash),false);\n    requested_event_hash := app_data_agent.runtime_canonical_sha256(requested_event);\n  end if;\n  if requested_command is null';
begin
  select pg_catalog.pg_get_functiondef(
    'app_data_agent.accept_backend_run_command(jsonb,text,jsonb,text)'::pg_catalog.regprocedure)
  into strict definition;
  if (pg_catalog.length(definition)-pg_catalog.length(pg_catalog.replace(
      definition,begin_anchor,'')))/pg_catalog.length(begin_anchor)<>1
    or (pg_catalog.length(definition)-pg_catalog.length(pg_catalog.replace(
      definition,kind_anchor,'')))/pg_catalog.length(kind_anchor)<>1
  then
    raise exception using errcode='P0001',message='U20_TEAM_ACCEPTANCE_SOURCE_ANCHOR_DRIFT';
  end if;
  patched := pg_catalog.replace(definition,begin_anchor,upgrade_block);
  patched := pg_catalog.replace(patched,kind_anchor,
    E'or requested_payload ->> ''kind''\n      not in (''START_L2_RESEARCH'',''START_DATA_AGENT_TEAM'')');
  if patched=definition
    or pg_catalog.strpos(patched,'QA_TEAM_ACCEPTANCE_ATOMIC_UPGRADE')=0
  then
    raise exception using errcode='P0001',message='U20_TEAM_ACCEPTANCE_PATCH_FAILED';
  end if;
  execute patched;
end
$patch$;
-- The original U20 insert trigger remains enabled as defense in depth.
do $postconditions$
declare definition text;
begin
  select pg_catalog.pg_get_functiondef(
    'app_data_agent.accept_backend_run_command(jsonb,text,jsonb,text)'::pg_catalog.regprocedure)
  into strict definition;
  if pg_catalog.strpos(definition,'QA_TEAM_ACCEPTANCE_ATOMIC_UPGRADE')=0
    or pg_catalog.strpos(
      definition,E'not in (''START_L2_RESEARCH'',''START_DATA_AGENT_TEAM'')')=0
  then
    raise exception using errcode='P0001',message='U20_TEAM_ACCEPTANCE_POSTCONDITION_FAILED';
  end if;
  if not exists(select 1 from pg_catalog.pg_trigger trigger
    where trigger.tgrelid='app_data_agent.commands'::pg_catalog.regclass
      and trigger.tgname='commands_route_question_run_to_agent_team'
      and trigger.tgenabled<>'D')
  then
    raise exception using errcode='P0001',message='U20_TEAM_ACCEPTANCE_TRIGGER_MISSING';
  end if;
end
$postconditions$;
select platform.assert_migration_checksum(
  'app','00000000-0000-4000-8000-00000000da01'::uuid,
  '20260725010670_app_data_agent_atomic_team_acceptance','sha256:5d68f486444ffa2100d5ff5217cf9c60cbf9325ca4d34af00d31fc736650c728');
commit;
