-- qa_admin_audit_failure_repair_migration_checksum: sha256:a37895d18021f7f5d82441960f0a07dc311dc08177a73355c08558ca4f151896
-- 10677 maps every receipt insert failure to one stable fail-closed public marker.
begin;

do $bootstrap$
begin
  if pg_catalog.current_setting('server_version_num')::integer not between 170000 and 179999 then
    raise exception using errcode='0A000',message='QA_ADMIN_AUDIT_FAILURE_REPAIR_POSTGRES_VERSION_UNSUPPORTED';
  end if;
  if session_user<>'postgres' or current_user<>'postgres' then
    raise exception using errcode='42501',message='QA_ADMIN_AUDIT_FAILURE_REPAIR_EXECUTOR_UNSAFE';
  end if;
  if not exists(select 1 from platform.migration_ledger where owner_kind='app'
    and app_id='00000000-0000-4000-8000-00000000da01'::uuid
    and migration_version='20260725010676_app_data_agent_qa_admin_audit_coalesce_repair')
  then raise exception using errcode='P0001',message='QA_ADMIN_AUDIT_FAILURE_REPAIR_BASELINE_10676_MISSING'; end if;
end
$bootstrap$;

set local lock_timeout='2000ms';
set local statement_timeout='300000ms';
set local idle_in_transaction_session_timeout='60000ms';
select platform.acquire_migration_lock('app','00000000-0000-4000-8000-00000000da01'::uuid);
select platform.assert_migration_checksum(
  'app','00000000-0000-4000-8000-00000000da01'::uuid,
  '20260725010677_app_data_agent_qa_admin_audit_failure_repair',
  'sha256:a37895d18021f7f5d82441960f0a07dc311dc08177a73355c08558ca4f151896');

create or replace function app_data_agent.qa_admin_audit_receipt(
  request_document jsonb,requested_operation text,requested_reason text,
  requested_owner uuid,requested_resource_kind text,requested_resource_id uuid,
  requested_result_classification text default 'AUTHORIZED')
returns jsonb language plpgsql volatile security definer set search_path='' as $function$
declare authority record; receipt_id uuid:=pg_catalog.gen_random_uuid(); occurred timestamptz:=pg_catalog.clock_timestamp();
  request_digest text;
begin
  select * into authority from platform.resolve_qa_admin_audit_scope((request_document->>'workspace_id')::uuid);
  request_digest:=app_data_agent.u2_canonical_sha256(request_document);
  begin
    insert into app_data_agent.qa_admin_conversation_audit_receipts(
      app_id,tenant_id,environment,receipt_id,actor_principal_id,actor_role,
      target_owner_principal_id,resource_kind,resource_id,operation_kind,reason_code,
      request_digest,result_classification,occurred_at)
    values(authority.app_id,authority.tenant_id,authority.environment,receipt_id,
      authority.actor_principal_id,authority.actor_role,requested_owner,requested_resource_kind,
      requested_resource_id,requested_operation,requested_reason,request_digest,
      requested_result_classification,occurred);
  exception when others then
    raise exception using errcode='P0001',message='QA_ADMIN_AUDIT_UNAVAILABLE';
  end;
  return pg_catalog.jsonb_build_object(
    'schema_version','qa-admin-audit-receipt-ref@1.0.0','receipt_id',receipt_id,
    'operation',requested_operation,'reason_code',requested_reason,
    'request_digest',request_digest,'occurred_at',occurred);
end
$function$;

do $postconditions$
declare target regprocedure:=pg_catalog.to_regprocedure(
  'app_data_agent.qa_admin_audit_receipt(jsonb,text,text,uuid,text,uuid,text)');
  definition text;
begin
  select pg_catalog.pg_get_functiondef(target) into definition;
  if target is null
    or pg_catalog.strpos(definition,'QA_ADMIN_AUDIT_UNAVAILABLE')=0
    or not exists(select 1 from pg_catalog.pg_proc where oid=target and prosecdef and provolatile='v'
      and proconfig=array['search_path=""'])
  then raise exception using errcode='P0001',message='QA_ADMIN_AUDIT_FAILURE_REPAIR_POSTCONDITION_FAILED'; end if;
end
$postconditions$;

commit;
