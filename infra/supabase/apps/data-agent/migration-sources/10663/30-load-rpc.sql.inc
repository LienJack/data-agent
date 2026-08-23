create function app_data_agent.load_resolved_context_authority_snapshot(requested jsonb)
returns jsonb language plpgsql volatile security definer set search_path='' as $function$
declare
  authority record;
  defaults_record app_data_agent.workspace_run_default_revisions%rowtype;
  config_record app_data_agent.effective_run_config_receipts%rowtype;
  context_record app_data_agent.effective_config_context_receipts%rowtype;
  model_record app_data_agent.model_catalog_entries%rowtype;
  release_record semantic.semantic_source_release%rowtype;
  defaults_json jsonb;
  semantic_ref jsonb;
  snapshot_ref jsonb;
  context_policy jsonb;
  egress_policy jsonb;
  provider_name text;
  knowledge_refs jsonb;
  snapshot_document jsonb;
  run_question text;
begin
  if not pg_catalog.pg_has_role(session_user,'data_agent_backend','USAGE') then
    raise exception using errcode='42501',message='DA_BACKEND_ROLE_REQUIRED';
  end if;
  perform app_data_agent.assert_resolved_context_request(requested);
  select * into authority from platform.current_backend_authority(false);
  if requested->'scope' <> pg_catalog.jsonb_build_object(
    'app_id',authority.app_id,'tenant_id',authority.tenant_id,'environment',authority.environment)
  then raise exception using errcode='42501',message='RESOLVED_CONTEXT_SCOPE_MISMATCH'; end if;

  if requested#>>'{basis,consumer}'='PREVIEW' then
    run_question:=requested->>'question';
    select revision.* into defaults_record
    from app_data_agent.workspace_run_defaults current_defaults
    join app_data_agent.workspace_run_default_revisions revision
      on revision.app_id=current_defaults.app_id and revision.tenant_id=current_defaults.tenant_id
     and revision.environment=current_defaults.environment and revision.defaults_id=current_defaults.defaults_id
     and revision.defaults_revision=current_defaults.defaults_revision and revision.defaults_hash=current_defaults.defaults_hash
    where current_defaults.app_id=authority.app_id and current_defaults.tenant_id=authority.tenant_id
      and current_defaults.environment=authority.environment
      and current_defaults.defaults_id=(requested#>>'{basis,defaults_ref,defaults_id}')::uuid
      and current_defaults.defaults_revision=(requested#>>'{basis,defaults_ref,defaults_revision}')::bigint
      and current_defaults.defaults_hash=requested#>>'{basis,defaults_ref,defaults_hash}'
    for share of current_defaults,revision;
    if not found then raise exception using errcode='40001',message='RESOLVED_CONTEXT_DEFAULTS_STALE'; end if;
    defaults_json:=defaults_record.defaults_json;
    if defaults_json->'model'='null'::jsonb or defaults_json->'datasource'='null'::jsonb
      or defaults_json->'semantic_release'='null'::jsonb or defaults_json->'schema_snapshot'='null'::jsonb
    then raise exception using errcode='55000',message='RESOLVED_CONTEXT_DEFAULTS_INCOMPLETE'; end if;
    select model.* into model_record from app_data_agent.model_catalog_entries model
    where model.app_id=authority.app_id and model.environment=authority.environment
      and model.model_profile_id=(defaults_json#>>'{model,resource_id}')::uuid
      and model.config_version=(defaults_json#>>'{model,resource_revision}')::bigint and model.status='ACTIVE';
    if not found then raise exception using errcode='55000',message='RESOLVED_CONTEXT_MODEL_STALE'; end if;
    select release.* into release_record from semantic.semantic_source_release release
    where release.app_id=authority.app_id and release.tenant_id=authority.tenant_id
      and release.environment=authority.environment
      and release.release_id=(defaults_json#>>'{semantic_release,resource_id}')::uuid
      and release.release_generation=(defaults_json#>>'{semantic_release,resource_revision}')::bigint
      and release.release_digest=defaults_json#>>'{semantic_release,resource_hash}'
      and exists(select 1 from semantic.semantic_active_pointer pointer
        where pointer.app_id=release.app_id and pointer.tenant_id=release.tenant_id
          and pointer.environment=release.environment and pointer.semantic_domain=release.semantic_domain
          and pointer.current_release_id=release.release_id
          and pointer.current_release_generation=release.release_generation
          and pointer.current_release_digest=release.release_digest);
    if not found then raise exception using errcode='40001',message='RESOLVED_CONTEXT_RELEASE_STALE'; end if;
    semantic_ref:=(defaults_json->'semantic_release')||pg_catalog.jsonb_build_object(
      'datasource_id',(defaults_json#>>'{datasource,resource_id}')::uuid,
      'semantic_generation',release_record.release_generation,'publication_status','PUBLISHED');
    snapshot_ref:=(defaults_json->'schema_snapshot')||pg_catalog.jsonb_build_object(
      'datasource_id',(defaults_json#>>'{datasource,resource_id}')::uuid,
      'semantic_release_id',release_record.release_id,'semantic_generation',release_record.release_generation);
    context_policy:=app_data_agent.builtin_effective_config_policy('CONTEXT_POLICY');
    egress_policy:=app_data_agent.builtin_effective_config_policy('EGRESS_POLICY');
    provider_name:=model_record.provider;
    knowledge_refs:=coalesce(defaults_json->'knowledge','[]'::jsonb);
  else
    select config.* into config_record from app_data_agent.effective_run_config_receipts config
    where config.app_id=authority.app_id and config.tenant_id=authority.tenant_id
      and config.environment=authority.environment
      and config.run_id=(requested#>>'{basis,run_id}')::uuid
      and config.config_id=(requested#>>'{basis,config_ref,config_id}')::uuid
      and config.config_revision=(requested#>>'{basis,config_ref,config_revision}')::bigint
      and config.config_hash=requested#>>'{basis,config_ref,config_hash}'
    for share;
    if not found then raise exception using errcode='40001',message='RESOLVED_CONTEXT_CONFIG_STALE'; end if;
    select context.* into context_record from app_data_agent.effective_config_context_receipts context
    join app_data_agent.run_attempts attempt
      on attempt.app_id=context.app_id and attempt.tenant_id=context.tenant_id
     and attempt.environment=context.environment and attempt.attempt_id=context.attempt_id
     and attempt.run_id=context.run_id and attempt.outbox_id=context.outbox_id
    join app_data_agent.outbox message
      on message.app_id=attempt.app_id and message.tenant_id=attempt.tenant_id
     and message.environment=attempt.environment and message.outbox_id=attempt.outbox_id
    where context.app_id=authority.app_id and context.tenant_id=authority.tenant_id
      and context.environment=authority.environment and context.run_id=config_record.run_id
      and context.config_id=config_record.config_id and context.config_hash=config_record.config_hash
      and context.context_receipt_id=(requested#>>'{basis,context_receipt_ref,receipt_id}')::uuid
      and context.receipt_hash=requested#>>'{basis,context_receipt_ref,receipt_hash}'
      and context.consumer_kind='WORKER_START' and attempt.status='ACTIVE'
      and attempt.worker_fence=context.worker_fence and attempt.lease_token=context.lease_token
      and attempt.lease_expires_at>pg_catalog.clock_timestamp()
      and message.status='LEASED' and message.active_attempt_id=attempt.attempt_id
      and message.run_fence=attempt.worker_fence and message.lease_token=attempt.lease_token
      and message.lease_expires_at>pg_catalog.clock_timestamp()
    for share of context,attempt,message;
    if not found then raise exception using errcode='40001',message='RESOLVED_CONTEXT_WORKER_AUTHORITY_STALE'; end if;
    select message.content into run_question
    from app_data_agent.workspace_run_bindings binding
    join app_data_agent.qa_messages message
      on message.app_id=binding.app_id and message.tenant_id=binding.tenant_id
     and message.environment=binding.environment and message.conversation_id=binding.conversation_id
     and message.run_id=binding.run_id and message.role='user' and message.message_type='text'
    join app_data_agent.run_events event
      on event.app_id=binding.app_id and event.tenant_id=binding.tenant_id
     and event.environment=binding.environment and event.run_id=binding.run_id
     and event.event_id=message.message_id and event.event_type='run.accepted'
    where binding.app_id=authority.app_id and binding.tenant_id=authority.tenant_id
      and binding.environment=authority.environment and binding.run_id=config_record.run_id;
    if run_question is null then raise exception using errcode='40001',message='RESOLVED_CONTEXT_QUESTION_MISSING'; end if;
    defaults_json:=config_record.effective_config_json;
    semantic_ref:=defaults_json->'semantic_release';
    snapshot_ref:=defaults_json->'schema_snapshot';
    context_policy:=defaults_json->'context_policy';
    egress_policy:=defaults_json->'egress_policy';
    provider_name:=config_record.provider;
    select coalesce(pg_catalog.jsonb_agg(binding.document order by binding.document->>'resource_id'),'[]'::jsonb)
    into knowledge_refs from (
      select resource.document
      from pg_catalog.jsonb_array_elements(defaults_json->'resource_bindings') binding(document)
      cross join lateral (select binding.document->'effective_resource' document) resource
      where binding.document->>'resource_kind'='KNOWLEDGE'
        and binding.document->>'availability'='AVAILABLE'
    ) binding;
    defaults_record.defaults_id:=config_record.defaults_id;
    defaults_record.defaults_revision:=config_record.defaults_revision;
    defaults_record.defaults_hash:=config_record.defaults_hash;
    select release.* into release_record from semantic.semantic_source_release release
    where release.app_id=authority.app_id and release.tenant_id=authority.tenant_id
      and release.environment=authority.environment
      and release.semantic_domain=config_record.semantic_domain
      and release.release_id=config_record.semantic_release_id
      and release.release_generation=config_record.semantic_release_generation
      and release.release_digest=config_record.semantic_release_digest
      and exists(select 1 from semantic.semantic_active_pointer pointer
        where pointer.app_id=release.app_id and pointer.tenant_id=release.tenant_id
          and pointer.environment=release.environment and pointer.semantic_domain=release.semantic_domain
          and pointer.current_release_id=release.release_id
          and pointer.current_release_generation=release.release_generation
          and pointer.current_release_digest=release.release_digest);
    if not found then raise exception using errcode='40001',message='RESOLVED_CONTEXT_RELEASE_STALE'; end if;
  end if;
  if not (egress_policy->'allowed_providers') ? provider_name then
    raise exception using errcode='42501',message='RESOLVED_CONTEXT_PROVIDER_DENIED';
  end if;
  snapshot_document:=pg_catalog.jsonb_build_object(
    'schema_version','resolved-context-authority-snapshot@1.0.0','scope',requested->'scope',
    'semantic_domain',release_record.semantic_domain,'question',run_question,
    'question_hash',app_data_agent.u2_canonical_sha256(to_jsonb(run_question)),
    'defaults_ref',pg_catalog.jsonb_build_object('defaults_id',defaults_record.defaults_id,
      'defaults_revision',defaults_record.defaults_revision,'defaults_hash',defaults_record.defaults_hash),
    'semantic_release',semantic_ref,'schema_snapshot',snapshot_ref,
    'context_policy',context_policy,'egress_policy',egress_policy,'provider',provider_name,
    'published_metrics',app_data_agent.resolved_context_metric_projection(
      authority.app_id,authority.tenant_id,authority.environment,release_record.semantic_domain,release_record.release_id),
    'published_ontology',app_data_agent.resolved_context_ontology_projection(
      authority.app_id,authority.tenant_id,authority.environment,release_record.semantic_domain,release_record.release_id),
    'published_relationships',app_data_agent.resolved_context_relationship_projection(
      authority.app_id,authority.tenant_id,authority.environment,release_record.semantic_domain,release_record.release_id),
    'knowledge_refs',knowledge_refs,
    'projection_hashes',(select pg_catalog.jsonb_agg(to_jsonb(projection_hash) order by projection_hash)
      from pg_catalog.unnest(array[
        release_record.executable_projection_hash,release_record.relationship_projection_hash,
        release_record.runtime_restriction_projection_hash]::text[]) projection_hash));
  return snapshot_document||pg_catalog.jsonb_build_object(
    'snapshot_hash',app_data_agent.u2_canonical_sha256(snapshot_document));
exception when invalid_text_representation or numeric_value_out_of_range then
  raise exception using errcode='22023',message='RESOLVED_CONTEXT_REQUEST_INVALID';
end
$function$;
