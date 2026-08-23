select platform.assert_migration_checksum('app','00000000-0000-4000-8000-00000000da01'::uuid,
  '20260725010718_app_data_agent_research_authority_rowtype_repair',
  '__RESEARCH_AUTHORITY_ROWTYPE_REPAIR_MIGRATION_CHECKSUM__');
commit;
