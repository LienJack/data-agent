select platform.assert_migration_checksum('app','00000000-0000-4000-8000-00000000da01'::uuid,
  '20260725010743_app_data_agent_opensandbox_analysis_cutover',
  '__OPENSANDBOX_ANALYSIS_CUTOVER_MIGRATION_CHECKSUM__');
commit;
