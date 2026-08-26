create function app_data_agent.falcon24_e1_staging_session_state_fence()
returns trigger language plpgsql volatile security definer set search_path='' as $function$
begin
  if new.app_id is distinct from old.app_id or new.tenant_id is distinct from old.tenant_id
    or new.environment is distinct from old.environment or new.staging_id is distinct from old.staging_id
    or new.retained_assets_hash is distinct from old.retained_assets_hash
    or new.created_by is distinct from old.created_by or new.created_at is distinct from old.created_at
    or old.status in('HOLD','CONSUMED') and new is distinct from old
    or old.status='STAGED' and new.status not in('STAGED','HOLD','CONSUMED')
  then raise exception using errcode='55000',message='FALCON24_E1_STAGING_SESSION_IMMUTABLE'; end if;
  return new;
end
$function$;

create function app_data_agent.falcon24_e1_baseline_state_fence()
returns trigger language plpgsql volatile security definer set search_path='' as $function$
begin
  if new.app_id is distinct from old.app_id or new.tenant_id is distinct from old.tenant_id
    or new.environment is distinct from old.environment or new.baseline_id is distinct from old.baseline_id
    or new.authority_epoch is distinct from old.authority_epoch
    or new.staging_id is distinct from old.staging_id or new.baseline_hash is distinct from old.baseline_hash
    or new.baseline_document is distinct from old.baseline_document
    or new.source_commit is distinct from old.source_commit
    or new.retained_assets_hash is distinct from old.retained_assets_hash
    or new.web_build_hash is distinct from old.web_build_hash
    or new.production_isolation_proven is distinct from old.production_isolation_proven
    or new.production_gate is distinct from old.production_gate
    or new.created_by is distinct from old.created_by or new.created_at is distinct from old.created_at
    or old.status in('ACTIVE','HOLD') and new is distinct from old
    or old.status='STAGED' and new.status not in('STAGED','ACTIVE','HOLD')
  then raise exception using errcode='55000',message='FALCON24_E1_BASELINE_IMMUTABLE'; end if;
  return new;
end
$function$;

create function app_data_agent.falcon24_e1_activation_attempt_state_fence()
returns trigger language plpgsql volatile security definer set search_path='' as $function$
begin
  if new.app_id is distinct from old.app_id or new.tenant_id is distinct from old.tenant_id
    or new.environment is distinct from old.environment or new.attempt_id is distinct from old.attempt_id
    or new.baseline_id is distinct from old.baseline_id
    or new.expected_baseline_hash is distinct from old.expected_baseline_hash
    or new.created_by is distinct from old.created_by or new.created_at is distinct from old.created_at
    or old.status in('HOLD','ACTIVATED') and new is distinct from old
    or old.status='OPEN' and new.status not in('OPEN','HOLD','ACTIVATED')
  then raise exception using errcode='55000',message='FALCON24_E1_ACTIVATION_ATTEMPT_IMMUTABLE'; end if;
  return new;
end
$function$;

create function app_data_agent.falcon24_e1_immutable_row_fence()
returns trigger language plpgsql volatile security definer set search_path='' as $function$
begin
  raise exception using errcode='55000',message='FALCON24_E1_IMMUTABLE_ROW';
end
$function$;

create trigger falcon24_e1_staging_session_state_fence before update
on app_data_agent.falcon24_e1_staging_sessions
for each row execute function app_data_agent.falcon24_e1_staging_session_state_fence();
create trigger falcon24_e1_baseline_state_fence before update
on app_data_agent.falcon24_authority_baselines
for each row execute function app_data_agent.falcon24_e1_baseline_state_fence();
create trigger falcon24_e1_activation_attempt_state_fence before update
on app_data_agent.falcon24_e1_activation_attempts
for each row execute function app_data_agent.falcon24_e1_activation_attempt_state_fence();
create trigger falcon24_e1_staging_receipt_immutable before update or delete
on app_data_agent.falcon24_e1_staging_receipts
for each row execute function app_data_agent.falcon24_e1_immutable_row_fence();
create trigger falcon24_e1_current_authority_immutable before update or delete
on app_data_agent.falcon24_current_authority_epoch
for each row execute function app_data_agent.falcon24_e1_immutable_row_fence();
