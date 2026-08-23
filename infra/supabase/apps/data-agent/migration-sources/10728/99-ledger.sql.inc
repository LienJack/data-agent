select platform.assert_migration_checksum('app','00000000-0000-4000-8000-00000000da01'::uuid,
  '20260725010728_app_data_agent_semantic_retrieval_hash_phase',
  '__SEMANTIC_RETRIEVAL_HASH_PHASE_MIGRATION_CHECKSUM__');
commit;
