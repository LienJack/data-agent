select platform.assert_migration_checksum('app','00000000-0000-4000-8000-00000000da01'::uuid,
  '20260725010748_app_data_agent_analysis_stage_cleanup_authority',
  '__ANALYSIS_STAGE_CLEANUP_AUTHORITY_MIGRATION_CHECKSUM__');
commit;
