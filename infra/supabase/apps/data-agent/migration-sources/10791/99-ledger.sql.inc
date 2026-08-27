select platform.assert_migration_checksum(
  'app','00000000-0000-4000-8000-00000000da01'::uuid,
  '20260725010791_app_data_agent_falcon24_semantic_closure_readback',
  '__FALCON24_SEMANTIC_CLOSURE_READBACK_MIGRATION_CHECKSUM__');
commit;
