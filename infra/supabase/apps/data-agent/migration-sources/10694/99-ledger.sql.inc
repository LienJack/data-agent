select platform.assert_migration_checksum(
  'app','00000000-0000-4000-8000-00000000da01'::uuid,
  '20260725010694_app_data_agent_semantic_provider_pending_attempt_recovery',
  '__SEMANTIC_PROVIDER_PENDING_ATTEMPT_MIGRATION_CHECKSUM__'
);
commit;
