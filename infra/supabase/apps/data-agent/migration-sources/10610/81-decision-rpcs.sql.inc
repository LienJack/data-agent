-- ============================================================
-- 10610: Decision RPC functions
-- Transaction pattern:
--   BEGIN
--     ACQUIRE scope_authority_fence advisory lock
--     ACQUIRE packet advisory lock
--     LOCK semantic_authority_fence FOR UPDATE
--     LOCK semantic_review_task FOR UPDATE
--     ASSERT packet.decision_window_status = OPEN
--     ASSERT review_outcome = PENDING && now < decision_expires_at
--     LOCK current policy/assignment/membership rows in canonical order
--     ASSERT base/policy/membership/principal role/eligibility/exclusion are current
--     INSERT immutable decision UNIQUE(scope, packet, principal, semantic_role)
--     IF veto: UPDATE packet SET decision_window_status=CLOSED, review_outcome=VETOED
--     ELSE IF quorum: UPDATE packet SET decision_window_status=CLOSED, review_outcome=APPROVED
--   COMMIT
-- ============================================================

-- ============================================================
-- Record a review decision (APPROVE or REJECT)
-- A7 Agent: cannot approve/reject (only propose/submit)
-- A2 Human Reviewer: can approve/reject, human session only
-- ============================================================
create or replace function semantic.record_review_decision(
  p_app_id uuid,
  p_tenant_id uuid,
  p_environment text,
  p_semantic_domain text,
  p_packet_id uuid,
  p_principal text,
  p_semantic_role text,
  p_decision text,
  p_decision_reason text default null
) returns jsonb
  language plpgsql
  strict
  security definer
  set search_path = ''
as $function$
declare
  v_decision_id uuid;
  v_decision_digest text;
  v_current_veto_rules jsonb;
  v_current_quorum_rules jsonb;
  v_exclusion_set jsonb;
  v_packet_kind text;
  v_total_approvals integer;
  v_total_rejections integer;
  v_required_approvals integer;
  v_veto_count integer;
  v_min_reviewers integer;
  v_decision_set_digest text;
  v_result jsonb;
begin
  -- Acquire locks in canonical order
  perform semantic.lock_semantic_authority_fence(p_app_id, p_tenant_id, p_environment, p_semantic_domain);
  perform semantic.lock_packet(p_app_id, p_tenant_id, p_environment, p_semantic_domain, p_packet_id);

  -- Lock authority fence row
  perform 1
  from semantic.semantic_authority_fence as fence
  where fence.app_id = p_app_id
    and fence.tenant_id = p_tenant_id
    and fence.environment = p_environment
  for update;

  -- Assert packet is open
  perform semantic.assert_review_packet_open(p_app_id, p_tenant_id, p_environment, p_semantic_domain, p_packet_id);

  -- Get packet details
  select task.packet_kind, task.veto_rules_snapshot, task.quorum_rules_snapshot, task.exclusion_set
  into v_packet_kind, v_current_veto_rules, v_current_quorum_rules, v_exclusion_set
  from semantic.semantic_review_task as task
  where task.app_id = p_app_id
    and task.tenant_id = p_tenant_id
    and task.environment = p_environment
    and task.semantic_domain = p_semantic_domain
    and task.packet_id = p_packet_id
  for update;

  -- Verify principal not excluded
  perform semantic.verify_principal_not_excluded(p_principal, v_exclusion_set);

  -- Verify principal has valid assignment for this role
  perform 1
  from semantic.semantic_reviewer_assignment as assignment
  where assignment.app_id = p_app_id
    and assignment.tenant_id = p_tenant_id
    and assignment.environment = p_environment
    and assignment.semantic_domain = p_semantic_domain
    and assignment.principal = p_principal
    and assignment.semantic_role = p_semantic_role
    and assignment.is_active = true
    and (assignment.expires_at is null or assignment.expires_at > pg_catalog.clock_timestamp())
  for update;
  if not found then
    raise exception using errcode = '42501', message = 'SEMANTIC_REVIEWER_REQUIRED';
  end if;

  -- Generate decision ID and digest
  v_decision_id := extensions.gen_random_uuid();
  v_decision_digest := semantic.semantic_sha256(
    p_packet_id::text || p_principal || p_semantic_role || p_decision || coalesce(p_decision_reason, ''),
    jsonb_build_object('version', '1.0.0', 'kind', 'review_decision')
  );

  -- Insert immutable decision
  insert into semantic.semantic_review_decision (
    app_id, tenant_id, environment, semantic_domain,
    packet_id, decision_id, principal, semantic_role,
    decision, decision_reason, decision_digest
  ) values (
    p_app_id, p_tenant_id, p_environment, p_semantic_domain,
    p_packet_id, v_decision_id, p_principal, p_semantic_role,
    p_decision, p_decision_reason, v_decision_digest
  );

  -- Count current approvals and rejections
  select count(*) into v_total_approvals
  from semantic.semantic_review_decision as decision
  where decision.app_id = p_app_id
    and decision.tenant_id = p_tenant_id
    and decision.environment = p_environment
    and decision.semantic_domain = p_semantic_domain
    and decision.packet_id = p_packet_id
    and decision.decision = 'APPROVE';

  select count(*) into v_total_rejections
  from semantic.semantic_review_decision as decision
  where decision.app_id = p_app_id
    and decision.tenant_id = p_tenant_id
    and decision.environment = p_environment
    and decision.semantic_domain = p_semantic_domain
    and decision.packet_id = p_packet_id
    and decision.decision = 'REJECT';

  -- Check veto rules
  v_veto_count := (v_current_veto_rules->>'min_veto_count')::integer;
  if v_veto_count is null then
    v_veto_count := 1;
  end if;

  if p_decision = 'REJECT' and v_total_rejections >= v_veto_count then
    -- Veto: close packet with VETOED
    update semantic.semantic_review_task as task
    set decision_window_status = 'CLOSED',
        review_outcome = 'VETOED',
        closed_at = pg_catalog.clock_timestamp()
    where task.app_id = p_app_id
      and task.tenant_id = p_tenant_id
      and task.environment = p_environment
      and task.semantic_domain = p_semantic_domain
      and task.packet_id = p_packet_id;

    v_result := jsonb_build_object(
      'decision_id', v_decision_id,
      'decision_digest', v_decision_digest,
      'packet_closed', true,
      'outcome', 'VETOED',
      'total_approvals', v_total_approvals,
      'total_rejections', v_total_rejections
    );
  else
    -- Check quorum rules
    v_required_approvals := (v_current_quorum_rules->>'required_approvals')::integer;
    if v_required_approvals is null then
      v_min_reviewers := (v_current_quorum_rules->>'min_reviewers')::integer;
      if v_min_reviewers is null then
        v_required_approvals := 1;
      else
        v_required_approvals := v_min_reviewers;
      end if;
    end if;

    if v_total_approvals >= v_required_approvals then
      -- Quorum reached: compute decision set digest and close
      v_decision_set_digest := semantic.semantic_sha256(
        p_packet_id::text || v_total_approvals::text || v_total_rejections::text,
        jsonb_build_object('version', '1.0.0', 'kind', 'decision_set')
      );

      update semantic.semantic_review_task as task
      set decision_window_status = 'CLOSED',
          review_outcome = 'APPROVED',
          closed_at = pg_catalog.clock_timestamp()
      where task.app_id = p_app_id
        and task.tenant_id = p_tenant_id
        and task.environment = p_environment
        and task.semantic_domain = p_semantic_domain
        and task.packet_id = p_packet_id;

      v_result := jsonb_build_object(
        'decision_id', v_decision_id,
        'decision_digest', v_decision_digest,
        'packet_closed', true,
        'outcome', 'APPROVED',
        'decision_set_digest', v_decision_set_digest,
        'total_approvals', v_total_approvals,
        'total_rejections', v_total_rejections
      );
    else
      v_result := jsonb_build_object(
        'decision_id', v_decision_id,
        'decision_digest', v_decision_digest,
        'packet_closed', false,
        'outcome', 'PENDING',
        'total_approvals', v_total_approvals,
        'total_rejections', v_total_rejections,
        'required_approvals', v_required_approvals
      );
    end if;
  end if;

  return v_result;
end;
$function$;
