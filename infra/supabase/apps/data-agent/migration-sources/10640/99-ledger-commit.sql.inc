select platform.assert_migration_checksum(
  'app',
  '00000000-0000-4000-8000-00000000da01'::uuid,
  '20260725010640_app_data_agent_semantic_graph_studio',
  '__SEMANTIC_GRAPH_STUDIO_MIGRATION_CHECKSUM__'
);

commit;
