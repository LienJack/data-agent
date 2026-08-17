# U7 Technical Design

## Authority Flow

```text
AppCapability + full ArtifactReference
              │
              ├─ exact committed source resolve (scope/run/principal/hash)
              │
              ├─ deterministic safe preview projection
              │
              └─ deterministic export bytes
                       │
                       ├─ canonical output hash
                       └─ 10657 append-only Export Receipt
                                  │
download receipt ─ exact source reload ─ rebuild bytes ─ hash compare ─ attachment
```

`ArtifactReference` is the only source identity. A preview projection is not persisted Authority. An Export Receipt is derived
Authority: it proves which exact source revision and deterministic exporter/policy produced which exact byte hash.

## Contract Model

`packages/contracts/src/artifacts/export-receipt.ts` defines strict preview projections, preview result, export command,
`ArtifactExportReceipt`, receipt reference/load result, and canonical compute/build/verify helpers. Only `TABLE` is exportable in U7;
other projections are previewable and linkable. The adapter recognizes committed L2 documents and explicit safe workspace documents;
it never treats arbitrary object keys as renderable HTML.

## Safe Rendering

The renderer converts Markdown into a token tree/text blocks, never HTML. Raw HTML is removed as text; URLs are accepted only for
`https:` and `mailto:`. SQL uses text children. Tables/charts use scalar values and escaped React text nodes. Chart projection is
declarative and limited to known mark/encoding fields; it does not accept callbacks, URLs or HTML labels.

Preview route headers are `no-store`, `nosniff` and default-deny CSP. The React component contains no
`dangerouslySetInnerHTML`.

## Deterministic Export

CSV uses RFC4180 quoting, UTF-8 and fixed CRLF. Formula neutralization prefixes a literal apostrophe after detecting leading
whitespace/control characters followed by `=`, `+`, `-` or `@`; the receipt records the exact policy version.

XLSX is a deterministic minimal OOXML ZIP containing fixed workbook, worksheet, styles, relationships and content-type entries. ZIP
metadata/ordering/permissions are fixed. Strings use inline string cells with XML escaping; finite numbers/booleans use typed cells;
null is blank. The same normalized matrix feeds CSV and XLSX.

## PostgreSQL 10657

`artifact_export_receipts` stores immutable receipt JSON/hash and exact source/output identity. A composite FK points to the committed
source row in `app_data_agent.artifacts`.

`create_artifact_export_receipt(command, receipt)` resolves transaction-local backend Authority, validates strict shape/scope/hash,
checks idempotency before insert and returns exact replay. `load_artifact_export_receipt(command)` requires exact receipt/source/output
identity. The table uses FORCE RLS, a NOLOGIN/NOBYPASSRLS owner, immutable guard and backend-only function grants; direct DML is revoked.

## Platform and Web Composition

Platform `PostgresArtifactWorkspaceStore` owns SQL RPC mapping and verifies every DB receipt before returning it. Web
`artifact-workspace-service` composes existing `createPostgresRepository.resolveArtifact`, strict document adapters, deterministic
renderer/exporter and the new store.

- `GET /artifacts/:artifactId` accepts the remaining full ref fields in a strict encoded query and returns preview JSON.
- `POST /artifacts/:artifactId/exports` creates/replays a receipt and returns metadata plus download URL.
- `GET /artifacts/:artifactId/exports` loads exact receipt, rebuilds/verifies bytes, then returns attachment.

Both routes compare the path id to `source_ref.artifact_id` before database access. Unknown artifact schemas fail closed. A renderer or
exporter version change produces a different request hash/receipt; no dual read or backfill is introduced.
