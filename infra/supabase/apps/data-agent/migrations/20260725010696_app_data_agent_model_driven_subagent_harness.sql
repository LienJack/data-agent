-- model_driven_subagent_harness_migration_checksum: sha256:8e74cfd247270428117ffed554f6020ba0c752881d19012d3ad64438acecdac2
-- 10696 adds Product Profile v2 discovery and frozen Root Harness catalogs.
begin;

do $bootstrap$
begin
  if pg_catalog.current_setting('server_version_num')::integer not between 170000 and 179999 then
    raise exception using errcode='0A000',message='SUBAGENT_HARNESS_POSTGRES_VERSION_UNSUPPORTED';
  end if;
  if session_user<>'postgres' or current_user<>'postgres' then
    raise exception using errcode='42501',message='SUBAGENT_HARNESS_MIGRATION_EXECUTOR_UNSAFE';
  end if;
  if not exists(select 1 from platform.migration_ledger where owner_kind='app'
    and app_id='00000000-0000-4000-8000-00000000da01'::uuid
    and migration_version='20260725010695_app_data_agent_semantic_provider_preflight_failure_recovery')
  then raise exception using errcode='P0001',message='SUBAGENT_HARNESS_BASELINE_10695_MISSING'; end if;
end
$bootstrap$;

set local lock_timeout='2000ms';
set local statement_timeout='300000ms';
set local idle_in_transaction_session_timeout='60000ms';
select platform.acquire_migration_lock('app','00000000-0000-4000-8000-00000000da01'::uuid);
do $profile_constraints$
declare constraint_name text;
begin
  for constraint_name in
    select con.conname from pg_catalog.pg_constraint con
    where con.conrelid='app_data_agent.agent_product_profile_revisions'::regclass
      and con.contype='c'
      and (pg_catalog.pg_get_constraintdef(con.oid) like '%profile_id IN (%'
        or pg_catalog.pg_get_constraintdef(con.oid) like '%agent-product-profile-revision@1.0.0%')
  loop
    execute pg_catalog.format(
      'alter table app_data_agent.agent_product_profile_revisions drop constraint %I',
      constraint_name);
  end loop;
end
$profile_constraints$;

alter table app_data_agent.agent_product_profile_revisions
  add constraint agent_product_profile_revisions_generic_profile_id_check
    check(profile_id~'^[a-z][a-z0-9]*(-[a-z0-9]+)*$' and pg_catalog.length(profile_id) between 3 and 64),
  add constraint agent_product_profile_revisions_document_version_check
    check(document_json->>'schema_version' in(
      'agent-product-profile-revision@1.0.0','agent-product-profile-revision@2.0.0')
      and document_json->>'profile_id'=profile_id
      and (document_json->>'revision')::bigint=revision
      and document_json->>'approval_status'=approval_status
      and (document_json->>'schema_version'<>'agent-product-profile-revision@2.0.0'
        or (pg_catalog.jsonb_typeof(document_json->'discovery')='object'
          and document_json#>>'{discovery,schema_version}'='subagent-discovery-descriptor@1.0.0'
          and document_json#>'{discovery,produced_artifact_types}'=
            document_json->'expected_output_artifact_types')));

create function app_data_agent.list_agent_profile_revisions_v2(enabled_only boolean)
returns jsonb language plpgsql stable security definer set search_path='' as $function$
declare authority record; items jsonb;
begin
  if not pg_catalog.pg_has_role(session_user,'data_agent_backend','USAGE') then
    raise exception using errcode='42501',message='DA_BACKEND_ROLE_REQUIRED'; end if;
  select * into authority from platform.current_backend_authority(false);
  select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
    'schema_version','agent-product-profile-registry-item@2.0.0','revision',revision.document_json,
    'head',pg_catalog.jsonb_build_object(
      'schema_version','agent-product-profile-head@2.0.0',
      'scope',pg_catalog.jsonb_build_object('app_id',head.app_id,'tenant_id',head.tenant_id,
        'environment',head.environment),'profile_id',head.profile_id,
      'active_revision',head.active_revision,'active_revision_hash',head.active_revision_hash,
      'lifecycle',head.lifecycle,'version',head.version,'updated_at',head.updated_at))
    order by head.profile_id),'[]'::jsonb) into items
  from app_data_agent.agent_product_profile_heads head
  join app_data_agent.agent_product_profile_revisions revision
    on revision.app_id=head.app_id and revision.tenant_id=head.tenant_id
    and revision.environment=head.environment and revision.profile_id=head.profile_id
    and revision.revision=head.active_revision and revision.revision_hash=head.active_revision_hash
  where head.app_id=authority.app_id and head.tenant_id=authority.tenant_id
    and head.environment=authority.environment
    and revision.document_json->>'schema_version'='agent-product-profile-revision@2.0.0'
    and (not enabled_only or (head.lifecycle='ENABLED' and revision.approval_status='APPROVED'));
  return pg_catalog.jsonb_build_object(
    'schema_version','agent-product-profile-list-result@2.0.0','items',items);
end
$function$;

do $seed_v2_profiles$
declare source record; next_revision bigint; discovery jsonb; draft jsonb; revision_hash text;
begin
  for source in
    select head.*,revision.document_json from app_data_agent.agent_product_profile_heads head
    join app_data_agent.agent_product_profile_revisions revision
      on revision.app_id=head.app_id and revision.tenant_id=head.tenant_id
      and revision.environment=head.environment and revision.profile_id=head.profile_id
      and revision.revision=head.active_revision and revision.revision_hash=head.active_revision_hash
    where head.profile_id in(
      'governed-text2sql-agent','report-writing-agent','semantic-management-agent')
      and revision.document_json->>'schema_version'='agent-product-profile-revision@1.0.0'
  loop
    select pg_catalog.max(revision)+1 into strict next_revision
    from app_data_agent.agent_product_profile_revisions
    where app_id=source.app_id and tenant_id=source.tenant_id
      and environment=source.environment and profile_id=source.profile_id;
    discovery:=case source.profile_id
      when 'semantic-management-agent' then pg_catalog.jsonb_build_object(
        'schema_version','subagent-discovery-descriptor@1.0.0',
        'display_name','Semantic Management Agent',
        'description','Reads frozen semantic objects, relationships, lineage, and governed definitions.',
        'when_to_use',pg_catalog.jsonb_build_array(
          'Use for semantic relationships, dependencies, lineage, metric definitions, and semantic context.'),
        'when_not_to_use',pg_catalog.jsonb_build_array(
          'Do not use to execute arbitrary SQL or publish semantic mutations.'),
        'examples',pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
          'request','Explain dependencies between tables from the frozen relationship graph.',
          'expected_use','Read semantic relationships and return governed analysis evidence.')),
        'accepted_input_artifact_types','[]'::jsonb,
        'produced_artifact_types',source.document_json->'expected_output_artifact_types',
        'access_mode','READ_ONLY')
      when 'governed-text2sql-agent' then pg_catalog.jsonb_build_object(
        'schema_version','subagent-discovery-descriptor@1.0.0',
        'display_name','Governed Text2SQL Agent',
        'description','Compiles and executes governed analytical queries against the frozen data context.',
        'when_to_use',pg_catalog.jsonb_build_array(
          'Use when the request requires database values, aggregates, rankings, trends, or rows.'),
        'when_not_to_use',pg_catalog.jsonb_build_array(
          'Do not use for semantic graph relationships that require no SQL execution.'),
        'examples',pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
          'request','Show monthly sales trend for the current workspace.',
          'expected_use','Produce accepted QueryEvidence from governed SQL execution.')),
        'accepted_input_artifact_types','[]'::jsonb,
        'produced_artifact_types',source.document_json->'expected_output_artifact_types',
        'access_mode','READ_ONLY')
      else pg_catalog.jsonb_build_object(
        'schema_version','subagent-discovery-descriptor@1.0.0',
        'display_name','Report Writing Agent',
        'description','Builds formal reports only from already accepted governed evidence.',
        'when_to_use',pg_catalog.jsonb_build_array(
          'Use after accepted QueryEvidence or analysis Artifacts exist and a formal report is requested.'),
        'when_not_to_use',pg_catalog.jsonb_build_array(
          'Do not use without accepted input evidence and do not query databases directly.'),
        'examples',pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
          'request','Turn accepted sales evidence into a formal report.',
          'expected_use','Consume accepted evidence and produce an AnalysisReport.')),
        'accepted_input_artifact_types',pg_catalog.jsonb_build_array('QueryEvidence'),
        'produced_artifact_types',source.document_json->'expected_output_artifact_types',
        'access_mode','READ_ONLY') end;
    draft:=(source.document_json-'schema_version'-'revision'-'revision_hash')||
      pg_catalog.jsonb_build_object(
        'schema_version','agent-product-profile-revision@2.0.0',
        'revision',next_revision,'discovery',discovery);
    revision_hash:=app_data_agent.u2_canonical_sha256(draft);
    insert into app_data_agent.agent_product_profile_revisions(
      app_id,tenant_id,environment,profile_id,revision,revision_hash,approval_status,
      document_json,created_by,created_at)
    values(source.app_id,source.tenant_id,source.environment,source.profile_id,next_revision,
      revision_hash,source.document_json->>'approval_status',
      draft||pg_catalog.jsonb_build_object('revision_hash',revision_hash),
      source.updated_by,pg_catalog.clock_timestamp());
    update app_data_agent.agent_product_profile_heads set
      active_revision=next_revision,active_revision_hash=revision_hash,version=version+1,
      updated_at=pg_catalog.clock_timestamp()
    where app_id=source.app_id and tenant_id=source.tenant_id
      and environment=source.environment and profile_id=source.profile_id;
  end loop;
end
$seed_v2_profiles$;
create function app_data_agent.commit_agent_profile_revision_v2(command jsonb)
returns jsonb language plpgsql volatile security definer set search_path='' as $function$
declare
  authority record; existing_receipt app_data_agent.agent_product_profile_operation_receipts%rowtype;
  existing_document jsonb; head_record app_data_agent.agent_product_profile_heads%rowtype;
  revision_document jsonb; profile_id_value text; revision_value bigint; revision_hash_value text;
  expected_version bigint; target_lifecycle_value text; now_at timestamptz; result_document jsonb;
begin
  if not pg_catalog.pg_has_role(session_user,'data_agent_backend','USAGE') then
    raise exception using errcode='42501',message='DA_BACKEND_ROLE_REQUIRED'; end if;
  if command is null or not app_data_agent.resolved_context_exact_keys(command,array[
    'schema_version','operation_id','idempotency_key','actor_principal_id','revision',
    'expected_head_version','target_lifecycle','command_hash']::text[])
    or command->>'schema_version'<>'agent-product-profile-commit-command@2.0.0'
    or command->>'command_hash'<>app_data_agent.u2_canonical_sha256(command-'command_hash')
    or pg_catalog.length(command->>'idempotency_key') not between 8 and 128
  then raise exception using errcode='22023',message='AGENT_PROFILE_COMMAND_INVALID'; end if;
  select * into strict authority from platform.current_backend_authority(true);
  if pg_catalog.lower(authority.membership_role)<>'owner'
    or (command->>'actor_principal_id')::uuid<>authority.principal_id
  then raise exception using errcode='42501',message='AGENT_PROFILE_MANAGE_REQUIRED'; end if;
  revision_document:=command->'revision';
  if revision_document#>'{scope}'<>pg_catalog.jsonb_build_object(
    'app_id',authority.app_id,'tenant_id',authority.tenant_id,'environment',authority.environment)
  then raise exception using errcode='42501',message='AGENT_PROFILE_SCOPE_MISMATCH'; end if;
  profile_id_value:=revision_document->>'profile_id';
  revision_value:=(revision_document->>'revision')::bigint;
  revision_hash_value:=revision_document->>'revision_hash';
  expected_version:=(command->>'expected_head_version')::bigint;
  target_lifecycle_value:=command->>'target_lifecycle';
  if profile_id_value!~'^[a-z][a-z0-9]*(-[a-z0-9]+)*$'
    or pg_catalog.length(profile_id_value) not between 3 and 64
    or revision_document->>'schema_version'<>'agent-product-profile-revision@2.0.0'
    or revision_document#>>'{runtime_profile_ref,profile_id}'<>profile_id_value
    or revision_hash_value<>app_data_agent.u2_canonical_sha256(revision_document-'revision_hash')
    or revision_document->>'approval_status' not in ('APPROVED','QUARANTINED')
    or target_lifecycle_value not in ('ENABLED','DISABLED','QUARANTINED')
    or (target_lifecycle_value='ENABLED' and revision_document->>'approval_status'<>'APPROVED')
    or revision_document#>>'{discovery,schema_version}'<>'subagent-discovery-descriptor@1.0.0'
    or revision_document#>'{discovery,produced_artifact_types}'<>
      revision_document->'expected_output_artifact_types'
    or revision_document#>>'{discovery,access_mode}' not in('READ_ONLY','CONTROLLED_WRITE')
    or pg_catalog.jsonb_array_length(revision_document->'skill_refs')<1
    or not exists(select 1 from app_data_agent.agent_profile_revisions runtime_profile
      where runtime_profile.profile_id=profile_id_value
        and runtime_profile.profile_revision=
          (revision_document#>>'{runtime_profile_ref,revision}')::integer
        and runtime_profile.profile_hash=revision_document#>>'{runtime_profile_ref,profile_hash}'
        and runtime_profile.profile_json->'direct_tool_allowlist'=
          revision_document->'direct_tool_allowlist'
        and runtime_profile.profile_json->'expected_output_artifact_types'=
          revision_document->'expected_output_artifact_types'
        and app_data_agent.u2_canonical_sha256(runtime_profile.profile_json->'verifier')=
          revision_document->>'verifier_contract_hash')
    or exists(select 1 from pg_catalog.jsonb_array_elements(
        revision_document->'skill_refs') skill_ref(document)
      where not exists(select 1 from app_data_agent.skill_revisions skill
        join app_data_agent.skill_heads skill_head on skill_head.app_id=skill.app_id
          and skill_head.tenant_id=skill.tenant_id and skill_head.environment=skill.environment
          and skill_head.skill_id=skill.skill_id and skill_head.active_revision=skill.revision
          and skill_head.active_revision_hash=skill.revision_hash
        where skill.app_id=authority.app_id and skill.tenant_id=authority.tenant_id
          and skill.environment=authority.environment
          and skill.skill_id=(skill_ref.document->>'skill_id')::uuid
          and skill.revision=(skill_ref.document->>'revision')::bigint
          and skill.revision_hash=skill_ref.document->>'revision_hash'
          and skill.approval_status='APPROVED' and skill_head.lifecycle='ENABLED'
          and not exists(select 1 from pg_catalog.jsonb_array_elements_text(
            skill.document_json->'capabilities') capability(value)
            where not (revision_document->'direct_tool_allowlist') ? capability.value)
          and not exists(select 1 from app_data_agent.skill_signer_revocations revocation
            where revocation.app_id=skill.app_id and revocation.tenant_id=skill.tenant_id
              and revocation.environment=skill.environment and revocation.signer_id=skill.signer_id)))
  then raise exception using errcode='23514',message='AGENT_PROFILE_REVISION_INVALID'; end if;
  select * into existing_receipt from app_data_agent.agent_product_profile_operation_receipts receipt
  where receipt.app_id=authority.app_id and receipt.tenant_id=authority.tenant_id
    and receipt.environment=authority.environment and receipt.actor_principal_id=authority.principal_id
    and receipt.idempotency_key=command->>'idempotency_key' for share;
  if found then
    if existing_receipt.command_hash<>command->>'command_hash' then
      raise exception using errcode='23505',message='AGENT_PROFILE_OPERATION_CONFLICT'; end if;
    return pg_catalog.jsonb_set(existing_receipt.result_json,'{disposition}','"REPLAYED"'::jsonb,false);
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    authority.app_id::text||':'||authority.tenant_id::text||':'||authority.environment||
    ':AGENT_PROFILE:'||profile_id_value,0));
  now_at:=pg_catalog.clock_timestamp();
  insert into app_data_agent.agent_product_profile_revisions(app_id,tenant_id,environment,
    profile_id,revision,revision_hash,approval_status,document_json,created_by,created_at)
  values(authority.app_id,authority.tenant_id,authority.environment,profile_id_value,revision_value,
    revision_hash_value,revision_document->>'approval_status',revision_document,authority.principal_id,now_at)
  on conflict do nothing;
  select document_json into existing_document from app_data_agent.agent_product_profile_revisions
  where app_id=authority.app_id and tenant_id=authority.tenant_id and environment=authority.environment
    and profile_id=profile_id_value and revision=revision_value;
  if existing_document<>revision_document then
    raise exception using errcode='23505',message='AGENT_PROFILE_REVISION_CONFLICT'; end if;
  select * into head_record from app_data_agent.agent_product_profile_heads head
  where head.app_id=authority.app_id and head.tenant_id=authority.tenant_id
    and head.environment=authority.environment and head.profile_id=profile_id_value for update;
  if (found and head_record.version<>expected_version) or (not found and expected_version<>0) then
    raise exception using errcode='40001',message='AGENT_PROFILE_HEAD_VERSION_CONFLICT'; end if;
  insert into app_data_agent.agent_product_profile_heads(app_id,tenant_id,environment,profile_id,
    active_revision,active_revision_hash,lifecycle,version,updated_by,updated_at)
  values(authority.app_id,authority.tenant_id,authority.environment,profile_id_value,revision_value,
    revision_hash_value,target_lifecycle_value,1,authority.principal_id,now_at)
  on conflict(app_id,tenant_id,environment,profile_id) do update set
    active_revision=excluded.active_revision,active_revision_hash=excluded.active_revision_hash,
    lifecycle=excluded.lifecycle,version=app_data_agent.agent_product_profile_heads.version+1,
    updated_by=excluded.updated_by,updated_at=excluded.updated_at;
  select * into strict head_record from app_data_agent.agent_product_profile_heads head
  where head.app_id=authority.app_id and head.tenant_id=authority.tenant_id
    and head.environment=authority.environment and head.profile_id=profile_id_value;
  result_document:=pg_catalog.jsonb_build_object(
    'schema_version','agent-product-profile-commit-result@2.0.0','disposition','COMMITTED',
    'operation_id',command->>'operation_id','command_hash',command->>'command_hash',
    'item',pg_catalog.jsonb_build_object(
      'schema_version','agent-product-profile-registry-item@2.0.0','revision',revision_document,
      'head',pg_catalog.jsonb_build_object(
        'schema_version','agent-product-profile-head@2.0.0',
        'scope',pg_catalog.jsonb_build_object('app_id',head_record.app_id,
          'tenant_id',head_record.tenant_id,'environment',head_record.environment),
        'profile_id',head_record.profile_id,'active_revision',head_record.active_revision,
        'active_revision_hash',head_record.active_revision_hash,'lifecycle',head_record.lifecycle,
        'version',head_record.version,'updated_at',head_record.updated_at)));
  insert into app_data_agent.agent_product_profile_operation_receipts(app_id,tenant_id,environment,
    actor_principal_id,operation_id,idempotency_key,command_hash,result_json,committed_at)
  values(authority.app_id,authority.tenant_id,authority.environment,authority.principal_id,
    (command->>'operation_id')::uuid,command->>'idempotency_key',command->>'command_hash',result_document,now_at);
  return result_document;
exception when invalid_text_representation or numeric_value_out_of_range then
  raise exception using errcode='22023',message='AGENT_PROFILE_COMMAND_INVALID';
end
$function$;
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
do $patch_run_v3$
declare definition text; repaired text; root_payload_branch text; old_acceptance text; new_acceptance text;
begin
  select pg_catalog.pg_get_functiondef('app_data_agent.command_payload_is_valid(jsonb)'::regprocedure)
    into definition;
  root_payload_branch:=E'  if requested_payload ?& array[''schema_version'',''kind'',''executor_version'',''effective_config_ref'',''catalog_snapshot'']\n    and (select pg_catalog.count(*)=5 from pg_catalog.jsonb_object_keys(requested_payload))\n    and requested_payload->>''schema_version''=''effective-config-team-lease@3.0.0''\n    and requested_payload->>''kind''=''START_DATA_AGENT_TEAM''\n    and requested_payload->>''executor_version''=''ROOT_HARNESS@1''\n    and app_data_agent.subagent_catalog_snapshot_is_valid(requested_payload->''catalog_snapshot'',requested_payload#>>''{catalog_snapshot,run_id}'')\n  then return true; end if;\n';
  repaired:=pg_catalog.replace(definition,
    E'  payload_kind:=requested_payload->>''kind'';',root_payload_branch||E'  payload_kind:=requested_payload->>''kind'';');
  if repaired=definition then
    raise exception using errcode='P0001',message='SUBAGENT_HARNESS_COMMAND_VALIDATOR_DRIFT'; end if;
  execute repaired;

  select pg_catalog.pg_get_functiondef(
    'app_data_agent.accept_question_run_with_effective_config(jsonb,jsonb)'::regprocedure)
    into definition;
  repaired:=pg_catalog.replace(definition,
    E'or (select pg_catalog.count(*) not in (7,9) from pg_catalog.jsonb_object_keys(requested_command))',
    E'or (select pg_catalog.count(*) not in (7,8,9) from pg_catalog.jsonb_object_keys(requested_command))');
  repaired:=pg_catalog.replace(repaired,
    E'''dispatch_admission'',''shadow_dispatch_plan''))',
    E'''dispatch_admission'',''shadow_dispatch_plan'',''subagent_catalog_snapshot''))');
  repaired:=pg_catalog.replace(repaired,
    E'or ((select pg_catalog.count(*)=9 from pg_catalog.jsonb_object_keys(requested_command))',
    E'or ((select pg_catalog.count(*)=8 from pg_catalog.jsonb_object_keys(requested_command))\n      and (not requested_command ? ''subagent_catalog_snapshot''\n        or not app_data_agent.subagent_catalog_snapshot_is_valid(requested_command->''subagent_catalog_snapshot'',requested_config->>''run_id'')))\n    or ((select pg_catalog.count(*)=9 from pg_catalog.jsonb_object_keys(requested_command))');
  old_acceptance:=E'  if requested_command ? ''dispatch_admission'' then\n    perform app_data_agent.commit_agent_dispatch_execute_internal(requested_idempotency_key,requested_command->''dispatch_admission'',requested_command->''shadow_dispatch_plan'');\n    accepted_payload := pg_catalog.jsonb_build_object(\n      ''schema_version'',''effective-config-team-lease@2.0.0'',''kind'',''START_DATA_AGENT_TEAM'',\n      ''executor_version'',requested_command#>>''{dispatch_admission,binding,effective_executor_version}'',\n      ''effective_config_ref'',config_ref,\n      ''profile_refs'',requested_command#>''{dispatch_admission,binding,selected_profile_refs}'',\n      ''dispatch_plan'',requested_command#>''{dispatch_admission,plan}'',\n      ''dispatch_binding'',requested_command#>''{dispatch_admission,binding}'');\n    accepted_command := (requested_command-''dispatch_admission''::text-''shadow_dispatch_plan''::text) || pg_catalog.jsonb_build_object(''payload'',accepted_payload);\n  else\n    accepted_payload := pg_catalog.jsonb_build_object(\n      ''kind'',''START_L2_RESEARCH'',''effective_config_ref'',config_ref);\n    accepted_command := requested_command || pg_catalog.jsonb_build_object(''payload'',accepted_payload);\n  end if;';
  new_acceptance:=E'  if requested_command ? ''subagent_catalog_snapshot'' then\n    perform app_data_agent.commit_subagent_catalog_snapshot_internal(requested_idempotency_key,requested_command->''subagent_catalog_snapshot'');\n    accepted_payload := pg_catalog.jsonb_build_object(\n      ''schema_version'',''effective-config-team-lease@3.0.0'',''kind'',''START_DATA_AGENT_TEAM'',\n      ''executor_version'',''ROOT_HARNESS@1'',''effective_config_ref'',config_ref,\n      ''catalog_snapshot'',requested_command->''subagent_catalog_snapshot'');\n    accepted_command := (requested_command-''subagent_catalog_snapshot''::text) || pg_catalog.jsonb_build_object(''payload'',accepted_payload);\n  elsif requested_command ? ''dispatch_admission'' then\n    perform app_data_agent.commit_agent_dispatch_execute_internal(requested_idempotency_key,requested_command->''dispatch_admission'',requested_command->''shadow_dispatch_plan'');\n    accepted_payload := pg_catalog.jsonb_build_object(\n      ''schema_version'',''effective-config-team-lease@2.0.0'',''kind'',''START_DATA_AGENT_TEAM'',\n      ''executor_version'',requested_command#>>''{dispatch_admission,binding,effective_executor_version}'',\n      ''effective_config_ref'',config_ref,\n      ''profile_refs'',requested_command#>''{dispatch_admission,binding,selected_profile_refs}'',\n      ''dispatch_plan'',requested_command#>''{dispatch_admission,plan}'',\n      ''dispatch_binding'',requested_command#>''{dispatch_admission,binding}'');\n    accepted_command := (requested_command-''dispatch_admission''::text-''shadow_dispatch_plan''::text) || pg_catalog.jsonb_build_object(''payload'',accepted_payload);\n  else\n    accepted_payload := pg_catalog.jsonb_build_object(\n      ''kind'',''START_L2_RESEARCH'',''effective_config_ref'',config_ref);\n    accepted_command := requested_command || pg_catalog.jsonb_build_object(''payload'',accepted_payload);\n  end if;';
  repaired:=pg_catalog.replace(repaired,old_acceptance,new_acceptance);
  if repaired=definition then
    raise exception using errcode='P0001',message='SUBAGENT_HARNESS_ACCEPTANCE_FUNCTION_DRIFT'; end if;
  execute repaired;
end
$patch_run_v3$;
alter table app_data_agent.subagent_capability_catalog_snapshots owner to data_agent_u19_team_owner;
alter function app_data_agent.subagent_catalog_snapshot_is_valid(jsonb,text)
  owner to data_agent_u19_team_owner;
alter function app_data_agent.commit_subagent_catalog_snapshot_internal(text,jsonb)
  owner to data_agent_u19_team_owner;
alter function app_data_agent.load_subagent_catalog_snapshot(uuid,uuid)
  owner to data_agent_u19_team_owner;
alter function app_data_agent.list_agent_profile_revisions_v2(boolean)
  owner to data_agent_u20_profile_owner;
alter function app_data_agent.commit_agent_profile_revision_v2(jsonb)
  owner to data_agent_u20_profile_owner;

revoke all on app_data_agent.subagent_capability_catalog_snapshots from public,data_agent_backend;
revoke all on function app_data_agent.subagent_catalog_snapshot_is_valid(jsonb,text),
  app_data_agent.commit_subagent_catalog_snapshot_internal(text,jsonb),
  app_data_agent.load_subagent_catalog_snapshot(uuid,uuid),
  app_data_agent.list_agent_profile_revisions_v2(boolean),
  app_data_agent.commit_agent_profile_revision_v2(jsonb) from public;
grant execute on function app_data_agent.load_subagent_catalog_snapshot(uuid,uuid)
  to data_agent_backend;
grant execute on function app_data_agent.list_agent_profile_revisions_v2(boolean),
  app_data_agent.commit_agent_profile_revision_v2(jsonb) to data_agent_backend;
grant execute on function app_data_agent.commit_subagent_catalog_snapshot_internal(text,jsonb)
  to data_agent_effective_config_rpc_owner;

do $postconditions$
begin
  if not pg_catalog.has_function_privilege('data_agent_backend',
      'app_data_agent.load_subagent_catalog_snapshot(uuid,uuid)','EXECUTE')
    or not pg_catalog.has_function_privilege('data_agent_backend',
      'app_data_agent.list_agent_profile_revisions_v2(boolean)','EXECUTE')
    or not pg_catalog.has_function_privilege('data_agent_backend',
      'app_data_agent.commit_agent_profile_revision_v2(jsonb)','EXECUTE')
    or not pg_catalog.has_function_privilege('data_agent_effective_config_rpc_owner',
      'app_data_agent.commit_subagent_catalog_snapshot_internal(text,jsonb)','EXECUTE')
    or pg_catalog.has_table_privilege('data_agent_backend',
      'app_data_agent.subagent_capability_catalog_snapshots','INSERT')
    or pg_catalog.strpos(pg_catalog.pg_get_functiondef(
      'app_data_agent.command_payload_is_valid(jsonb)'::regprocedure),
      'effective-config-team-lease@3.0.0')=0
    or pg_catalog.strpos(pg_catalog.pg_get_functiondef(
      'app_data_agent.accept_question_run_with_effective_config(jsonb,jsonb)'::regprocedure),
      'subagent_catalog_snapshot')=0
    or exists(select 1 from app_data_agent.agent_product_profile_heads head
      join app_data_agent.agent_product_profile_revisions revision
        on revision.app_id=head.app_id and revision.tenant_id=head.tenant_id
        and revision.environment=head.environment and revision.profile_id=head.profile_id
        and revision.revision=head.active_revision and revision.revision_hash=head.active_revision_hash
      where head.profile_id in(
        'governed-text2sql-agent','report-writing-agent','semantic-management-agent')
        and revision.document_json->>'schema_version'<>'agent-product-profile-revision@2.0.0')
  then raise exception using errcode='P0001',message='SUBAGENT_HARNESS_POSTCONDITION_FAILED'; end if;
end
$postconditions$;
select platform.assert_migration_checksum(
  'app','00000000-0000-4000-8000-00000000da01'::uuid,
  '20260725010696_app_data_agent_model_driven_subagent_harness',
  'sha256:8e74cfd247270428117ffed554f6020ba0c752881d19012d3ad64438acecdac2');

commit;
