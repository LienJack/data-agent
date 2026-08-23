alter function semantic.prepare_publish_attempt(uuid,uuid,text,text,uuid,uuid,text,bigint,bigint,bigint,text)
  owner to data_agent_u5_human_governance_owner;
alter function semantic.commit_publish_attempt(uuid,uuid,text,text,uuid,uuid,text,uuid,text,uuid,text,jsonb)
  owner to data_agent_u5_human_governance_owner;
alter function semantic.human_prepare_publish_attempt(jsonb)
  owner to data_agent_u5_human_governance_owner;
alter function semantic.human_commit_publish_attempt(jsonb)
  owner to data_agent_u5_human_governance_owner;

revoke all on function
  semantic.prepare_publish_attempt(uuid,uuid,text,text,uuid,uuid,text,bigint,bigint,bigint,text),
  semantic.commit_publish_attempt(uuid,uuid,text,text,uuid,uuid,text,uuid,text,uuid,text,jsonb),
  semantic.human_prepare_publish_attempt(jsonb),
  semantic.human_commit_publish_attempt(jsonb)
from public,anon,authenticated,service_role,data_agent_backend;

grant execute on function
  semantic.human_prepare_publish_attempt(jsonb),
  semantic.human_commit_publish_attempt(jsonb)
to data_agent_backend;

do $postconditions$
begin
  if exists (
    select 1 from pg_catalog.pg_class as cls
    join pg_catalog.pg_namespace as nsp on nsp.oid=cls.relnamespace
    where nsp.nspname='semantic' and cls.relname in (
      'semantic_legacy_compatible_mirror','semantic_legacy_equivalence_receipt',
      'semantic_legacy_closure_authorization','semantic_legacy_equivalence_attempt',
      'semantic_candidate_self_publish_idempotency'
    )
  ) then raise exception 'SEMANTIC_V2_ONLY_TABLE_SURFACE_UNSAFE'; end if;
  if exists (
    select 1 from information_schema.columns
    where table_schema='semantic' and (
      (table_name='semantic_publish_attempt' and column_name in (
        'conditional_legacy_plan','committed_legacy_attempt_ref'
      )) or
      (table_name='semantic_runtime_activation' and column_name in (
        'runtime_mode','rollback_window_status','legacy_contract_status','closure_authorization_digest'
      ))
    )
  ) then raise exception 'SEMANTIC_V2_ONLY_COLUMN_SURFACE_UNSAFE'; end if;
  if exists (
    select 1 from pg_catalog.pg_proc as proc
    join pg_catalog.pg_namespace as nsp on nsp.oid=proc.pronamespace
    where nsp.nspname='semantic'
      and proc.prokind in ('f','p')
      and pg_catalog.pg_get_functiondef(proc.oid) ~* 'legacy_(equivalence|closure|compatible)|conditional_legacy|committed_legacy|runtime_mode|rollback_window_status|legacy_contract_status|closure_authorization_digest'
  ) then raise exception 'SEMANTIC_V2_ONLY_FUNCTION_SURFACE_UNSAFE'; end if;
  if pg_catalog.to_regprocedure('semantic.self_review_and_publish_semantic_candidate(jsonb)') is not null
    or exists (select 1 from pg_catalog.pg_roles where rolname='data_agent_u5_self_publish_owner')
  then raise exception 'SEMANTIC_V2_ONLY_SELF_PUBLISH_SURFACE_UNSAFE'; end if;
  if not exists (
    select 1 from semantic.semantic_v2_retirement_receipts
    where migration_version='20260725010704_app_data_agent_semantic_v2_only'
      and pg_catalog.jsonb_array_length(deleted_objects)=17
  ) then raise exception 'SEMANTIC_V2_ONLY_RETIREMENT_RECEIPT_MISSING'; end if;
  if pg_catalog.has_function_privilege(
    'anon','semantic.human_commit_publish_attempt(jsonb)','EXECUTE'
  ) or not pg_catalog.has_function_privilege(
    'data_agent_backend','semantic.human_commit_publish_attempt(jsonb)','EXECUTE'
  ) then raise exception 'SEMANTIC_V2_ONLY_EXECUTE_SURFACE_UNSAFE'; end if;
end
$postconditions$;
