select platform.assert_migration_checksum(
  'app','00000000-0000-4000-8000-00000000da01'::uuid,
  '20260725010672_app_data_agent_team_runtime_repairs','__TEAM_RUNTIME_REPAIR_MIGRATION_CHECKSUM__');
commit;
