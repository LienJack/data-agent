select platform.assert_migration_checksum('app','00000000-0000-4000-8000-00000000da01'::uuid,
  '20260725010744_app_data_agent_analysis_governed_result_journal',
  '__ANALYSIS_GOVERNED_RESULT_JOURNAL_MIGRATION_CHECKSUM__');
commit;
