select platform.assert_migration_checksum(
  'app',
  '00000000-0000-4000-8000-00000000da01'::uuid,
  '20260725010660_app_data_agent_workspace_files',
  '__WORKSPACE_FILES_MIGRATION_CHECKSUM__'
);

commit;
