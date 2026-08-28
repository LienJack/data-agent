alter table app_data_agent.falcon24_diagnostic_attempts
  drop constraint falcon24_diagnostic_attempts_authority_epoch_check,
  drop constraint falcon24_diagnostic_attempts_semantic_release_generation_check;

alter table app_data_agent.falcon24_diagnostic_attempts
  add constraint falcon24_diagnostic_attempts_authority_epoch_check check(
    app_data_agent.falcon24_authority_epoch_is_canonical(authority_epoch)
    and pg_catalog.substr(authority_epoch,2)::numeric>=4),
  add constraint falcon24_diagnostic_attempts_semantic_release_generation_check check(
    semantic_release_generation=2),
  add constraint falcon24_diagnostic_attempts_manifest_epoch_check check(
    (authority_epoch='E4'
      and manifest_document->>'schema_version'='falcon24-diagnostic-attempt@1.0.0')
    or (pg_catalog.substr(authority_epoch,2)::numeric>=5
      and manifest_document->>'schema_version'='falcon24-diagnostic-attempt@2.0.0'));

alter table app_data_agent.falcon24_diagnostic_receipts
  drop constraint falcon24_diagnostic_receipts_receipt_document_check1;

alter table app_data_agent.falcon24_diagnostic_receipts
  add constraint falcon24_diagnostic_receipts_receipt_document_version_check check(
    receipt_document->>'schema_version' in(
      'falcon24-diagnostic-receipt@1.0.0','falcon24-diagnostic-receipt@2.0.0'));
