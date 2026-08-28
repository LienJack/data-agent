alter table semantic.semantic_successor_review_preparation
  owner to data_agent_u6_data_owner;
alter table semantic.semantic_successor_review_decision_document
  owner to data_agent_u6_data_owner;

alter table semantic.semantic_successor_review_preparation enable row level security;
alter table semantic.semantic_successor_review_preparation force row level security;
alter table semantic.semantic_successor_review_decision_document enable row level security;
alter table semantic.semantic_successor_review_decision_document force row level security;

create policy semantic_successor_review_preparation_rpc
on semantic.semantic_successor_review_preparation for all to data_agent_u6_rpc_owner
using(platform.backend_context_matches(app_id,tenant_id,environment,false)
  and semantic_domain=nullif(pg_catalog.current_setting('app.semantic_domain',true),''))
with check(platform.backend_context_matches(app_id,tenant_id,environment,true)
  and semantic_domain=nullif(pg_catalog.current_setting('app.semantic_domain',true),'')
  and principal_id=nullif(pg_catalog.current_setting('data_agent.principal_id',true),'')::uuid);

create policy semantic_successor_review_document_rpc
on semantic.semantic_successor_review_decision_document for select to data_agent_u6_rpc_owner
using(platform.backend_context_matches(app_id,tenant_id,environment,false)
  and semantic_domain=nullif(pg_catalog.current_setting('app.semantic_domain',true),''));
create policy semantic_successor_review_document_insert_rpc
on semantic.semantic_successor_review_decision_document for insert to data_agent_u6_rpc_owner
with check(platform.backend_context_matches(app_id,tenant_id,environment,true)
  and semantic_domain=nullif(pg_catalog.current_setting('app.semantic_domain',true),''));

create policy semantic_successor_review_task_insert_rpc
on semantic.semantic_review_task for insert to data_agent_u6_rpc_owner
with check(platform.backend_context_matches(app_id,tenant_id,environment,true)
  and semantic_domain=nullif(pg_catalog.current_setting('app.semantic_domain',true),'')
  and approval_mode='HUMAN_REVIEW');
create policy semantic_successor_review_decision_select_rpc
on semantic.semantic_review_decision for select to data_agent_u6_rpc_owner
using(platform.backend_context_matches(app_id,tenant_id,environment,false)
  and semantic_domain=nullif(pg_catalog.current_setting('app.semantic_domain',true),''));
create policy semantic_successor_review_decision_insert_rpc
on semantic.semantic_review_decision for insert to data_agent_u6_rpc_owner
with check(platform.backend_context_matches(app_id,tenant_id,environment,true)
  and semantic_domain=nullif(pg_catalog.current_setting('app.semantic_domain',true),'')
  and principal=nullif(pg_catalog.current_setting('data_agent.principal_id',true),''));
create policy semantic_successor_reviewer_policy_revision_rpc
on semantic.semantic_reviewer_policy_revision for select to data_agent_u6_rpc_owner
using(platform.backend_context_matches(app_id,tenant_id,environment,false)
  and semantic_domain=nullif(pg_catalog.current_setting('app.semantic_domain',true),''));
create policy semantic_successor_reviewer_policy_pointer_rpc
on semantic.semantic_reviewer_policy_pointer for select to data_agent_u6_rpc_owner
using(platform.backend_context_matches(app_id,tenant_id,environment,false)
  and semantic_domain=nullif(pg_catalog.current_setting('app.semantic_domain',true),''));
create policy semantic_successor_reviewer_assignment_rpc
on semantic.semantic_reviewer_assignment for select to data_agent_u6_rpc_owner
using(platform.backend_context_matches(app_id,tenant_id,environment,false)
  and semantic_domain=nullif(pg_catalog.current_setting('app.semantic_domain',true),''));

grant select,insert on table semantic.semantic_successor_review_preparation
  to data_agent_u6_rpc_owner;
grant select,insert on table semantic.semantic_successor_review_decision_document
  to data_agent_u6_rpc_owner;
grant select,insert,update on table semantic.semantic_review_task
  to data_agent_u6_rpc_owner;
grant select,insert on table semantic.semantic_review_decision
  to data_agent_u6_rpc_owner;
grant select on table semantic.semantic_reviewer_policy_revision,
  semantic.semantic_reviewer_policy_pointer,semantic.semantic_reviewer_assignment
  to data_agent_u6_rpc_owner;

alter function semantic.prepare_falcon24_successor_review(jsonb)
  owner to data_agent_u6_rpc_owner;
alter function semantic.record_review_decision(uuid,uuid,text,text,uuid,text,text,text,text)
  owner to data_agent_u6_rpc_owner;
alter function semantic.human_record_semantic_review_decision(jsonb)
  owner to data_agent_u6_rpc_owner;
alter function semantic.prepare_falcon24_successor_publish_attempt(jsonb)
  owner to data_agent_u6_rpc_owner;

grant execute on function
  semantic.lock_semantic_authority_fence(uuid,uuid,text,text),
  semantic.lock_packet(uuid,uuid,text,text,uuid),
  semantic.assert_review_packet_open(uuid,uuid,text,text,uuid),
  semantic.verify_principal_not_excluded(text,jsonb),
  semantic.u5_json_has_exact_keys(jsonb,text[]),
  semantic.assert_u5_scope(jsonb,text,boolean),
  platform.backend_context_matches(uuid,uuid,text,boolean),
  app_data_agent.u2_canonical_sha256(jsonb),
  app_data_agent.runtime_iso_timestamp(timestamptz)
to data_agent_u6_rpc_owner;
grant execute on function
  semantic.record_review_decision(uuid,uuid,text,text,uuid,text,text,text,text)
to data_agent_u6_rpc_owner;

revoke all on table semantic.semantic_successor_review_preparation,
  semantic.semantic_successor_review_decision_document
from public,anon,authenticated,service_role,data_agent_backend;
revoke all on function
  semantic.prepare_falcon24_successor_review(jsonb),
  semantic.record_review_decision(uuid,uuid,text,text,uuid,text,text,text,text),
  semantic.human_record_semantic_review_decision(jsonb),
  semantic.prepare_falcon24_successor_publish_attempt(jsonb)
from public,anon,authenticated,service_role,data_agent_backend;
grant execute on function
  semantic.prepare_falcon24_successor_review(jsonb),
  semantic.human_record_semantic_review_decision(jsonb),
  semantic.prepare_falcon24_successor_publish_attempt(jsonb)
to data_agent_backend;
