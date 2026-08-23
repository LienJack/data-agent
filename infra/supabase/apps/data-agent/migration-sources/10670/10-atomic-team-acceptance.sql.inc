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
