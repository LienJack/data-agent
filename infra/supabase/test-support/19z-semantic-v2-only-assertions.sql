do $assertions$
begin
  if exists (
    select 1 from pg_catalog.pg_class as cls
    join pg_catalog.pg_namespace as nsp on nsp.oid=cls.relnamespace
    where nsp.nspname='semantic' and cls.relname like 'semantic_legacy_%'
  ) then raise exception 'SEMANTIC_V2_ONLY_ASSERTION_LEGACY_TABLE_PRESENT'; end if;
  if exists (
    select 1 from information_schema.columns
    where table_schema='semantic' and column_name in (
      'conditional_legacy_plan','committed_legacy_attempt_ref','runtime_mode',
      'rollback_window_status','legacy_contract_status','closure_authorization_digest'
    )
  ) then raise exception 'SEMANTIC_V2_ONLY_ASSERTION_LEGACY_COLUMN_PRESENT'; end if;
  if exists (
    select 1 from pg_catalog.pg_proc as proc
    join pg_catalog.pg_namespace as nsp on nsp.oid=proc.pronamespace
    where nsp.nspname='semantic'
      and proc.prokind in ('f','p')
      and pg_catalog.pg_get_functiondef(proc.oid) ~* 'legacy_(equivalence|closure|compatible)|conditional_legacy|committed_legacy|runtime_mode|rollback_window_status|legacy_contract_status|closure_authorization_digest'
  ) then raise exception 'SEMANTIC_V2_ONLY_ASSERTION_LEGACY_FUNCTION_PRESENT'; end if;
  if to_regprocedure('semantic.self_review_and_publish_semantic_candidate(jsonb)') is not null
    or exists (select 1 from pg_catalog.pg_roles where rolname='data_agent_u5_self_publish_owner')
    or to_regclass('semantic.semantic_candidate_self_publish_idempotency') is not null
  then raise exception 'SEMANTIC_V2_ONLY_ASSERTION_SELF_PUBLISH_PRESENT'; end if;
  if to_regprocedure(
    'semantic.prepare_publish_attempt(uuid,uuid,text,text,uuid,uuid,text,bigint,bigint,bigint,text)'
  ) is null or to_regprocedure(
    'semantic.commit_publish_attempt(uuid,uuid,text,text,uuid,uuid,text,uuid,text,uuid,text,jsonb)'
  ) is null then raise exception 'SEMANTIC_V2_ONLY_ASSERTION_PUBLISH_RPC_MISSING'; end if;
end
$assertions$;

do $strict_commands$
begin
  begin
    perform semantic.human_prepare_publish_attempt(pg_catalog.jsonb_build_object(
      'schema_version','human-prepare-publish-attempt@1.0.0',
      'scope',pg_catalog.jsonb_build_object(
        'app_id','00000000-0000-4000-8000-00000000da01',
        'tenant_id','00000000-0000-4000-8000-000000000001',
        'workspace_id','00000000-0000-4000-8000-000000000001',
        'environment','test'
      ),
      'semantic_domain','v2_only_probe',
      'packet_id','00000000-0000-4000-8000-000000000002',
      'candidate_id','00000000-0000-4000-8000-000000000003',
      'compiler_bundle_digest','sha256:'||pg_catalog.repeat('a',64),
      'catalog_fence_epoch',1,
      'dependency_generation',1,
      'target_generation',1,
      'idempotency_digest','sha256:'||pg_catalog.repeat('b',64),
      'conditional_legacy_plan',pg_catalog.jsonb_build_object('forbidden',true)
    ));
    raise exception 'SEMANTIC_V2_ONLY_ASSERTION_LEGACY_COMMAND_ACCEPTED';
  exception when others then
    if sqlerrm <> 'SEMANTIC_HUMAN_PREPARE_COMMAND_INVALID' then raise; end if;
  end;
end
$strict_commands$;
