import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  new URL(
    "../infra/supabase/apps/data-agent/migrations/20260725010816_app_data_agent_semantic_conversation_intent.sql",
    import.meta.url,
  ),
  "utf8",
);

describe("semantic conversation intent forward migration", () => {
  it("keeps current request identity and uses the existing exact task reader", () => {
    expect(migration).toContain("app_data_agent.assert_semantic_context_request(jsonb)");
    expect(migration).toContain(
      "app_data_agent.load_provider_task_artifact(pg_catalog.jsonb_build_object(",
    );
    expect(migration).toContain(
      "'run_id',config_record.run_id,'reference',requested#>'{basis,provider_task_ref}'",
    );
    expect(migration).toContain("'principal_id',authority.principal_id");
    expect(migration).toContain(
      "task_document#>>'{current_message,content}' is distinct from run_question",
    );
    expect(migration).toContain("defaults_json#>>'{conversation_binding,resource_version}'");
    expect(migration).toContain(
      "snapshot_document:=snapshot_document||pg_catalog.jsonb_build_object('conversation_intent',conversation_intent)",
    );
    expect(migration).not.toMatch(/run_question\s*:=/);
    expect(migration).toContain(
      "{package,retrieval_receipt,intent_context_hash}' is distinct from",
    );
    expect(migration).toContain(
      "{package,retrieval_receipt,retrieval_query_hash}' is distinct from",
    );
  });
  it("projects only bounded prior user text and does not mutate authority or expand table grants", () => {
    expect(migration).toContain(
      "message.document->>'role'='user' and message.document->>'type'='text'",
    );
    expect(migration).toContain(
      "message.document->>'message_id'<>task_document#>>'{current_message,message_id}'",
    );
    expect(migration).toContain("order by message.ordinality desc limit 8");
    expect(migration).toContain("order by question.ordinality");
    expect(migration).not.toMatch(/grant\s+(?:select|insert|update|delete|all)\b/i);
    expect(migration).not.toMatch(
      /(?:insert into|update|delete from)\s+(?:app_data_agent|semantic)\./i,
    );
    expect(migration).not.toMatch(/create (?:or replace )?function/i);
    expect(migration).not.toContain("订单收入");
  });
});
