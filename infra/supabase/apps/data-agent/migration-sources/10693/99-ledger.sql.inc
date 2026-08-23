select platform.assert_migration_checksum(
  'app','00000000-0000-4000-8000-00000000da01'::uuid,
  '20260725010693_app_data_agent_semantic_graph_studio_digest_repair',
  '__SEMANTIC_GRAPH_STUDIO_DIGEST_REPAIR_MIGRATION_CHECKSUM__'
);
commit;
