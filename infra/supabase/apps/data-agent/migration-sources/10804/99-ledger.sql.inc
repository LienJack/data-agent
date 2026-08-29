select platform.assert_migration_checksum(
  'app','00000000-0000-4000-8000-00000000da01'::uuid,
  '20260725010804_app_data_agent_falcon24_failure_receipt_closure',
  '__FALCON24_FAILURE_RECEIPT_CLOSURE_MIGRATION_CHECKSUM__');

commit;
