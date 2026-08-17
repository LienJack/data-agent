-- ============================================================
-- Forward-only governance mode extension. Existing rows remain HUMAN_REVIEW.
-- ============================================================

alter table semantic.semantic_review_task
  add column approval_mode text not null default 'HUMAN_REVIEW';
alter table semantic.semantic_review_task
  drop constraint semantic_review_task_packet_kind_check;
alter table semantic.semantic_review_task
  add constraint semantic_review_task_packet_kind_check check (
    (approval_mode = 'HUMAN_REVIEW' and packet_kind in (
      'CANDIDATE_REVIEW','ROLLBACK_REVIEW','LEGACY_CLOSURE_REVIEW'
    )) or
    (approval_mode = 'SYSTEM_BOOTSTRAP_POLICY' and packet_kind = 'SYSTEM_BOOTSTRAP_ADMISSION')
  );
alter table semantic.semantic_review_task
  add constraint semantic_review_task_approval_mode_check
  check (approval_mode in ('HUMAN_REVIEW','SYSTEM_BOOTSTRAP_POLICY'));

alter table semantic.semantic_publish_attempt
  add column approval_mode text not null default 'HUMAN_REVIEW'
  check (approval_mode in ('HUMAN_REVIEW','SYSTEM_BOOTSTRAP_POLICY'));
alter table semantic.semantic_source_release
  add column approval_mode text not null default 'HUMAN_REVIEW'
  check (approval_mode in ('HUMAN_REVIEW','SYSTEM_BOOTSTRAP_POLICY'));

create function semantic.reject_system_bootstrap_human_decision()
returns trigger language plpgsql set search_path = '' as $function$
begin
  if exists (
    select 1 from semantic.semantic_review_task as task
    where task.app_id = new.app_id and task.tenant_id = new.tenant_id
      and task.environment = new.environment and task.semantic_domain = new.semantic_domain
      and task.packet_id = new.packet_id
      and task.approval_mode = 'SYSTEM_BOOTSTRAP_POLICY'
  ) then
    raise exception using errcode = '42501', message = 'SEMANTIC_BOOTSTRAP_HUMAN_DECISION_FORBIDDEN';
  end if;
  return new;
end
$function$;

create trigger semantic_review_decision_system_bootstrap_guard
before insert or update on semantic.semantic_review_decision
for each row execute function semantic.reject_system_bootstrap_human_decision();
