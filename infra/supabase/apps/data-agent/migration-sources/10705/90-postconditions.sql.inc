alter function app_data_agent.resolved_context_published_lexicon(uuid,uuid,text,text,uuid)
  owner to data_agent_u12_context_owner;
alter function app_data_agent.load_resolved_context_authority_snapshot(jsonb)
  owner to data_agent_u12_context_owner;
alter function app_data_agent.commit_resolved_context_package(jsonb)
  owner to data_agent_u12_context_owner;

revoke all on function
  app_data_agent.resolved_context_published_lexicon(uuid,uuid,text,text,uuid)
from public,anon,authenticated,service_role,data_agent_backend;

do $postconditions$
declare
  load_definition text:=pg_catalog.pg_get_functiondef(
    'app_data_agent.load_resolved_context_authority_snapshot(jsonb)'::pg_catalog.regprocedure
  );
  commit_definition text:=pg_catalog.pg_get_functiondef(
    'app_data_agent.commit_resolved_context_package(jsonb)'::pg_catalog.regprocedure
  );
begin
  if pg_catalog.strpos(load_definition,'resolved-context-authority-snapshot@2.0.0')=0
    or pg_catalog.strpos(load_definition,$$'published_lexicon'$$)=0
    or pg_catalog.strpos(load_definition,'resolved-context-authority-snapshot@1.0.0')>0
  then raise exception 'RESOLVED_CONTEXT_LEXICON_LOAD_CONTRACT_UNSAFE'; end if;
  if pg_catalog.strpos(commit_definition,'resolved-context-package@2.0.0')=0
    or pg_catalog.strpos(commit_definition,'resolved-context-route-decision@2.0.0')=0
    or pg_catalog.strpos(commit_definition,'resolved-context-package@1.0.0')>0
  then raise exception 'RESOLVED_CONTEXT_LEXICON_COMMIT_CONTRACT_UNSAFE'; end if;
  if pg_catalog.to_regprocedure(
      'app_data_agent.load_resolved_context_authority_snapshot_v1(jsonb)'
    ) is not null
    or pg_catalog.to_regprocedure(
      'app_data_agent.load_resolved_context_authority_snapshot_v2(jsonb)'
    ) is not null
    or pg_catalog.to_regprocedure(
      'app_data_agent.commit_resolved_context_package_v1(jsonb)'
    ) is not null
    or pg_catalog.to_regprocedure(
      'app_data_agent.commit_resolved_context_package_v2(jsonb)'
    ) is not null
  then raise exception 'RESOLVED_CONTEXT_LEXICON_COMPATIBILITY_RPC_UNSAFE'; end if;
  if pg_catalog.has_function_privilege(
    'data_agent_backend',
    'app_data_agent.resolved_context_published_lexicon(uuid,uuid,text,text,uuid)',
    'EXECUTE'
  ) then raise exception 'RESOLVED_CONTEXT_LEXICON_HELPER_EXPOSED'; end if;
end
$postconditions$;
