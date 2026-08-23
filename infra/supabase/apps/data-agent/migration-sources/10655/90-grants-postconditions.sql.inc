-- ============================================================
-- Ownership, FORCE RLS, exact grants and postconditions.
-- ============================================================

alter table semantic.ontology_package_candidates owner to data_agent_u4_data_owner;
alter table semantic.ontology_package_validation_receipts owner to data_agent_u4_data_owner;
alter table semantic.ontology_package_preview_bindings owner to data_agent_u4_data_owner;

alter table semantic.ontology_package_candidates enable row level security;
alter table semantic.ontology_package_candidates force row level security;
alter table semantic.ontology_package_validation_receipts enable row level security;
alter table semantic.ontology_package_validation_receipts force row level security;
alter table semantic.ontology_package_preview_bindings enable row level security;
alter table semantic.ontology_package_preview_bindings force row level security;

create policy ontology_package_candidates_rpc_owner
on semantic.ontology_package_candidates for all to data_agent_u4_rpc_owner
using (true) with check (true);
create policy ontology_package_validation_rpc_owner
on semantic.ontology_package_validation_receipts for all to data_agent_u4_rpc_owner
using (true) with check (true);
create policy ontology_package_preview_rpc_owner
on semantic.ontology_package_preview_bindings for all to data_agent_u4_rpc_owner
using (true) with check (true);

create policy ontology_package_candidate_revision_read
on semantic.semantic_candidate_revision for select to data_agent_u4_rpc_owner
using (
  app_id = nullif(pg_catalog.current_setting('data_agent.app_id',true),'')::uuid
  and tenant_id = nullif(pg_catalog.current_setting('data_agent.tenant_id',true),'')::uuid
  and environment = nullif(pg_catalog.current_setting('data_agent.environment',true),'')
  and semantic_domain = nullif(pg_catalog.current_setting('app.semantic_domain',true),'')
);
create policy ontology_package_graph_projection_read
on semantic.semantic_graph_projection for select to data_agent_u4_rpc_owner
using (
  app_id = nullif(pg_catalog.current_setting('data_agent.app_id',true),'')::uuid
  and tenant_id = nullif(pg_catalog.current_setting('data_agent.tenant_id',true),'')::uuid
  and environment = nullif(pg_catalog.current_setting('data_agent.environment',true),'')
  and semantic_domain = nullif(pg_catalog.current_setting('app.semantic_domain',true),'')
);

grant usage on schema semantic to data_agent_u4_data_owner;
grant usage on schema semantic,platform,app_data_agent to data_agent_u4_rpc_owner;
grant select,insert on table
  semantic.ontology_package_candidates,
  semantic.ontology_package_validation_receipts,
  semantic.ontology_package_preview_bindings
to data_agent_u4_rpc_owner;
grant select on table semantic.semantic_candidate_revision,semantic.semantic_graph_projection
to data_agent_u4_rpc_owner;
grant execute on function
  semantic.assert_explorer_scope(uuid,uuid,text,uuid,text),
  semantic.lock_semantic_authority_fence(uuid,uuid,text,text),
  semantic.ontology_package_json_has_exact_keys(jsonb,text[]),
  semantic.assert_ontology_package_document(uuid,uuid,text,text,jsonb),
  app_data_agent.u2_canonical_sha256(jsonb),
  app_data_agent.contains_potential_plaintext_secret(jsonb,text)
to data_agent_u4_rpc_owner;

alter function semantic.commit_ontology_package_candidate(uuid,uuid,text,uuid,text,uuid,uuid,jsonb)
  owner to data_agent_u4_rpc_owner;
alter function semantic.commit_ontology_package_validation(uuid,uuid,text,uuid,text,jsonb)
  owner to data_agent_u4_rpc_owner;
alter function semantic.bind_ontology_package_preview(uuid,uuid,text,uuid,text,jsonb)
  owner to data_agent_u4_rpc_owner;
alter function semantic.get_ontology_package_preview(uuid,uuid,text,uuid,text,uuid,bigint)
  owner to data_agent_u4_rpc_owner;

revoke all on function semantic.commit_ontology_package_candidate(uuid,uuid,text,uuid,text,uuid,uuid,jsonb) from public;
revoke all on function semantic.commit_ontology_package_validation(uuid,uuid,text,uuid,text,jsonb) from public;
revoke all on function semantic.bind_ontology_package_preview(uuid,uuid,text,uuid,text,jsonb) from public;
revoke all on function semantic.get_ontology_package_preview(uuid,uuid,text,uuid,text,uuid,bigint) from public;
grant execute on function semantic.commit_ontology_package_candidate(uuid,uuid,text,uuid,text,uuid,uuid,jsonb)
  to data_agent_backend;
grant execute on function semantic.commit_ontology_package_validation(uuid,uuid,text,uuid,text,jsonb)
  to data_agent_backend;
grant execute on function semantic.bind_ontology_package_preview(uuid,uuid,text,uuid,text,jsonb)
  to data_agent_backend;
grant execute on function semantic.get_ontology_package_preview(uuid,uuid,text,uuid,text,uuid,bigint)
  to data_agent_backend;

revoke all on table
  semantic.ontology_package_candidates,
  semantic.ontology_package_validation_receipts,
  semantic.ontology_package_preview_bindings
from public,anon,authenticated,service_role,data_agent_backend,data_agent_job_authority;

do $postconditions$
declare
  relation_name text;
  function_name text;
  function_record record;
begin
  foreach relation_name in array array[
    'ontology_package_candidates','ontology_package_validation_receipts',
    'ontology_package_preview_bindings'
  ] loop
    if not (select class.relrowsecurity and class.relforcerowsecurity
      from pg_catalog.pg_class as class
      join pg_catalog.pg_namespace as namespace on namespace.oid = class.relnamespace
      where namespace.nspname = 'semantic' and class.relname = relation_name)
    then
      raise exception using errcode = 'P0001', message = 'ONTOLOGY_PACKAGE_RLS_POSTCONDITION_FAILED';
    end if;
    if not pg_catalog.has_table_privilege('data_agent_u4_rpc_owner','semantic.' || relation_name,'SELECT')
      or not pg_catalog.has_table_privilege('data_agent_u4_rpc_owner','semantic.' || relation_name,'INSERT')
      or pg_catalog.has_table_privilege('data_agent_backend','semantic.' || relation_name,'SELECT')
      or pg_catalog.has_table_privilege('data_agent_backend','semantic.' || relation_name,'INSERT')
    then
      raise exception using errcode = 'P0001', message = 'ONTOLOGY_PACKAGE_GRANT_POSTCONDITION_FAILED';
    end if;
  end loop;
  if exists (
    select 1 from pg_catalog.pg_roles
    where rolname in ('data_agent_u4_data_owner','data_agent_u4_rpc_owner')
      and (rolcanlogin or rolsuper or rolcreatedb or rolcreaterole or rolreplication or rolinherit)
  ) then
    raise exception using errcode = 'P0001', message = 'ONTOLOGY_PACKAGE_ROLE_POSTCONDITION_FAILED';
  end if;
  foreach function_name in array array[
    'commit_ontology_package_candidate','commit_ontology_package_validation',
    'bind_ontology_package_preview','get_ontology_package_preview'
  ] loop
    select procedure.prosecdef,procedure.proconfig,procedure.provolatile,owner.rolname as owner_name
    into function_record
    from pg_catalog.pg_proc as procedure
    join pg_catalog.pg_namespace as namespace on namespace.oid = procedure.pronamespace
    join pg_catalog.pg_roles as owner on owner.oid = procedure.proowner
    where namespace.nspname = 'semantic' and procedure.proname = function_name;
    if not found or not function_record.prosecdef
      or function_record.owner_name <> 'data_agent_u4_rpc_owner'
      or pg_catalog.array_to_string(function_record.proconfig,',') not in ('search_path=','search_path=""')
      or (function_name = 'get_ontology_package_preview' and function_record.provolatile <> 's')
      or (function_name <> 'get_ontology_package_preview' and function_record.provolatile <> 'v')
    then
      raise exception using errcode = 'P0001', message = 'ONTOLOGY_PACKAGE_RPC_POSTCONDITION_FAILED';
    end if;
  end loop;
end
$postconditions$;
