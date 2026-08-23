select platform.assert_migration_checksum(
  'app','00000000-0000-4000-8000-00000000da01'::uuid,
  '20260725010671_app_data_agent_public_agent_events','__PUBLIC_AGENT_EVENT_MIGRATION_CHECKSUM__');
commit;
