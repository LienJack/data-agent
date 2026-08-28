create or replace function semantic.record_review_decision(
  p_app_id uuid,p_tenant_id uuid,p_environment text,p_semantic_domain text,
  p_packet_id uuid,p_principal text,p_semantic_role text,p_decision text,
  p_decision_reason text default null
) returns jsonb language plpgsql volatile security definer set search_path='' as $function$
#variable_conflict use_variable
declare
  task semantic.semantic_review_task%rowtype;
  decision_id uuid:=extensions.gen_random_uuid();
  decision_digest text;
  total_approvals integer;
  total_rejections integer;
  required_approvals integer;
  veto_count integer;
  min_reviewers integer;
  decision_set_digest text;
  strict_successor boolean;
  policy_ref jsonb;
  change_set jsonb;
  reason_codes jsonb;
  review_material jsonb;
  review_document jsonb;
  now_at timestamptz:=pg_catalog.clock_timestamp();
  result jsonb;
begin
  if p_decision not in ('APPROVE','REJECT')
    or p_semantic_role not in ('domain_reviewer','security_reviewer','admin_reviewer')
  then raise exception using errcode='22023',message='SEMANTIC_REVIEW_DECISION_INVALID'; end if;

  perform semantic.lock_semantic_authority_fence(
    p_app_id,p_tenant_id,p_environment,p_semantic_domain);
  perform semantic.lock_packet(
    p_app_id,p_tenant_id,p_environment,p_semantic_domain,p_packet_id);
  perform semantic.assert_review_packet_open(
    p_app_id,p_tenant_id,p_environment,p_semantic_domain,p_packet_id);

  select review_task.* into task from semantic.semantic_review_task as review_task
  where review_task.app_id=p_app_id and review_task.tenant_id=p_tenant_id
    and review_task.environment=p_environment
    and review_task.semantic_domain=p_semantic_domain
    and review_task.packet_id=p_packet_id
  for update;
  if not found or task.approval_mode<>'HUMAN_REVIEW'
  then raise exception using errcode='P0002',message='SEMANTIC_REVIEW_PACKET_NOT_FOUND'; end if;

  perform semantic.verify_principal_not_excluded(p_principal,task.exclusion_set);
  strict_successor:=task.packet_payload->>'schema_version'=
    'semantic-successor-review-packet@1.0.0';
  policy_ref:=task.packet_payload->'review_policy_ref';
  change_set:=task.packet_payload->'change_set';
  if strict_successor and (
      task.packet_kind<>'CANDIDATE_REVIEW'
      or task.candidate_id is null
      or not semantic.u5_json_has_exact_keys(policy_ref,array[
        'policy_version','policy_digest']::text[])
      or coalesce(policy_ref->>'policy_version','')!~'^[1-9][0-9]{0,15}$'
      or coalesce(policy_ref->>'policy_digest','')!~'^sha256:[0-9a-f]{64}$'
      or change_set->>'schema_version'<>'semantic-change-set@1.0.0'
      or change_set->>'lifecycle_state'<>'REVIEW_FROZEN'
      or change_set#>>'{validation,outcome}'<>'PASS'
      or change_set->>'change_set_id'<>task.candidate_id::text
      or coalesce(change_set->>'change_set_hash','')!~'^sha256:[0-9a-f]{64}$'
      or app_data_agent.u2_canonical_sha256(change_set-'change_set_hash')<>
        change_set->>'change_set_hash'
      or p_principal!~*
        '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      or (p_decision_reason is not null and
        (pg_catalog.length(pg_catalog.btrim(p_decision_reason))<1
          or pg_catalog.length(pg_catalog.btrim(p_decision_reason))>128))
    )
  then raise exception using errcode='22023',
    message='SEMANTIC_SUCCESSOR_REVIEW_PACKET_INVALID'; end if;

  perform 1 from semantic.semantic_reviewer_assignment as assignment
  where assignment.app_id=p_app_id and assignment.tenant_id=p_tenant_id
    and assignment.environment=p_environment and assignment.semantic_domain=p_semantic_domain
    and assignment.principal=p_principal and assignment.semantic_role=p_semantic_role
    and assignment.is_active=true
    and (assignment.expires_at is null or assignment.expires_at>now_at)
    and (not strict_successor
      or assignment.policy_version=(policy_ref->>'policy_version')::bigint);
  if not found then raise exception using errcode='42501',message='SEMANTIC_REVIEWER_REQUIRED'; end if;

  if strict_successor then
    perform 1 from semantic.semantic_reviewer_policy_pointer as current_policy
    where current_policy.app_id=p_app_id and current_policy.tenant_id=p_tenant_id
      and current_policy.environment=p_environment
      and current_policy.semantic_domain=p_semantic_domain
      and current_policy.current_policy_version=(policy_ref->>'policy_version')::bigint
      and current_policy.current_policy_digest=policy_ref->>'policy_digest';
    if not found then raise exception using errcode='40001',
      message='SEMANTIC_SUCCESSOR_REVIEW_POLICY_STALE'; end if;
    reason_codes:=case when p_decision_reason is null then '[]'::jsonb
      else pg_catalog.jsonb_build_array(pg_catalog.btrim(p_decision_reason)) end;
    review_material:=pg_catalog.jsonb_build_object(
      'schema_version','semantic-review-decision@1.0.0',
      'review_id',p_packet_id,
      'scope',pg_catalog.jsonb_build_object(
        'app_id',p_app_id,'tenant_id',p_tenant_id,'environment',p_environment,
        'semantic_domain',p_semantic_domain),
      'change_set_id',task.candidate_id,
      'change_set_hash',change_set->>'change_set_hash',
      'reviewer_principal_id',p_principal::uuid,
      'decision',p_decision,
      'reason_codes',reason_codes,
      'reviewed_at',app_data_agent.runtime_iso_timestamp(now_at));
    decision_digest:=app_data_agent.u2_canonical_sha256(review_material);
    review_document:=review_material||pg_catalog.jsonb_build_object(
      'review_hash',decision_digest);
  else
    decision_digest:=semantic.semantic_sha256(
      p_packet_id::text||p_principal||p_semantic_role||p_decision||
        coalesce(p_decision_reason,''),
      pg_catalog.jsonb_build_object('version','1.0.0','kind','review_decision'));
  end if;

  insert into semantic.semantic_review_decision(
    app_id,tenant_id,environment,semantic_domain,packet_id,decision_id,
    principal,semantic_role,decision,decision_reason,decision_digest,created_at)
  values(p_app_id,p_tenant_id,p_environment,p_semantic_domain,p_packet_id,decision_id,
    p_principal,p_semantic_role,p_decision,p_decision_reason,decision_digest,now_at);
  if strict_successor then
    insert into semantic.semantic_successor_review_decision_document(
      app_id,tenant_id,environment,semantic_domain,packet_id,decision_id,
      review_hash,review_document,created_at)
    values(p_app_id,p_tenant_id,p_environment,p_semantic_domain,p_packet_id,decision_id,
      decision_digest,review_document,now_at);
  end if;

  select pg_catalog.count(*) filter(where decision='APPROVE'),
    pg_catalog.count(*) filter(where decision='REJECT')
  into total_approvals,total_rejections
  from semantic.semantic_review_decision as review_decision
  where review_decision.app_id=p_app_id and review_decision.tenant_id=p_tenant_id
    and review_decision.environment=p_environment
    and review_decision.semantic_domain=p_semantic_domain
    and review_decision.packet_id=p_packet_id;

  veto_count:=coalesce((task.veto_rules_snapshot->>'min_veto_count')::integer,1);
  if p_decision='REJECT' and total_rejections>=veto_count then
    update semantic.semantic_review_task set decision_window_status='CLOSED',
      review_outcome='VETOED',closed_at=now_at
    where app_id=p_app_id and tenant_id=p_tenant_id and environment=p_environment
      and semantic_domain=p_semantic_domain and packet_id=p_packet_id;
    if task.candidate_id is not null then
      update semantic.semantic_candidate set candidate_status='REJECTED',updated_at=now_at
      where app_id=p_app_id and tenant_id=p_tenant_id and environment=p_environment
        and semantic_domain=p_semantic_domain and candidate_id=task.candidate_id
        and candidate_status in ('REVIEW_SUBMITTED','WAITING_REVIEW');
    end if;
    result:=pg_catalog.jsonb_build_object(
      'decision_id',decision_id,'decision_digest',decision_digest,
      'packet_closed',true,'outcome','VETOED','total_approvals',total_approvals,
      'total_rejections',total_rejections);
  else
    required_approvals:=(task.quorum_rules_snapshot->>'required_approvals')::integer;
    if required_approvals is null then
      min_reviewers:=(task.quorum_rules_snapshot->>'min_reviewers')::integer;
      required_approvals:=coalesce(min_reviewers,1);
    end if;
    if total_approvals>=required_approvals then
      decision_set_digest:=semantic.semantic_sha256(
        p_packet_id::text||total_approvals::text||total_rejections::text,
        pg_catalog.jsonb_build_object('version','1.0.0','kind','decision_set'));
      update semantic.semantic_review_task set decision_window_status='CLOSED',
        review_outcome='APPROVED',closed_at=now_at
      where app_id=p_app_id and tenant_id=p_tenant_id and environment=p_environment
        and semantic_domain=p_semantic_domain and packet_id=p_packet_id;
      if task.candidate_id is not null then
        update semantic.semantic_candidate set candidate_status='APPROVED',updated_at=now_at
        where app_id=p_app_id and tenant_id=p_tenant_id and environment=p_environment
          and semantic_domain=p_semantic_domain and candidate_id=task.candidate_id
          and candidate_status in ('REVIEW_SUBMITTED','WAITING_REVIEW');
      end if;
      result:=pg_catalog.jsonb_build_object(
        'decision_id',decision_id,'decision_digest',decision_digest,
        'packet_closed',true,'outcome','APPROVED',
        'decision_set_digest',decision_set_digest,'total_approvals',total_approvals,
        'total_rejections',total_rejections);
    else
      result:=pg_catalog.jsonb_build_object(
        'decision_id',decision_id,'decision_digest',decision_digest,
        'packet_closed',false,'outcome','PENDING','total_approvals',total_approvals,
        'total_rejections',total_rejections,'required_approvals',required_approvals);
    end if;
  end if;
  return result;
end
$function$;

create function semantic.human_record_semantic_review_decision(p_command jsonb)
returns jsonb language plpgsql volatile security definer set search_path='' as $function$
declare scope_json jsonb; principal_id uuid;
begin
  if p_command is null or not semantic.u5_json_has_exact_keys(p_command,array[
    'schema_version','scope','semantic_domain','packet_id','principal_id',
    'semantic_role','decision','decision_reason'
  ]::text[]) or p_command->>'schema_version'<>'human-semantic-review-decision@1.0.0'
    or coalesce(p_command->>'packet_id','')!~*
      '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    or coalesce(p_command->>'principal_id','')!~*
      '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    or p_command->>'semantic_role' not in
      ('domain_reviewer','security_reviewer','admin_reviewer')
    or p_command->>'decision' not in ('APPROVE','REJECT')
    or (p_command->'decision_reason'<>'null'::jsonb
      and pg_catalog.jsonb_typeof(p_command->'decision_reason')<>'string')
  then raise exception using errcode='22023',message='SEMANTIC_HUMAN_REVIEW_COMMAND_INVALID'; end if;
  scope_json:=p_command->'scope';
  perform semantic.assert_u5_scope(scope_json,p_command->>'semantic_domain',true);
  principal_id:=nullif(pg_catalog.current_setting('data_agent.principal_id',true),'')::uuid;
  if principal_id is distinct from (p_command->>'principal_id')::uuid
  then raise exception using errcode='42501',message='SEMANTIC_HUMAN_REVIEW_SCOPE_FORBIDDEN'; end if;
  return semantic.record_review_decision(
    (scope_json->>'app_id')::uuid,(scope_json->>'tenant_id')::uuid,
    scope_json->>'environment',p_command->>'semantic_domain',
    (p_command->>'packet_id')::uuid,p_command->>'principal_id',
    p_command->>'semantic_role',p_command->>'decision',p_command->>'decision_reason');
end
$function$;
