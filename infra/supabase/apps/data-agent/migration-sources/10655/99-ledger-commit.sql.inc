select platform.assert_migration_checksum(
  'app',
  '00000000-0000-4000-8000-00000000da01'::uuid,
  '20260725010655_app_data_agent_ontology_package_authority',
  '__ONTOLOGY_PACKAGE_MIGRATION_CHECKSUM__'
);

commit;
