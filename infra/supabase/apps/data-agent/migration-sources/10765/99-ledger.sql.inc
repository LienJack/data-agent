select platform.assert_migration_checksum('app','00000000-0000-4000-8000-00000000da01'::uuid,
  '20260725010765_app_data_agent_governed_analysis_public_event',
  '__GOVERNED_ANALYSIS_PUBLIC_EVENT_MIGRATION_CHECKSUM__');
commit;
