create table app_data_agent.subagent_capability_catalog_snapshots(
  app_id uuid not null,tenant_id uuid not null,environment text not null,
  principal_id uuid not null,run_id uuid not null,catalog_id uuid not null,
  idempotency_key text not null,policy_version text not null,
  snapshot_hash text not null check(snapshot_hash~'^sha256:[0-9a-f]{64}$'),
  snapshot_json jsonb not null,committed_at timestamptz not null,
  primary key(app_id,tenant_id,environment,principal_id,run_id),
  unique(app_id,tenant_id,environment,principal_id,catalog_id),
  unique(app_id,tenant_id,environment,principal_id,idempotency_key),
  check(snapshot_json->>'snapshot_hash'=snapshot_hash
    and snapshot_hash=app_data_agent.u2_canonical_sha256(snapshot_json-'snapshot_hash')),
  foreign key(app_id,tenant_id,environment,run_id)
    references app_data_agent.runs(app_id,tenant_id,environment,run_id)
    on delete restrict deferrable initially deferred
);

create trigger subagent_capability_catalog_snapshots_immutable before update or delete
on app_data_agent.subagent_capability_catalog_snapshots for each row
execute function app_data_agent.reject_agent_profile_immutable_mutation();

alter table app_data_agent.subagent_capability_catalog_snapshots enable row level security;
alter table app_data_agent.subagent_capability_catalog_snapshots force row level security;
create policy subagent_capability_catalog_backend
on app_data_agent.subagent_capability_catalog_snapshots for all to data_agent_u19_team_owner
using(platform.backend_context_matches(app_id,tenant_id,environment,true)
  and principal_id=pg_catalog.current_setting('data_agent.principal_id')::uuid)
with check(platform.backend_context_matches(app_id,tenant_id,environment,true)
  and principal_id=pg_catalog.current_setting('data_agent.principal_id')::uuid);

create function app_data_agent.subagent_catalog_snapshot_is_valid(snapshot jsonb,requested_run_id text)
returns boolean language sql immutable set search_path='' as $function$
  select pg_catalog.jsonb_typeof(snapshot)='object'
    and snapshot ?& array['schema_version','catalog_id','scope','run_id','principal_id',
      'policy_version','items','snapshot_hash']
    and (select pg_catalog.count(*)=8 from pg_catalog.jsonb_object_keys(snapshot))
    and snapshot->>'schema_version'='subagent-capability-catalog-snapshot@1.0.0'
    and app_data_agent.canonical_uuid_json_string_is_valid(snapshot->'catalog_id')
    and app_data_agent.canonical_uuid_json_string_is_valid(snapshot->'run_id')
    and snapshot->>'run_id'=requested_run_id
    and app_data_agent.canonical_uuid_json_string_is_valid(snapshot->'principal_id')
    and pg_catalog.jsonb_typeof(snapshot->'scope')='object'
    and snapshot->'scope' ?& array['app_id','tenant_id','environment']
    and (select pg_catalog.count(*)=3 from pg_catalog.jsonb_object_keys(snapshot->'scope'))
    and app_data_agent.canonical_uuid_json_string_is_valid(snapshot#>'{scope,app_id}')
    and app_data_agent.canonical_uuid_json_string_is_valid(snapshot#>'{scope,tenant_id}')
    and snapshot#>>'{scope,environment}'~'^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$'
    and snapshot->>'policy_version'~'^[A-Za-z0-9][A-Za-z0-9._:@/+~-]{0,127}$'
    and pg_catalog.jsonb_typeof(snapshot->'items')='array'
    and pg_catalog.jsonb_array_length(snapshot->'items') between 0 and 64
    and not exists(select 1 from pg_catalog.jsonb_array_elements(snapshot->'items') item
      where pg_catalog.jsonb_typeof(item)<>'object'
        or not item ?& array['profile_ref','discovery']
        or (select pg_catalog.count(*)<>2 from pg_catalog.jsonb_object_keys(item))
        or item#>>'{profile_ref,profile_id}'!~'^[a-z][a-z0-9]*(-[a-z0-9]+)*$'
        or item#>>'{profile_ref,revision}'!~'^[1-9][0-9]*$'
        or item#>>'{profile_ref,revision_hash}'!~'^sha256:[0-9a-f]{64}$'
        or item#>>'{discovery,schema_version}'<>'subagent-discovery-descriptor@1.0.0'
        or item#>>'{discovery,access_mode}' not in('READ_ONLY','CONTROLLED_WRITE'))
    and coalesce((select pg_catalog.array_agg(item#>>'{profile_ref,profile_id}' order by ordinal)=
        pg_catalog.array_agg(distinct item#>>'{profile_ref,profile_id}'
          order by item#>>'{profile_ref,profile_id}')
      from pg_catalog.jsonb_array_elements(snapshot->'items') with ordinality entry(item,ordinal)),true)
    and snapshot->>'snapshot_hash'=app_data_agent.u2_canonical_sha256(snapshot-'snapshot_hash');
$function$;

create function app_data_agent.commit_subagent_catalog_snapshot_internal(
  requested_idempotency_key text,snapshot jsonb)
returns jsonb language plpgsql volatile security definer set search_path='' as $function$
declare authority record; existing app_data_agent.subagent_capability_catalog_snapshots%rowtype;
begin
  if pg_catalog.length(requested_idempotency_key) not between 8 and 128
    or not app_data_agent.subagent_catalog_snapshot_is_valid(snapshot,snapshot->>'run_id')
  then raise exception using errcode='22023',message='SUBAGENT_CATALOG_SNAPSHOT_INVALID'; end if;
  select * into strict authority from platform.current_backend_authority(true);
  if snapshot#>>'{scope,app_id}'<>authority.app_id::text
    or snapshot#>>'{scope,tenant_id}'<>authority.tenant_id::text
    or snapshot#>>'{scope,environment}'<>authority.environment
    or snapshot->>'principal_id'<>authority.principal_id::text
  then raise exception using errcode='42501',message='SUBAGENT_CATALOG_SCOPE_DENIED'; end if;
  select * into existing from app_data_agent.subagent_capability_catalog_snapshots
  where app_id=authority.app_id and tenant_id=authority.tenant_id
    and environment=authority.environment and principal_id=authority.principal_id
    and run_id=(snapshot->>'run_id')::uuid for share;
  if found then
    if existing.snapshot_hash<>snapshot->>'snapshot_hash'
      or existing.idempotency_key<>requested_idempotency_key
    then raise exception using errcode='23505',message='SUBAGENT_CATALOG_IDEMPOTENCY_CONFLICT'; end if;
    return existing.snapshot_json;
  end if;
  insert into app_data_agent.subagent_capability_catalog_snapshots(
    app_id,tenant_id,environment,principal_id,run_id,catalog_id,idempotency_key,
    policy_version,snapshot_hash,snapshot_json,committed_at)
  values(authority.app_id,authority.tenant_id,authority.environment,authority.principal_id,
    (snapshot->>'run_id')::uuid,(snapshot->>'catalog_id')::uuid,requested_idempotency_key,
    snapshot->>'policy_version',snapshot->>'snapshot_hash',snapshot,pg_catalog.clock_timestamp());
  return snapshot;
end
$function$;

create function app_data_agent.load_subagent_catalog_snapshot(
  requested_run_id uuid,requested_catalog_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $function$
declare authority record; snapshot jsonb;
begin
  select * into strict authority from platform.current_backend_authority(false);
  select row.snapshot_json into snapshot
  from app_data_agent.subagent_capability_catalog_snapshots row
  where row.app_id=authority.app_id and row.tenant_id=authority.tenant_id
    and row.environment=authority.environment and row.principal_id=authority.principal_id
    and row.run_id=requested_run_id and row.catalog_id=requested_catalog_id;
  return snapshot;
end
$function$;
