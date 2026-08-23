select platform.assert_migration_checksum('app','00000000-0000-4000-8000-00000000da01'::uuid,
  '20260725010712_app_data_agent_research_authority_provisioning',
  '__RESEARCH_AUTHORITY_PROVISIONING_MIGRATION_CHECKSUM__');
commit;
