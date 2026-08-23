select platform.assert_migration_checksum('app','00000000-0000-4000-8000-00000000da01'::uuid,
  '20260725010720_app_data_agent_research_authority_uuid_grant',
  '__RESEARCH_AUTHORITY_UUID_GRANT_MIGRATION_CHECKSUM__');
commit;
