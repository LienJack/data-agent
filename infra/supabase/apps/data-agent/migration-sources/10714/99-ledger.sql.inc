select platform.assert_migration_checksum('app','00000000-0000-4000-8000-00000000da01'::uuid,
  '20260725010714_app_data_agent_research_authority_platform_binding',
  '__RESEARCH_AUTHORITY_PLATFORM_BINDING_MIGRATION_CHECKSUM__');
commit;
