# ROCAN: reporting crimes against nature in Aruba

Anonymous citizens upload a photo and a location on a map of Aruba. The system automatically classifies and routes each report to **Directie Natuur en Milieu (DNM)**, **Aruba Conservation Foundation (ACF)** and/or **Directie Openbare Werken (DOW)**, tracks whether they acknowledge it, and compiles a **monthly master report for OM Aruba**.

> **Status:** Phase 1 of 8 (foundation and mock environment) is built. See [`docs/progress/phase-1.md`](docs/progress/phase-1.md).

## Run it locally
Requires Node 22, pnpm 10 and Docker.

```bash
pnpm install
pnpm dev:mock      # starts Postgres+PostGIS, S3 storage, Mailpit; seeds the DB; runs web + worker
```
Then open http://localhost:3000 (web), http://localhost:3001/readyz (worker), http://localhost:8025 (Mailpit, all outgoing mail) and http://localhost:9001 (storage console).

Tests: `pnpm test:unit`, `pnpm test:integration` (needs the Docker services), `pnpm test:e2e`.

## What's here

| Path | What it is |
|---|---|
| [`docs/SPEC.md`](docs/SPEC.md) | Full system specification: architecture, data model, state machine, pipeline, routing, AI classification, report formats, security, and the 8-phase build plan with acceptance criteria. |
| [`docs/MOCK_TESTING.md`](docs/MOCK_TESTING.md) | The mock-up and testing system: run the whole flow locally with mock email, mock AI, mock agencies and a controllable clock; 18 end-to-end scenarios; test layers; worked scoring examples. |
| [`CLAUDE.md`](CLAUDE.md) | Working rules for Claude Code when building the system. |
| [`db/schema.sql`](db/schema.sql) | Reference PostgreSQL/PostGIS schema. |
| [`config/agencies.yaml`](config/agencies.yaml) | Receiving agencies (names, intake emails, SLA). |
| [`config/categories.yaml`](config/categories.yaml) | 13 categories in Papiamento, Dutch, English and Spanish, plus routing rules. |
| [`fixtures/aruba-places.yaml`](fixtures/aruba-places.yaml) | Named test locations across Aruba for synthetic data and routing tests. |

## Architecture at a glance
Next.js PWA (offline-capable) and staff portal · PostgreSQL + PostGIS · pg-boss worker · S3 storage with a write-once evidence vault · Claude vision for classification · React-PDF reports · email delivery with one-click acknowledgement links.

## Building it with Claude Code
Open this repository in Claude Code and ask, one phase at a time:

```
Build Phase 1 from docs/SPEC.md §15. Follow CLAUDE.md. Prove every acceptance criterion with tests.
```

Then Phase 2, 3, … 8. Each phase ends with passing CI and a progress note in `docs/progress/`.

## Before launch (not code)
See SPEC §16: who operates the system and acts as data controller; agreements with DNM, ACF, DOW and OM (including OM's preferred format); official GIS boundaries for protected areas; legal check of the laws per category; native-speaker review of the Papiamento text; and data-protection sign-off.
