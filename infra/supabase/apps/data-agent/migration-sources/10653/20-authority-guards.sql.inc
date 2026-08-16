create function app_data_agent.reject_effective_config_authority_mutation()
returns trigger
language plpgsql
set search_path = ''
as $function$
begin
  raise exception using errcode = '55000', message = 'EFFECTIVE_CONFIG_AUTHORITY_IMMUTABLE';
end
$function$;

create function app_data_agent.guard_workspace_run_defaults_update()
returns trigger
language plpgsql
set search_path = ''
as $function$
begin
  if new.app_id is distinct from old.app_id
    or new.tenant_id is distinct from old.tenant_id
    or new.environment is distinct from old.environment
    or new.defaults_id is distinct from old.defaults_id
    or new.defaults_revision <> old.defaults_revision + 1
    or new.revision_id = old.revision_id
    or new.updated_by_principal_id is null
    or new.updated_at < old.updated_at
  then
    raise exception using errcode = '40001', message = 'WORKSPACE_RUN_DEFAULTS_CAS_CONFLICT';
  end if;
  return new;
end
$function$;

create trigger workspace_run_defaults_update_guard
before update or delete on app_data_agent.workspace_run_defaults
for each row execute function app_data_agent.guard_workspace_run_defaults_update();

create trigger workspace_run_default_revisions_immutable
before update or delete on app_data_agent.workspace_run_default_revisions
for each row execute function app_data_agent.reject_effective_config_authority_mutation();

create trigger effective_run_config_receipts_immutable
before update or delete on app_data_agent.effective_run_config_receipts
for each row execute function app_data_agent.reject_effective_config_authority_mutation();

create trigger effective_run_config_resource_bindings_immutable
before update or delete on app_data_agent.effective_run_config_resource_bindings
for each row execute function app_data_agent.reject_effective_config_authority_mutation();

create trigger effective_config_context_receipts_immutable
before update or delete on app_data_agent.effective_config_context_receipts
for each row execute function app_data_agent.reject_effective_config_authority_mutation();

alter table app_data_agent.workspace_run_defaults enable row level security;
alter table app_data_agent.workspace_run_defaults force row level security;
alter table app_data_agent.workspace_run_default_revisions enable row level security;
alter table app_data_agent.workspace_run_default_revisions force row level security;
alter table app_data_agent.effective_run_config_receipts enable row level security;
alter table app_data_agent.effective_run_config_receipts force row level security;
alter table app_data_agent.effective_run_config_resource_bindings enable row level security;
alter table app_data_agent.effective_run_config_resource_bindings force row level security;
alter table app_data_agent.effective_config_context_receipts enable row level security;
alter table app_data_agent.effective_config_context_receipts force row level security;

create policy workspace_run_defaults_rpc_owner
on app_data_agent.workspace_run_defaults for all
to data_agent_effective_config_rpc_owner using (true) with check (true);
create policy workspace_run_default_revisions_rpc_owner
on app_data_agent.workspace_run_default_revisions for all
to data_agent_effective_config_rpc_owner using (true) with check (true);
create policy effective_run_config_receipts_rpc_owner
on app_data_agent.effective_run_config_receipts for all
to data_agent_effective_config_rpc_owner using (true) with check (true);
create policy effective_run_config_resource_bindings_rpc_owner
on app_data_agent.effective_run_config_resource_bindings for all
to data_agent_effective_config_rpc_owner using (true) with check (true);
create policy effective_config_context_receipts_rpc_owner
on app_data_agent.effective_config_context_receipts for all
to data_agent_effective_config_rpc_owner using (true) with check (true);

create function app_data_agent.canonical_uuid_json_string_is_valid(value jsonb)
returns boolean language sql immutable set search_path = '' as $function$
  select pg_catalog.jsonb_typeof(value) = 'string'
    and value #>> '{}' ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$';
$function$;

create function app_data_agent.versioned_resource_reference_is_valid(value jsonb)
returns boolean language sql immutable set search_path = '' as $function$
  select pg_catalog.jsonb_typeof(value) = 'object'
    and value ?& array['resource_id','resource_revision','resource_hash']
    and not exists (select 1 from pg_catalog.jsonb_object_keys(value) key(name)
      where key.name not in ('resource_id','resource_revision','resource_hash'))
    and app_data_agent.canonical_uuid_json_string_is_valid(value -> 'resource_id')
    and pg_catalog.jsonb_typeof(value -> 'resource_revision') = 'number'
    and (value ->> 'resource_revision') ~ '^[1-9][0-9]*$'
    and value ->> 'resource_hash' ~ '^sha256:[0-9a-f]{64}$';
$function$;

create function app_data_agent.versioned_resource_array_is_valid(value jsonb)
returns boolean language sql immutable set search_path = '' as $function$
  select pg_catalog.jsonb_typeof(value) = 'array'
    and pg_catalog.jsonb_array_length(value) <= 128
    and not exists (
      select 1 from pg_catalog.jsonb_array_elements(value) with ordinality item(document,ordinal)
      where not app_data_agent.versioned_resource_reference_is_valid(item.document)
        or exists (select 1 from pg_catalog.jsonb_array_elements(value) with ordinality prior(document,ordinal)
          where prior.ordinal < item.ordinal
            and prior.document ->> 'resource_id' >= item.document ->> 'resource_id')
    );
$function$;

-- U2 ships three immutable built-in policy revisions. Their values, IDs and
-- canonical hashes are server-owned; Defaults may reference but never define them.
create function app_data_agent.builtin_effective_config_policy(policy_kind text)
returns jsonb language sql immutable set search_path = '' as $function$
  select case policy_kind
    when 'CONTEXT_POLICY' then pg_catalog.jsonb_build_object(
      'resource_id','00000000-0000-4000-8000-0000000053c1'::uuid,'resource_revision',1,
      'resource_hash',platform.canonical_sha256(pg_catalog.jsonb_build_object(
        'schema_version','effective-context-policy@1.0.0','max_context_tokens',128000,
        'max_resource_bindings',1024)),
      'max_context_tokens',128000,'max_resource_bindings',1024)
    when 'EGRESS_POLICY' then pg_catalog.jsonb_build_object(
      'resource_id','00000000-0000-4000-8000-0000000053e1'::uuid,'resource_revision',1,
      'resource_hash',platform.canonical_sha256(pg_catalog.jsonb_build_object(
        'schema_version','effective-egress-policy@1.0.0',
        'allowed_providers',pg_catalog.jsonb_build_array('deepseek','gemini','glm','grok','kimi','openai'),
        'allowed_audiences',pg_catalog.jsonb_build_array('PRIVATE','WORKSPACE'),
        'classification','INTERNAL')),
      'allowed_providers',pg_catalog.jsonb_build_array('deepseek','gemini','glm','grok','kimi','openai'),
      'allowed_audiences',pg_catalog.jsonb_build_array('PRIVATE','WORKSPACE'),
      'classification','INTERNAL')
    when 'EXECUTION_SAFETY_POLICY' then pg_catalog.jsonb_build_object(
      'resource_id','00000000-0000-4000-8000-0000000053f1'::uuid,'resource_revision',1,
      'resource_hash',platform.canonical_sha256(pg_catalog.jsonb_build_object(
        'schema_version','effective-execution-safety-policy@1.0.0','max_tool_calls',10000,
        'max_provider_calls',10000,'max_elapsed_ms',9007199254740991)),
      'max_tool_calls',10000,'max_provider_calls',10000,'max_elapsed_ms',9007199254740991)
    else null end;
$function$;

create function app_data_agent.requested_defaults_resource_reference_is_valid(document jsonb)
returns boolean language sql immutable set search_path = '' as $function$
  select pg_catalog.jsonb_typeof(document) = 'object'
    and document ?& array['resource_id','expected_revision']
    and (select pg_catalog.count(*) = 2 from pg_catalog.jsonb_object_keys(document))
    and app_data_agent.canonical_uuid_json_string_is_valid(document -> 'resource_id')
    and pg_catalog.jsonb_typeof(document -> 'expected_revision') = 'number'
    and document ->> 'expected_revision' ~ '^[1-9][0-9]*$';
$function$;

create function app_data_agent.requested_defaults_resource_array_is_valid(document jsonb)
returns boolean language sql immutable set search_path = '' as $function$
  select pg_catalog.jsonb_typeof(document) = 'array'
    and pg_catalog.jsonb_array_length(document) <= 128
    and not exists (
      select 1
      from pg_catalog.jsonb_array_elements(document) with ordinality item(value,ordinal)
      where not app_data_agent.requested_defaults_resource_reference_is_valid(item.value)
        or exists (
          select 1 from pg_catalog.jsonb_array_elements(document) with ordinality prior(value,ordinal)
          where prior.ordinal < item.ordinal
            and (prior.value ->> 'resource_id' > item.value ->> 'resource_id'
              or (prior.value ->> 'resource_id' = item.value ->> 'resource_id'
                and (prior.value ->> 'expected_revision')::bigint >=
                  (item.value ->> 'expected_revision')::bigint))
        )
        or exists (
          select 1 from pg_catalog.jsonb_array_elements(document) duplicate(value)
          where duplicate.value ->> 'resource_id' = item.value ->> 'resource_id'
          group by duplicate.value ->> 'resource_id' having pg_catalog.count(*) > 1
        )
    );
$function$;

-- Exact workspaceDefaultsSelectionCandidateSchema. PostgreSQL resolves the
-- intent to workspaceDefaultsValueSchema before hashing or persisting it.
create function app_data_agent.workspace_run_defaults_document_is_valid(document jsonb)
returns boolean language sql immutable set search_path = '' as $function$
  select pg_catalog.jsonb_typeof(document) = 'object'
    and document ?& array['model','datasource','files','knowledge','mcp_servers','skills',
      'semantic_release','schema_snapshot','context_policy','egress_policy','execution_safety_policy']
    and not exists (select 1 from pg_catalog.jsonb_object_keys(document) key(name)
      where key.name not in ('model','datasource','files','knowledge','mcp_servers','skills',
        'semantic_release','schema_snapshot','context_policy','egress_policy','execution_safety_policy'))
    and (document -> 'model' = 'null'::jsonb or app_data_agent.requested_defaults_resource_reference_is_valid(document -> 'model'))
    and (document -> 'datasource' = 'null'::jsonb or app_data_agent.requested_defaults_resource_reference_is_valid(document -> 'datasource'))
    and app_data_agent.requested_defaults_resource_array_is_valid(document -> 'files')
    and app_data_agent.requested_defaults_resource_array_is_valid(document -> 'knowledge')
    and app_data_agent.requested_defaults_resource_array_is_valid(document -> 'mcp_servers')
    and app_data_agent.requested_defaults_resource_array_is_valid(document -> 'skills')
    and (document -> 'semantic_release' = 'null'::jsonb or app_data_agent.requested_defaults_resource_reference_is_valid(document -> 'semantic_release'))
    and (document -> 'schema_snapshot' = 'null'::jsonb or app_data_agent.requested_defaults_resource_reference_is_valid(document -> 'schema_snapshot'))
    and app_data_agent.requested_defaults_resource_reference_is_valid(document -> 'context_policy')
    and app_data_agent.requested_defaults_resource_reference_is_valid(document -> 'egress_policy')
    and app_data_agent.requested_defaults_resource_reference_is_valid(document -> 'execution_safety_policy')
    and not app_data_agent.contains_potential_plaintext_secret(document);
$function$;

create function app_data_agent.requested_resource_selection_is_valid(value jsonb, single_value boolean)
returns boolean language sql immutable set search_path = '' as $function$
  select pg_catalog.jsonb_typeof(value) = 'object'
    and value ? 'mode'
    and value ->> 'mode' in ('INHERIT_DEFAULT','EXPLICIT_NONE','RESOURCE_IDS')
    and ((value ->> 'mode' in ('INHERIT_DEFAULT','EXPLICIT_NONE')
      and (select pg_catalog.count(*) = 1 from pg_catalog.jsonb_object_keys(value)))
      or (value ->> 'mode' = 'RESOURCE_IDS'
        and value ? 'resources'
        and (select pg_catalog.count(*) = 2 from pg_catalog.jsonb_object_keys(value))
        and pg_catalog.jsonb_typeof(value -> 'resources') = 'array'
        and pg_catalog.jsonb_array_length(value -> 'resources') between 1 and 128
        and (not single_value or pg_catalog.jsonb_array_length(value -> 'resources') = 1)
        and not exists (
          select 1 from pg_catalog.jsonb_array_elements(value -> 'resources') with ordinality item(document,ordinal)
          where pg_catalog.jsonb_typeof(item.document) <> 'object'
            or not item.document ?& array['resource_id','expected_revision']
            or (select pg_catalog.count(*) <> 2 from pg_catalog.jsonb_object_keys(item.document))
            or not app_data_agent.canonical_uuid_json_string_is_valid(item.document -> 'resource_id')
            or pg_catalog.jsonb_typeof(item.document -> 'expected_revision') <> 'number'
            or item.document ->> 'expected_revision' !~ '^[1-9][0-9]*$'
            or exists (select 1 from pg_catalog.jsonb_array_elements(value -> 'resources') with ordinality prior(document,ordinal)
              where prior.ordinal < item.ordinal and prior.document ->> 'resource_id' >= item.document ->> 'resource_id')
        )));
$function$;

create function app_data_agent.effective_config_request_is_valid(request jsonb)
returns boolean language sql immutable set search_path = '' as $function$
  select pg_catalog.jsonb_typeof(request) = 'object'
    and request ->> 'schema_version' = 'run-config-request@1.0.0'
    and request ->> 'operation' in ('QUESTION_RUN','SEMANTIC_BOOTSTRAP_JOB')
    and request ?& array['schema_version','workspace_id','idempotency_key','defaults_ref',
      'overrides','mentions','operation','request_hash']
    and ((request ->> 'operation' = 'QUESTION_RUN'
        and request ?& array['run_id','conversation_ref']
        and (select pg_catalog.count(*) = 10 from pg_catalog.jsonb_object_keys(request))
        and pg_catalog.jsonb_typeof(request -> 'conversation_ref') = 'object'
        and (select pg_catalog.count(*) = 2 from pg_catalog.jsonb_object_keys(request -> 'conversation_ref'))
        and (request -> 'conversation_ref') ?& array['conversation_id','expected_resource_version']
        and app_data_agent.canonical_uuid_json_string_is_valid(request #> '{conversation_ref,conversation_id}')
        and request #>> '{conversation_ref,expected_resource_version}' ~ '^[1-9][0-9]*$')
      or (request ->> 'operation' = 'SEMANTIC_BOOTSTRAP_JOB'
        and request ? 'job_id'
        and (select pg_catalog.count(*) in (9,10) from pg_catalog.jsonb_object_keys(request))
        and not exists (select 1 from pg_catalog.jsonb_object_keys(request) key(name)
          where key.name not in ('schema_version','workspace_id','idempotency_key','defaults_ref',
            'overrides','mentions','operation','job_id','trigger_question_run_id','request_hash'))
        and app_data_agent.canonical_uuid_json_string_is_valid(request -> 'job_id')
        and (not request ? 'trigger_question_run_id'
          or (app_data_agent.canonical_uuid_json_string_is_valid(request -> 'trigger_question_run_id')
            and request ->> 'trigger_question_run_id' <> request ->> 'job_id'))))
    and app_data_agent.canonical_uuid_json_string_is_valid(request -> 'workspace_id')
    and (request ->> 'operation' <> 'QUESTION_RUN'
      or app_data_agent.canonical_uuid_json_string_is_valid(request -> 'run_id'))
    and request ->> 'request_hash' ~ '^sha256:[0-9a-f]{64}$'
    and pg_catalog.jsonb_typeof(request -> 'defaults_ref') = 'object'
    and (select pg_catalog.count(*) = 3 from pg_catalog.jsonb_object_keys(request -> 'defaults_ref'))
    and app_data_agent.canonical_uuid_json_string_is_valid(request #> '{defaults_ref,defaults_id}')
    and (request #>> '{defaults_ref,defaults_revision}') ~ '^[1-9][0-9]*$'
    and request #>> '{defaults_ref,defaults_hash}' ~ '^sha256:[0-9a-f]{64}$'
    and pg_catalog.jsonb_typeof(request -> 'overrides') = 'object'
    and (request -> 'overrides') ?& array['model','datasource','files','knowledge','mcp_servers','skills','egress']
    and (select pg_catalog.count(*) = 7 from pg_catalog.jsonb_object_keys(request -> 'overrides'))
    and app_data_agent.requested_resource_selection_is_valid(request #> '{overrides,model}',true)
    and app_data_agent.requested_resource_selection_is_valid(request #> '{overrides,datasource}',true)
    and app_data_agent.requested_resource_selection_is_valid(request #> '{overrides,files}',false)
    and app_data_agent.requested_resource_selection_is_valid(request #> '{overrides,knowledge}',false)
    and app_data_agent.requested_resource_selection_is_valid(request #> '{overrides,mcp_servers}',false)
    and app_data_agent.requested_resource_selection_is_valid(request #> '{overrides,skills}',false)
    and (request ->> 'operation' <> 'SEMANTIC_BOOTSTRAP_JOB' or (
      request #>> '{overrides,model,mode}' = 'EXPLICIT_NONE'
      and request #> '{overrides,egress}' = 'null'::jsonb
      and request #>> '{overrides,mcp_servers,mode}' = 'EXPLICIT_NONE'
      and request #>> '{overrides,skills,mode}' = 'EXPLICIT_NONE'
      and not exists (
        select 1 from pg_catalog.jsonb_array_elements(request -> 'mentions') mention(document)
        where mention.document ->> 'resource_kind' not in ('FILE','KNOWLEDGE')
      )
    ))
    and (request #> '{overrides,egress}' = 'null'::jsonb or (
      pg_catalog.jsonb_typeof(request #> '{overrides,egress}') = 'object'
      and (request #> '{overrides,egress}') ?& array['allowed_providers','allowed_audiences','classification']
      and (select pg_catalog.count(*) = 3 from pg_catalog.jsonb_object_keys(request #> '{overrides,egress}'))
      and request #>> '{overrides,egress,classification}' in ('PUBLIC','INTERNAL','RESTRICTED','SECRET')
      and pg_catalog.jsonb_typeof(request #> '{overrides,egress,allowed_providers}') = 'array'
      and pg_catalog.jsonb_array_length(request #> '{overrides,egress,allowed_providers}') between 1 and 64
      and not exists (select 1 from pg_catalog.jsonb_array_elements_text(request #> '{overrides,egress,allowed_providers}') with ordinality provider(value,ordinal)
        where provider.value not in ('openai','anthropic','deepseek','glm','kimi','grok','gemini')
          or exists (select 1 from pg_catalog.jsonb_array_elements_text(request #> '{overrides,egress,allowed_providers}') with ordinality prior(value,ordinal)
            where prior.ordinal < provider.ordinal and prior.value >= provider.value))
      and pg_catalog.jsonb_typeof(request #> '{overrides,egress,allowed_audiences}') = 'array'
      and pg_catalog.jsonb_array_length(request #> '{overrides,egress,allowed_audiences}') between 1 and 64
      and not exists (select 1 from pg_catalog.jsonb_array_elements_text(request #> '{overrides,egress,allowed_audiences}') audience(value)
        where audience.value not in ('PRIVATE','WORKSPACE','TENANT','EXTERNAL'))
      and not exists (select 1 from pg_catalog.jsonb_array_elements_text(request #> '{overrides,egress,allowed_audiences}') with ordinality audience(value,ordinal)
        where exists (select 1 from pg_catalog.jsonb_array_elements_text(request #> '{overrides,egress,allowed_audiences}') with ordinality prior(value,ordinal)
          where prior.ordinal < audience.ordinal
            and pg_catalog.array_position(array['PRIVATE','WORKSPACE','TENANT','EXTERNAL'],prior.value)
              >= pg_catalog.array_position(array['PRIVATE','WORKSPACE','TENANT','EXTERNAL'],audience.value)))))
    and pg_catalog.jsonb_typeof(request -> 'mentions') = 'array'
    and pg_catalog.jsonb_array_length(request -> 'mentions') <= 128
    and not exists (select 1 from pg_catalog.jsonb_array_elements(request -> 'mentions') with ordinality mention(document,ordinal)
      where pg_catalog.jsonb_typeof(mention.document) <> 'object'
        or not mention.document ?& array['mention_id','resource_kind','resource_id','expected_revision']
        or (select pg_catalog.count(*) <> 4 from pg_catalog.jsonb_object_keys(mention.document))
        or not app_data_agent.canonical_uuid_json_string_is_valid(mention.document -> 'mention_id')
        or not app_data_agent.canonical_uuid_json_string_is_valid(mention.document -> 'resource_id')
        or mention.document ->> 'resource_kind' not in ('FILE','KNOWLEDGE','MCP_SERVER','SKILL')
        or (mention.document ->> 'expected_revision') !~ '^[1-9][0-9]*$'
        or exists (select 1 from pg_catalog.jsonb_array_elements(request -> 'mentions') with ordinality prior(document,ordinal)
          where prior.ordinal < mention.ordinal and prior.document ->> 'mention_id' >= mention.document ->> 'mention_id'))
    and not exists (
      select candidate.resource_kind,candidate.resource_id
      from (
        select mention.document ->> 'resource_kind' as resource_kind,
          mention.document ->> 'resource_id' as resource_id
        from pg_catalog.jsonb_array_elements(request -> 'mentions') mention(document)
        union all
        select kind.resource_kind,item.document ->> 'resource_id'
        from (values
          ('files','FILE'),('knowledge','KNOWLEDGE'),
          ('mcp_servers','MCP_SERVER'),('skills','SKILL')
        ) kind(selection_name,resource_kind)
        cross join lateral pg_catalog.jsonb_array_elements(case
          when request #>> array['overrides',kind.selection_name,'mode'] = 'RESOURCE_IDS'
            then request #> array['overrides',kind.selection_name,'resources']
          else '[]'::jsonb end) item(document)
      ) candidate
      group by candidate.resource_kind,candidate.resource_id
      having pg_catalog.count(*) > 1
    )
    and not app_data_agent.contains_potential_plaintext_secret(request);
$function$;

create function app_data_agent.build_requested_optional_resource_bindings(request jsonb)
returns jsonb
language sql
immutable
set search_path = ''
as $function$
  with overridden as (
    select kind.resource_kind,'OVERRIDE'::text as source,null::jsonb as mention_id,item.document
    from (values
      ('files','FILE'),('knowledge','KNOWLEDGE'),
      ('mcp_servers','MCP_SERVER'),('skills','SKILL')
    ) kind(selection_name,resource_kind)
    cross join lateral pg_catalog.jsonb_array_elements(case
      when request #>> array['overrides',kind.selection_name,'mode'] = 'RESOURCE_IDS'
        then request #> array['overrides',kind.selection_name,'resources']
      else '[]'::jsonb end) item(document)
  ), mentioned as (
    select mention.document ->> 'resource_kind' as resource_kind,'MENTION'::text as source,
      mention.document -> 'mention_id' as mention_id,mention.document
    from pg_catalog.jsonb_array_elements(request -> 'mentions') mention(document)
  ), bindings as (
    select pg_catalog.jsonb_build_object(
      'resource_kind',candidate.resource_kind,
      'mention_id',candidate.mention_id,
      'requested_resource_id',candidate.document -> 'resource_id',
      'requested_revision',(candidate.document ->> 'expected_revision')::bigint,
      'effective_resource',null,'source',candidate.source,
      'availability','UNAVAILABLE','unavailable_reason','RESOURCE_NOT_FOUND_OR_FORBIDDEN'
    ) as document
    from (select * from overridden union all select * from mentioned) candidate
  )
  select coalesce(pg_catalog.jsonb_agg(bindings.document order by
    bindings.document ->> 'resource_kind',bindings.document ->> 'requested_resource_id',
    bindings.document ->> 'source',bindings.document ->> 'mention_id'),'[]'::jsonb)
  from bindings;
$function$;

-- Preserve the caller-controlled singleton selection on every fail-closed
-- branch. This is a projection only: it never resolves an effective resource.
create function app_data_agent.build_unavailable_singleton_resource_binding(
  selection jsonb,
  default_reference jsonb,
  resource_kind text,
  unavailable_reason text
)
returns jsonb
language plpgsql
immutable
set search_path = ''
as $function$
declare
  requested_reference jsonb;
  binding_source text;
  binding_reason text;
begin
  if resource_kind not in ('MODEL_PROFILE','DATASOURCE')
    or not app_data_agent.requested_resource_selection_is_valid(selection,true)
    or unavailable_reason not in (
      'EXPLICITLY_CLEARED','DEFAULT_NOT_CONFIGURED','DEFAULT_REMOVED',
      'RESOURCE_NOT_FOUND_OR_FORBIDDEN','RESOURCE_DISABLED','RESOURCE_REVISION_MISMATCH',
      'MODEL_NOT_AVAILABLE'
    )
  then
    raise exception using errcode = '22023', message = 'EFFECTIVE_CONFIG_REQUEST_INVALID';
  end if;
  if selection ->> 'mode' = 'RESOURCE_IDS' then
    requested_reference := selection #> '{resources,0}';
    binding_source := 'OVERRIDE';
  elsif selection ->> 'mode' = 'EXPLICIT_NONE' then
    requested_reference := null;
    binding_source := 'OVERRIDE';
  else
    requested_reference := default_reference;
    binding_source := 'DEFAULT';
  end if;
  binding_reason := case when selection ->> 'mode' = 'EXPLICIT_NONE'
    then 'EXPLICITLY_CLEARED' else unavailable_reason end;
  return pg_catalog.jsonb_build_object(
    'resource_kind',resource_kind,'mention_id',null,
    'requested_resource_id',requested_reference -> 'resource_id',
    'requested_revision',case
      when selection ->> 'mode' = 'RESOURCE_IDS'
        then (requested_reference ->> 'expected_revision')::bigint
      when requested_reference is not null and requested_reference <> 'null'::jsonb
        then (requested_reference ->> 'resource_revision')::bigint
      else null end,
    'effective_resource',null,'source',binding_source,
    'availability','UNAVAILABLE','unavailable_reason',binding_reason
  );
end
$function$;

-- INHERIT_DEFAULT is an explicit server-owned selection. Freeze every non-empty
-- Defaults reference. Empty collections remain empty and are represented by the
-- request/evaluation wire rather than a fabricated unavailable resource binding.
create function app_data_agent.build_inherited_optional_resource_bindings(
  request jsonb,
  defaults_document jsonb
)
returns jsonb
language sql
immutable
set search_path = ''
as $function$
  with inherited_kind as (
    select selection_name,resource_kind,
      case when pg_catalog.jsonb_typeof(defaults_document -> selection_name) = 'array'
        then defaults_document -> selection_name else '[]'::jsonb end as references
    from (values
      ('files','FILE'),('knowledge','KNOWLEDGE'),
      ('mcp_servers','MCP_SERVER'),('skills','SKILL')
    ) kind(selection_name,resource_kind)
    where request #>> array['overrides',selection_name,'mode'] = 'INHERIT_DEFAULT'
  ), projected as (
    select kind.resource_kind,item.document as reference
    from inherited_kind kind
    cross join lateral pg_catalog.jsonb_array_elements(kind.references) item(document)
  )
  select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
    'resource_kind',projected.resource_kind,'mention_id',null,
    'requested_resource_id',projected.reference -> 'resource_id',
    'requested_revision',(projected.reference ->> 'resource_revision')::bigint,
    'effective_resource',null,'source','DEFAULT','availability','UNAVAILABLE',
    'unavailable_reason','RESOURCE_NOT_FOUND_OR_FORBIDDEN'
  ) order by projected.resource_kind,
    coalesce(projected.reference ->> 'resource_id','NONE')),'[]'::jsonb)
  from projected;
$function$;

create function app_data_agent.build_optional_selection_evaluations(
  request jsonb,
  defaults_ref jsonb,
  resource_bindings jsonb
)
returns jsonb
language sql
immutable
set search_path = ''
as $function$
  select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
    'resource_kind',kind.resource_kind,
    'selection_mode',request #>> array['overrides',kind.selection_name,'mode'],
    'binding_count',case
      when request #>> array['overrides',kind.selection_name,'mode'] = 'RESOURCE_IDS'
        then (select pg_catalog.count(*)
          from pg_catalog.jsonb_array_elements(resource_bindings) binding(document)
          where binding.document ->> 'resource_kind' = kind.resource_kind
            and binding.document ->> 'source' = 'OVERRIDE')
      when request #>> array['overrides',kind.selection_name,'mode'] = 'INHERIT_DEFAULT'
        then (select pg_catalog.count(*)
          from pg_catalog.jsonb_array_elements(resource_bindings) binding(document)
          where binding.document ->> 'resource_kind' = kind.resource_kind
            and binding.document ->> 'source' = 'DEFAULT')
      else 0 end,
    'defaults_ref',case
      when request #>> array['overrides',kind.selection_name,'mode'] = 'INHERIT_DEFAULT'
        then defaults_ref else 'null'::jsonb end
  ) order by kind.ordinal)
  from (values
    ('files','FILE',1),('knowledge','KNOWLEDGE',2),
    ('mcp_servers','MCP_SERVER',3),('skills','SKILL',4)
  ) kind(selection_name,resource_kind,ordinal);
$function$;
