select platform.assert_migration_checksum(
  'app',
  '00000000-0000-4000-8000-00000000da01'::uuid,
  '20260725010703_app_data_agent_commercial_archive_retirement',
  '__COMMERCIAL_ARCHIVE_RETIREMENT_MIGRATION_CHECKSUM__'
);

commit;
