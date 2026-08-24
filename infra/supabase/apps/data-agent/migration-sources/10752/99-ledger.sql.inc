select platform.assert_migration_checksum('app','00000000-0000-4000-8000-00000000da01'::uuid,
  '20260725010752_app_data_agent_analysis_context_journal_coalesce_repair',
  '__ANALYSIS_CONTEXT_JOURNAL_COALESCE_REPAIR_MIGRATION_CHECKSUM__');
commit;
