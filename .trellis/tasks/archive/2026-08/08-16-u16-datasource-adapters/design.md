# U16 Technical Design

## Authority Flow

```text
Adapter Registry Contract
  -> Gallery field projection
  -> Workspace Datasource Revision + SecretRef/File capability
  -> Egress/File target verification
  -> dialect-specific parse/firewall/explain
  -> read-only bounded execution
  -> normalized result + Adapter Certification Receipt
```

## Registry

`DatasourceAdapterDescriptor` is framework-neutral and immutable. It carries the exact field schema and three capability states, but
never connection values. `DatasourceAdapterCertificationReport` binds implementation and fixture hashes. The Registry returns all five
mandatory descriptors in canonical ID order and derives platform readiness only when every descriptor is `GOVERNED_QUERY + READY`.

## Adapter Boundary

All implementations conform to one `GovernedDatasourceAdapter` port with `scanSchema`, `explain`, and `execute`. The port accepts an
already-authorized target plus a dialect-bound request/permit and returns strict normalized columns/rows/receipt. Network connection and
file opening are injected so denial tests prove zero I/O. Parser implementations are not shared across dialects.

PostgreSQL retains `pgsql-parser`; MySQL and SQLite use distinct `node-sql-parser` dialect modes; DuckDB uses native statement
extraction and disables external access; ClickHouse uses single-statement scanning plus `EXPLAIN SYNTAX` and readonly settings. Parser
success never replaces datasource-side read-only enforcement.

## Web

The Gallery consumes the same descriptor list exported by Contracts. Field components switch on descriptor field kind and preserve
server validation. Capability badges distinguish connection, schema scan, and governed query. BLOCKED adapters remain inspectable but
cannot be selected for a new production Run.

## Rollback

Disable an Adapter certification Head or omit its runtime factory. Existing Datasource revisions remain readable; new Runs cannot bind
the unavailable Adapter. Never rewrite the datasource type or substitute another dialect parser.
