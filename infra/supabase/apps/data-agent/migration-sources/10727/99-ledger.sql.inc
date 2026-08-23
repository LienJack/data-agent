select platform.assert_migration_checksum('app','00000000-0000-4000-8000-00000000da01'::uuid,
  '20260725010727_app_data_agent_semantic_context_validation_phase_projection',
  '__SEMANTIC_CONTEXT_VALIDATION_PHASE_MIGRATION_CHECKSUM__');
commit;
