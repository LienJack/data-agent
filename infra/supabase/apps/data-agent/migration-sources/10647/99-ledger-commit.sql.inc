select platform.assert_migration_checksum(
  'app',
  '00000000-0000-4000-8000-00000000da01'::uuid,
  '20260725010647_app_data_agent_workspace_command_payload',
  '__WORKSPACE_COMMAND_PAYLOAD_MIGRATION_CHECKSUM__'
);

commit;
