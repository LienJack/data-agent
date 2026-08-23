-- ============================================================
-- 10625: RLS, ownership, exact grants and static postconditions
-- ============================================================

alter table semantic.semantic_relationship_index_job owner to data_agent_u6_data_owner;
alter table semantic.semantic_relationship_index_attempt owner to data_agent_u6_data_owner;
alter table semantic.semantic_relationship_index_attempt_receipt owner to data_agent_u6_data_owner;
alter table semantic.semantic_relationship_index_checkpoint owner to data_agent_u6_data_owner;

alter table semantic.semantic_relationship_index_job enable row level security;
alter table semantic.semantic_relationship_index_job force row level security;
alter table semantic.semantic_relationship_index_attempt enable row level security;
alter table semantic.semantic_relationship_index_attempt force row level security;
alter table semantic.semantic_relationship_index_attempt_receipt enable row level security;
alter table semantic.semantic_relationship_index_attempt_receipt force row level security;
alter table semantic.semantic_relationship_index_checkpoint enable row level security;
alter table semantic.semantic_relationship_index_checkpoint force row level security;

create policy semantic_relationship_index_job_rpc_scope_policy
  on semantic.semantic_relationship_index_job
  for all
  to data_agent_u6_rpc_owner
  using (
    app_id = nullif(pg_catalog.current_setting('data_agent.app_id', true), '')::uuid
    and tenant_id = nullif(pg_catalog.current_setting('data_agent.tenant_id', true), '')::uuid
    and environment = nullif(pg_catalog.current_setting('data_agent.environment', true), '')
    and semantic_domain = nullif(pg_catalog.current_setting('app.semantic_domain', true), '')
  )
  with check (
    app_id = nullif(pg_catalog.current_setting('data_agent.app_id', true), '')::uuid
    and tenant_id = nullif(pg_catalog.current_setting('data_agent.tenant_id', true), '')::uuid
    and environment = nullif(pg_catalog.current_setting('data_agent.environment', true), '')
    and semantic_domain = nullif(pg_catalog.current_setting('app.semantic_domain', true), '')
  );

create policy semantic_relationship_index_attempt_rpc_scope_policy
  on semantic.semantic_relationship_index_attempt
  for all
  to data_agent_u6_rpc_owner
  using (
    app_id = nullif(pg_catalog.current_setting('data_agent.app_id', true), '')::uuid
    and tenant_id = nullif(pg_catalog.current_setting('data_agent.tenant_id', true), '')::uuid
    and environment = nullif(pg_catalog.current_setting('data_agent.environment', true), '')
    and semantic_domain = nullif(pg_catalog.current_setting('app.semantic_domain', true), '')
  )
  with check (
    app_id = nullif(pg_catalog.current_setting('data_agent.app_id', true), '')::uuid
    and tenant_id = nullif(pg_catalog.current_setting('data_agent.tenant_id', true), '')::uuid
    and environment = nullif(pg_catalog.current_setting('data_agent.environment', true), '')
    and semantic_domain = nullif(pg_catalog.current_setting('app.semantic_domain', true), '')
  );

create policy semantic_relationship_index_checkpoint_rpc_scope_policy
  on semantic.semantic_relationship_index_checkpoint
  for all
  to data_agent_u6_rpc_owner
  using (
    app_id = nullif(pg_catalog.current_setting('data_agent.app_id', true), '')::uuid
    and tenant_id = nullif(pg_catalog.current_setting('data_agent.tenant_id', true), '')::uuid
    and environment = nullif(pg_catalog.current_setting('data_agent.environment', true), '')
    and semantic_domain = nullif(pg_catalog.current_setting('app.semantic_domain', true), '')
  )
  with check (
    app_id = nullif(pg_catalog.current_setting('data_agent.app_id', true), '')::uuid
    and tenant_id = nullif(pg_catalog.current_setting('data_agent.tenant_id', true), '')::uuid
    and environment = nullif(pg_catalog.current_setting('data_agent.environment', true), '')
    and semantic_domain = nullif(pg_catalog.current_setting('app.semantic_domain', true), '')
  );

create policy semantic_relationship_index_attempt_receipt_rpc_scope_policy
  on semantic.semantic_relationship_index_attempt_receipt
  for all
  to data_agent_u6_rpc_owner
  using (
    app_id = nullif(pg_catalog.current_setting('data_agent.app_id', true), '')::uuid
    and tenant_id = nullif(pg_catalog.current_setting('data_agent.tenant_id', true), '')::uuid
    and environment = nullif(pg_catalog.current_setting('data_agent.environment', true), '')
    and semantic_domain = nullif(pg_catalog.current_setting('app.semantic_domain', true), '')
  )
  with check (
    app_id = nullif(pg_catalog.current_setting('data_agent.app_id', true), '')::uuid
    and tenant_id = nullif(pg_catalog.current_setting('data_agent.tenant_id', true), '')::uuid
    and environment = nullif(pg_catalog.current_setting('data_agent.environment', true), '')
    and semantic_domain = nullif(pg_catalog.current_setting('app.semantic_domain', true), '')
  );

create policy semantic_outbox_relationship_index_scope_policy
  on semantic.semantic_outbox
  for select
  to data_agent_u6_rpc_owner
  using (
    app_id = nullif(pg_catalog.current_setting('data_agent.app_id', true), '')::uuid
    and tenant_id = nullif(pg_catalog.current_setting('data_agent.tenant_id', true), '')::uuid
    and environment = nullif(pg_catalog.current_setting('data_agent.environment', true), '')
    and semantic_domain = nullif(pg_catalog.current_setting('app.semantic_domain', true), '')
  );

grant select, insert, update on table semantic.semantic_relationship_index_job to data_agent_u6_rpc_owner;
grant select, insert on table semantic.semantic_relationship_index_attempt to data_agent_u6_rpc_owner;
grant select, insert on table semantic.semantic_relationship_index_attempt_receipt to data_agent_u6_rpc_owner;
grant select, insert, update on table semantic.semantic_relationship_index_checkpoint to data_agent_u6_rpc_owner;
grant select on table semantic.semantic_outbox to data_agent_u6_rpc_owner;

alter function semantic.reconcile_relationship_index_jobs(uuid, uuid, text, uuid, text)
  owner to data_agent_u6_rpc_owner;
alter function semantic.claim_relationship_index_job(uuid, uuid, text, uuid, text, uuid, integer)
  owner to data_agent_u6_rpc_owner;
alter function semantic.heartbeat_relationship_index_attempt(uuid, uuid, text, uuid, text, uuid, bigint, uuid, integer)
  owner to data_agent_u6_rpc_owner;
alter function semantic.commit_relationship_index_attempt(uuid, uuid, text, uuid, text, uuid, bigint, uuid, uuid, text, text, text, integer, integer)
  owner to data_agent_u6_rpc_owner;
alter function semantic.requeue_relationship_index_release(uuid, uuid, text, uuid, text, uuid, uuid, text, text)
  owner to data_agent_u6_rpc_owner;
alter function semantic.fail_relationship_index_attempt(uuid, uuid, text, uuid, text, uuid, bigint, uuid, text)
  owner to data_agent_u6_rpc_owner;
alter function semantic.get_relationship_index_checkpoint(uuid, uuid, text, uuid, text, uuid)
  owner to data_agent_u6_rpc_owner;

revoke all on function semantic.reconcile_relationship_index_jobs(uuid, uuid, text, uuid, text) from public;
revoke all on function semantic.claim_relationship_index_job(uuid, uuid, text, uuid, text, uuid, integer) from public;
revoke all on function semantic.heartbeat_relationship_index_attempt(uuid, uuid, text, uuid, text, uuid, bigint, uuid, integer) from public;
revoke all on function semantic.commit_relationship_index_attempt(uuid, uuid, text, uuid, text, uuid, bigint, uuid, uuid, text, text, text, integer, integer) from public;
revoke all on function semantic.requeue_relationship_index_release(uuid, uuid, text, uuid, text, uuid, uuid, text, text) from public;
revoke all on function semantic.fail_relationship_index_attempt(uuid, uuid, text, uuid, text, uuid, bigint, uuid, text) from public;
revoke all on function semantic.get_relationship_index_checkpoint(uuid, uuid, text, uuid, text, uuid) from public;

grant execute on function semantic.reconcile_relationship_index_jobs(uuid, uuid, text, uuid, text)
  to data_agent_backend;
grant execute on function semantic.claim_relationship_index_job(uuid, uuid, text, uuid, text, uuid, integer)
  to data_agent_backend;
grant execute on function semantic.heartbeat_relationship_index_attempt(uuid, uuid, text, uuid, text, uuid, bigint, uuid, integer)
  to data_agent_backend;
grant execute on function semantic.commit_relationship_index_attempt(uuid, uuid, text, uuid, text, uuid, bigint, uuid, uuid, text, text, text, integer, integer)
  to data_agent_backend;
grant execute on function semantic.requeue_relationship_index_release(uuid, uuid, text, uuid, text, uuid, uuid, text, text)
  to data_agent_backend;
grant execute on function semantic.fail_relationship_index_attempt(uuid, uuid, text, uuid, text, uuid, bigint, uuid, text)
  to data_agent_backend;
grant execute on function semantic.get_relationship_index_checkpoint(uuid, uuid, text, uuid, text, uuid)
  to data_agent_backend;

revoke all on table semantic.semantic_relationship_index_job from data_agent_backend;
revoke all on table semantic.semantic_relationship_index_attempt from data_agent_backend;
revoke all on table semantic.semantic_relationship_index_attempt_receipt from data_agent_backend;
revoke all on table semantic.semantic_relationship_index_checkpoint from data_agent_backend;

do $postconditions$
declare
  relation_name text;
  function_name text;
  function_record record;
begin
  foreach relation_name in array array[
    'semantic_relationship_index_job',
    'semantic_relationship_index_attempt',
    'semantic_relationship_index_attempt_receipt',
    'semantic_relationship_index_checkpoint'
  ] loop
    if pg_catalog.has_table_privilege(
      'data_agent_backend', pg_catalog.format('semantic.%I', relation_name), 'SELECT'
    ) or pg_catalog.has_table_privilege(
      'data_agent_backend', pg_catalog.format('semantic.%I', relation_name), 'INSERT'
    ) or pg_catalog.has_table_privilege(
      'data_agent_backend', pg_catalog.format('semantic.%I', relation_name), 'UPDATE'
    ) or pg_catalog.has_table_privilege(
      'data_agent_backend', pg_catalog.format('semantic.%I', relation_name), 'DELETE'
    ) then
      raise exception using errcode = 'P0001', message = 'SEMANTIC_RELATIONSHIP_INDEX_BACKEND_TABLE_ACL_FAILED';
    end if;
    if not pg_catalog.has_table_privilege(
      'data_agent_u6_rpc_owner', pg_catalog.format('semantic.%I', relation_name), 'SELECT'
    ) or not pg_catalog.has_table_privilege(
      'data_agent_u6_rpc_owner', pg_catalog.format('semantic.%I', relation_name), 'INSERT'
    ) or (
      relation_name in ('semantic_relationship_index_job', 'semantic_relationship_index_checkpoint')
      and not pg_catalog.has_table_privilege(
        'data_agent_u6_rpc_owner', pg_catalog.format('semantic.%I', relation_name), 'UPDATE'
      )
    ) or (
      relation_name in ('semantic_relationship_index_attempt', 'semantic_relationship_index_attempt_receipt')
      and pg_catalog.has_table_privilege(
        'data_agent_u6_rpc_owner', pg_catalog.format('semantic.%I', relation_name), 'UPDATE'
      )
    ) or pg_catalog.has_table_privilege(
      'data_agent_u6_rpc_owner', pg_catalog.format('semantic.%I', relation_name), 'DELETE'
    ) then
      raise exception using errcode = 'P0001', message = 'SEMANTIC_RELATIONSHIP_INDEX_RPC_OWNER_TABLE_ACL_FAILED';
    end if;
  end loop;

  foreach function_name in array array[
    'reconcile_relationship_index_jobs',
    'claim_relationship_index_job',
    'heartbeat_relationship_index_attempt',
    'commit_relationship_index_attempt',
    'requeue_relationship_index_release',
    'fail_relationship_index_attempt',
    'get_relationship_index_checkpoint'
  ] loop
    select
      procedure.prosecdef,
      procedure.proconfig,
      procedure.provolatile,
      owner.rolname as owner_name
    into function_record
    from pg_catalog.pg_proc as procedure
    join pg_catalog.pg_namespace as namespace on namespace.oid = procedure.pronamespace
    join pg_catalog.pg_roles as owner on owner.oid = procedure.proowner
    where namespace.nspname = 'semantic'
      and procedure.proname = function_name;
    if not found
      or not function_record.prosecdef
      or function_record.owner_name <> 'data_agent_u6_rpc_owner'
      or pg_catalog.array_to_string(function_record.proconfig, ',') not in ('search_path=', 'search_path=""')
      or (
        function_name = 'get_relationship_index_checkpoint'
        and function_record.provolatile <> 's'
      )
      or (
        function_name <> 'get_relationship_index_checkpoint'
        and function_record.provolatile <> 'v'
      )
    then
      raise exception using errcode = 'P0001', message = 'SEMANTIC_RELATIONSHIP_INDEX_RPC_POSTCONDITION_FAILED';
    end if;
  end loop;

  if not pg_catalog.has_function_privilege(
    'data_agent_backend',
    'semantic.get_relationship_index_checkpoint(uuid,uuid,text,uuid,text,uuid)',
    'EXECUTE'
  ) or pg_catalog.has_function_privilege(
    'authenticated',
    'semantic.get_relationship_index_checkpoint(uuid,uuid,text,uuid,text,uuid)',
    'EXECUTE'
  ) or pg_catalog.has_function_privilege(
    'authenticated',
    'semantic.claim_relationship_index_job(uuid,uuid,text,uuid,text,uuid,integer)',
    'EXECUTE'
  ) then
    raise exception using errcode = 'P0001', message = 'SEMANTIC_RELATIONSHIP_INDEX_RPC_ACL_POSTCONDITION_FAILED';
  end if;

  if (
    select pg_catalog.count(*)
    from pg_catalog.pg_policies as policy
    where policy.schemaname = 'semantic'
      and policy.policyname in (
        'semantic_relationship_index_job_rpc_scope_policy',
        'semantic_relationship_index_attempt_rpc_scope_policy',
        'semantic_relationship_index_attempt_receipt_rpc_scope_policy',
        'semantic_relationship_index_checkpoint_rpc_scope_policy'
      )
      and policy.roles = array['data_agent_u6_rpc_owner']::name[]
      and policy.qual like '%semantic_domain%'
  ) <> 4 then
    raise exception using errcode = 'P0001', message = 'SEMANTIC_RELATIONSHIP_INDEX_RLS_POSTCONDITION_FAILED';
  end if;
  if not exists (
    select 1
    from pg_catalog.pg_policies as policy
    where policy.schemaname = 'semantic'
      and policy.policyname = 'semantic_outbox_relationship_index_scope_policy'
      and policy.roles = array['data_agent_u6_rpc_owner']::name[]
      and policy.qual like '%semantic_domain%'
  ) then
    raise exception using errcode = 'P0001', message = 'SEMANTIC_RELATIONSHIP_INDEX_OUTBOX_RLS_POSTCONDITION_FAILED';
  end if;
end
$postconditions$;
