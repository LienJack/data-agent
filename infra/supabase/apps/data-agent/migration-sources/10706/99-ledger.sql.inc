select platform.assert_migration_checksum('app','00000000-0000-4000-8000-00000000da01'::uuid,
  '20260725010706_app_data_agent_semantic_binding_impact','__SEMANTIC_BINDING_IMPACT_MIGRATION_CHECKSUM__');
commit;
