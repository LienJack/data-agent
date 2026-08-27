create function app_data_agent.falcon24_bind_current_authority()
returns trigger language plpgsql volatile security definer set search_path='' as $function$
declare current_epoch app_data_agent.falcon24_current_authority_epoch%rowtype;
begin
  select * into current_epoch from app_data_agent.falcon24_current_authority_epoch row
    where row.app_id=new.app_id and row.tenant_id=new.tenant_id
      and row.environment=new.environment for share;
  if not found then raise exception using errcode='55000',
    message='FALCON24_AUTHORITY_NOT_ACTIVE'; end if;
  if (new.authority_epoch is not null
      and new.authority_epoch is distinct from current_epoch.authority_epoch)
    or (new.authority_baseline_id is not null
      and new.authority_baseline_id is distinct from current_epoch.baseline_id)
    or (new.authority_baseline_hash is not null
      and new.authority_baseline_hash is distinct from current_epoch.baseline_hash)
    or (new.authority_activation_attempt_id is not null
      and new.authority_activation_attempt_id is distinct from current_epoch.activation_attempt_id)
  then raise exception using errcode='55000',
    message='FALCON24_AUTHORITY_BINDING_MISMATCH'; end if;
  new.authority_epoch:=current_epoch.authority_epoch;
  new.authority_baseline_id:=current_epoch.baseline_id;
  new.authority_baseline_hash:=current_epoch.baseline_hash;
  new.authority_activation_attempt_id:=current_epoch.activation_attempt_id;
  return new;
end
$function$;

create function app_data_agent.falcon24_bind_artifact_to_run()
returns trigger language plpgsql volatile security definer set search_path='' as $function$
declare authority_run app_data_agent.runs%rowtype;
begin
  select * into authority_run from app_data_agent.runs row
    where row.app_id=new.app_id and row.tenant_id=new.tenant_id
      and row.environment=new.environment and row.run_id=new.run_id for share;
  if not found then raise exception using errcode='55000',
    message='FALCON24_ARTIFACT_RUN_NOT_FOUND'; end if;
  if (new.authority_epoch is not null
      and new.authority_epoch is distinct from authority_run.authority_epoch)
    or (new.authority_baseline_id is not null
      and new.authority_baseline_id is distinct from authority_run.authority_baseline_id)
    or (new.authority_baseline_hash is not null
      and new.authority_baseline_hash is distinct from authority_run.authority_baseline_hash)
    or (new.authority_activation_attempt_id is not null
      and new.authority_activation_attempt_id is distinct from
        authority_run.authority_activation_attempt_id)
  then raise exception using errcode='55000',
    message='FALCON24_ARTIFACT_AUTHORITY_MISMATCH'; end if;
  new.authority_epoch:=authority_run.authority_epoch;
  new.authority_baseline_id:=authority_run.authority_baseline_id;
  new.authority_baseline_hash:=authority_run.authority_baseline_hash;
  new.authority_activation_attempt_id:=authority_run.authority_activation_attempt_id;
  return new;
end
$function$;

create function app_data_agent.falcon24_binding_immutable()
returns trigger language plpgsql volatile security definer set search_path='' as $function$
begin
  if new.authority_epoch is distinct from old.authority_epoch
    or new.authority_baseline_id is distinct from old.authority_baseline_id
    or new.authority_baseline_hash is distinct from old.authority_baseline_hash
    or new.authority_activation_attempt_id is distinct from old.authority_activation_attempt_id
  then raise exception using errcode='55000',
    message='FALCON24_AUTHORITY_BINDING_IMMUTABLE'; end if;
  return new;
end
$function$;

drop trigger runs_falcon24_e1_bind on app_data_agent.runs;
drop trigger effective_config_falcon24_e1_bind
  on app_data_agent.effective_run_config_receipts;
drop trigger artifacts_falcon24_e1_bind on app_data_agent.artifacts;
drop trigger falcon24_campaign_e1_bind on app_data_agent.falcon24_acceptance_campaigns;
drop trigger falcon24_qualification_e1_bind on app_data_agent.falcon24_qualifications;
drop trigger runs_falcon24_e1_immutable on app_data_agent.runs;
drop trigger effective_config_falcon24_e1_immutable
  on app_data_agent.effective_run_config_receipts;
drop trigger artifacts_falcon24_e1_immutable on app_data_agent.artifacts;
drop trigger falcon24_campaign_e1_immutable on app_data_agent.falcon24_acceptance_campaigns;
drop trigger falcon24_qualification_e1_immutable on app_data_agent.falcon24_qualifications;

create trigger runs_falcon24_authority_bind before insert on app_data_agent.runs
for each row execute function app_data_agent.falcon24_bind_current_authority();
create trigger effective_config_falcon24_authority_bind before insert
on app_data_agent.effective_run_config_receipts
for each row execute function app_data_agent.falcon24_bind_current_authority();
create trigger artifacts_falcon24_authority_bind before insert on app_data_agent.artifacts
for each row execute function app_data_agent.falcon24_bind_artifact_to_run();
create trigger falcon24_campaign_authority_bind before insert
on app_data_agent.falcon24_acceptance_campaigns
for each row execute function app_data_agent.falcon24_bind_current_authority();
create trigger falcon24_qualification_authority_bind before insert
on app_data_agent.falcon24_qualifications
for each row execute function app_data_agent.falcon24_bind_current_authority();

create trigger runs_falcon24_authority_immutable before update on app_data_agent.runs
for each row execute function app_data_agent.falcon24_binding_immutable();
create trigger effective_config_falcon24_authority_immutable before update
on app_data_agent.effective_run_config_receipts
for each row execute function app_data_agent.falcon24_binding_immutable();
create trigger artifacts_falcon24_authority_immutable before update on app_data_agent.artifacts
for each row execute function app_data_agent.falcon24_binding_immutable();
create trigger falcon24_campaign_authority_immutable before update
on app_data_agent.falcon24_acceptance_campaigns
for each row execute function app_data_agent.falcon24_binding_immutable();
create trigger falcon24_qualification_authority_immutable before update
on app_data_agent.falcon24_qualifications
for each row execute function app_data_agent.falcon24_binding_immutable();
