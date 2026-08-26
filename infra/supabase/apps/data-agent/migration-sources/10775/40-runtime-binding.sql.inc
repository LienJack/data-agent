alter table app_data_agent.runs
  add column authority_epoch text not null,
  add column authority_baseline_id uuid not null,
  add column authority_baseline_hash text not null,
  add column authority_activation_attempt_id uuid not null,
  add constraint runs_falcon24_e1_epoch_check check(authority_epoch='E1'),
  add constraint runs_falcon24_e1_hash_check
    check(authority_baseline_hash~'^sha256:[0-9a-f]{64}$'),
  add constraint runs_falcon24_e1_baseline_fk foreign key(
    app_id,tenant_id,environment,authority_baseline_id,authority_baseline_hash,authority_epoch)
    references app_data_agent.falcon24_authority_baselines(
      app_id,tenant_id,environment,baseline_id,baseline_hash,authority_epoch) on delete restrict,
  add constraint runs_falcon24_e1_attempt_fk foreign key(
    app_id,tenant_id,environment,authority_activation_attempt_id,
    authority_baseline_id,authority_baseline_hash)
    references app_data_agent.falcon24_e1_activation_attempts(
      app_id,tenant_id,environment,attempt_id,baseline_id,expected_baseline_hash)
    on delete restrict;

alter table app_data_agent.effective_run_config_receipts
  add column authority_epoch text not null,
  add column authority_baseline_id uuid not null,
  add column authority_baseline_hash text not null,
  add column authority_activation_attempt_id uuid not null,
  add constraint effective_config_falcon24_e1_epoch_check check(authority_epoch='E1'),
  add constraint effective_config_falcon24_e1_hash_check
    check(authority_baseline_hash~'^sha256:[0-9a-f]{64}$'),
  add constraint effective_config_falcon24_e1_baseline_fk foreign key(
    app_id,tenant_id,environment,authority_baseline_id,authority_baseline_hash,authority_epoch)
    references app_data_agent.falcon24_authority_baselines(
      app_id,tenant_id,environment,baseline_id,baseline_hash,authority_epoch) on delete restrict,
  add constraint effective_config_falcon24_e1_attempt_fk foreign key(
    app_id,tenant_id,environment,authority_activation_attempt_id,
    authority_baseline_id,authority_baseline_hash)
    references app_data_agent.falcon24_e1_activation_attempts(
      app_id,tenant_id,environment,attempt_id,baseline_id,expected_baseline_hash)
    on delete restrict;

alter table app_data_agent.artifacts
  add column authority_epoch text not null,
  add column authority_baseline_id uuid not null,
  add column authority_baseline_hash text not null,
  add column authority_activation_attempt_id uuid not null,
  add constraint artifacts_falcon24_e1_epoch_check check(authority_epoch='E1'),
  add constraint artifacts_falcon24_e1_hash_check
    check(authority_baseline_hash~'^sha256:[0-9a-f]{64}$'),
  add constraint artifacts_falcon24_e1_baseline_fk foreign key(
    app_id,tenant_id,environment,authority_baseline_id,authority_baseline_hash,authority_epoch)
    references app_data_agent.falcon24_authority_baselines(
      app_id,tenant_id,environment,baseline_id,baseline_hash,authority_epoch) on delete restrict,
  add constraint artifacts_falcon24_e1_attempt_fk foreign key(
    app_id,tenant_id,environment,authority_activation_attempt_id,
    authority_baseline_id,authority_baseline_hash)
    references app_data_agent.falcon24_e1_activation_attempts(
      app_id,tenant_id,environment,attempt_id,baseline_id,expected_baseline_hash)
    on delete restrict;

alter table app_data_agent.falcon24_acceptance_campaigns
  add column authority_epoch text not null,
  add column authority_baseline_id uuid not null,
  add column authority_baseline_hash text not null,
  add column authority_activation_attempt_id uuid not null,
  add constraint falcon24_campaign_e1_epoch_check check(authority_epoch='E1'),
  add constraint falcon24_campaign_e1_hash_check
    check(authority_baseline_hash~'^sha256:[0-9a-f]{64}$'),
  add constraint falcon24_campaign_e1_baseline_fk foreign key(
    app_id,tenant_id,environment,authority_baseline_id,authority_baseline_hash,authority_epoch)
    references app_data_agent.falcon24_authority_baselines(
      app_id,tenant_id,environment,baseline_id,baseline_hash,authority_epoch) on delete restrict,
  add constraint falcon24_campaign_e1_attempt_fk foreign key(
    app_id,tenant_id,environment,authority_activation_attempt_id,
    authority_baseline_id,authority_baseline_hash)
    references app_data_agent.falcon24_e1_activation_attempts(
      app_id,tenant_id,environment,attempt_id,baseline_id,expected_baseline_hash)
    on delete restrict;

alter table app_data_agent.falcon24_qualifications
  add column authority_epoch text not null,
  add column authority_baseline_id uuid not null,
  add column authority_baseline_hash text not null,
  add column authority_activation_attempt_id uuid not null,
  add constraint falcon24_qualification_e1_epoch_check check(authority_epoch='E1'),
  add constraint falcon24_qualification_e1_hash_check
    check(authority_baseline_hash~'^sha256:[0-9a-f]{64}$'),
  add constraint falcon24_qualification_e1_baseline_fk foreign key(
    app_id,tenant_id,environment,authority_baseline_id,authority_baseline_hash,authority_epoch)
    references app_data_agent.falcon24_authority_baselines(
      app_id,tenant_id,environment,baseline_id,baseline_hash,authority_epoch) on delete restrict,
  add constraint falcon24_qualification_e1_attempt_fk foreign key(
    app_id,tenant_id,environment,authority_activation_attempt_id,
    authority_baseline_id,authority_baseline_hash)
    references app_data_agent.falcon24_e1_activation_attempts(
      app_id,tenant_id,environment,attempt_id,baseline_id,expected_baseline_hash)
    on delete restrict;

create function app_data_agent.falcon24_e1_bind_current_authority()
returns trigger language plpgsql volatile security definer set search_path='' as $function$
declare current_epoch app_data_agent.falcon24_current_authority_epoch%rowtype;
begin
  select * into current_epoch from app_data_agent.falcon24_current_authority_epoch row
    where row.app_id=new.app_id and row.tenant_id=new.tenant_id
      and row.environment=new.environment for share;
  if not found then raise exception using errcode='55000',message='FALCON24_E1_NOT_ACTIVE'; end if;
  if (new.authority_epoch is not null and new.authority_epoch is distinct from 'E1')
    or (new.authority_baseline_id is not null
      and new.authority_baseline_id is distinct from current_epoch.baseline_id)
    or (new.authority_baseline_hash is not null
      and new.authority_baseline_hash is distinct from current_epoch.baseline_hash)
    or (new.authority_activation_attempt_id is not null
      and new.authority_activation_attempt_id is distinct from current_epoch.activation_attempt_id)
  then raise exception using errcode='55000',message='FALCON24_E1_AUTHORITY_BINDING_MISMATCH'; end if;
  new.authority_epoch:=current_epoch.authority_epoch;
  new.authority_baseline_id:=current_epoch.baseline_id;
  new.authority_baseline_hash:=current_epoch.baseline_hash;
  new.authority_activation_attempt_id:=current_epoch.activation_attempt_id;
  return new;
end
$function$;

create function app_data_agent.falcon24_e1_bind_artifact_to_run()
returns trigger language plpgsql volatile security definer set search_path='' as $function$
declare authority_run app_data_agent.runs%rowtype;
begin
  select * into authority_run from app_data_agent.runs row
    where row.app_id=new.app_id and row.tenant_id=new.tenant_id
      and row.environment=new.environment and row.run_id=new.run_id for share;
  if not found then raise exception using errcode='55000',message='FALCON24_E1_ARTIFACT_RUN_NOT_FOUND'; end if;
  if (new.authority_epoch is not null
      and new.authority_epoch is distinct from authority_run.authority_epoch)
    or (new.authority_baseline_id is not null
      and new.authority_baseline_id is distinct from authority_run.authority_baseline_id)
    or (new.authority_baseline_hash is not null
      and new.authority_baseline_hash is distinct from authority_run.authority_baseline_hash)
    or (new.authority_activation_attempt_id is not null
      and new.authority_activation_attempt_id is distinct from
        authority_run.authority_activation_attempt_id)
  then raise exception using errcode='55000',message='FALCON24_E1_ARTIFACT_AUTHORITY_MISMATCH'; end if;
  new.authority_epoch:=authority_run.authority_epoch;
  new.authority_baseline_id:=authority_run.authority_baseline_id;
  new.authority_baseline_hash:=authority_run.authority_baseline_hash;
  new.authority_activation_attempt_id:=authority_run.authority_activation_attempt_id;
  return new;
end
$function$;

create function app_data_agent.falcon24_e1_binding_immutable()
returns trigger language plpgsql volatile security definer set search_path='' as $function$
begin
  if new.authority_epoch is distinct from old.authority_epoch
    or new.authority_baseline_id is distinct from old.authority_baseline_id
    or new.authority_baseline_hash is distinct from old.authority_baseline_hash
    or new.authority_activation_attempt_id is distinct from old.authority_activation_attempt_id
  then raise exception using errcode='55000',message='FALCON24_E1_AUTHORITY_BINDING_IMMUTABLE'; end if;
  return new;
end
$function$;

create trigger runs_falcon24_e1_bind before insert on app_data_agent.runs
for each row execute function app_data_agent.falcon24_e1_bind_current_authority();
create trigger effective_config_falcon24_e1_bind before insert
on app_data_agent.effective_run_config_receipts
for each row execute function app_data_agent.falcon24_e1_bind_current_authority();
create trigger artifacts_falcon24_e1_bind before insert on app_data_agent.artifacts
for each row execute function app_data_agent.falcon24_e1_bind_artifact_to_run();
create trigger falcon24_campaign_e1_bind before insert
on app_data_agent.falcon24_acceptance_campaigns
for each row execute function app_data_agent.falcon24_e1_bind_current_authority();
create trigger falcon24_qualification_e1_bind before insert
on app_data_agent.falcon24_qualifications
for each row execute function app_data_agent.falcon24_e1_bind_current_authority();

create trigger runs_falcon24_e1_immutable before update on app_data_agent.runs
for each row execute function app_data_agent.falcon24_e1_binding_immutable();
create trigger effective_config_falcon24_e1_immutable before update
on app_data_agent.effective_run_config_receipts
for each row execute function app_data_agent.falcon24_e1_binding_immutable();
create trigger artifacts_falcon24_e1_immutable before update on app_data_agent.artifacts
for each row execute function app_data_agent.falcon24_e1_binding_immutable();
create trigger falcon24_campaign_e1_immutable before update
on app_data_agent.falcon24_acceptance_campaigns
for each row execute function app_data_agent.falcon24_e1_binding_immutable();
create trigger falcon24_qualification_e1_immutable before update
on app_data_agent.falcon24_qualifications
for each row execute function app_data_agent.falcon24_e1_binding_immutable();

create function app_data_agent.load_falcon24_run_authority_binding(command jsonb)
returns jsonb language plpgsql stable security definer set search_path='' as $function$
declare authority record; authority_run app_data_agent.runs%rowtype;
begin
  if command is null or pg_catalog.jsonb_typeof(command) is distinct from 'object'
    or app_data_agent.provider_json_object_has_exact_keys(command,array[
      'schema_version','run_id','command_hash']::text[]) is distinct from true
    or command->>'schema_version' is distinct from 'falcon24-run-authority-load@1.0.0'
    or command->>'command_hash' is distinct from
      app_data_agent.u2_canonical_sha256(command-'command_hash')
    or app_data_agent.canonical_uuid_json_string_is_valid(command->'run_id') is distinct from true
  then raise exception using errcode='22023',message='FALCON24_E1_RUN_AUTHORITY_LOAD_INVALID'; end if;
  select * into strict authority from platform.current_backend_authority(false);
  select * into authority_run from app_data_agent.runs row
    where row.app_id=authority.app_id and row.tenant_id=authority.tenant_id
      and row.environment=authority.environment and row.run_id=(command->>'run_id')::uuid
      and row.principal_id=authority.principal_id;
  if not found then raise exception using errcode='02000',message='FALCON24_E1_RUN_NOT_FOUND'; end if;
  return pg_catalog.jsonb_build_object(
    'schema_version','falcon24-authority-binding@1.0.0',
    'authority_epoch',authority_run.authority_epoch,
    'baseline_id',authority_run.authority_baseline_id,
    'baseline_hash',authority_run.authority_baseline_hash,
    'activation_attempt_id',authority_run.authority_activation_attempt_id);
end
$function$;
