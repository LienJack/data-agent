# AgenticDataBench E-commerce PostgreSQL Demo v1

This directory is the immutable, offline seed bundle for the interview Demo.

- Upstream benchmark commit: `61bb0d6be3439797d2c75a6ede198b0b296cc226`
- Upstream dataset revision: `3b0ac3fde63fd615de92bf70c1dd93b73f92d92f`
- Scope: all nine Olist CSV files, the full eBay CSV, and the first 10,000
  physical JSONL records from each Amazon file.
- Standard startup must only read `seed/`; it must never download data.
- `source-manifest.json` records source identity and the bounded-slice policy.
- `bundle-manifest.json` records the bytes that are committed to this repository.
- `public/` is safe to expose in Test Center APIs. `sealed/` is server-side Oracle
  material and must never be serialized through public routes.

Verify the bundle before import:

```bash
pnpm exec tsx scripts/verify-agenticdatabench-ecommerce-bundle.ts
```

Maintainers can rebuild the compressed chunks from an already-audited source
directory. Network download is intentionally outside the normal application path:

```bash
pnpm exec tsx scripts/build-agenticdatabench-ecommerce-bundle.ts \
  --source-dir /absolute/path/to/audited/ecommerce/files \
  --output-dir infra/agenticdatabench/ecommerce-v1
```

The source directory must contain the ten original CSV files plus the two fixed
Amazon slice files named `amazon_reviews_10000.jsonl` and
`amazon_metadata_10000.jsonl`. The builder rejects any byte or row-count drift.

During PostgreSQL import, JSON `\\u0000` escapes are deterministically removed
because PostgreSQL `text` cannot represent NUL. The committed source chunks and
their hashes remain unchanged, so this database normalization is auditable.
