# CLAUDE.md: building ROCAN

ROCAN is an anonymous reporting system for crimes against nature in Aruba. Citizens submit a photo and a map location, and the system turns each one into an incident report for DNM, ACF and DOW. A monthly master report goes to OM Aruba.

## Read first
1. `docs/SPEC.md`: the full specification. Section numbers (§) are stable; cite them in code comments where logic implements a rule (e.g. `// SPEC §12.3 reminder schedule`).
2. `docs/MOCK_TESTING.md`: the mock environment, scenarios and test layers. Build the mock pieces first. They are how every phase is proven.
3. `db/schema.sql`: the reference data model. Drizzle migrations must produce an equivalent schema.
4. `config/agencies.yaml`, `config/categories.yaml`, `fixtures/aruba-places.yaml`: seed data and routing rules.

## How to work
- Build in the phase order of SPEC §15. Work on one phase at a time. A phase is done only when every acceptance checkbox is covered by an automated test that passes in CI. Tick the boxes in `docs/SPEC.md` as you complete them.
- Before starting a phase, write a short plan in `docs/progress/phase-N.md` (what you'll build, files, tests). Update it at the end with what was done and any deviations.
- If the spec is ambiguous or wrong, don't silently improvise. Pick the conservative option (more privacy, more human review), note it in the phase progress file under "Decisions", and continue.
- Items in SPEC §16 are not yours to decide. Use the listed placeholders.

## Non-negotiables
- **Never store reporter IPs, user agents or device identifiers**, not in the DB, logs, error trackers or object-storage access logs. The privacy test suite (MOCK_TESTING §8.1) must stay green.
- **Never use `new Date()` / `Date.now()` in business logic.** Inject `Clock` from `packages/clock`.
- **Domain rules live in `packages/core` as pure functions** (state machine, routing, auto-dispatch decision, SLA, shortlist scoring). The DB and worker layers call them; they don't reimplement them.
- **State changes only through `transition()`** (SPEC §8), which writes `report_status_history` and `audit_log` in the same transaction.
- **Originals are immutable.** Hash on arrival, vault with Object Lock, never re-encode the original. Agencies and the AI only ever see derivatives.
- **Automation switches default to off** (SPEC §3.2). Flagged reports (faces, minors, plates, names, low quality, duplicates, classifier failure) never auto-dispatch.
- **Config over code**: agency names/emails, categories, routing rules, SLAs, thresholds and texts come from config/DB.
- **No real photos of people or children** in fixtures. Use placeholder images and mock-classifier directives.
- `MOCK_MODE=1` features (`/dev`, clock control, classifier directives, dev users) must be impossible to enable in production.
- No third-party scripts, fonts or trackers on public pages.

## Conventions
- TypeScript strict, ESM, Node 22, pnpm workspaces, Turborepo.
- Zod schemas in `packages/core/schemas` are shared by client, API and worker.
- Code, identifiers, comments and commit messages in English. User-facing strings only via next-intl message files (`pap`, `nl`, `en`, `es`). Never hard-code UI text.
- Times stored in UTC; displayed in `America/Aruba`.
- Small, focused commits with conventional prefixes (`feat(core): routing engine`, `test(scenarios): overdue-dow`).

## Commands
Available now (Phase 1):
```bash
pnpm dev:mock            # services + buckets + db reset/seed + web (:3000) + worker (:3001), MOCK_MODE=1
pnpm services:up         # docker compose services only (postgis, rustfs, mailpit)
pnpm storage:init        # create buckets; the vault gets Object Lock (compliance)
pnpm db:reset            # drop, migrate, seed (refuses NODE_ENV=production)
pnpm db:generate         # drizzle-kit: new migration after editing packages/db/src/schema.ts
pnpm lint && pnpm format:check && pnpm typecheck
pnpm test:unit
pnpm test:integration    # needs the docker services
pnpm test:e2e            # Playwright; set PLAYWRIGHT_CHROMIUM_PATH to reuse a preinstalled Chromium
pnpm build
```
Planned (add them in the phase that builds them, then move them above):
```bash
pnpm seed:demo           # Phase 4+: synthetic dataset through the real API
pnpm scenario <name>     # Phase 3+: one scenario from MOCK_TESTING §7
pnpm test:scenarios      # Phase 3+
pnpm eval:classifier     # Phase 4: real Claude API, manual only
```

## Repo gotchas (learned in Phase 1)
- Packages export TypeScript source (`exports: ./src/index.ts`); use **extensionless relative imports** (Turbopack does not map `./x.js` to `x.ts`).
- postgres.js: pass JSON as `${JSON.stringify(v)}::jsonb`, arrays as `${sql.array(v)}::type[]`, numerics as strings. `citext[]` comes back as a raw string unless cast to `text[]`.
- After `dropAll()` + migrate, open a new connection: enum types are recreated and cached plans go stale.
- Every schema change: edit `packages/db/src/schema.ts` **and** `db/schema.sql`, run `pnpm db:generate`; the schema-equivalence test fails until both match.
- `next build` always runs with `NODE_ENV=production` (set in the web build script).

## Claude API usage (classifier)
- Package `@anthropic-ai/sdk`, model from `CLASSIFIER_MODEL` (default `claude-opus-5-5`), adaptive thinking with `output_config.effort` from `CLASSIFIER_EFFORT` (default `low`).
- Structured output with `client.messages.parse` + `zodOutputFormat(ClassificationSchema)`. Always check `stop_reason` (handle `refusal`) before reading `parsed_output`; `parsed_output` can be null.
- Enable server-side refusal fallbacks (`fallbacks: "default"`, beta `server-side-fallback-2026-07-01`) on the beta messages endpoint.
- Static system prompt (cacheable); per-report data in the user turn; the reporter's description is wrapped and labelled as untrusted data.
- No tools are given to the model.
