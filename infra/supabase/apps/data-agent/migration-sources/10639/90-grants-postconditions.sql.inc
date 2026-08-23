-- ============================================================
-- 10639: RLS, ownership, narrow grants and postconditions
-- ============================================================

do $tables$
declare
  relation_name text;
begin
  foreach relation_name in array array[
    'semantic_authoring_run', 'semantic_authoring_turn',
    'semantic_authoring_tool_receipt', 'semantic_authoring_patch',
    'semantic_authoring_event', 'semantic_authoring_resume_idempotency'
  ] loop
    execute pg_catalog.format('alter table semantic.%I owner to data_agent_u6_data_owner', relation_name);
    execute pg_catalog.format('alter table semantic.%I enable row level security', relation_name);
    execute pg_catalog.format('alter table semantic.%I force row level security', relation_name);
    execute pg_catalog.format(
      'create policy %I on semantic.%I for all to data_agent_u6_rpc_owner using (
        app_id = nullif(pg_catalog.current_setting(''data_agent.app_id'', true), '''')::uuid
        and tenant_id = nullif(pg_catalog.current_setting(''data_agent.tenant_id'', true), '''')::uuid
        and environment = nullif(pg_catalog.current_setting(''data_agent.environment'', true), '''')
        and semantic_domain = nullif(pg_catalog.current_setting(''app.semantic_domain'', true), '''')
      ) with check (
        app_id = nullif(pg_catalog.current_setting(''data_agent.app_id'', true), '''')::uuid
        and tenant_id = nullif(pg_catalog.current_setting(''data_agent.tenant_id'', true), '''')::uuid
        and environment = nullif(pg_catalog.current_setting(''data_agent.environment'', true), '''')
        and semantic_domain = nullif(pg_catalog.current_setting(''app.semantic_domain'', true), '''')
      )',
      relation_name || '_rpc_scope_policy', relation_name
    );
    execute pg_catalog.format(
      'grant select, insert, update on table semantic.%I to data_agent_u6_rpc_owner', relation_name
    );
    execute pg_catalog.format('revoke all on table semantic.%I from public', relation_name);
    execute pg_catalog.format('revoke all on table semantic.%I from data_agent_backend', relation_name);
  end loop;
end
$tables$;

alter function semantic.build_authoring_state(uuid,uuid,text,text,uuid)
  owner to data_agent_u6_rpc_owner;
alter function semantic.append_authoring_events(uuid,uuid,text,text,uuid,bigint,jsonb)
  owner to data_agent_u6_rpc_owner;
alter function semantic.start_semantic_authoring(uuid,uuid,text,uuid,text,jsonb)
  owner to data_agent_u6_rpc_owner;
alter function semantic.get_semantic_authoring(uuid,uuid,text,uuid,text,uuid)
  owner to data_agent_u6_rpc_owner;
alter function semantic.begin_semantic_authoring_turn(uuid,uuid,text,uuid,text,uuid,bigint,integer,text,jsonb,jsonb)
  owner to data_agent_u6_rpc_owner;
alter function semantic.commit_semantic_authoring_turn(uuid,uuid,text,uuid,text,uuid,bigint,integer,text,text,jsonb,jsonb)
  owner to data_agent_u6_rpc_owner;
alter function semantic.get_semantic_authoring_tool_receipt(uuid,uuid,text,uuid,text,uuid,text)
  owner to data_agent_u6_rpc_owner;
alter function semantic.commit_semantic_authoring_tool(uuid,uuid,text,uuid,text,uuid,bigint,integer,text,jsonb,jsonb,jsonb,jsonb)
  owner to data_agent_u6_rpc_owner;
alter function semantic.resume_semantic_authoring(uuid,uuid,text,uuid,text,uuid,uuid,text,text)
  owner to data_agent_u6_rpc_owner;
alter function semantic.complete_semantic_authoring(uuid,uuid,text,uuid,text,uuid,bigint,integer,text,jsonb,jsonb,text,jsonb)
  owner to data_agent_u6_rpc_owner;
alter function semantic.fail_semantic_authoring(uuid,uuid,text,uuid,text,uuid,bigint,text,jsonb)
  owner to data_agent_u6_rpc_owner;
alter function semantic.list_semantic_authoring_events(uuid,uuid,text,uuid,text,uuid,bigint,integer)
  owner to data_agent_u6_rpc_owner;

revoke all on function semantic.build_authoring_state(uuid,uuid,text,text,uuid) from public;
revoke all on function semantic.append_authoring_events(uuid,uuid,text,text,uuid,bigint,jsonb) from public;
grant execute on function semantic.build_authoring_state(uuid,uuid,text,text,uuid) to data_agent_u6_rpc_owner;
grant execute on function semantic.append_authoring_events(uuid,uuid,text,text,uuid,bigint,jsonb) to data_agent_u6_rpc_owner;

do $grants$
declare
  signature text;
begin
  foreach signature in array array[
    'semantic.start_semantic_authoring(uuid,uuid,text,uuid,text,jsonb)',
    'semantic.get_semantic_authoring(uuid,uuid,text,uuid,text,uuid)',
    'semantic.begin_semantic_authoring_turn(uuid,uuid,text,uuid,text,uuid,bigint,integer,text,jsonb,jsonb)',
    'semantic.commit_semantic_authoring_turn(uuid,uuid,text,uuid,text,uuid,bigint,integer,text,text,jsonb,jsonb)',
    'semantic.get_semantic_authoring_tool_receipt(uuid,uuid,text,uuid,text,uuid,text)',
    'semantic.commit_semantic_authoring_tool(uuid,uuid,text,uuid,text,uuid,bigint,integer,text,jsonb,jsonb,jsonb,jsonb)',
    'semantic.resume_semantic_authoring(uuid,uuid,text,uuid,text,uuid,uuid,text,text)',
    'semantic.complete_semantic_authoring(uuid,uuid,text,uuid,text,uuid,bigint,integer,text,jsonb,jsonb,text,jsonb)',
    'semantic.fail_semantic_authoring(uuid,uuid,text,uuid,text,uuid,bigint,text,jsonb)',
    'semantic.list_semantic_authoring_events(uuid,uuid,text,uuid,text,uuid,bigint,integer)'
  ] loop
    execute pg_catalog.format('revoke all on function %s from public', signature);
    execute pg_catalog.format('grant execute on function %s to data_agent_backend', signature);
  end loop;
end
$grants$;

-- Narrow security-definer RPCs fence every mutation before touching Candidate.
grant update on table semantic.semantic_candidate to data_agent_u6_rpc_owner;

do $postconditions$
declare
  relation_name text;
  function_name text;
  function_record record;
begin
  foreach relation_name in array array[
    'semantic_authoring_run', 'semantic_authoring_turn',
    'semantic_authoring_tool_receipt', 'semantic_authoring_patch',
    'semantic_authoring_event', 'semantic_authoring_resume_idempotency'
  ] loop
    if not (select class.relrowsecurity and class.relforcerowsecurity
      from pg_catalog.pg_class as class
      join pg_catalog.pg_namespace as namespace on namespace.oid = class.relnamespace
      where namespace.nspname = 'semantic' and class.relname = relation_name)
      or pg_catalog.has_table_privilege(
        'data_agent_backend', pg_catalog.format('semantic.%I', relation_name),
        'SELECT,INSERT,UPDATE,DELETE'
      )
    then
      raise exception using errcode = 'P0001', message = 'SEMANTIC_AUTHORING_TABLE_HARDENING_FAILED';
    end if;
  end loop;
  foreach function_name in array array[
    'build_authoring_state', 'append_authoring_events', 'start_semantic_authoring',
    'get_semantic_authoring', 'begin_semantic_authoring_turn',
    'commit_semantic_authoring_turn', 'get_semantic_authoring_tool_receipt',
    'commit_semantic_authoring_tool', 'resume_semantic_authoring',
    'complete_semantic_authoring', 'fail_semantic_authoring',
    'list_semantic_authoring_events'
  ] loop
    select procedure.prosecdef, procedure.proconfig, owner.rolname as owner_name
    into function_record
    from pg_catalog.pg_proc as procedure
    join pg_catalog.pg_namespace as namespace on namespace.oid = procedure.pronamespace
    join pg_catalog.pg_roles as owner on owner.oid = procedure.proowner
    where namespace.nspname = 'semantic' and procedure.proname = function_name;
    if not found or not function_record.prosecdef
      or function_record.owner_name <> 'data_agent_u6_rpc_owner'
      or pg_catalog.array_to_string(function_record.proconfig, ',') not in ('search_path=', 'search_path=""')
    then
      raise exception using errcode = 'P0001', message = 'SEMANTIC_AUTHORING_FUNCTION_HARDENING_FAILED';
    end if;
  end loop;
end
$postconditions$;
