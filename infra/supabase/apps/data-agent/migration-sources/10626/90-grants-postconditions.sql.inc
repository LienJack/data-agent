-- ============================================================
-- 10626: RLS, ownership, exact grants and static postconditions
-- ============================================================

alter table semantic.semantic_schema_feature_packet owner to data_agent_u6_data_owner;
alter table semantic.semantic_candidate_compile_run owner to data_agent_u6_data_owner;
alter table semantic.semantic_change_proposal owner to data_agent_u6_data_owner;

alter table semantic.semantic_schema_feature_packet enable row level security;
alter table semantic.semantic_schema_feature_packet force row level security;
alter table semantic.semantic_candidate_compile_run enable row level security;
alter table semantic.semantic_candidate_compile_run force row level security;
alter table semantic.semantic_change_proposal enable row level security;
alter table semantic.semantic_change_proposal force row level security;

create policy semantic_schema_feature_packet_rpc_scope_policy
  on semantic.semantic_schema_feature_packet for all to data_agent_u6_rpc_owner
  using (
    app_id = nullif(pg_catalog.current_setting('data_agent.app_id', true), '')::uuid
    and tenant_id = nullif(pg_catalog.current_setting('data_agent.tenant_id', true), '')::uuid
    and environment = nullif(pg_catalog.current_setting('data_agent.environment', true), '')
    and semantic_domain = nullif(pg_catalog.current_setting('app.semantic_domain', true), '')
  ) with check (
    app_id = nullif(pg_catalog.current_setting('data_agent.app_id', true), '')::uuid
    and tenant_id = nullif(pg_catalog.current_setting('data_agent.tenant_id', true), '')::uuid
    and environment = nullif(pg_catalog.current_setting('data_agent.environment', true), '')
    and semantic_domain = nullif(pg_catalog.current_setting('app.semantic_domain', true), '')
  );
create policy semantic_candidate_compile_run_rpc_scope_policy
  on semantic.semantic_candidate_compile_run for all to data_agent_u6_rpc_owner
  using (
    app_id = nullif(pg_catalog.current_setting('data_agent.app_id', true), '')::uuid
    and tenant_id = nullif(pg_catalog.current_setting('data_agent.tenant_id', true), '')::uuid
    and environment = nullif(pg_catalog.current_setting('data_agent.environment', true), '')
    and semantic_domain = nullif(pg_catalog.current_setting('app.semantic_domain', true), '')
  ) with check (
    app_id = nullif(pg_catalog.current_setting('data_agent.app_id', true), '')::uuid
    and tenant_id = nullif(pg_catalog.current_setting('data_agent.tenant_id', true), '')::uuid
    and environment = nullif(pg_catalog.current_setting('data_agent.environment', true), '')
    and semantic_domain = nullif(pg_catalog.current_setting('app.semantic_domain', true), '')
  );
create policy semantic_change_proposal_rpc_scope_policy
  on semantic.semantic_change_proposal for all to data_agent_u6_rpc_owner
  using (
    app_id = nullif(pg_catalog.current_setting('data_agent.app_id', true), '')::uuid
    and tenant_id = nullif(pg_catalog.current_setting('data_agent.tenant_id', true), '')::uuid
    and environment = nullif(pg_catalog.current_setting('data_agent.environment', true), '')
    and semantic_domain = nullif(pg_catalog.current_setting('app.semantic_domain', true), '')
  ) with check (
    app_id = nullif(pg_catalog.current_setting('data_agent.app_id', true), '')::uuid
    and tenant_id = nullif(pg_catalog.current_setting('data_agent.tenant_id', true), '')::uuid
    and environment = nullif(pg_catalog.current_setting('data_agent.environment', true), '')
    and semantic_domain = nullif(pg_catalog.current_setting('app.semantic_domain', true), '')
  );

grant select, insert on table semantic.semantic_schema_feature_packet to data_agent_u6_rpc_owner;
grant select, insert, update on table semantic.semantic_candidate_compile_run to data_agent_u6_rpc_owner;
grant select, insert on table semantic.semantic_change_proposal to data_agent_u6_rpc_owner;

alter function semantic.begin_schema_candidate_compile(uuid,uuid,text,uuid,text,uuid,uuid,uuid,text,jsonb,jsonb)
  owner to data_agent_u6_rpc_owner;
alter function semantic.get_schema_candidate_drift_evidence(uuid,uuid,text,uuid,text,text,uuid)
  owner to data_agent_u6_rpc_owner;
alter function semantic.finish_schema_candidate_compile(uuid,uuid,text,uuid,text,uuid,text,jsonb,text)
  owner to data_agent_u6_rpc_owner;
alter function semantic.get_schema_candidate_compile(uuid,uuid,text,uuid,text,uuid)
  owner to data_agent_u6_rpc_owner;
alter function semantic.attach_schema_compile_candidate(uuid,uuid,text,uuid,text,uuid,uuid,uuid)
  owner to data_agent_u6_rpc_owner;

revoke all on function semantic.begin_schema_candidate_compile(uuid,uuid,text,uuid,text,uuid,uuid,uuid,text,jsonb,jsonb) from public;
revoke all on function semantic.get_schema_candidate_drift_evidence(uuid,uuid,text,uuid,text,text,uuid) from public;
revoke all on function semantic.finish_schema_candidate_compile(uuid,uuid,text,uuid,text,uuid,text,jsonb,text) from public;
revoke all on function semantic.get_schema_candidate_compile(uuid,uuid,text,uuid,text,uuid) from public;
revoke all on function semantic.attach_schema_compile_candidate(uuid,uuid,text,uuid,text,uuid,uuid,uuid) from public;
grant execute on function semantic.begin_schema_candidate_compile(uuid,uuid,text,uuid,text,uuid,uuid,uuid,text,jsonb,jsonb) to data_agent_backend;
grant execute on function semantic.get_schema_candidate_drift_evidence(uuid,uuid,text,uuid,text,text,uuid) to data_agent_backend;
grant execute on function semantic.finish_schema_candidate_compile(uuid,uuid,text,uuid,text,uuid,text,jsonb,text) to data_agent_backend;
grant execute on function semantic.get_schema_candidate_compile(uuid,uuid,text,uuid,text,uuid) to data_agent_backend;
grant execute on function semantic.attach_schema_compile_candidate(uuid,uuid,text,uuid,text,uuid,uuid,uuid) to data_agent_backend;

revoke all on table semantic.semantic_schema_feature_packet from data_agent_backend;
revoke all on table semantic.semantic_candidate_compile_run from data_agent_backend;
revoke all on table semantic.semantic_change_proposal from data_agent_backend;

do $postconditions$
declare
  relation_name text;
  function_name text;
  function_record record;
begin
  foreach relation_name in array array[
    'semantic_schema_feature_packet', 'semantic_candidate_compile_run', 'semantic_change_proposal'
  ] loop
    if pg_catalog.has_table_privilege(
      'data_agent_backend', pg_catalog.format('semantic.%I', relation_name), 'SELECT,INSERT,UPDATE,DELETE'
    ) then
      raise exception using errcode = 'P0001', message = 'SEMANTIC_CANDIDATE_COMPILE_BACKEND_TABLE_ACL_FAILED';
    end if;
  end loop;
  foreach function_name in array array[
    'get_schema_candidate_drift_evidence', 'begin_schema_candidate_compile', 'finish_schema_candidate_compile',
    'get_schema_candidate_compile', 'attach_schema_compile_candidate'
  ] loop
    select procedure.prosecdef, procedure.proconfig, procedure.provolatile, owner.rolname as owner_name
    into function_record
    from pg_catalog.pg_proc as procedure
    join pg_catalog.pg_namespace as namespace on namespace.oid = procedure.pronamespace
    join pg_catalog.pg_roles as owner on owner.oid = procedure.proowner
    where namespace.nspname = 'semantic' and procedure.proname = function_name;
    if not found or not function_record.prosecdef
      or function_record.owner_name <> 'data_agent_u6_rpc_owner'
      or pg_catalog.array_to_string(function_record.proconfig, ',') not in ('search_path=', 'search_path=""')
      or (function_name in ('get_schema_candidate_drift_evidence', 'get_schema_candidate_compile')
        and function_record.provolatile <> 's')
      or (function_name not in ('get_schema_candidate_drift_evidence', 'get_schema_candidate_compile')
        and function_record.provolatile <> 'v')
    then
      raise exception using errcode = 'P0001', message = 'SEMANTIC_CANDIDATE_COMPILE_FUNCTION_HARDENING_FAILED';
    end if;
  end loop;
end
$postconditions$;
