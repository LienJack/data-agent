select platform.assert_migration_checksum(
  'app','00000000-0000-4000-8000-00000000da01'::uuid,
  '20260725010670_app_data_agent_atomic_team_acceptance','__U20_TEAM_ACCEPTANCE_MIGRATION_CHECKSUM__');
commit;
