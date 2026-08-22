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
