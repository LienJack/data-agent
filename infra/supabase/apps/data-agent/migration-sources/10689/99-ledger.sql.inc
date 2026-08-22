select platform.assert_migration_checksum(
  'app','00000000-0000-4000-8000-00000000da01'::uuid,
  '20260725010689_app_data_agent_semantic_relationship_retry_repair',
  '__SEMANTIC_RELATIONSHIP_RETRY_REPAIR_MIGRATION_CHECKSUM__'
);
commit;
