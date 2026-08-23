# Data provenance and use notice

## Benchmark materials

AgenticDataBench's repository and Hugging Face dataset card declare Apache-2.0.
The exact repository `LICENSE` is preserved as
`UPSTREAM_AGENTICDATABENCH_LICENSE.txt`. The public case definitions and Gold
artifacts in this bundle are copied from the fixed benchmark commit identified in
`source-manifest.json`.

## Underlying datasets

AgenticDataBench aggregates third-party datasets. Its Apache-2.0 declaration must
not be interpreted as a new license grant from every original data publisher.
The materialized sources in this Demo are attributed as follows:

- Olist Brazilian E-Commerce public dataset: anonymized marketplace data
  published through Kaggle by Olist. The nine CSV files are redistributed here
  exactly as present in the fixed AgenticDataBench dataset revision.
- Amazon Review Data (2018), Cell Phones and Accessories: Jianmo Ni, Jiacheng Li,
  and Julian McAuley. This Demo includes only the first 10,000 physical records of
  the reviews and metadata files, as required by the compatible benchmark cases.
- eBay PC Laptops and Netbooks: the CSV distributed by AgenticDataBench. A reliable
  original publisher/license record was not present in the audited benchmark
  materials; its provenance therefore remains explicitly `UNVERIFIED`.

This repository uses the data as a fixed evaluation/demo fixture. Before external
commercial redistribution or production use, the deployer must independently
review the current terms of the original Olist, Amazon Review Data, and eBay data
publishers. Do not treat this notice as legal advice or as a production data-use
approval.

## Privacy and safety

The bundle contains public benchmark fixtures, not application customer data. It
must remain isolated in the two dedicated PostgreSQL schemas. No fixture record is
allowed to enter control-plane, billing, authentication, or user-memory tables.
