-- ============================================================
-- 10622: Repair 10610 optional publish arguments
-- ============================================================
-- The two functions declared nullable default arguments while also being STRICT,
-- which made omitted optional material short-circuit to SQL NULL. The optional
-- fields remain nullable, but required projection/compiler material stays strict
-- at the TypeScript contract and inside each function's state checks.

alter function semantic.prepare_publish_attempt(
  uuid,
  uuid,
  text,
  text,
  uuid,
  uuid,
  text,
  bigint,
  bigint,
  bigint,
  text,
  jsonb
) called on null input;

alter function semantic.commit_publish_attempt(
  uuid,
  uuid,
  text,
  text,
  uuid,
  uuid,
  text,
  uuid,
  text,
  uuid,
  text,
  jsonb,
  uuid
) called on null input;

-- Remove the inert 12-argument overload after the historical 10610 GRANT has
-- resolved. It never contains a mutation path and is absent from the final API.
drop function if exists semantic.commit_publish_attempt(
  uuid,
  uuid,
  text,
  text,
  uuid,
  uuid,
  text,
  uuid,
  text,
  uuid,
  text,
  uuid
);
