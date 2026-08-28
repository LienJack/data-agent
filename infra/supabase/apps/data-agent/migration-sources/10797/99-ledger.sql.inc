select platform.assert_migration_checksum(
  'app','00000000-0000-4000-8000-00000000da01'::uuid,
  '20260725010797_app_data_agent_falcon24_successor_activation_closure',
  '__FALCON24_SUCCESSOR_ACTIVATION_CLOSURE_MIGRATION_CHECKSUM__');

commit;
