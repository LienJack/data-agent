select platform.assert_migration_checksum(
  'app',
  '00000000-0000-4000-8000-00000000da01'::uuid,
  '20260725010662_app_data_agent_semantic_induction',
  '__SEMANTIC_INDUCTION_MIGRATION_CHECKSUM__'
);

commit;
