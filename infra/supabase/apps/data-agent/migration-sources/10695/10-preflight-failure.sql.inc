alter table semantic.semantic_authoring_turn
  drop constraint semantic_authoring_provider_dispatch_closure,
  add constraint semantic_authoring_provider_dispatch_closure check(
    (provider_status='INTENT_COMMITTED')=(provider_dispatched_at is null)
    or (provider_status in ('RESPONSE_OBSERVED','FAILED')
      and provider_terminal_kind='FAILED' and provider_dispatched_at is null)
    or provider_status is null
  );
