# U13 Technical Design

## Authority flow

```text
U12 Resolved Context Package
  -> Grounding materializer (Published + Queryable + exact Mapping only)
  -> deterministic Logical Plan / AST / SQL compiler
  -> PostgreSQL relationship authority
       -> current Neo4j generation acceleration or explicit PG fallback
  -> SQL Firewall sealed decision
  -> PostgreSQL Sandbox Authority revalidation
  -> datasource execution + immutable Receipt
```

## Contract boundaries

`grounding-materializer.ts` and `text2sql-primitives.ts` own strict versioned Grounding, Logical Plan, Compiler Receipt and Firewall binding fields. Every derived hash includes exact U12 package, semantic release, schema snapshot and mapping closure refs. Structural parse is not Authority branding.

## Compiler and graph

The Semantic compiler lowers only Published queryable nodes with current physical mappings. Formula and relationship lowering produce deterministic AST nodes with stable ordering. PostgreSQL remains relationship truth; Neo4j results must carry the current generation/checkpoint and are discarded on mismatch. Fallback is observable evidence, not a silent behavior change.

## Firewall and execution

The existing PostgreSQL AST policy remains the only SQL shape gate. U13 threads exact compiler/context bindings through the Sandbox Authority and prevents a caller from substituting SQL after authorization. Rejection returns a stable reason and no datasource callback is invoked. Execution budgets remain technical limits only.

## Compatibility and rollback

New schemas are versioned additions; historical compiler artifacts remain readable but cannot authorize current execution. Rollback revokes the new execution binding while leaving U12 Context receipts and existing sandbox authorities intact. No destructive data migration is required unless fresh PG inspection shows a missing persistent receipt surface.

## Verification

Tests cover deterministic lowering, cross-snapshot substitution, projection generation fallback, SQL AST deny matrix, zero-I/O rejection, receipt replay and full binding closure. Falcon and real Provider paths remain excluded.
