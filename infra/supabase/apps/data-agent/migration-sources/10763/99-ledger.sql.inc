select platform.assert_migration_checksum('app','00000000-0000-4000-8000-00000000da01'::uuid,
  '20260725010763_app_data_agent_semantic_helper_consumer_repair',
  '__SEMANTIC_HELPER_CONSUMER_REPAIR_MIGRATION_CHECKSUM__');
commit;
