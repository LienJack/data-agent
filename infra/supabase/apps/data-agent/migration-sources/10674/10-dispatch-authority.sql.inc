create table app_data_agent.agent_dispatch_rollout_policies (
  app_id uuid not null, tenant_id uuid not null, environment text not null,
  mode text not null check(mode in ('SHADOW','ENFORCED','ROOT_ONLY_DEFER_DATA')),
  version bigint not null check(version>0), policy_version text not null,
  updated_at timestamptz not null,
  primary key(app_id,tenant_id,environment)
);

create table app_data_agent.agent_dispatch_deferred_receipts (
  app_id uuid not null, tenant_id uuid not null, environment text not null,
  principal_id uuid not null, run_id uuid not null, idempotency_key text not null,
  question_hash text not null check(question_hash~'^sha256:[0-9a-f]{64}$'),
  receipt_hash text not null check(receipt_hash~'^sha256:[0-9a-f]{64}$'),
  receipt_json jsonb not null, committed_at timestamptz not null,
  primary key(app_id,tenant_id,environment,principal_id,run_id),
  unique(app_id,tenant_id,environment,principal_id,idempotency_key)
);

create table app_data_agent.agent_dispatch_execute_receipts (
  app_id uuid not null, tenant_id uuid not null, environment text not null,
  principal_id uuid not null, run_id uuid not null, idempotency_key text not null,
  receipt_hash text not null check(receipt_hash~'^sha256:[0-9a-f]{64}$'),
  receipt_json jsonb not null, shadow_plan_json jsonb,
  committed_at timestamptz not null,
  primary key(app_id,tenant_id,environment,principal_id,run_id),
  unique(app_id,tenant_id,environment,principal_id,idempotency_key),
  foreign key(app_id,tenant_id,environment,run_id)
    references app_data_agent.runs(app_id,tenant_id,environment,run_id)
    on delete restrict deferrable initially deferred
);

alter table app_data_agent.agent_dispatch_rollout_policies enable row level security;
alter table app_data_agent.agent_dispatch_rollout_policies force row level security;
alter table app_data_agent.agent_dispatch_deferred_receipts enable row level security;
alter table app_data_agent.agent_dispatch_deferred_receipts force row level security;
alter table app_data_agent.agent_dispatch_execute_receipts enable row level security;
alter table app_data_agent.agent_dispatch_execute_receipts force row level security;

create policy agent_dispatch_rollout_backend on app_data_agent.agent_dispatch_rollout_policies
  for all to data_agent_u19_team_owner
  using(platform.backend_context_matches(app_id,tenant_id,environment,true))
  with check(platform.backend_context_matches(app_id,tenant_id,environment,true));
create policy agent_dispatch_deferred_backend on app_data_agent.agent_dispatch_deferred_receipts
  for all to data_agent_u19_team_owner
  using(platform.backend_context_matches(app_id,tenant_id,environment,true)
    and principal_id=pg_catalog.current_setting('data_agent.principal_id')::uuid)
  with check(platform.backend_context_matches(app_id,tenant_id,environment,true)
    and principal_id=pg_catalog.current_setting('data_agent.principal_id')::uuid);
create policy agent_dispatch_execute_backend on app_data_agent.agent_dispatch_execute_receipts
  for all to data_agent_u19_team_owner
  using(platform.backend_context_matches(app_id,tenant_id,environment,true)
    and principal_id=pg_catalog.current_setting('data_agent.principal_id')::uuid)
  with check(platform.backend_context_matches(app_id,tenant_id,environment,true)
    and principal_id=pg_catalog.current_setting('data_agent.principal_id')::uuid);

create function app_data_agent.agent_dispatch_profile_refs_are_canonical(refs jsonb)
returns boolean language sql immutable set search_path='' as $function$
  select pg_catalog.jsonb_typeof(refs)='array'
    and pg_catalog.jsonb_array_length(refs) between 0 and 3
    and coalesce((select pg_catalog.bool_and(
      pg_catalog.jsonb_typeof(item)='object'
      and (select pg_catalog.count(*)=3 from pg_catalog.jsonb_object_keys(item))
      and item ?& array['profile_id','revision','revision_hash']
      and item->>'profile_id' in ('governed-text2sql-agent','report-writing-agent','semantic-management-agent')
      and pg_catalog.jsonb_typeof(item->'revision')='number'
      and item->>'revision'~'^[1-9][0-9]*$'
      and item->>'revision_hash'~'^sha256:[0-9a-f]{64}$')
      from pg_catalog.jsonb_array_elements(refs) item),true)
    and coalesce((select pg_catalog.array_agg(rank order by ordinal)=
        pg_catalog.array_agg(distinct rank order by rank)
      from (select case item->>'profile_id'
          when 'governed-text2sql-agent' then 1 when 'report-writing-agent' then 2 else 3 end rank,
          ordinal
        from pg_catalog.jsonb_array_elements(refs) with ordinality entry(item,ordinal)) ranked),true);
$function$;

create function app_data_agent.agent_dispatch_plan_ref_is_valid(ref jsonb)
returns boolean language sql immutable set search_path='' as $function$
  select pg_catalog.jsonb_typeof(ref)='object'
    and ref ?& array['plan_id','plan_hash']
    and (select pg_catalog.count(*)=2 from pg_catalog.jsonb_object_keys(ref))
    and app_data_agent.canonical_uuid_json_string_is_valid(ref->'plan_id')
    and ref->>'plan_hash'~'^sha256:[0-9a-f]{64}$';
$function$;

create function app_data_agent.agent_dispatch_direct_receipt_is_valid(
  receipt jsonb, policy_value text, capability_hash text)
returns boolean language sql immutable set search_path='' as $function$
  select pg_catalog.jsonb_typeof(receipt)='object'
    and receipt ?& array['schema_version','no_new_facts','no_governance_mutation','no_formal_report',
      'policy_version','capability_snapshot_hash','receipt_hash']
    and (select pg_catalog.count(*)=7 from pg_catalog.jsonb_object_keys(receipt))
    and receipt->>'schema_version'='direct-admissibility-receipt@1.0.0'
    and receipt->'no_new_facts'='true'::jsonb
    and receipt->'no_governance_mutation'='true'::jsonb
    and receipt->'no_formal_report'='true'::jsonb
    and receipt->>'policy_version'~'^[A-Za-z0-9][A-Za-z0-9._:@/+~-]{0,127}$'
    and receipt->>'capability_snapshot_hash'~'^sha256:[0-9a-f]{64}$'
    and receipt->>'policy_version'=policy_value
    and receipt->>'capability_snapshot_hash'=capability_hash
    and receipt->>'receipt_hash'=app_data_agent.u2_canonical_sha256(receipt-'receipt_hash'::text);
$function$;

create function app_data_agent.agent_dispatch_plan_is_valid(plan jsonb, requested_run_id text)
returns boolean language sql immutable set search_path='' as $function$
  select pg_catalog.jsonb_typeof(plan)='object'
    and plan ?& array['schema_version','plan_id','run_id','question_class','mode',
      'selected_profile_refs','dependency_edges','required_evidence','reason_codes',
      'capability_snapshot_hash','policy_version','direct_admissibility_receipt','plan_hash']
    and (select pg_catalog.count(*)=13 from pg_catalog.jsonb_object_keys(plan))
    and plan->>'schema_version'='agent-dispatch-plan@1.0.0'
    and app_data_agent.canonical_uuid_json_string_is_valid(plan->'plan_id')
    and app_data_agent.canonical_uuid_json_string_is_valid(plan->'run_id')
    and plan->>'run_id'=requested_run_id
    and plan->>'question_class' in ('EXPLANATION','SEMANTIC_READ','DATA_QUERY','REPORT','ATTRIBUTION')
    and plan->>'mode' in ('DIRECT','TEAM')
    and app_data_agent.agent_dispatch_profile_refs_are_canonical(plan->'selected_profile_refs')
    and pg_catalog.jsonb_typeof(plan->'dependency_edges')='array'
    and pg_catalog.jsonb_array_length(plan->'dependency_edges') between 0 and 8
    and not exists(select 1 from pg_catalog.jsonb_array_elements(plan->'dependency_edges') edge
      where pg_catalog.jsonb_typeof(edge)<>'object'
        or (select pg_catalog.count(*)<>3 from pg_catalog.jsonb_object_keys(edge))
        or not edge ?& array['from_profile_id','to_profile_id','evidence_requirement']
        or edge->>'from_profile_id'=edge->>'to_profile_id'
        or edge->>'evidence_requirement' not in ('DIRECT_PROVIDER_RECEIPT','FROZEN_SEMANTIC_RELEASE',
          'ACCEPTED_QUERY_EVIDENCE','ACCEPTED_REPORT_ARTIFACT')
        or not exists(select 1 from pg_catalog.jsonb_array_elements(plan->'selected_profile_refs') ref
          where ref->>'profile_id'=edge->>'from_profile_id')
        or not exists(select 1 from pg_catalog.jsonb_array_elements(plan->'selected_profile_refs') ref
          where ref->>'profile_id'=edge->>'to_profile_id'))
    and not exists(select 1 from pg_catalog.jsonb_array_elements(plan->'dependency_edges') edge
      group by edge->>'from_profile_id',edge->>'to_profile_id',edge->>'evidence_requirement'
      having pg_catalog.count(*)>1)
    and coalesce((select pg_catalog.array_agg(edge_key order by ordinal)=
        pg_catalog.array_agg(distinct edge_key order by edge_key)
      from (select (case edges.edge_json->>'from_profile_id' when 'governed-text2sql-agent' then '1'
          when 'report-writing-agent' then '2' else '3' end)||':'||
          (case edges.edge_json->>'to_profile_id' when 'governed-text2sql-agent' then '1'
          when 'report-writing-agent' then '2' else '3' end)||':'||
          (edges.edge_json->>'evidence_requirement') as edge_key,edges.ordinal
        from pg_catalog.jsonb_array_elements(plan->'dependency_edges')
          with ordinality as edges(edge_json,ordinal)) canonical_edges),true)
    and not exists(with recursive paths(origin,target) as (
      select edge->>'from_profile_id',edge->>'to_profile_id'
      from pg_catalog.jsonb_array_elements(plan->'dependency_edges') edge
      union
      select paths.origin,edge->>'to_profile_id' from paths
      join pg_catalog.jsonb_array_elements(plan->'dependency_edges') edge
        on edge->>'from_profile_id'=paths.target)
      select 1 from paths where origin=target)
    and pg_catalog.jsonb_typeof(plan->'required_evidence')='array'
    and pg_catalog.jsonb_array_length(plan->'required_evidence') between 1 and 4
    and (select pg_catalog.array_agg(value#>>'{}' order by ordinal)=
        pg_catalog.array_agg(distinct value#>>'{}' order by value#>>'{}')
      from pg_catalog.jsonb_array_elements(plan->'required_evidence') with ordinality item(value,ordinal))
    and not exists(select 1 from pg_catalog.jsonb_array_elements(plan->'required_evidence') value
      where pg_catalog.jsonb_typeof(value)<>'string'
        or value#>>'{}' not in ('DIRECT_PROVIDER_RECEIPT','FROZEN_SEMANTIC_RELEASE',
        'ACCEPTED_QUERY_EVIDENCE','ACCEPTED_REPORT_ARTIFACT'))
    and pg_catalog.jsonb_typeof(plan->'reason_codes')='array'
    and pg_catalog.jsonb_array_length(plan->'reason_codes') between 1 and 16
    and (select pg_catalog.array_agg(value#>>'{}' order by ordinal)=
        pg_catalog.array_agg(distinct value#>>'{}' order by value#>>'{}')
      from pg_catalog.jsonb_array_elements(plan->'reason_codes') with ordinality item(value,ordinal))
    and not exists(select 1 from pg_catalog.jsonb_array_elements(plan->'reason_codes') value
      where pg_catalog.jsonb_typeof(value)<>'string'
        or value#>>'{}'!~'^[A-Z][A-Z0-9_]*$'
        or pg_catalog.length(value#>>'{}')>128)
    and plan->>'capability_snapshot_hash'~'^sha256:[0-9a-f]{64}$'
    and plan->>'policy_version'~'^[A-Za-z0-9][A-Za-z0-9._:@/+~-]{0,127}$'
    and plan->>'plan_hash'=app_data_agent.u2_canonical_sha256(plan-'plan_hash'::text)
    and ((plan->>'mode'='DIRECT' and plan->>'question_class'='EXPLANATION'
      and pg_catalog.jsonb_array_length(plan->'selected_profile_refs')=0
      and pg_catalog.jsonb_array_length(plan->'dependency_edges')=0
      and plan->'required_evidence'='["DIRECT_PROVIDER_RECEIPT"]'::jsonb
      and app_data_agent.agent_dispatch_direct_receipt_is_valid(
        plan->'direct_admissibility_receipt',plan->>'policy_version',plan->>'capability_snapshot_hash'))
      or (plan->>'mode'='TEAM' and pg_catalog.jsonb_array_length(plan->'selected_profile_refs')>0
        and plan->'direct_admissibility_receipt'='null'::jsonb))
    and (not exists(select 1 from pg_catalog.jsonb_array_elements(plan->'selected_profile_refs') ref
        where ref->>'profile_id'='report-writing-agent')
      or (exists(select 1 from pg_catalog.jsonb_array_elements(plan->'selected_profile_refs') ref
          where ref->>'profile_id'='governed-text2sql-agent')
        and exists(select 1 from pg_catalog.jsonb_array_elements(plan->'dependency_edges') edge
          where edge->>'from_profile_id'='governed-text2sql-agent'
            and edge->>'to_profile_id'='report-writing-agent'
            and edge->>'evidence_requirement'='ACCEPTED_QUERY_EVIDENCE')));
$function$;

create function app_data_agent.agent_dispatch_binding_is_valid(
  plan jsonb, binding jsonb, requested_run_id text)
returns boolean language sql immutable set search_path='' as $function$
  select app_data_agent.agent_dispatch_plan_is_valid(plan,requested_run_id)
    and pg_catalog.jsonb_typeof(binding)='object'
    and binding ?& array['schema_version','run_id','effective_executor_version','dispatch_plan_ref',
      'selected_profile_refs','policy_version','capability_snapshot_hash','shadow_dispatch_plan_ref','binding_hash']
    and (select pg_catalog.count(*)=9 from pg_catalog.jsonb_object_keys(binding))
    and binding->>'schema_version'='agent-dispatch-execution-binding@1.0.0'
    and app_data_agent.canonical_uuid_json_string_is_valid(binding->'run_id')
    and binding->>'run_id'=requested_run_id
    and binding->>'effective_executor_version' in ('LEGACY_FIXED@1','ADAPTIVE@1')
    and app_data_agent.agent_dispatch_plan_ref_is_valid(binding->'dispatch_plan_ref')
    and binding#>>'{dispatch_plan_ref,plan_id}'=plan->>'plan_id'
    and binding#>>'{dispatch_plan_ref,plan_hash}'=plan->>'plan_hash'
    and binding->'selected_profile_refs'=plan->'selected_profile_refs'
    and app_data_agent.agent_dispatch_profile_refs_are_canonical(binding->'selected_profile_refs')
    and binding->>'policy_version'=plan->>'policy_version'
    and binding->>'capability_snapshot_hash'=plan->>'capability_snapshot_hash'
    and (binding->'shadow_dispatch_plan_ref'='null'::jsonb
      or app_data_agent.agent_dispatch_plan_ref_is_valid(binding->'shadow_dispatch_plan_ref'))
    and binding->>'binding_hash'=app_data_agent.u2_canonical_sha256(binding-'binding_hash'::text)
    and ((binding->>'effective_executor_version'='ADAPTIVE@1'
        and binding->'shadow_dispatch_plan_ref'='null'::jsonb)
      or (binding->>'effective_executor_version'='LEGACY_FIXED@1'
        and binding->'shadow_dispatch_plan_ref'<>'null'::jsonb
        and pg_catalog.jsonb_array_length(binding->'selected_profile_refs')=3
        and binding#>>'{selected_profile_refs,0,profile_id}'='governed-text2sql-agent'
        and binding#>>'{selected_profile_refs,1,profile_id}'='report-writing-agent'
        and binding#>>'{selected_profile_refs,2,profile_id}'='semantic-management-agent'));
$function$;

create function app_data_agent.agent_dispatch_execute_receipt_is_valid(
  receipt jsonb, shadow_plan jsonb, requested_run_id text)
returns boolean language plpgsql immutable set search_path='' as $function$
declare plan jsonb; binding jsonb; expected_shadow jsonb;
begin
  if pg_catalog.jsonb_typeof(receipt)<>'object' or not receipt ?& array['kind','plan','binding']
    or (select pg_catalog.count(*)<>3 from pg_catalog.jsonb_object_keys(receipt))
    or receipt->>'kind'<>'EXECUTE' then return false; end if;
  plan:=receipt->'plan'; binding:=receipt->'binding';
  if not app_data_agent.agent_dispatch_binding_is_valid(plan,binding,requested_run_id)
  then return false; end if;
  expected_shadow:=binding->'shadow_dispatch_plan_ref';
  if binding->>'effective_executor_version'='ADAPTIVE@1' then
    return expected_shadow='null'::jsonb and shadow_plan='null'::jsonb;
  end if;
  if pg_catalog.jsonb_array_length(binding->'selected_profile_refs')<>3
    or binding#>>'{selected_profile_refs,0,profile_id}'<>'governed-text2sql-agent'
    or binding#>>'{selected_profile_refs,1,profile_id}'<>'report-writing-agent'
    or binding#>>'{selected_profile_refs,2,profile_id}'<>'semantic-management-agent'
    or expected_shadow='null'::jsonb then return false; end if;
  return app_data_agent.agent_dispatch_plan_is_valid(shadow_plan,requested_run_id)
    and shadow_plan->>'plan_id'=expected_shadow->>'plan_id'
    and shadow_plan->>'plan_hash'=expected_shadow->>'plan_hash'
    and binding->>'effective_executor_version'='LEGACY_FIXED@1';
end
$function$;

create function app_data_agent.resolve_agent_dispatch_rollout_policy(requested_bootstrap_mode text)
returns jsonb language plpgsql volatile security definer set search_path='' as $function$
declare authority record; policy app_data_agent.agent_dispatch_rollout_policies%rowtype; now_at timestamptz;
begin
  if requested_bootstrap_mode not in ('SHADOW','ENFORCED','ROOT_ONLY_DEFER_DATA') then
    raise exception using errcode='22023',message='AGENT_DISPATCH_ROLLOUT_POLICY_INVALID'; end if;
  select * into strict authority from platform.current_backend_authority(true);
  now_at:=pg_catalog.clock_timestamp();
  insert into app_data_agent.agent_dispatch_rollout_policies(
    app_id,tenant_id,environment,mode,version,policy_version,updated_at)
  values(authority.app_id,authority.tenant_id,authority.environment,requested_bootstrap_mode,1,
    'adaptive-routing@1.0.0+rollout.1',now_at) on conflict do nothing;
  select * into strict policy from app_data_agent.agent_dispatch_rollout_policies
  where app_id=authority.app_id and tenant_id=authority.tenant_id and environment=authority.environment
  for share;
  return pg_catalog.jsonb_build_object('schema_version','agent-dispatch-rollout-policy@1.0.0',
    'mode',policy.mode,'version',policy.version,'policy_version',policy.policy_version);
end
$function$;

create function app_data_agent.set_agent_dispatch_rollout_policy(
  requested_mode text, expected_version bigint)
returns jsonb language plpgsql volatile security definer set search_path='' as $function$
declare authority record; policy app_data_agent.agent_dispatch_rollout_policies%rowtype;
begin
  if requested_mode not in ('SHADOW','ENFORCED','ROOT_ONLY_DEFER_DATA')
    or expected_version is null or expected_version<=0
  then raise exception using errcode='22023',message='AGENT_DISPATCH_ROLLOUT_POLICY_INVALID'; end if;
  select * into strict authority from platform.current_backend_authority(true);
  if pg_catalog.lower(authority.membership_role)<>'owner' then
    raise exception using errcode='42501',message='AGENT_DISPATCH_ROLLOUT_MANAGE_REQUIRED'; end if;
  select * into strict policy from app_data_agent.agent_dispatch_rollout_policies
  where app_id=authority.app_id and tenant_id=authority.tenant_id and environment=authority.environment
  for update;
  if policy.mode=requested_mode then
    return pg_catalog.jsonb_build_object('schema_version','agent-dispatch-rollout-policy@1.0.0',
      'mode',policy.mode,'version',policy.version,'policy_version',policy.policy_version);
  end if;
  if policy.version<>expected_version then
    raise exception using errcode='40001',message='AGENT_DISPATCH_ROLLOUT_VERSION_CONFLICT'; end if;
  update app_data_agent.agent_dispatch_rollout_policies set
    mode=requested_mode,
    version=policy.version+1,
    policy_version='adaptive-routing@1.0.0+rollout.'||(policy.version+1)::text,
    updated_at=pg_catalog.clock_timestamp()
  where app_id=authority.app_id and tenant_id=authority.tenant_id and environment=authority.environment
  returning * into strict policy;
  return pg_catalog.jsonb_build_object('schema_version','agent-dispatch-rollout-policy@1.0.0',
    'mode',policy.mode,'version',policy.version,'policy_version',policy.policy_version);
end
$function$;

create function app_data_agent.commit_agent_dispatch_deferred(
  requested_idempotency_key text, requested_question_hash text, requested_receipt jsonb)
returns jsonb language plpgsql volatile security definer set search_path='' as $function$
declare authority record; existing app_data_agent.agent_dispatch_deferred_receipts%rowtype; run_value uuid;
begin
  if requested_idempotency_key is null or requested_idempotency_key=''
    or requested_question_hash!~'^sha256:[0-9a-f]{64}$'
    or pg_catalog.jsonb_typeof(requested_receipt)<>'object'
    or not requested_receipt ?& array['kind','schema_version','run_id','question_class','reason_code',
      'required_capabilities','policy_version','capability_snapshot_hash','receipt_hash']
    or requested_receipt->>'kind'<>'DEFERRED'
    or requested_receipt->>'schema_version'<>'agent-dispatch-deferred-receipt@1.0.0'
    or requested_receipt->>'question_class' not in ('EXPLANATION','SEMANTIC_READ','DATA_QUERY','REPORT','ATTRIBUTION')
    or requested_receipt->>'reason_code'!~'^[A-Z][A-Z0-9_]*$'
    or pg_catalog.length(requested_receipt->>'reason_code')>128
    or pg_catalog.jsonb_typeof(requested_receipt->'required_capabilities')<>'array'
    or pg_catalog.jsonb_array_length(requested_receipt->'required_capabilities') not between 1 and 16
    or (select pg_catalog.array_agg(value#>>'{}' order by ordinal)<>
        pg_catalog.array_agg(distinct value#>>'{}' order by value#>>'{}')
      from pg_catalog.jsonb_array_elements(requested_receipt->'required_capabilities')
        with ordinality item(value,ordinal))
    or exists(select 1 from pg_catalog.jsonb_array_elements(
        requested_receipt->'required_capabilities') value
      where pg_catalog.jsonb_typeof(value)<>'string'
        or value#>>'{}'!~'^[A-Za-z0-9][A-Za-z0-9._:@/+~-]{0,127}$')
    or requested_receipt->>'policy_version'!~'^[A-Za-z0-9][A-Za-z0-9._:@/+~-]{0,127}$'
    or requested_receipt->>'capability_snapshot_hash'!~'^sha256:[0-9a-f]{64}$'
    or (select pg_catalog.count(*)<>9 from pg_catalog.jsonb_object_keys(requested_receipt))
    or requested_receipt->>'receipt_hash'<>
      app_data_agent.u2_canonical_sha256(requested_receipt-'receipt_hash'::text)
  then raise exception using errcode='22023',message='AGENT_DISPATCH_DEFERRED_RECEIPT_INVALID'; end if;
  begin run_value:=(requested_receipt->>'run_id')::uuid;
  exception when others then raise exception using errcode='22023',message='AGENT_DISPATCH_DEFERRED_RECEIPT_INVALID'; end;
  select * into strict authority from platform.current_backend_authority(true);
  select * into existing from app_data_agent.agent_dispatch_deferred_receipts where
    app_id=authority.app_id and tenant_id=authority.tenant_id and environment=authority.environment
    and principal_id=authority.principal_id and idempotency_key=requested_idempotency_key for update;
  if found then
    if existing.run_id<>run_value or existing.question_hash<>requested_question_hash
      or existing.receipt_hash<>requested_receipt->>'receipt_hash' or existing.receipt_json<>requested_receipt
    then raise exception using errcode='23505',message='AGENT_DISPATCH_DEFERRED_REPLAY_MISMATCH'; end if;
    return existing.receipt_json;
  end if;
  insert into app_data_agent.agent_dispatch_deferred_receipts values(
    authority.app_id,authority.tenant_id,authority.environment,authority.principal_id,run_value,
    requested_idempotency_key,requested_question_hash,requested_receipt->>'receipt_hash',requested_receipt,
    pg_catalog.clock_timestamp());
  return requested_receipt;
end
$function$;

create function app_data_agent.commit_agent_dispatch_execute_internal(
  requested_idempotency_key text, requested_receipt jsonb, requested_shadow_plan jsonb)
returns void language plpgsql volatile security definer set search_path='' as $function$
declare authority record; run_value uuid;
begin
  run_value:=(requested_receipt#>>'{plan,run_id}')::uuid;
  select * into strict authority from platform.current_backend_authority(true);
  insert into app_data_agent.agent_dispatch_execute_receipts values(
    authority.app_id,authority.tenant_id,authority.environment,authority.principal_id,run_value,
    requested_idempotency_key,requested_receipt#>>'{binding,binding_hash}',requested_receipt,
    requested_shadow_plan,pg_catalog.clock_timestamp())
  on conflict(app_id,tenant_id,environment,principal_id,run_id) do nothing;
  if not exists(select 1 from app_data_agent.agent_dispatch_execute_receipts where
    app_id=authority.app_id and tenant_id=authority.tenant_id and environment=authority.environment
    and principal_id=authority.principal_id and run_id=run_value and idempotency_key=requested_idempotency_key
    and receipt_json=requested_receipt and shadow_plan_json is not distinct from requested_shadow_plan)
  then raise exception using errcode='23505',message='AGENT_DISPATCH_EXECUTE_REPLAY_MISMATCH'; end if;
end
$function$;
