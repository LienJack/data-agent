select platform.assert_migration_checksum(
  'app','00000000-0000-4000-8000-00000000da01'::uuid,
  '20260725010665_app_data_agent_extension_registry','__U14_EXTENSION_MIGRATION_CHECKSUM__');
commit;
