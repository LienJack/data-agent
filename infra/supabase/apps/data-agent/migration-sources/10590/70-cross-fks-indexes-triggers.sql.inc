alter table app_data_agent.research_invocation_results
  add column secure_sql_receipt_id uuid,
  add constraint research_invocation_results_record_blob_uq
    unique (
      app_id, tenant_id, environment, record_kind, record_id, blob_id
    ),
  add constraint research_invocation_results_record_receipt_uq
    unique (
      app_id, tenant_id, environment, record_id, secure_sql_receipt_id
    ),
  add constraint research_invocation_results_blob_fk
    foreign key (
      app_id, tenant_id, environment, record_kind, record_id, blob_id
    )
    references app_data_agent.research_invocation_result_blobs (
      app_id, tenant_id, environment, result_record_kind, result_record_id, blob_id
    )
    on delete no action
    deferrable initially deferred,
  add constraint research_invocation_results_sql_receipt_fk
    foreign key (app_id, tenant_id, environment, secure_sql_receipt_id)
    references app_data_agent.research_secure_sql_execution_receipts (
      app_id, tenant_id, environment, record_id
    )
    on delete no action
    deferrable initially deferred,
  add constraint research_invocation_results_sql_receipt_shape
    check (
      (record_kind = 'SQL_INVOCATION_RESULT' and secure_sql_receipt_id is not null)
      or (record_kind <> 'SQL_INVOCATION_RESULT' and secure_sql_receipt_id is null)
    );

alter table app_data_agent.research_invocation_result_blobs
  add constraint research_invocation_result_blobs_result_fk
    foreign key (
      app_id, tenant_id, environment, result_record_kind, result_record_id, blob_id
    )
    references app_data_agent.research_invocation_results (
      app_id, tenant_id, environment, record_kind, record_id, blob_id
    )
    on delete no action
    deferrable initially deferred;

alter table app_data_agent.research_secure_sql_execution_receipts
  add constraint research_secure_sql_receipts_result_fk
    foreign key (app_id, tenant_id, environment, result_record_id, record_id)
    references app_data_agent.research_invocation_results (
      app_id, tenant_id, environment, record_id, secure_sql_receipt_id
    )
    on delete no action
    deferrable initially deferred;

alter table app_data_agent.research_invocation_terminal_preparations
  add constraint research_terminal_preparations_transition_fk
    foreign key (app_id, tenant_id, environment, invocation_id, transition_id)
    references app_data_agent.research_invocation_transition_operations (
      app_id, tenant_id, environment, invocation_id, transition_id
    )
    on delete restrict not deferrable;

create index research_authority_capabilities_expiry
on app_data_agent.research_authority_capabilities (
  app_id, tenant_id, environment, expires_at
)
where state = 'ACTIVE';

create index research_artifact_commit_operations_run_time
on app_data_agent.research_artifact_commit_operations (
  app_id, tenant_id, environment, run_id, committed_at
);

create index research_frontier_operations_run_time
on app_data_agent.research_frontier_operations (
  app_id, tenant_id, environment, run_id, completed_at
);

create index report_read_grants_expiry
on app_data_agent.report_read_grants (
  app_id, tenant_id, environment, expires_at, grant_id
)
where state in ('ISSUED', 'CONSUMED');

create index research_resource_reservations_run_state
on app_data_agent.research_resource_reservations (
  app_id, tenant_id, environment, run_id, state, reservation_seq
);

create index research_invocation_commits_run_state
on app_data_agent.research_invocation_commits (
  app_id, tenant_id, environment, run_id, state, invocation_id
);

create index research_invocation_terminal_preparations_expiry
on app_data_agent.research_invocation_terminal_preparations (
  app_id, tenant_id, environment, expires_at, preparation_id
)
where state in ('PREPARING', 'PREPARED');

create trigger research_artifact_commit_operations_immutable
before update or delete on app_data_agent.research_artifact_commit_operations
for each row execute function platform.reject_immutable_mutation();

create trigger research_frontier_events_immutable
before update or delete on app_data_agent.research_frontier_events
for each row execute function platform.reject_immutable_mutation();

create trigger research_readiness_publications_immutable
before update or delete on app_data_agent.research_readiness_publications
for each row execute function platform.reject_immutable_mutation();

create trigger research_readiness_consumptions_immutable
before update or delete on app_data_agent.research_readiness_consumptions
for each row execute function platform.reject_immutable_mutation();

create trigger research_domain_terminals_immutable
before update or delete on app_data_agent.research_domain_terminals
for each row execute function platform.reject_immutable_mutation();

create trigger research_stop_terminal_commits_immutable
before update or delete on app_data_agent.research_stop_terminal_commits
for each row execute function platform.reject_immutable_mutation();

create trigger research_release_decision_commits_immutable
before update or delete on app_data_agent.research_release_decision_commits
for each row execute function platform.reject_immutable_mutation();

create trigger research_result_key_transition_operations_immutable
before update or delete on app_data_agent.research_result_key_transition_operations
for each row execute function platform.reject_immutable_mutation();

create trigger research_resource_transition_operations_immutable
before update or delete on app_data_agent.research_resource_transition_operations
for each row execute function platform.reject_immutable_mutation();

create trigger research_invocation_request_operations_immutable
before update or delete on app_data_agent.research_invocation_request_operations
for each row execute function platform.reject_immutable_mutation();

create trigger research_invocation_transition_operations_immutable
before update or delete on app_data_agent.research_invocation_transition_operations
for each row execute function platform.reject_immutable_mutation();

create trigger research_system_artifacts_immutable
before update or delete on app_data_agent.research_system_artifacts
for each row execute function platform.reject_immutable_mutation();

create trigger research_system_record_identities_immutable
before update or delete on app_data_agent.research_system_record_identities
for each row execute function platform.reject_immutable_mutation();

create trigger research_adapter_termination_receipts_immutable
before update or delete on app_data_agent.research_adapter_termination_receipts
for each row execute function platform.reject_immutable_mutation();

create trigger research_invocation_outcome_usage_immutable
before update or delete on app_data_agent.research_invocation_outcome_usage
for each row execute function platform.reject_immutable_mutation();

create trigger research_result_access_audit_purge_operations_immutable
before update or delete on app_data_agent.research_result_access_audit_purge_operations
for each row execute function platform.reject_immutable_mutation();
