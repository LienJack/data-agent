-- research_authority_provisioning_migration_checksum: sha256:65599ab33e25af8001dcb11cc4cba2495811369ef3369ed0a4cff5545b98174b
begin;

do $bootstrap$
begin
  if pg_catalog.current_setting('server_version_num')::integer not between 170000 and 179999 then
    raise exception using errcode='0A000',message='RESEARCH_AUTHORITY_PROVISIONING_POSTGRES_VERSION_UNSUPPORTED';
  end if;
  if session_user<>'postgres' or current_user<>'postgres' then
    raise exception using errcode='42501',message='RESEARCH_AUTHORITY_PROVISIONING_EXECUTOR_UNSAFE';
  end if;
  if not exists(select 1 from platform.migration_ledger
    where owner_kind='app' and app_id='00000000-0000-4000-8000-00000000da01'::uuid
      and migration_version='20260725010711_app_data_agent_analysis_input_materialization')
  then raise exception using errcode='P0001',message='RESEARCH_AUTHORITY_PROVISIONING_BASELINE_10711_MISSING'; end if;
end
$bootstrap$;

set local lock_timeout='2000ms';
set local statement_timeout='300000ms';
set local idle_in_transaction_session_timeout='60000ms';
select platform.acquire_migration_lock('app','00000000-0000-4000-8000-00000000da01'::uuid);
create or replace function app_data_agent.provision_u6_authority_manifest(
  envelope_json jsonb
)
returns jsonb
language plpgsql
volatile
called on null input
security definer
set search_path = ''
as $function$
declare
  scope_json jsonb;
  requested_manifest_id uuid;
  requested_app_id uuid;
  requested_tenant_id uuid;
  requested_environment text;
  requested_principal_id uuid;
  requested_deployment_id uuid;
  requested_expires_at timestamptz;
  requested_profile text;
  locked_deployment record;
  locked_lifecycle record;
  locked_membership record;
  assignment record;
  current_head record;
  current_capability record;
  requested_assignment_key text;
  next_capability_id uuid;
  next_authority_epoch bigint;
  capability_set jsonb := '{}'::jsonb;
  created_any boolean := false;
  db_now timestamptz;
begin
  if pg_catalog.current_setting('role',true)<>'data_agent_u6_provisioner'
    or pg_catalog.jsonb_typeof(envelope_json)<>'object'
    or (select pg_catalog.count(*) from pg_catalog.jsonb_object_keys(
      case when pg_catalog.jsonb_typeof(envelope_json)='object' then envelope_json else '{}'::jsonb end
    ))<>8
    or envelope_json->>'protocol_version'<>'u6-authority-manifest@1.0.0'
    or envelope_json->>'profile'<>'RESEARCH_ANALYSIS_WORKER'
    or envelope_json->>'request_hash' is distinct from app_data_agent.u6_domain_sha256(
      'u6-authority-manifest@1.0.0',envelope_json-'request_hash'
    )
  then
    raise exception using errcode='42501',message='DA_U6_PROVISIONER_REQUIRED';
  end if;

  begin
    scope_json:=envelope_json->'scope';
    if pg_catalog.jsonb_typeof(scope_json)<>'object'
      or (select pg_catalog.count(*) from pg_catalog.jsonb_object_keys(scope_json))<>3
    then raise exception using errcode='22023',message='DA_U6_AUTHORITY_MANIFEST_INVALID'; end if;
    requested_manifest_id:=(envelope_json->>'manifest_id')::uuid;
    requested_app_id:=(scope_json->>'app_id')::uuid;
    requested_tenant_id:=(scope_json->>'tenant_id')::uuid;
    requested_environment:=scope_json->>'environment';
    requested_principal_id:=(envelope_json->>'principal_id')::uuid;
    requested_deployment_id:=(envelope_json->>'deployment_id')::uuid;
    requested_expires_at:=(envelope_json->>'expires_at')::timestamptz;
    requested_profile:=envelope_json->>'profile';
  exception when invalid_text_representation or datetime_field_overflow then
    raise exception using errcode='22023',message='DA_U6_AUTHORITY_MANIFEST_INVALID';
  end;
  if requested_app_id<>'00000000-0000-4000-8000-00000000da01'::uuid
    or requested_environment is null
    or requested_environment!~'^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$'
  then raise exception using errcode='22023',message='DA_U6_AUTHORITY_MANIFEST_INVALID'; end if;

  db_now:=pg_catalog.clock_timestamp();
  if requested_expires_at<db_now+interval '5 minutes'
    or requested_expires_at>db_now+interval '30 days'
  then raise exception using errcode='22023',message='DA_U6_AUTHORITY_MANIFEST_EXPIRY_INVALID'; end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      requested_app_id::text||pg_catalog.chr(31)||requested_tenant_id::text||pg_catalog.chr(31)||
      requested_environment||pg_catalog.chr(31)||requested_principal_id::text,
      0
    )
  );
  select source.* into locked_deployment
  from platform.deployment_mappings as source
  where source.app_id=requested_app_id
    and source.environment=requested_environment
    and source.deployment_id=requested_deployment_id
  for update of source;
  select source.* into locked_lifecycle
  from platform.app_environment_lifecycle as source
  where source.app_id=requested_app_id and source.environment=requested_environment
  for update of source;
  select source.* into locked_membership
  from app_data_agent.memberships as source
  where source.app_id=requested_app_id
    and source.tenant_id=requested_tenant_id
    and source.environment=requested_environment
    and source.principal_id=requested_principal_id
  for update of source;
  if locked_deployment.deployment_id is null
    or not locked_deployment.is_active
    or locked_deployment.revoked_at is not null
    or locked_lifecycle.app_id is null
    or locked_lifecycle.lifecycle_state<>'ACTIVE'
    or locked_membership.principal_id is null
    or locked_membership.revoked_at is not null
    or pg_catalog.upper(locked_membership.membership_role) not in ('OWNER','ANALYST')
  then raise exception using errcode='42501',message='DA_U6_AUTHORITY_BINDING_INVALID'; end if;

  for assignment in
    select source.purpose,source.authority_kind,source.artifact_authority_domain
    from (values
      ('BRIEF_SEMANTIC','RESEARCH_ARTIFACT_AUTHORITY','BRIEF_SEMANTIC'),
      ('PLANNING','RESEARCH_ARTIFACT_AUTHORITY','PLANNING'),
      ('OBLIGATION_EXECUTION','RESEARCH_ARTIFACT_AUTHORITY','OBLIGATION_EXECUTION'),
      ('EVIDENCE','RESEARCH_ARTIFACT_AUTHORITY','EVIDENCE'),
      ('CLAIM_STRUCTURE','RESEARCH_ARTIFACT_AUTHORITY','CLAIM_STRUCTURE'),
      ('RELATION','RESEARCH_ARTIFACT_AUTHORITY','RELATION'),
      ('PROOF','RESEARCH_ARTIFACT_AUTHORITY','PROOF'),
      ('COVERAGE','RESEARCH_ARTIFACT_AUTHORITY','COVERAGE'),
      ('RESEARCH_STOP','RESEARCH_ARTIFACT_AUTHORITY','RESEARCH_STOP'),
      ('PROJECTION','RESEARCH_ARTIFACT_AUTHORITY','PROJECTION'),
      ('EVIDENCE_GATE','RESEARCH_ARTIFACT_AUTHORITY','EVIDENCE_GATE'),
      ('READINESS','RESEARCH_ARTIFACT_AUTHORITY','READINESS'),
      ('REPORT_READ','REPORT_READ_AUTHORITY',null)
    ) as source(purpose,authority_kind,artifact_authority_domain)
    order by source.purpose
  loop
    requested_assignment_key:=app_data_agent.u6_domain_sha256(
      'u6-authority-assignment@1.0.0',
      pg_catalog.jsonb_build_object(
        'principal_id',requested_principal_id,
        'authority_kind',assignment.authority_kind,
        'artifact_authority_domain',assignment.artifact_authority_domain,
        'frontier_kind',null,
        'resource_kind',null
      )
    );
    current_head:=null;
    current_capability:=null;
    select source.* into current_head
    from app_data_agent.research_authority_capability_heads as source
    where source.app_id=requested_app_id
      and source.tenant_id=requested_tenant_id
      and source.environment=requested_environment
      and source.assignment_key=requested_assignment_key
    for update of source;
    if current_head.current_capability_id is not null then
      select source.* into current_capability
      from app_data_agent.research_authority_capabilities as source
      where source.app_id=requested_app_id
        and source.tenant_id=requested_tenant_id
        and source.environment=requested_environment
        and source.capability_id=current_head.current_capability_id
      for update of source;
    end if;

    if current_capability.capability_id is not null
      and current_capability.state='ACTIVE'
      and current_capability.expires_at=requested_expires_at
      and current_capability.deployment_id=requested_deployment_id
      and current_capability.membership_version=locked_membership.membership_version
      and current_capability.app_epoch=locked_lifecycle.authority_epoch
      and current_capability.membership_role=pg_catalog.upper(locked_membership.membership_role)
      and current_capability.authority_kind=assignment.authority_kind
      and current_capability.artifact_authority_domain is not distinct from assignment.artifact_authority_domain
    then
      next_capability_id:=current_capability.capability_id;
    else
      next_authority_epoch:=pg_catalog.coalesce(current_head.current_authority_epoch,-1)+1;
      if current_capability.capability_id is not null and current_capability.state='ACTIVE' then
        update app_data_agent.research_authority_capabilities
        set state='REVOKED',revoked_at=db_now
        where app_id=requested_app_id
          and tenant_id=requested_tenant_id
          and environment=requested_environment
          and capability_id=current_capability.capability_id;
      end if;
      next_capability_id:=app_data_agent.u6_uuid_v5(
        requested_manifest_id,
        pg_catalog.convert_to(
          requested_assignment_key||pg_catalog.chr(31)||next_authority_epoch::text,'UTF8'
        )
      );
      insert into app_data_agent.research_authority_capabilities(
        app_id,tenant_id,environment,capability_id,assignment_key,principal_id,
        deployment_id,membership_version,app_epoch,membership_role,authority_kind,
        artifact_authority_domain,frontier_kind,resource_kind,authority_epoch,state,
        expires_at,revoked_at
      ) values (
        requested_app_id,requested_tenant_id,requested_environment,next_capability_id,
        requested_assignment_key,requested_principal_id,requested_deployment_id,
        locked_membership.membership_version,locked_lifecycle.authority_epoch,
        pg_catalog.upper(locked_membership.membership_role),assignment.authority_kind,
        assignment.artifact_authority_domain,null,null,next_authority_epoch,'ACTIVE',
        requested_expires_at,null
      );
      insert into app_data_agent.research_authority_capability_heads(
        app_id,tenant_id,environment,assignment_key,principal_id,authority_kind,
        artifact_authority_domain,frontier_kind,resource_kind,current_capability_id,
        current_authority_epoch,updated_at
      ) values (
        requested_app_id,requested_tenant_id,requested_environment,requested_assignment_key,
        requested_principal_id,assignment.authority_kind,assignment.artifact_authority_domain,
        null,null,next_capability_id,next_authority_epoch,db_now
      ) on conflict(app_id,tenant_id,environment,assignment_key) do update set
        current_capability_id=excluded.current_capability_id,
        current_authority_epoch=excluded.current_authority_epoch,
        updated_at=excluded.updated_at;
      created_any:=true;
    end if;
    capability_set:=capability_set||pg_catalog.jsonb_build_object(
      assignment.purpose,next_capability_id
    );
  end loop;

  return pg_catalog.jsonb_build_object(
    'protocol_version','u6-authority-capability-set@1.0.0',
    'manifest_id',requested_manifest_id,
    'scope',scope_json,
    'principal_id',requested_principal_id,
    'deployment_id',requested_deployment_id,
    'profile',requested_profile,
    'capabilities',capability_set,
    'expires_at',pg_catalog.to_char(requested_expires_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'created',created_any
  );
end
$function$;
alter function app_data_agent.provision_u6_authority_manifest(jsonb)
owner to data_agent_u6_provisioner_owner;
revoke all privileges on function app_data_agent.provision_u6_authority_manifest(jsonb)
from public,anon,authenticated,service_role,data_agent_backend,data_agent_job_authority;
grant execute on function app_data_agent.provision_u6_authority_manifest(jsonb)
to data_agent_u6_provisioner;

do $postconditions$
declare definition text;
begin
  select pg_catalog.pg_get_functiondef(
    'app_data_agent.provision_u6_authority_manifest(jsonb)'::pg_catalog.regprocedure
  ) into strict definition;
  if pg_catalog.strpos(definition,'RESEARCH_ANALYSIS_WORKER')=0
    or pg_catalog.strpos(definition,'DA_U6_AUTHORITY_MANIFEST_CONTRACT_UNAVAILABLE')>0
    or pg_catalog.strpos(definition,'REPORT_READ_AUTHORITY')=0
    or pg_catalog.strpos(definition,'pg_advisory_xact_lock')=0
  then raise exception using errcode='P0001',message='RESEARCH_AUTHORITY_PROVISIONER_NOT_INSTALLED'; end if;
  if not pg_catalog.has_function_privilege(
    'data_agent_u6_provisioner','app_data_agent.provision_u6_authority_manifest(jsonb)','EXECUTE'
  ) or pg_catalog.has_function_privilege(
    'data_agent_backend','app_data_agent.provision_u6_authority_manifest(jsonb)','EXECUTE'
  ) then raise exception using errcode='P0001',message='RESEARCH_AUTHORITY_PROVISIONER_ACL_INVALID'; end if;
end
$postconditions$;
select platform.assert_migration_checksum('app','00000000-0000-4000-8000-00000000da01'::uuid,
  '20260725010712_app_data_agent_research_authority_provisioning',
  'sha256:65599ab33e25af8001dcb11cc4cba2495811369ef3369ed0a4cff5545b98174b');
commit;
