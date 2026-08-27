select platform.assert_migration_checksum(
  'app','00000000-0000-4000-8000-00000000da01'::uuid,
  '20260725010789_app_data_agent_semantic_context_canonical_aliases',
  '__SEMANTIC_CONTEXT_CANONICAL_ALIASES_MIGRATION_CHECKSUM__');
commit;
