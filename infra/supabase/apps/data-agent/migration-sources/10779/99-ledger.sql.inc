select platform.assert_migration_checksum(
  'app','00000000-0000-4000-8000-00000000da01'::uuid,
  '20260725010779_app_data_agent_falcon24_e1_gate_attempt_authority',
  '__FALCON24_E1_GATE_ATTEMPT_MIGRATION_CHECKSUM__');
commit;
