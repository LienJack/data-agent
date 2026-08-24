select platform.assert_migration_checksum('app','00000000-0000-4000-8000-00000000da01'::uuid,
  '20260725010751_app_data_agent_analysis_stage_cleanup_hash_grant',
  '__ANALYSIS_STAGE_CLEANUP_HASH_GRANT_MIGRATION_CHECKSUM__');
commit;
