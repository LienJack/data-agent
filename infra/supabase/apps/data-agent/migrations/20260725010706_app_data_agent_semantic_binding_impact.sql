-- semantic_binding_impact_migration_checksum: sha256:7e9cbc3fe6f3ed89b04777a0bf1a1b87367a1c89f9c3863ff0038d183df2692e
begin;

do $bootstrap$
begin
  if pg_catalog.current_setting('server_version_num')::integer not between 170000 and 179999 then
    raise exception using errcode='0A000',message='SEMANTIC_BINDING_IMPACT_POSTGRES_VERSION_UNSUPPORTED';
  end if;
  if session_user<>'postgres' or current_user<>'postgres' then
    raise exception using errcode='42501',message='SEMANTIC_BINDING_IMPACT_EXECUTOR_UNSAFE';
  end if;
  if not exists(select 1 from platform.migration_ledger
    where owner_kind='app' and app_id='00000000-0000-4000-8000-00000000da01'::uuid
      and migration_version='20260725010705_app_data_agent_resolved_context_lexicon')
  then raise exception using errcode='P0001',message='SEMANTIC_BINDING_IMPACT_BASELINE_10705_MISSING'; end if;
end
$bootstrap$;

set local lock_timeout='2000ms';
set local statement_timeout='300000ms';
set local idle_in_transaction_session_timeout='60000ms';
select platform.acquire_migration_lock('app','00000000-0000-4000-8000-00000000da01'::uuid);
create table app_data_agent.semantic_binding_impact_receipts (
  app_id uuid not null check(app_id='00000000-0000-4000-8000-00000000da01'::uuid),
  tenant_id uuid not null,
  environment text not null check(environment~'^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$'),
  semantic_domain text not null check(semantic_domain~'^[A-Za-z_][A-Za-z0-9_]{0,63}$'),
  impact_id uuid not null,
  datasource_id text not null check(datasource_id~'^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,127}$'),
  drift_event_id uuid not null,
  event_storage_digest text not null check(event_storage_digest~'^sha256:[0-9a-f]{64}$'),
  release_id uuid not null,
  release_generation bigint not null check(release_generation between 1 and 9007199254740991),
  release_digest text not null check(release_digest~'^sha256:[0-9a-f]{64}$'),
  authority_input_hash text not null check(authority_input_hash~'^sha256:[0-9a-f]{64}$'),
  plan_hash text not null check(plan_hash~'^sha256:[0-9a-f]{64}$'),
  receipt_hash text not null check(receipt_hash~'^sha256:[0-9a-f]{64}$'),
  candidate_id uuid,
  candidate_revision_id uuid,
  receipt_json jsonb not null check(pg_catalog.jsonb_typeof(receipt_json)='object'
    and not app_data_agent.contains_potential_plaintext_secret(receipt_json)),
  committed_by uuid not null,
  committed_at timestamptz not null,
  primary key(app_id,tenant_id,environment,semantic_domain,impact_id),
  unique(app_id,tenant_id,environment,semantic_domain,receipt_hash),
  foreign key(app_id,tenant_id,environment,datasource_id,drift_event_id)
    references catalog.schema_drift_event(app_id,tenant_id,environment,datasource_id,drift_event_id),
  foreign key(app_id,tenant_id,environment,semantic_domain,release_id)
    references semantic.semantic_source_release(app_id,tenant_id,environment,semantic_domain,release_id),
  foreign key(app_id,tenant_id,environment,semantic_domain,candidate_id,candidate_revision_id)
    references semantic.semantic_candidate_revision(app_id,tenant_id,environment,semantic_domain,candidate_id,revision_id),
  check((candidate_id is null)=(candidate_revision_id is null))
);

alter table app_data_agent.semantic_binding_impact_receipts enable row level security;
alter table app_data_agent.semantic_binding_impact_receipts force row level security;

create function app_data_agent.reject_semantic_binding_impact_mutation()
returns trigger language plpgsql set search_path='' as $function$
begin
  raise exception using errcode='55000',message='SEMANTIC_BINDING_IMPACT_IMMUTABLE';
end
$function$;
create trigger semantic_binding_impact_receipts_immutable
before update or delete on app_data_agent.semantic_binding_impact_receipts
for each row execute function app_data_agent.reject_semantic_binding_impact_mutation();

create function app_data_agent.semantic_binding_impact_exact_keys(value jsonb,keys text[])
returns boolean language sql immutable strict set search_path='' as $function$
  select pg_catalog.jsonb_typeof(value)='object' and value-keys='{}'::jsonb
    and not exists(select 1 from pg_catalog.unnest(keys) required(key) where not value?required.key)
$function$;

create function app_data_agent.semantic_binding_impact_uuid_v8(requested_hash text)
returns uuid language plpgsql immutable strict set search_path='' as $function$
declare value text; variant text;
begin
  if requested_hash!~'^sha256:[0-9a-f]{64}$' then
    raise exception using errcode='22023',message='SEMANTIC_BINDING_IMPACT_HASH_INVALID';
  end if;
  value:=pg_catalog.substr(requested_hash,8,32);
  value:=pg_catalog.substr(value,1,12)||'8'||pg_catalog.substr(value,14);
  variant:=case pg_catalog.substr(value,17,1)
    when '0' then '8' when '4' then '8' when '8' then '8' when 'c' then '8'
    when '1' then '9' when '5' then '9' when '9' then '9' when 'd' then '9'
    when '2' then 'a' when '6' then 'a' when 'a' then 'a' when 'e' then 'a' else 'b' end;
  value:=pg_catalog.substr(value,1,16)||variant||pg_catalog.substr(value,18);
  return (pg_catalog.substr(value,1,8)||'-'||pg_catalog.substr(value,9,4)||'-'||
    pg_catalog.substr(value,13,4)||'-'||pg_catalog.substr(value,17,4)||'-'||
    pg_catalog.substr(value,21,12))::uuid;
end
$function$;

create function app_data_agent.semantic_binding_impact_utc_millis(value timestamptz)
returns text language sql immutable strict parallel safe set search_path='' as $function$
  select pg_catalog.to_char(value at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
$function$;
create function app_data_agent.load_semantic_binding_impact_authority(requested jsonb)
returns jsonb language plpgsql volatile security definer set search_path='' as $function$
declare authority record; drift catalog.schema_drift_event%rowtype;
  release semantic.semantic_source_release%rowtype; packages jsonb; material jsonb;
begin
  if not pg_catalog.pg_has_role(session_user,'data_agent_backend','USAGE') then
    raise exception using errcode='42501',message='DA_BACKEND_ROLE_REQUIRED';
  end if;
  if requested is null or not app_data_agent.semantic_binding_impact_exact_keys(requested,array[
      'schema_version','semantic_domain','datasource_id','drift_event_id']::text[])
    or requested->>'schema_version'<>'semantic-binding-impact-analyze@1.0.0'
    or requested->>'semantic_domain'!~'^[A-Za-z_][A-Za-z0-9_]{0,63}$'
    or requested->>'datasource_id'!~'^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,127}$'
    or (requested->>'drift_event_id')::uuid::text<>requested->>'drift_event_id'
  then raise exception using errcode='22023',message='SEMANTIC_BINDING_IMPACT_REQUEST_INVALID'; end if;
  select * into authority from platform.current_backend_authority(false);
  select event.* into drift from catalog.schema_drift_event event
  where event.app_id=authority.app_id and event.tenant_id=authority.tenant_id
    and event.environment=authority.environment and event.datasource_id=requested->>'datasource_id'
    and event.drift_event_id=(requested->>'drift_event_id')::uuid for share;
  if not found or drift.event_payload->>'binding_impact'<>'UNKNOWN'
    or drift.event_storage_digest<>platform.canonical_sha256(drift.event_payload)
  then raise exception using errcode='P0001',message='SEMANTIC_BINDING_IMPACT_DRIFT_NOT_FOUND'; end if;
  select source.* into release from semantic.semantic_source_release source
  join semantic.semantic_active_pointer pointer
    on pointer.app_id=source.app_id and pointer.tenant_id=source.tenant_id
    and pointer.environment=source.environment and pointer.semantic_domain=source.semantic_domain
    and pointer.current_release_id=source.release_id
    and pointer.current_release_generation=source.release_generation
    and pointer.current_release_digest=source.release_digest
  where source.app_id=authority.app_id and source.tenant_id=authority.tenant_id
    and source.environment=authority.environment and source.semantic_domain=requested->>'semantic_domain'
  for share of source,pointer;
  if not found then raise exception using errcode='40001',message='SEMANTIC_BINDING_IMPACT_RELEASE_STALE'; end if;
  select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
    'namespace_id',package.namespace_id,'package_id',package.package_id,
    'package_version',package.package_version,'package_hash',package.package_hash,
    'objects',coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
      'object_id',item.value->>'object_id','graph_entry_kind',item.value->>'graph_entry_kind',
      'graph_entry_id',item.value->>'graph_entry_id','semantic_role',item.value->>'semantic_role',
      'resolution',item.value->>'resolution','object_hash',app_data_agent.u2_canonical_sha256(item.value)
    ) order by item.value->>'object_id') from pg_catalog.jsonb_array_elements(package.package_json->'objects') item(value)),'[]'::jsonb),
    'physical_mappings',coalesce((select pg_catalog.jsonb_agg(item.value order by item.value->>'mapping_id')
      from pg_catalog.jsonb_array_elements(package.package_json->'physical_mappings') item(value)
      where item.value->>'datasource_id'=requested->>'datasource_id'),'[]'::jsonb),
    'metric_bindings',coalesce((select pg_catalog.jsonb_agg(item.value order by item.value->>'metric_object_id')
      from pg_catalog.jsonb_array_elements(package.package_json->'metric_bindings') item(value)),'[]'::jsonb),
    'constraints',coalesce((select pg_catalog.jsonb_agg(item.value order by item.value->>'constraint_id')
      from pg_catalog.jsonb_array_elements(package.package_json->'constraints') item(value)),'[]'::jsonb),
    'graph_edges',coalesce((select pg_catalog.jsonb_agg(item.value order by item.value->>'edge_id')
      from pg_catalog.jsonb_array_elements(package.package_json#>'{graph_source,edges}') item(value)),'[]'::jsonb)
  ) order by package.package_id,package.package_version) into packages
  from semantic.initial_semantic_release_sets release_set
  join semantic.initial_semantic_release_package_bindings binding
    using(app_id,tenant_id,environment,semantic_domain,release_set_id)
  join semantic.ontology_package_candidates package
    on package.app_id=binding.app_id and package.tenant_id=binding.tenant_id
    and package.environment=binding.environment and package.semantic_domain=binding.semantic_domain
    and package.package_id=binding.package_id and package.package_version=binding.package_version
    and package.package_hash=binding.package_hash
  where release_set.app_id=release.app_id and release_set.tenant_id=release.tenant_id
    and release_set.environment=release.environment and release_set.semantic_domain=release.semantic_domain
    and release_set.release_id=release.release_id;
  if packages is null then raise exception using errcode='P0001',message='SEMANTIC_BINDING_IMPACT_AUTHORITY_NOT_FOUND'; end if;
  if exists(select item.value->>'object_id' from pg_catalog.jsonb_array_elements(packages) package(value),
      lateral pg_catalog.jsonb_array_elements(package.value->'objects') item(value)
      group by item.value->>'object_id' having pg_catalog.count(*)>1)
    or exists(select item.value->>'mapping_id' from pg_catalog.jsonb_array_elements(packages) package(value),
      lateral pg_catalog.jsonb_array_elements(package.value->'physical_mappings') item(value)
      group by item.value->>'mapping_id' having pg_catalog.count(*)>1)
  then raise exception using errcode='P0001',message='SEMANTIC_BINDING_IMPACT_AUTHORITY_DUPLICATE'; end if;
  if exists(select 1 from pg_catalog.jsonb_array_elements(packages) package(value),
      lateral pg_catalog.jsonb_array_elements(package.value->'physical_mappings') mapping(value)
      where mapping.value->>'snapshot_content_hash'<>drift.base_snapshot_content_hash)
  then raise exception using errcode='40001',message='SEMANTIC_BINDING_IMPACT_MAPPING_STALE'; end if;
  material:=pg_catalog.jsonb_build_object(
    'schema_version','semantic-binding-impact-authority@1.0.0',
    'scope',pg_catalog.jsonb_build_object('app_id',authority.app_id,'tenant_id',authority.tenant_id,
      'environment',authority.environment,'semantic_domain',release.semantic_domain),
    'datasource_id',drift.datasource_id,
    'drift',pg_catalog.jsonb_build_object('event',drift.event_payload,'event_storage_digest',drift.event_storage_digest),
    'release',pg_catalog.jsonb_build_object('release_id',release.release_id,'generation',release.release_generation,
      'release_digest',release.release_digest),'packages',packages);
  return material||pg_catalog.jsonb_build_object('authority_input_hash',app_data_agent.u2_canonical_sha256(material));
exception when invalid_text_representation or numeric_value_out_of_range then
  raise exception using errcode='22023',message='SEMANTIC_BINDING_IMPACT_REQUEST_INVALID';
end
$function$;

create function app_data_agent.commit_semantic_binding_impact(requested jsonb)
returns jsonb language plpgsql volatile security definer set search_path='' as $function$
declare authority record; plan jsonb; candidate_draft jsonb; current_authority jsonb;
  existing app_data_agent.semantic_binding_impact_receipts%rowtype; candidate jsonb;
  candidate_ref jsonb; material jsonb; receipt jsonb; now_at timestamptz:=pg_catalog.clock_timestamp();
begin
  if not pg_catalog.pg_has_role(session_user,'data_agent_backend','USAGE') then
    raise exception using errcode='42501',message='DA_BACKEND_ROLE_REQUIRED';
  end if;
  if requested is null or not app_data_agent.semantic_binding_impact_exact_keys(requested,array['plan','candidate_draft']::text[])
    or not app_data_agent.semantic_binding_impact_exact_keys(requested->'plan',array[
      'schema_version','impact_id','scope','datasource_id','authority_input_hash','drift_ref','release_ref',
      'status','risk_level','direct_impacts','transitive_impacts','unchanged_object_hashes',
      'suggested_actions','manual_reason_codes','candidate_operations','plan_hash']::text[])
    or requested#>>'{plan,schema_version}'<>'semantic-binding-impact-plan@1.0.0'
    or requested#>>'{plan,plan_hash}'<>app_data_agent.u2_canonical_sha256((requested->'plan')-'plan_hash')
    or (requested#>>'{plan,impact_id}')::uuid<>app_data_agent.semantic_binding_impact_uuid_v8(requested#>>'{plan,authority_input_hash}')
    or requested#>>'{plan,status}' not in ('NO_SEMANTIC_ACTION','REVIEW_REQUIRED','MANUAL_INVESTIGATION')
    or pg_catalog.jsonb_typeof(requested#>'{plan,direct_impacts}')<>'array'
    or pg_catalog.jsonb_typeof(requested#>'{plan,transitive_impacts}')<>'array'
    or pg_catalog.jsonb_typeof(requested#>'{plan,unchanged_object_hashes}')<>'array'
    or pg_catalog.jsonb_typeof(requested#>'{plan,suggested_actions}')<>'array'
    or pg_catalog.jsonb_typeof(requested#>'{plan,manual_reason_codes}')<>'array'
    or pg_catalog.jsonb_typeof(requested#>'{plan,candidate_operations}')<>'array'
    or (requested#>>'{plan,status}'='REVIEW_REQUIRED')<>(requested->'candidate_draft'<>'null'::jsonb)
    or (requested#>>'{plan,status}'='REVIEW_REQUIRED' and (
      pg_catalog.jsonb_array_length(requested#>'{plan,candidate_operations}') not between 1 and 256
      or exists(select 1 from pg_catalog.jsonb_array_elements(requested#>'{plan,candidate_operations}') operation(value)
        where operation.value->>'action'<>'MARK_STALE' or operation.value->'payload'<>'null'::jsonb)))
    or (requested#>>'{plan,status}'<>'REVIEW_REQUIRED'
      and pg_catalog.jsonb_array_length(requested#>'{plan,candidate_operations}')<>0)
    or (requested#>>'{plan,status}'='NO_SEMANTIC_ACTION'
      and (pg_catalog.jsonb_array_length(requested#>'{plan,direct_impacts}')<>0
        or pg_catalog.jsonb_array_length(requested#>'{plan,transitive_impacts}')<>0))
    or (requested#>>'{plan,status}'='MANUAL_INVESTIGATION'
      and pg_catalog.jsonb_array_length(requested#>'{plan,manual_reason_codes}')=0)
  then raise exception using errcode='22023',message='SEMANTIC_BINDING_IMPACT_COMMIT_INVALID'; end if;
  plan:=requested->'plan'; candidate_draft:=nullif(requested->'candidate_draft','null'::jsonb);
  select * into authority from platform.current_backend_authority(true);
  if plan#>>'{scope,app_id}'<>authority.app_id::text or plan#>>'{scope,tenant_id}'<>authority.tenant_id::text
    or plan#>>'{scope,environment}'<>authority.environment
  then raise exception using errcode='42501',message='SEMANTIC_BINDING_IMPACT_SCOPE_MISMATCH'; end if;
  perform pg_catalog.set_config('app.semantic_domain',plan#>>'{scope,semantic_domain}',true);
  current_authority:=app_data_agent.load_semantic_binding_impact_authority(pg_catalog.jsonb_build_object(
    'schema_version','semantic-binding-impact-analyze@1.0.0','semantic_domain',plan#>>'{scope,semantic_domain}',
    'datasource_id',plan->>'datasource_id','drift_event_id',plan#>>'{drift_ref,drift_event_id}'));
  if current_authority->>'authority_input_hash'<>plan->>'authority_input_hash'
    or current_authority->'scope'<>plan->'scope' or current_authority->>'datasource_id'<>plan->>'datasource_id'
    or current_authority#>>'{drift,event_storage_digest}'<>plan#>>'{drift_ref,event_storage_digest}'
    or current_authority->'release'<>plan->'release_ref'
  then raise exception using errcode='40001',message='SEMANTIC_BINDING_IMPACT_AUTHORITY_STALE'; end if;
  select * into existing from app_data_agent.semantic_binding_impact_receipts receipt_row
  where receipt_row.app_id=authority.app_id and receipt_row.tenant_id=authority.tenant_id
    and receipt_row.environment=authority.environment and receipt_row.semantic_domain=plan#>>'{scope,semantic_domain}'
    and receipt_row.impact_id=(plan->>'impact_id')::uuid;
  if found then
    if existing.plan_hash<>plan->>'plan_hash' or existing.authority_input_hash<>plan->>'authority_input_hash'
    then raise exception using errcode='23505',message='SEMANTIC_BINDING_IMPACT_IDEMPOTENCY_CONFLICT'; end if;
    return existing.receipt_json||pg_catalog.jsonb_build_object('created',false);
  end if;
  if candidate_draft is not null then
    if not app_data_agent.semantic_binding_impact_exact_keys(candidate_draft,array[
        'schema_version','title','description','semantic_domain','change_class','risk_level',
        'idempotency_key','source_payload','diff']::text[])
      or candidate_draft->>'schema_version'<>'semantic-candidate-draft@1.0.0'
      or candidate_draft->>'semantic_domain'<>plan#>>'{scope,semantic_domain}'
      or candidate_draft->>'idempotency_key'<>plan->>'impact_id'
      or not app_data_agent.semantic_binding_impact_exact_keys(candidate_draft->'source_payload',array[
        'schema_version','source_kind','content']::text[])
      or candidate_draft#>>'{source_payload,source_kind}'<>'SCHEMA_DISCOVERY'
      or not app_data_agent.semantic_binding_impact_exact_keys(candidate_draft#>'{source_payload,content}',array[
        'schema_version','impact_id','plan_hash','authority_input_hash','drift_ref','release_ref','review_only']::text[])
      or candidate_draft#>>'{source_payload,content,impact_id}'<>plan->>'impact_id'
      or candidate_draft#>>'{source_payload,content,review_only}'<>'true'
      or candidate_draft#>>'{source_payload,content,plan_hash}'<>plan->>'plan_hash'
      or candidate_draft#>>'{source_payload,content,authority_input_hash}'<>plan->>'authority_input_hash'
      or candidate_draft#>'{source_payload,content,drift_ref}'<>plan->'drift_ref'
      or candidate_draft#>'{source_payload,content,release_ref}'<>plan->'release_ref'
      or not app_data_agent.semantic_binding_impact_exact_keys(candidate_draft->'diff',array[
        'schema_version','summary','operations']::text[])
      or candidate_draft#>>'{diff,schema_version}'<>'semantic-diff@1.0.0'
      or pg_catalog.jsonb_typeof(candidate_draft#>'{diff,operations}')<>'array'
      or pg_catalog.jsonb_array_length(candidate_draft#>'{diff,operations}')
        <>pg_catalog.jsonb_array_length(plan->'candidate_operations')
      or exists(select 1 from pg_catalog.jsonb_array_elements(candidate_draft#>'{diff,operations}') operation(value)
        where operation.value->>'change_type'<>'MODIFY'
          or operation.value#>>'{before,state}'<>'CURRENT_RELEASE'
          or operation.value#>>'{after,state}'<>'STALE')
    then raise exception using errcode='22023',message='SEMANTIC_BINDING_IMPACT_CANDIDATE_INVALID'; end if;
    candidate:=semantic.create_candidate_draft(authority.app_id,authority.tenant_id,authority.environment,
      plan#>>'{scope,semantic_domain}',authority.principal_id::text,(plan->>'impact_id')::uuid,
      candidate_draft->>'title',candidate_draft->>'description',candidate_draft->>'change_class',
      candidate_draft->>'risk_level',candidate_draft->'source_payload',candidate_draft->'diff');
    if candidate->>'candidate_status'<>'DRAFT' then
      raise exception using errcode='P0001',message='SEMANTIC_BINDING_IMPACT_CANDIDATE_STATE_INVALID';
    end if;
    candidate_ref:=pg_catalog.jsonb_build_object('candidate_id',candidate->>'candidate_id',
      'revision_id',candidate->>'revision_id','source_revision_id',candidate->>'source_revision_id',
      'source_digest',candidate->>'source_digest','revision_digest',candidate->>'revision_digest');
  else candidate_ref:=null;
  end if;
  material:=pg_catalog.jsonb_build_object(
    'schema_version','semantic-binding-impact-receipt@1.0.0','authority','POSTGRESQL',
    'impact_id',plan->>'impact_id','scope',plan->'scope','datasource_id',plan->>'datasource_id',
    'authority_input_hash',plan->>'authority_input_hash','plan_hash',plan->>'plan_hash',
    'drift_event_id',plan#>>'{drift_ref,drift_event_id}','release',plan->'release_ref',
    'status',plan->>'status','risk_level',plan->>'risk_level',
    'direct_impact_count',pg_catalog.jsonb_array_length(plan->'direct_impacts'),
    'transitive_impact_count',pg_catalog.jsonb_array_length(plan->'transitive_impacts'),
    'suggested_actions',plan->'suggested_actions','manual_reason_codes',plan->'manual_reason_codes',
    'candidate_ref',candidate_ref,'committed_at',app_data_agent.semantic_binding_impact_utc_millis(now_at));
  receipt:=material||pg_catalog.jsonb_build_object('receipt_hash',app_data_agent.u2_canonical_sha256(material));
  insert into app_data_agent.semantic_binding_impact_receipts(app_id,tenant_id,environment,semantic_domain,
    impact_id,datasource_id,drift_event_id,event_storage_digest,release_id,release_generation,release_digest,
    authority_input_hash,plan_hash,receipt_hash,candidate_id,candidate_revision_id,receipt_json,committed_by,committed_at)
  values(authority.app_id,authority.tenant_id,authority.environment,plan#>>'{scope,semantic_domain}',
    (plan->>'impact_id')::uuid,plan->>'datasource_id',(plan#>>'{drift_ref,drift_event_id}')::uuid,
    plan#>>'{drift_ref,event_storage_digest}',(plan#>>'{release_ref,release_id}')::uuid,
    (plan#>>'{release_ref,generation}')::bigint,plan#>>'{release_ref,release_digest}',plan->>'authority_input_hash',
    plan->>'plan_hash',receipt->>'receipt_hash',nullif(candidate_ref->>'candidate_id','')::uuid,
    nullif(candidate_ref->>'revision_id','')::uuid,receipt,authority.principal_id,now_at);
  return receipt||pg_catalog.jsonb_build_object('created',true);
exception when invalid_text_representation or numeric_value_out_of_range then
  raise exception using errcode='22023',message='SEMANTIC_BINDING_IMPACT_COMMIT_INVALID';
end
$function$;

create function app_data_agent.get_semantic_binding_impact(requested jsonb)
returns jsonb language plpgsql stable security definer set search_path='' as $function$
declare authority record; stored app_data_agent.semantic_binding_impact_receipts%rowtype;
begin
  if not pg_catalog.pg_has_role(session_user,'data_agent_backend','USAGE') then
    raise exception using errcode='42501',message='DA_BACKEND_ROLE_REQUIRED';
  end if;
  if requested is null or not app_data_agent.semantic_binding_impact_exact_keys(requested,array['semantic_domain','impact_id']::text[])
    or requested->>'semantic_domain'!~'^[A-Za-z_][A-Za-z0-9_]{0,63}$'
    or (requested->>'impact_id')::uuid::text<>requested->>'impact_id'
  then raise exception using errcode='22023',message='SEMANTIC_BINDING_IMPACT_REQUEST_INVALID'; end if;
  select * into authority from platform.current_backend_authority(false);
  select * into stored from app_data_agent.semantic_binding_impact_receipts receipt
  where receipt.app_id=authority.app_id and receipt.tenant_id=authority.tenant_id
    and receipt.environment=authority.environment and receipt.semantic_domain=requested->>'semantic_domain'
    and receipt.impact_id=(requested->>'impact_id')::uuid;
  if not found then return null; end if;
  return pg_catalog.jsonb_build_object('schema_version','semantic-binding-impact-safe-projection@1.0.0',
    'impact_id',stored.receipt_json->>'impact_id','receipt_hash',stored.receipt_hash,
    'plan_hash',stored.plan_hash,'drift_event_id',stored.receipt_json->>'drift_event_id',
    'release',stored.receipt_json->'release','status',stored.receipt_json->>'status',
    'risk_level',stored.receipt_json->>'risk_level','direct_impact_count',stored.receipt_json->'direct_impact_count',
    'transitive_impact_count',stored.receipt_json->'transitive_impact_count',
    'suggested_actions',stored.receipt_json->'suggested_actions',
    'manual_reason_codes',stored.receipt_json->'manual_reason_codes',
    'candidate_ref',stored.receipt_json->'candidate_ref','committed_at',stored.receipt_json->>'committed_at');
exception when invalid_text_representation then
  raise exception using errcode='22023',message='SEMANTIC_BINDING_IMPACT_REQUEST_INVALID';
end
$function$;
alter table app_data_agent.semantic_binding_impact_receipts owner to data_agent_u11_induction_owner;
alter function app_data_agent.reject_semantic_binding_impact_mutation() owner to data_agent_u11_induction_owner;
alter function app_data_agent.semantic_binding_impact_exact_keys(jsonb,text[]) owner to data_agent_u11_induction_owner;
alter function app_data_agent.semantic_binding_impact_uuid_v8(text) owner to data_agent_u11_induction_owner;
alter function app_data_agent.semantic_binding_impact_utc_millis(timestamptz) owner to data_agent_u11_induction_owner;
alter function app_data_agent.load_semantic_binding_impact_authority(jsonb) owner to data_agent_u11_induction_owner;
alter function app_data_agent.commit_semantic_binding_impact(jsonb) owner to data_agent_u11_induction_owner;
alter function app_data_agent.get_semantic_binding_impact(jsonb) owner to data_agent_u11_induction_owner;

grant usage on schema app_data_agent,platform,semantic,catalog to data_agent_u11_induction_owner;
grant execute on function platform.current_backend_authority(boolean),platform.canonical_sha256(jsonb),
  platform.backend_context_matches(uuid,uuid,text,boolean),app_data_agent.u2_canonical_sha256(jsonb),
  app_data_agent.contains_potential_plaintext_secret(jsonb,text),
  semantic.create_candidate_draft(uuid,uuid,text,text,text,uuid,text,text,text,text,jsonb,jsonb)
to data_agent_u11_induction_owner;
grant select on catalog.schema_drift_event,semantic.semantic_source_release,semantic.semantic_active_pointer,
  semantic.initial_semantic_release_sets,semantic.initial_semantic_release_package_bindings,
  semantic.ontology_package_candidates to data_agent_u11_induction_owner;

create policy semantic_binding_impact_receipts_u11_all on app_data_agent.semantic_binding_impact_receipts
  for all to data_agent_u11_induction_owner using(platform.backend_context_matches(app_id,tenant_id,environment,false))
  with check(platform.backend_context_matches(app_id,tenant_id,environment,true));
create policy schema_drift_event_u11_binding_select on catalog.schema_drift_event
  for select to data_agent_u11_induction_owner using(platform.backend_context_matches(app_id,tenant_id,environment,false));
create policy initial_release_set_u11_binding_select on semantic.initial_semantic_release_sets
  for select to data_agent_u11_induction_owner using(platform.backend_context_matches(app_id,tenant_id,environment,false));
create policy initial_release_binding_u11_binding_select on semantic.initial_semantic_release_package_bindings
  for select to data_agent_u11_induction_owner using(platform.backend_context_matches(app_id,tenant_id,environment,false));
create policy ontology_package_u11_binding_select on semantic.ontology_package_candidates
  for select to data_agent_u11_induction_owner using(platform.backend_context_matches(app_id,tenant_id,environment,false));

revoke all on app_data_agent.semantic_binding_impact_receipts from public,anon,authenticated,service_role,data_agent_backend;
revoke all on function app_data_agent.reject_semantic_binding_impact_mutation(),
  app_data_agent.semantic_binding_impact_exact_keys(jsonb,text[]),app_data_agent.semantic_binding_impact_uuid_v8(text),
  app_data_agent.semantic_binding_impact_utc_millis(timestamptz),
  app_data_agent.load_semantic_binding_impact_authority(jsonb),app_data_agent.commit_semantic_binding_impact(jsonb),
  app_data_agent.get_semantic_binding_impact(jsonb) from public,anon,authenticated,service_role,data_agent_backend;
grant execute on function app_data_agent.load_semantic_binding_impact_authority(jsonb),
  app_data_agent.commit_semantic_binding_impact(jsonb),app_data_agent.get_semantic_binding_impact(jsonb)
to data_agent_backend;

do $postconditions$
begin
  if not exists(select 1 from pg_catalog.pg_class relation join pg_catalog.pg_namespace namespace
      on namespace.oid=relation.relnamespace where namespace.nspname='app_data_agent'
      and relation.relname='semantic_binding_impact_receipts' and relation.relrowsecurity and relation.relforcerowsecurity
      and relation.relowner=(select oid from pg_catalog.pg_roles where rolname='data_agent_u11_induction_owner'))
  then raise exception using errcode='P0001',message='SEMANTIC_BINDING_IMPACT_RLS_OR_OWNER_UNSAFE'; end if;
  if pg_catalog.has_table_privilege('data_agent_backend','app_data_agent.semantic_binding_impact_receipts','SELECT,INSERT,UPDATE,DELETE')
    or not pg_catalog.has_function_privilege('data_agent_backend','app_data_agent.load_semantic_binding_impact_authority(jsonb)','EXECUTE')
    or not pg_catalog.has_function_privilege('data_agent_backend','app_data_agent.commit_semantic_binding_impact(jsonb)','EXECUTE')
    or not pg_catalog.has_function_privilege('data_agent_backend','app_data_agent.get_semantic_binding_impact(jsonb)','EXECUTE')
  then raise exception using errcode='P0001',message='SEMANTIC_BINDING_IMPACT_GRANT_UNSAFE'; end if;
  if exists(select 1 from pg_catalog.pg_proc procedure join pg_catalog.pg_namespace namespace
    on namespace.oid=procedure.pronamespace where namespace.nspname='app_data_agent'
    and procedure.proname in ('load_semantic_binding_impact_authority','commit_semantic_binding_impact','get_semantic_binding_impact')
    and (not procedure.prosecdef or not procedure.proconfig@>array['search_path=""']::text[]))
  then raise exception using errcode='P0001',message='SEMANTIC_BINDING_IMPACT_RPC_SECURITY_UNSAFE'; end if;
  if pg_catalog.to_regprocedure('app_data_agent.load_semantic_binding_impact_authority_v1(jsonb)') is not null
    or pg_catalog.to_regprocedure('app_data_agent.load_semantic_binding_impact_authority_v2(jsonb)') is not null
  then raise exception using errcode='P0001',message='SEMANTIC_BINDING_IMPACT_COMPATIBILITY_RPC_UNSAFE'; end if;
end
$postconditions$;
select platform.assert_migration_checksum('app','00000000-0000-4000-8000-00000000da01'::uuid,
  '20260725010706_app_data_agent_semantic_binding_impact','sha256:7e9cbc3fe6f3ed89b04777a0bf1a1b87367a1c89f9c3863ff0038d183df2692e');
commit;
