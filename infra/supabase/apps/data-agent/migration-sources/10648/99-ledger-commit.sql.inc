select platform.assert_migration_checksum(
  'app',
  '00000000-0000-4000-8000-00000000da01'::uuid,
  '20260725010648_app_data_agent_qa_resource_binding',
  '__QA_RESOURCE_BINDING_MIGRATION_CHECKSUM__'
);

commit;
