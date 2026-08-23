-- ============================================================
-- Strict JSON, scope, mutation and canonical Authority helpers.
-- ============================================================

create function semantic.u5_json_has_exact_keys(p_value jsonb,p_keys text[])
returns boolean language sql immutable strict set search_path = '' as $function$
  select pg_catalog.jsonb_typeof(p_value)='object'
    and p_value - p_keys = '{}'::jsonb
    and not exists (
      select 1 from pg_catalog.unnest(p_keys) as required(key)
      where not p_value ? required.key
    )
$function$;

create function semantic.assert_u5_scope(p_scope jsonb,p_semantic_domain text,p_require_write boolean)
returns void language plpgsql volatile security definer set search_path = '' as $function$
declare
  v_app_id uuid;
  v_tenant_id uuid;
  v_environment text;
begin
  if p_scope is null or not semantic.u5_json_has_exact_keys(
    p_scope,array['app_id','tenant_id','workspace_id','environment']::text[]
  ) or coalesce(p_scope->>'app_id','') !~* '^[0-9a-f-]{36}$'
    or coalesce(p_scope->>'tenant_id','') !~* '^[0-9a-f-]{36}$'
    or p_scope->>'workspace_id' <> p_scope->>'tenant_id'
    or coalesce(p_semantic_domain,'') !~ '^[A-Za-z_][A-Za-z0-9_]{0,63}$'
  then
    raise exception using errcode='22023',message='SEMANTIC_BOOTSTRAP_SCOPE_INVALID';
  end if;
  v_app_id := (p_scope->>'app_id')::uuid;
  v_tenant_id := (p_scope->>'tenant_id')::uuid;
  v_environment := p_scope->>'environment';
  if v_app_id <> '00000000-0000-4000-8000-00000000da01'::uuid
    or nullif(pg_catalog.current_setting('data_agent.app_id',true),'')::uuid is distinct from v_app_id
    or nullif(pg_catalog.current_setting('data_agent.tenant_id',true),'')::uuid is distinct from v_tenant_id
    or nullif(pg_catalog.current_setting('data_agent.environment',true),'') is distinct from v_environment
    or nullif(pg_catalog.current_setting('app.semantic_domain',true),'') is distinct from p_semantic_domain
    or not platform.backend_context_matches(v_app_id,v_tenant_id,v_environment,p_require_write)
  then
    raise exception using errcode='42501',message='SEMANTIC_BOOTSTRAP_SCOPE_MISMATCH';
  end if;
end
$function$;

create function semantic.reject_u5_immutable_mutation()
returns trigger language plpgsql set search_path = '' as $function$
begin
  raise exception using errcode='55000',message='SEMANTIC_BOOTSTRAP_AUTHORITY_IMMUTABLE';
end
$function$;

create function semantic.guard_u5_key_transition()
returns trigger language plpgsql set search_path = '' as $function$
begin
  if old.app_id<>new.app_id or old.tenant_id<>new.tenant_id or old.environment<>new.environment
    or old.semantic_domain<>new.semantic_domain or old.key_id<>new.key_id
    or old.key_revision<>new.key_revision or old.principal_id<>new.principal_id
    or old.signer_role<>new.signer_role or old.key_purpose<>new.key_purpose
    or old.public_material<>new.public_material or old.public_material_hash<>new.public_material_hash
    or old.revocation_epoch>new.revocation_epoch
    or not (
      (old.key_status='STAGED' and new.key_status='ACTIVE' and new.activation_receipt_hash is not null) or
      (old.key_status in ('STAGED','ACTIVE') and new.key_status in ('COMPROMISED','RETIRED'))
    )
  then
    raise exception using errcode='55000',message='SEMANTIC_BOOTSTRAP_KEY_TRANSITION_INVALID';
  end if;
  return new;
end
$function$;

create function semantic.guard_u5_grant_transition()
returns trigger language plpgsql set search_path = '' as $function$
begin
  if old.app_id<>new.app_id or old.tenant_id<>new.tenant_id or old.environment<>new.environment
    or old.semantic_domain<>new.semantic_domain or old.grant_id<>new.grant_id
    or old.grant_hash<>new.grant_hash or old.request_hash<>new.request_hash
    or old.command_json<>new.command_json or old.grant_nonce<>new.grant_nonce
    or old.grant_status<>'ACTIVE' or new.grant_status not in ('CONSUMED','REVOKED','EXPIRED')
    or (new.grant_status='CONSUMED' and new.consumed_at is null)
  then
    raise exception using errcode='55000',message='SEMANTIC_PUBLISHER_GRANT_TRANSITION_INVALID';
  end if;
  return new;
end
$function$;

create trigger u5_signer_key_transition_guard before update on semantic.semantic_bootstrap_signer_key_revisions
for each row execute function semantic.guard_u5_key_transition();
create trigger u5_signer_key_delete_guard before delete on semantic.semantic_bootstrap_signer_key_revisions
for each row execute function semantic.reject_u5_immutable_mutation();
create trigger u5_grant_transition_guard before update on semantic.semantic_bootstrap_publisher_grants
for each row execute function semantic.guard_u5_grant_transition();
create trigger u5_grant_delete_guard before delete on semantic.semantic_bootstrap_publisher_grants
for each row execute function semantic.reject_u5_immutable_mutation();

do $immutable_triggers$
declare v_table text;
begin
  foreach v_table in array array[
    'semantic_bootstrap_signer_activations','verified_semantic_domain_bootstrap_receipts',
    'semantic_bootstrap_policy_revisions','semantic_bootstrap_validation_receipts',
    'initial_semantic_release_sets','initial_semantic_release_package_bindings',
    'semantic_package_admission_receipts','first_release_admission_receipts',
    'semantic_bootstrap_capability_tombstones','semantic_bootstrap_publish_idempotency',
    'semantic_bootstrap_outbox'
  ] loop
    execute pg_catalog.format(
      'create trigger %I before update or delete on semantic.%I for each row execute function semantic.reject_u5_immutable_mutation()',
      'u5_'||v_table||'_immutable',v_table
    );
  end loop;
end
$immutable_triggers$;
