select platform.assert_migration_checksum('app','00000000-0000-4000-8000-00000000da01'::uuid,
  '20260725010767_app_data_agent_accepted_sibling_output_attachment',
  '__AGENT_TEAM_ACCEPTED_SIBLING_OUTPUT_ATTACHMENT_MIGRATION_CHECKSUM__');
commit;
