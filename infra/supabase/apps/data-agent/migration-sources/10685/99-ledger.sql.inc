select platform.assert_migration_checksum(
  'app','00000000-0000-4000-8000-00000000da01'::uuid,
  '20260725010685_app_data_agent_semantic_revision_idempotency_lock',
  '__SEMANTIC_REVISION_IDEMPOTENCY_LOCK_MIGRATION_CHECKSUM__'
);
commit;
