alter table app_data_agent.agent_product_profile_revisions
  drop constraint agent_product_profile_revisions_profile_id_check;
alter table app_data_agent.agent_product_profile_revisions
  add constraint agent_product_profile_revisions_profile_id_check check(profile_id in (
    'governed-analysis-agent','governed-text2sql-agent',
    'report-writing-agent','semantic-management-agent'
  ));
