select platform.assert_migration_checksum(
  'app',
  '00000000-0000-4000-8000-00000000da01'::uuid,
  '20260725010658_app_data_agent_agent_team_authority',
  '__AGENT_TEAM_MIGRATION_CHECKSUM__'
);

commit;
