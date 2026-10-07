# ROCAN: System Specification

**Anonymous reporting of crimes against nature in Aruba, routed to the competent agencies, with a monthly master report to the Openbaar Ministerie.**

| | |
|---|---|
| Status | v1.0 build specification |
| Audience | Claude Code (builder), project owner, receiving agencies |
| Companion files | `CLAUDE.md`, `docs/MOCK_TESTING.md`, `db/schema.sql`, `config/*.yaml`, `fixtures/aruba-places.yaml` |
| Language of the code | English (identifiers, comments, commit messages) |
| Languages of the product | Papiamento (default), Nederlands, English, Español |

Section numbers (§) are stable and are referenced from code comments, tests and `CLAUDE.md`.

---

## Contents

1. Purpose and scope
2. Actors and roles
3. Design principles and the automation switches
4. Architecture
5. Citizen app (PWA)
6. Staff portal
7. Data model
8. Report lifecycle (state machine)
9. Processing pipeline
10. Categories and routing
11. AI classification
12. Outputs: incident PDF, daily digest, reminders, monthly OM report
13. Security, privacy and evidence integrity
14. Mock-up and testing system
15. Build plan (8 phases with acceptance criteria)
16. Decisions to settle outside the code

Appendix A: Configuration and environment variables. Appendix B: API surface. Appendix C: Glossary.

---

## 1. Purpose and scope

### 1.1 Problem
People in Aruba regularly witness illegal dumping, destruction of mangroves, disturbance of turtle nests, reef damage, poaching and similar harm to nature. There is no single, low-threshold, anonymous channel to report these, and no consolidated view that shows the Openbaar Ministerie (OM) what is happening and whether agencies follow up.

### 1.2 Goal
1. Any citizen or visitor can anonymously submit a photo plus a location on a map of Aruba, from their phone, even without mobile signal.
2. The system automatically turns each submission into a standardized incident report and delivers it to the right agencies: **DNM** (Directie Natuur en Milieu), **ACF** (Aruba Conservation Foundation) and/or **DOW** (Directie Openbare Werken).
3. Agencies acknowledge and update each incident. If they don't acknowledge within 7 days, the incident is flagged as overdue.
4. Every month the system compiles a master report for **OM Aruba**: statistics, hotspots, agency response performance, and an automatic shortlist of cases that may merit prosecution.

### 1.3 In scope (v1)
- Citizen PWA (submit, track by code, add info anonymously).
- Processing pipeline: evidence vault, EXIF stripping, geo-enrichment, AI classification, duplicate detection, routing.
- Staff portal: moderation, agency inbox, OM view, admin, audit.
- Outputs: incident PDF + email, daily agency digest, reminder emails, monthly OM report (PDF + case annex).
- Full mock-up and testing system (§14) that runs the whole flow locally without any real agency, email or AI account.

### 1.4 Out of scope (v1)
- Emergency response. The app shows a "call 911" banner and is not a replacement for it.
- Reporter accounts or any identification of reporters.
- Native iOS/Android apps (the PWA covers this; can be wrapped later).
- Direct integration with agency case-management systems (email + portal only; an API for agencies is a v2 item).
- Enforcement actions, fines or legal advice.

---

## 2. Actors and roles

| Actor | Authenticated? | What they do |
|---|---|---|
| **Reporter** | No | Submits reports, gets a tracking code + secret, can check status and answer moderator questions. |
| **Moderator** | Yes, with TOTP | Reviews AI output, fixes category, applies redactions, approves/rejects/merges, answers reporters. Operated by the controlling entity (§16). |
| **Agency user** (DNM / ACF / DOW) | Yes, or via signed one-click link | Sees reports routed to their agency, acknowledges, updates status, closes with outcome. Only sees their own agency's dispatches. |
| **OM user** | Yes | Reads monthly reports and the shortlisted case files. Read-only. |
| **Admin** | Yes, with TOTP | Manages users, categories, routing rules, protected areas, settings and automation switches. |
| **Auditor** | Yes | Read-only access to audit log, vault access log and settings history. |
| **System** | n/a | Background worker acting as `actor_type = 'system'`. |

Roles are enforced server-side on every query (row-level filters in the data-access layer, not just hidden UI).

---

## 3. Design principles and the automation switches

### 3.1 Principles
1. **Anonymity by construction.** The server never stores IP addresses, user agents, device identifiers or accounts for reporters (§13.1). Anonymity comes from the architecture, not from a promise.
2. **Evidence that holds up.** Originals are hashed on arrival and locked in an encrypted, write-once vault. Agencies get redacted working copies. The chain of custody is logged (§13.3).
3. **Human in the loop at launch, automation by switch.** Everything can run fully automatically, but the default sends each report through a moderator and the OM report through an approver (§3.2).
4. **Works without signal.** Reports composed in Arikok or on the coast are queued on the device and sent when the connection returns (§5.4).
5. **Accountability loop.** Every dispatch has a 7-day acknowledgement SLA. Overdue items are flagged, reminded, and reported to the OM (§12.3).
6. **Config over code.** Agency names, emails, categories, routing rules, SLAs, thresholds and translations live in config/DB, not in code.
7. **Testable end-to-end without real services.** Every external dependency has a mock and the clock can be advanced (§14).

### 3.2 Automation switches
The brief asks for a fully automated system. The launch default inserts two human checkpoints, because unreviewed anonymous accusations sent straight to agencies and the OM could contain false reports, named individuals or photos of minors. Both checkpoints are switches in the `setting` table that an admin can turn off once real data shows the classifier is reliable (§11.6).

| Setting | Default | Effect when on |
|---|---|---|
| `automation.auto_dispatch_enabled` | `false` | Reports that meet **all** auto-dispatch conditions skip `pending_review` and go to `approved`. |
| `automation.auto_dispatch_min_confidence` | `0.90` | Minimum AI confidence for auto-dispatch. |
| `automation.auto_dispatch_categories` | `[]` (= all except `OTHER`) | Optional allow-list of categories that may auto-dispatch. |
| `automation.auto_om_delivery_enabled` | `false` | The monthly OM report is delivered without waiting for approval. |

**Auto-dispatch conditions** (all must hold, otherwise the report goes to `pending_review`):
- the switch is on;
- `ai_confidence >= auto_dispatch_min_confidence`;
- the category is not `OTHER` and is in the allow-list (if set);
- the report has no safety flags: `person_identifiable`, `possible_minor`, `license_plate`, `named_individual`, `not_environmental`, `low_quality`, `routing_fallback`;
- the report is not a possible duplicate;
- the description is empty or the PII scrubber made no changes (§9.4).

Turning a switch on or off writes an `audit_log` entry and needs a typed reason. The admin page shows the last 90 days of `classification_accuracy` next to the switch so the decision is made with data in view.

---

## 4. Architecture

### 4.1 Overview

```
 Citizen phone (PWA)                     Staff browser
 ┌─────────────────────┐                 ┌───────────────────────┐
 │ Next.js PWA         │                 │ Next.js staff portal  │
 │ Service worker      │                 │ (/staff, auth + TOTP) │
 │ IndexedDB outbox    │                 └──────────┬────────────┘
 └─────────┬───────────┘                            │
           │ HTTPS (no IP logging)                  │
           ▼                                        ▼
 ┌─────────────────────────────────────────────────────────────┐
 │ Next.js server (App Router, Route Handlers, Server Actions) │
 │  • public API: /api/v1/reports, /uploads, /track            │
 │  • staff API + pages                                        │
 │  • signed agency ack links (/a/:token)                      │
 └───────┬───────────────────────┬──────────────────────┬──────┘
         │ SQL                   │ enqueue (pg-boss)    │ presigned PUT
         ▼                       ▼                      ▼
 ┌──────────────────┐   ┌─────────────────────┐   ┌──────────────────────────┐
 │ PostgreSQL 16    │◀──│ Worker (Node, pg-boss)│─▶│ S3-compatible storage    │
 │ + PostGIS        │   │  media, geo, classify │  │  rocan-incoming (TTL 24h) │
 │ + pg-boss schema │   │  dedupe, route, pdf   │  │  rocan-vault (Object Lock)│
 └──────────────────┘   │  email, digest, cron  │  │  rocan-derivatives        │
                        └──┬──────────┬────────┘  │  rocan-reports (PDFs)     │
                           │          │           └──────────────────────────┘
                           ▼          ▼
                 Claude API       SMTP / email API
               (vision classify)  (agencies, OM)
```

### 4.2 Stack (pin exact versions in Phase 1)

| Concern | Choice | Notes |
|---|---|---|
| Language | TypeScript (strict) everywhere | Node 22 LTS |
| Monorepo | pnpm workspaces + Turborepo | |
| Web (PWA + staff) | Next.js (App Router), React, Tailwind CSS | One app, two route groups: `(public)` and `staff` |
| Map | MapLibre GL JS | OSM-based tiles. Offline: pre-cached low-zoom vector tiles of Aruba (≈10–20 MB) in the service worker |
| i18n | next-intl | `pap` (default), `nl`, `en`, `es` |
| Offline | Workbox service worker + IndexedDB (Dexie) outbox | Background Sync where supported, foreground retry otherwise |
| DB | PostgreSQL 16 + PostGIS 3 | |
| ORM / migrations | Drizzle ORM + drizzle-kit | Custom `geometry` column types; raw SQL for PostGIS functions |
| Jobs | pg-boss | Same Postgres; cron schedules for digest/overdue/monthly |
| Object storage | S3-compatible (AWS S3 in production; RustFS locally and in CI) | Vault bucket with Object Lock (compliance mode) + SSE-KMS |
| Images | sharp | EXIF strip, resize, thumbnails, pHash input |
| Face/plate detection (redaction suggestions) | Claude classification output boxes + manual redaction tool | No third-party face service; boxes are suggestions a moderator confirms |
| AI | Anthropic TypeScript SDK (`@anthropic-ai/sdk`), model `claude-opus-5-5` | Structured outputs via Zod (§11) |
| PDF | React-PDF (`@react-pdf/renderer`) | Deterministic layout, embeddable fonts, testable text output |
| Email | Nodemailer over SMTP (prod: provider SMTP; dev: Mailpit) | |
| Auth (staff) | Auth.js with email magic link + TOTP (otplib) for admin/moderator | Sessions in DB |
| Validation | Zod (shared between client, API, worker) | |
| Tests | Vitest (unit/integration), Playwright (e2e, mobile emulation), Testcontainers or Compose for DB | |
| Observability | pino logs (IP-free), OpenTelemetry traces, `/healthz`, `/readyz` | |
| Deploy | Docker images (web, worker), Compose for single host; any container platform later | |

### 4.3 Repository layout

```
rocan/
├─ apps/
│  ├─ web/                 # Next.js: citizen PWA + staff portal + API routes
│  │  ├─ app/(public)/     # /, /report, /track, /about, /privacy
│  │  ├─ app/staff/        # /staff/... (auth required)
│  │  ├─ app/a/[token]/    # signed agency acknowledgement pages
│  │  ├─ app/api/v1/       # public + staff JSON APIs
│  │  ├─ app/dev/          # mock control panel (only when MOCK_MODE=1)
│  │  ├─ messages/         # pap.json, nl.json, en.json, es.json
│  │  └─ public/sw.js      # generated by Workbox
│  └─ worker/              # pg-boss worker: jobs/*.ts, schedules.ts
├─ packages/
│  ├─ core/                # domain: state machine, routing engine, scoring, Zod schemas
│  ├─ db/                  # Drizzle schema, migrations, seed (reads config/*.yaml)
│  ├─ geo/                 # enrichment, Aruba bounds, area lookup
│  ├─ media/               # hashing, EXIF strip, derivatives, pHash, vault client
│  ├─ classifier/          # Claude client, prompt, schema, mock classifier
│  ├─ reports/             # React-PDF templates: incident, digest, monthly OM
│  ├─ mail/                # templates (mjml or React Email) + transport
│  ├─ clock/               # injectable clock (real | offset | frozen), see §14.4
│  └─ testing/             # factories, synthetic data generator, scenario runner
├─ config/                 # agencies.yaml, categories.yaml, areas/*.geojson
├─ fixtures/               # aruba-places.yaml, images/, classifier-eval/
├─ db/schema.sql           # reference schema (source of truth for Phase 1)
├─ docs/                   # SPEC.md, MOCK_TESTING.md, runbooks
├─ docker-compose.yml      # postgres+postgis, rustfs (S3), mailpit; web + worker run via pnpm
└─ CLAUDE.md
```

**Domain logic belongs in `packages/core`** as pure functions: state transitions, routing, the auto-dispatch decision, shortlist scoring, SLA maths. They take a clock and plain data, so they can be unit-tested exhaustively without DB or network.

---

## 5. Citizen app (PWA)

### 5.1 Screens

| Route | Purpose |
|---|---|
| `/` | Short explanation, big "Report harm to nature" button, emergency banner ("Danger to people or active fire? Call 911"), language picker, link to `/track`. |
| `/report` | 4-step wizard (§5.2). |
| `/report/done` | Shows tracking code + secret **once**, with "copy" and "save as image" buttons and a note that we can't recover them. |
| `/track` | Enter code + secret: shows status timeline (citizen-safe wording), lets the reporter answer moderator questions, add a photo (≤ 2 extra), or withdraw the report. |
| `/about`, `/privacy` | What happens with a report, who receives it, what is and isn't stored. Plain language in all four languages. |

### 5.2 Report wizard
1. **Photo(s)**: 1–5 photos, camera or gallery. Client-side: HEIC→JPEG conversion where needed, downscale to max 3000 px long edge, keep the **original bytes** separately for upload (the server hashes and vaults what it receives). Show a reminder: "Avoid faces and license plates if you can. Don't put yourself at risk."
2. **Location**: map of Aruba centred on the device GPS fix (if permitted) with a draggable pin. Fallback: if a photo has EXIF GPS inside Aruba, offer "Use photo location". Pin must be within the Aruba polygon + 3 km sea buffer; otherwise the error is "This location is outside Aruba". Show accuracy circle. Satellite imagery is optional (licence-dependent).
3. **What did you see?**: category grid (13 icons with localized names and one-line descriptions from `config/categories.yaml`), "Not sure" option (maps to `OTHER`, the AI suggests a category). Optional: description (max 2000 chars, with a warning not to include names, phone numbers or plates), when it happened (now / earlier today / date-time), is it still going on (yes/no/unknown).
4. **Review & send**: summary, consent checkbox ("I report in good faith; photos may be used as evidence"), send.

Accessibility: WCAG 2.2 AA, large tap targets, works one-handed, readable in bright sunlight (high-contrast theme), works on a 4-year-old Android phone over 3G.

### 5.3 Submission protocol (online)
1. Client generates `idempotency_key` (UUIDv4) at wizard start.
2. `POST /api/v1/uploads` with `{count, mimes[], sizes[]}` returns presigned PUT URLs into `rocan-incoming/{uploadId}/{n}` (max 15 MB each, 24 h lifecycle). Upload goes direct to storage.
3. `POST /api/v1/reports` with `{idempotency_key, upload_id, client_created_at, location, accuracy, location_source, category_code?, description?, observed_at?, is_ongoing?, ui_language, offline: bool}`.
4. Server validates (Zod + Aruba bounds + object existence + magic-byte check), creates `report` in `submitted`, returns `{public_code, follow_up_secret}`. Re-posting the same `idempotency_key` returns the same code (secret is **not** re-sent; client keeps it locally until the user has seen it).
5. Server enqueues `report.ingest`.

### 5.4 Offline mode
- The app shell, translations, category data and Aruba basemap (zoom 9–15) are precached on first visit. "Install app" prompt after the first successful report.
- Without network the wizard still works: GPS works offline; the map uses cached tiles; photos and the report payload go into an IndexedDB **outbox** (encrypted at rest with a per-device key from WebCrypto, so a lost phone doesn't expose queued reports in plain form).
- The outbox flushes via Background Sync (Android/Chrome) or on next app open/visibility change (iOS). Each item retries with exponential backoff and keeps its `idempotency_key`, so duplicates can't be created.
- After a successful flush the app shows a local notification/toast with the tracking code. Until then `/report/done` shows "Queued, will send when you have signal" plus the pre-generated idempotency reference.
- Server stores `client_created_at` and `submitted_offline = true`; the incident PDF shows both "observed/composed at" and "received at".
- Queue limit: 10 reports or 150 MB; older unsent items are never silently dropped. The user is asked.

### 5.5 Abuse protection without identifying people
- Per-connection rate limiting in the web process: key = HMAC-SHA256(IP, in-memory salt rotated every 24 h, never written to disk). Limits: 10 reports/hour, 30/day per key; uploads 60/hour. Counters live only in memory (or in Redis with TTL ≤ 24 h if horizontally scaled; still never the raw IP).
- Proof-of-work challenge (e.g. ALTCHA, self-hosted, no third-party tracking) on `POST /reports` when the global rate exceeds a threshold.
- Content checks in the pipeline: not-an-image, duplicate image hash, not environmental (AI flag), outside Aruba.
- Reverse proxy and app are configured to **not log client IPs** (§13.1). A test asserts this (§14).

---

## 6. Staff portal

All routes under `/staff`, server-rendered, role-checked.

| Page | Roles | Contents |
|---|---|---|
| Dashboard | all | Counts by status, today's queue, overdue dispatches per agency, map of last 30 days. Scoped by role/agency. |
| Moderation queue | moderator, admin | List of `pending_review`, oldest first, with flags as badges. |
| Report detail | moderator, admin; agency (own) | Photos (derivatives), map with protected-area overlays, AI output + confidence + rationale, suggested redaction boxes, duplicate candidates side by side, routing preview with the reason for each rule, status history, messages with reporter. |
| Moderation actions | moderator, admin | Set category, severity (1–5), confirm/add redactions, edit `description_redacted`, approve, reject (reason from list + text), merge into another report, ask reporter a question (`needs info` badge, stays in `pending_review`). |
| Agency inbox | agency_user | Dispatches for own agency: new / acknowledged / in progress / overdue / closed. Actions: acknowledge, set in progress, add agency reference, close (resolved / no action, outcome note required), decline (wrong agency, reason required, triggers re-routing review). |
| Monthly reports | admin, om_user (delivered only), moderator (read) | Draft preview, shortlist review (include/exclude + note), approve and deliver, history of versions. |
| Map explorer | all (scoped) | Filters by category/date/status/agency; heatmap; export CSV (no reporter data exists to leak; derivative image links expire). |
| Admin | admin | Users, agencies, categories, routing rules (with a "test this rule" tool: pick a point and category and see the routing result), protected areas (GeoJSON upload with preview), settings & automation switches, email templates, retention jobs. |
| Audit | auditor, admin | Audit log with hash-chain verification button, vault access log, settings history. |

**Evidence access:** viewing an original from the vault requires a typed purpose, writes `vault_access_log` + `audit_log`, and serves the file via a 5-minute presigned URL with `Content-Disposition: attachment`.

**Agency one-click links:** every incident email has a signed link `/a/{token}` (HMAC, single dispatch, 30-day expiry) that opens a minimal page to acknowledge and optionally type a name and agency reference. No login required for acknowledgement; status updates beyond that require login. This gets agencies acknowledging from day one even before every staff member has an account.

---

## 7. Data model

The authoritative schema is `db/schema.sql`. Summary:

| Table | Purpose |
|---|---|
| `agency` | DNM, ACF, DOW, OM, with intake emails, SLA, flags. Seeded from `config/agencies.yaml`. |
| `category` | 13 categories, multilingual names/descriptions, severity weight, legal refs. Seeded from `config/categories.yaml`. |
| `district`, `protected_area`, `coastline` | Geo reference layers (PostGIS). Protected areas are **placeholders** until official GIS arrives (§16). |
| `routing_rule` | Data-driven routing (§10.2). |
| `report` | One citizen submission. No reporter identity fields exist. |
| `report_status_history` | Every state transition with actor. |
| `report_message` | Anonymous two-way messages via the follow-up secret. |
| `media` | Per photo: vault key + SHA-256 of original, derivative key, redactions, non-identifying EXIF (capture time, GPS), pHash. |
| `vault_access_log` | Every original read. |
| `classification` | Every AI (or mock) call with full structured output, tokens, latency. |
| `dispatch`, `dispatch_event` | One row per (report, agency): PDF hash, email id, SLA due date, ack, overdue, outcome. |
| `digest` | One per agency per day. |
| `monthly_report`, `monthly_report_case` | Versioned OM reports and the scored shortlist. |
| `staff_user` | Staff accounts, roles, agency scope, TOTP. |
| `setting` | Automation switches and tunables (§3.2, Appendix A). |
| `outbound_email` | Every email sent, for delivery tracking and tests. |
| `audit_log` | Append-only, hash-chained log of all staff and system actions. |

**Public code format:** `RC-XXXX-XXXX` using Crockford base32 without ambiguous characters, random (not sequential), unique. **Follow-up secret:** 6 words from a 2048-word list (≈66 bits), shown once, stored as an argon2id hash.

---

## 8. Report lifecycle (state machine)

Implemented once in `packages/core/stateMachine.ts` as a pure transition table. Every transition goes through `transition(report, event, actor, clock)`, which validates and returns the new state plus side-effect intents (jobs to enqueue, history row, audit row). The DB layer applies them in one transaction.

```
                      ┌─────────────┐
   POST /reports ───▶ │  submitted  │
                      └──────┬──────┘
                             │ ingest started
                      ┌──────▼──────┐   auto-reject (outside Aruba, no valid image,
                      │ processing  │───────────────────────────────▶ rejected
                      └──────┬──────┘
           ┌─────────────────┼─────────────────────────┐
           │ default         │ auto-dispatch            │ duplicate (confident)
   ┌───────▼────────┐        │ conditions met (§3.2)    │
   │ pending_review │        │                          ▼
   └──┬───┬────┬────┘        │                     pending_review with
      │   │    │ merge       │                     flag possible_duplicate
      │   │    └──────────▶ merged                 (never auto-merged)
      │   │ reject ───────▶ rejected
      │ approve              │
   ┌──▼──────────────────────▼──┐
   │          approved          │
   └─────────────┬──────────────┘
                 │ all primary dispatches sent
          ┌──────▼──────┐
          │ dispatched  │──── (overdue is a FLAG on dispatch, not a state)
          └──────┬──────┘
                 │ any primary agency acknowledges
          ┌──────▼───────┐
          │ acknowledged │
          └──────┬───────┘
                 │ agency marks in progress
          ┌──────▼──────┐
          │ in_progress │
          └──┬───────┬──┘
     resolved│       │no_action
             ▼       ▼
        resolved   no_action ──┐
             │                 │ retention period ends
             └──────▶ archived ◀┘   (also from rejected / merged)
```

### 8.1 Transition table

| From | Event | To | Guard / side effects |
|---|---|---|---|
| — | `submit` | submitted | Enqueue `report.ingest`. |
| submitted | `ingest.start` | processing | |
| processing | `pipeline.reject` | rejected | Reason ∈ {outside_aruba, no_valid_image, malware, empty}. Reporter sees a neutral message. |
| processing | `pipeline.done` | pending_review | Default path. |
| processing | `pipeline.done` | approved | Only if `autoDispatchDecision()` = true (§3.2). `auto_approved = true`. |
| pending_review | `moderator.approve` | approved | Requires `final_category_id`, severity, redaction review confirmed for flagged media. |
| pending_review | `moderator.reject` | rejected | Requires reason. |
| pending_review | `moderator.merge` | merged | Requires target report not itself merged. Target gains the photos as extra evidence. |
| pending_review | `reporter.withdraw` | rejected | Reason `withdrawn`. Also allowed from submitted/processing. |
| approved | `dispatch.all_primary_sent` | dispatched | Enqueue nothing; dispatch jobs were enqueued on entering `approved`. |
| dispatched | `agency.ack` | acknowledged | First primary ack wins; cc acks are recorded on the dispatch only. |
| dispatched / acknowledged | `agency.in_progress` | in_progress | |
| acknowledged / in_progress | `agency.resolve` | resolved | Outcome note required. Report closes when **all primary** dispatches are closed; the report status takes the "strongest" outcome (resolved > no_action). |
| acknowledged / in_progress | `agency.no_action` | no_action | Reason required. |
| any dispatch | `agency.decline` | (report → pending_review) | Wrong agency: moderator re-routes; dispatch status `declined`. |
| rejected / merged / resolved / no_action | `retention.expire` | archived | Purge derivatives; vault originals per retention policy (§13.4). |

Invalid transitions throw a typed error and are covered by an exhaustive property test (every state × every event).

### 8.2 Citizen-facing status wording
`submitted/processing` = "Received", `pending_review` = "Being checked", `approved/dispatched` = "Sent to the responsible agency", `acknowledged/in_progress` = "The agency is handling it", `resolved` = "Closed: the agency took action", `no_action` = "Closed", `rejected` = "Not forwarded" (+ generic reason), `merged` = "Combined with an existing report". The citizen never sees which agency, agency notes or other reports.

---

## 9. Processing pipeline

pg-boss queues, one handler per file in `apps/worker/jobs/`. Every job is **idempotent** (keyed on report id + step) and retries with backoff (3 tries, then `failed` with alert). The pipeline is a chain: each job enqueues the next.

| # | Job | Does |
|---|---|---|
| 1 | `report.ingest` | `submitted → processing`; enqueue `media.process` per photo. |
| 2 | `media.process` | §9.2. When all photos for a report are done, enqueue `report.enrich`. |
| 3 | `report.enrich` | §9.3 geo-enrichment. |
| 4 | `report.classify` | §11. Runs after enrichment because the prompt includes location context. |
| 5 | `report.scrub` | §9.4 PII scrubbing of description. |
| 6 | `report.dedupe` | §9.5. |
| 7 | `report.route` | §10. Computes and stores *proposed* dispatches (status `queued`, not sent). |
| 8 | `report.gate` | Applies `autoDispatchDecision()` → `approved` or `pending_review`. |
| 9 | `dispatch.render` | On entering `approved`: render incident PDF per dispatch (§12.1), store, hash. |
| 10 | `dispatch.send` | Email with PDF + ack link; set `sent_at`, `due_at`. When all primary sent → `dispatched`. |
| cron | `sla.check` (hourly) | §12.3 reminders and overdue flags. |
| cron | `digest.send` (daily 07:00 AST) | §12.2. |
| cron | `monthly.generate` (1st of month 06:00 AST) | §12.4. |
| cron | `retention.sweep` (daily 03:00 AST) | §13.4. |
| cron | `incoming.cleanup` (hourly) | Remove orphaned uploads older than 24 h. |

### 9.2 Media processing
1. Read object from `rocan-incoming`. Verify magic bytes (JPEG/PNG/HEIC/WebP), size, decodability. Reject non-images.
2. Compute SHA-256 of the **exact received bytes** → `original_sha256`.
3. Copy unchanged bytes to `rocan-vault/{report_id}/{sha256}` with Object Lock retention (compliance mode) and SSE-KMS; store `vault_key`, `vault_version_id`. Delete from incoming.
4. Extract non-identifying EXIF: `DateTimeOriginal` (+ offset), GPS lat/lon. Discard everything else (make, model, serial numbers, software, owner name, thumbnails, maker notes, XMP, IPTC).
5. Produce the **derivative**: auto-orient, strip all metadata, re-encode JPEG q85, max 2400 px; `derivative_sha256`. Produce a 400 px thumbnail.
6. Compute 64-bit perceptual hash (dHash/pHash) and quality metrics (blur variance, darkness).
7. If EXIF GPS exists and is > 2 km from the pinned location, add flag `location_mismatch` (shown to moderator, not a rejection).

### 9.3 Geo-enrichment
With PostGIS on `report.location`:
- Outside Aruba land polygon buffered by 3 km → `pipeline.reject(outside_aruba)`. (Client also blocks this; the server is authoritative.)
- `district_id` = district containing the point (nearest district for points at sea).
- `protected_area_ids` = all areas whose polygon contains the point (buffer 25 m to tolerate GPS error).
- `is_marine` = point not within land polygon, or within 30 m of the coastline.
- `distance_to_coast_m`.
Geo layers come from `config/areas/*.geojson`, loaded by the seed. Until official polygons arrive they are hand-drawn placeholders with `is_placeholder = true`; the PDF then prints "Protected area membership based on provisional boundaries."

### 9.4 PII scrubbing of free text
Before any text leaves the system, `description_redacted` is produced: regex + AI-assisted removal of phone numbers, emails, license plates (Aruban formats, e.g. `A-12345`, `P-1234`, `T-123`, `V-1234`), ID numbers, and personal names (the classifier returns name spans, §11). Replaced with `[removed]`. If anything was removed, flag `named_individual` (when names were found) so a moderator checks. Original description stays in the DB for moderators only.

### 9.5 Duplicate detection
Candidate duplicates: other non-rejected reports within `dedupe.radius_m` (75 m) and `dedupe.window_hours` (72 h) of the same or related category, **or** any report with an identical `original_sha256` or pHash Hamming distance ≤ 6.
- Identical SHA-256 within 24 h from the same flow (offline resubmit edge case) → handled by idempotency, not here.
- Otherwise: set `cluster_id` (shared with candidates) and flag `possible_duplicate`. **Never auto-merge**: multiple independent reports of the same incident strengthen evidence, and the OM shortlist uses cluster size (§12.4.3).

---

## 10. Categories and routing

### 10.1 Categories
13 categories, defined in `config/categories.yaml` (names in 4 languages, citizen descriptions, severity weights, marine flag, legal references):

| # | Code | English name | Weight | Marine |
|---|---|---|---|---|
| 1 | `ILLEGAL_DUMPING` | Illegal dumping of waste | 0.55 | |
| 2 | `POLLUTION_SPILL` | Pollution (oil, chemicals, sewage) | 0.85 | |
| 3 | `ILLEGAL_BURNING` | Illegal burning | 0.60 | |
| 4 | `CONSTRUCTION_CLEARING` | Illegal construction or land clearing | 0.80 | |
| 5 | `SAND_STONE_EXTRACTION` | Illegal sand, stone or coral rubble extraction | 0.65 | |
| 6 | `OFF_ROAD_DAMAGE` | Off-road vehicle damage | 0.45 | |
| 7 | `MANGROVE_WETLAND` | Damage to mangroves or wetlands | 0.85 | ✓ |
| 8 | `CORAL_REEF_DAMAGE` | Coral or reef damage | 0.80 | ✓ |
| 9 | `ILLEGAL_FISHING` | Illegal fishing | 0.60 | ✓ |
| 10 | `SEA_TURTLE` | Sea turtle or nest disturbance | 0.95 | ✓ |
| 11 | `WILDLIFE_POACHING` | Wildlife poaching or capture | 0.80 | |
| 12 | `INVASIVE_SPECIES` | Release of invasive species | 0.50 | |
| 13 | `OTHER` | Other harm to nature | 0.40 | |

Legal references are seeded as `verified: false`. The incident PDF prints only verified references; until the legal check (§16) is done it prints "Applicable legislation to be determined by the receiving agency."

### 10.2 Routing engine
`packages/core/routing.ts`: `route(report, rules, areas) → { dispatches: [{agency, role, ruleIds}], explanation[] }`.

1. Evaluate every active rule; a rule matches when its category is `*` or equals `final_category_id ?? ai_category_id`, and all its `condition` keys hold (vocabulary in `config/categories.yaml` header).
2. Merge results per agency; `primary` beats `cc`; keep all contributing `ruleIds`.
3. Drop agencies with `receives_incidents = false` (OM).
4. If no primary remains → DNM primary + flag `routing_fallback`.
5. Return a human-readable explanation per agency (printed on the PDF and shown in the portal).

Seeded rules in summary:

| Situation | Primary | CC |
|---|---|---|
| Anything inside an ACF-managed park (Arikok, Parke Marino) | ACF | DNM (+ DOW for dumping) |
| Anything outside ACF parks | DNM | category-dependent |
| Dumping outside any protected area | DOW **and** DNM | |
| Pollution, burning, construction/clearing, sand/stone | (as above) | + DOW |
| Reef damage at sea outside a park; sea turtles anywhere outside a park | DNM | + ACF |

A moderator can override the routing per report (add/remove agency, change role) with a reason; the override is audited and shown on the PDF as "Routing adjusted by moderator".

The admin "test a rule" tool and a table-driven unit test file (`routing.test.ts`, one row per place in `fixtures/aruba-places.yaml` × relevant categories) keep routing behaviour explicit.

---

## 11. AI classification

### 11.1 Role of the AI
The model **suggests**; it does not decide. It proposes a category, severity, safety flags and redaction boxes, and drafts a neutral one-paragraph summary for the PDF. A moderator confirms at launch; auto-dispatch (§3.2) may later rely on it within strict guards.

### 11.2 Call
- SDK: `@anthropic-ai/sdk`, model `claude-opus-5-5` (configurable via `CLASSIFIER_MODEL`), adaptive thinking with `output_config.effort: "low"` (tune with the eval set in §11.6), structured output via `client.messages.parse` + `zodOutputFormat(ClassificationSchema)`.
- Refusal handling: check `stop_reason` before reading output; enable server-side fallbacks (`fallbacks: "default"` with beta `server-side-fallback-2026-07-01` on the beta messages endpoint). A refusal or parse failure leaves the report in `pending_review` with flag `classifier_failed`. Never auto-dispatch.
- Input: up to 5 **derivative** images (EXIF-stripped, base64 JPEG), the reporter's category choice, the raw description (in a delimited data block, explicitly marked as untrusted user text), enrichment context (district, protected areas, marine yes/no), the category list with descriptions. The system prompt is static and cache-friendly; per-report content goes in the user turn.
- Prompt injection: the description is data. The system prompt says so, the output is schema-constrained, and no tool use is enabled, so injected text can at most change suggestions that a human or the guarded auto-dispatch checks anyway.
- Timeouts: 60 s, 2 retries on 429/5xx (SDK default), then `classifier_failed`.
- Prompt lives in `packages/classifier/prompt.ts` with a `PROMPT_VERSION` constant; every stored classification records it.

### 11.3 Output schema (Zod, abbreviated)
```ts
const Classification = z.object({
  is_environmental_harm: z.boolean(),
  category_code: z.enum(CATEGORY_CODES),          // 13 codes
  alternative_codes: z.array(z.enum(CATEGORY_CODES)).max(2),
  confidence: z.number().min(0).max(1),
  severity: z.number().int().min(1).max(5),
  summary_en: z.string().max(600),                // neutral, factual, no speculation about identity
  summary_nl: z.string().max(600),                // Dutch for agencies/OM
  visible_evidence: z.array(z.string()).max(8),   // e.g. "approx. 3 m³ construction debris", "tyre tracks across dune"
  safety: z.object({
    person_identifiable: z.boolean(),
    possible_minor: z.boolean(),
    license_plate_visible: z.boolean(),
    redaction_boxes: z.array(z.object({
      media_ordinal: z.number().int(), type: z.enum(['face','plate','other']),
      box: z.tuple([z.number(), z.number(), z.number(), z.number()]), // normalized x,y,w,h
    })),
  }),
  description_pii_spans: z.array(z.object({ start: z.number().int(), end: z.number().int(), kind: z.enum(['name','phone','email','plate','id','address']) })),
  quality: z.enum(['good','usable','poor']),
  matches_reported_location: z.enum(['consistent','inconsistent','unknown']), // e.g. reef photo pinned inland
  notes_for_moderator: z.string().max(400),
});
```
Mapping to flags: `person_identifiable`, `possible_minor`, `license_plate`, `named_individual` (name spans), `low_quality` (poor), `not_environmental`, `location_mismatch` (inconsistent).

### 11.4 Redaction
If any face/plate/minor flag is set, the derivative given to agencies is blurred in the suggested boxes **only after a moderator confirms or edits the boxes** (launch mode). Under auto-dispatch, flagged reports never auto-dispatch (§3.2), so unconfirmed redactions never leave the system. Images of possible minors: the derivative sent to agencies has the minor blurred, always; originals stay in the vault.

### 11.5 Cost and volume
Assume ≤ 50 reports/day initially. One call per report with ≤ 5 images. Log `input_tokens`/`output_tokens` per call; admin dashboard shows monthly spend. A daily budget cap (`CLASSIFIER_DAILY_LIMIT`, default 300 calls) protects against floods; beyond it, reports wait in `pending_review` with flag `classifier_skipped`.

### 11.6 Measuring reliability (gate for the automation switch)
- `classification_accuracy` view (AI vs. moderator final category).
- Admin page shows, per category, over the last 90 days: n, agreement %, and agreement at confidence ≥ threshold, plus safety-flag recall (how often a moderator added a redaction the AI missed).
- Suggested policy before enabling auto-dispatch for a category: ≥ 200 moderated reports, ≥ 95% agreement at the chosen threshold, zero missed minor/face flags in the window.
- Offline eval set in `fixtures/classifier-eval/` (labelled images + expected outputs; synthetic and licensed images only) with `pnpm eval:classifier` producing a confusion matrix. Run before changing prompt or model.

---

## 12. Outputs

### 12.1 Incident report (PDF, one per dispatch)
A4 portrait, Dutch with English sub-labels (configurable), generated with React-PDF from a frozen JSON snapshot, stored in `rocan-reports/incidents/{report}/{agency}-v{n}.pdf`, SHA-256 stored on `dispatch`.

1. **Header**: ROCAN logo, title "Melding natuurdelict / Nature crime report", public code, agency name + role (Primary / Ter informatie), generated-at timestamp, page x/y.
2. **Summary box**: category (NL/EN), severity 1–5, AI summary (NL) as edited/approved, status, "Reviewed by moderator" or "Automatically forwarded" badge.
3. **When**: observed (reporter), composed on device, received by server, offline submission yes/no, EXIF capture time(s).
4. **Where**: static map image (rendered server-side from MapLibre/OSM, pin + protected-area outline), coordinates (decimal and DMS), accuracy, location source, district, protected areas (with provisional boundary note), marine yes/no, distance to coast, EXIF-vs-pin mismatch note if any, Google/OSM link.
5. **Evidence**: photo derivatives (redacted), each with ordinal, capture time, SHA-256 of the **original** (vault) and of the derivative shown, "Original preserved in evidence vault, available to authorized investigators on request."
6. **Reporter's description**: PII-scrubbed text, marked as an unverified statement of an anonymous reporter, original language + machine translation to Dutch, clearly labelled.
7. **Observed details**: `visible_evidence` bullets.
8. **Related reports**: cluster members (codes, dates, distance), count.
9. **Routing**: all agencies that received this incident and why (rule explanations).
10. **Legal context**: verified legal references only, or the placeholder sentence.
11. **Action requested**: "Please acknowledge within 7 days" + ack link and QR code + how to update status.
12. **Footer**: disclaimer (anonymous, unverified report; AI-assisted classification; for official use only), document hash.

### 12.2 Daily digest
Per agency, 07:00 Aruba time, only if there is something to say: new dispatches since last digest, open count, overdue list (oldest first, with days overdue), dispatches due within 48 h. HTML email + CSV attachment. One click per item to the ack page. Stored in `digest`.

### 12.3 SLA, reminders and overdue
- `due_at = sent_at + agency.ack_sla_days` (default 7 days).
- Reminder schedule (days after `sent_at`, setting `reminders.schedule_days`): day 3 (friendly), day 6 (due tomorrow), day 7 (**overdue**: set `overdue_since`, flag in portal, also notify the agency's escalation contact if configured), then day 10 and 14 (overdue reminders). No more reminders after 14 days; the item stays overdue until acknowledged.
- `overdue_since` is never cleared, so the monthly report can show "acknowledged late (n days)".
- Cc dispatches do not have SLAs (informational).
- `sla.check` is pure logic in `core/sla.ts` given (dispatch, now) → actions; unit-tested with a frozen clock.

### 12.4 Monthly master report for OM Aruba
Generated on the 1st at 06:00 AST for the previous calendar month (Aruba time). Snapshot data is frozen into `monthly_report.data`, so re-rendering always yields the same PDF. Re-generation creates a new `version`; earlier versions become `superseded`.

#### 12.4.1 Contents (Dutch, with an English summary page)
1. Cover: period, version, generated/approved timestamps, approver name, document hash.
2. Executive summary: totals (received, forwarded, rejected, merged), month-over-month and year-to-date, top 3 categories, top 3 hotspots, agency response headline.
3. Reports by category (table + bar chart) and by district.
4. Map: all forwarded reports of the month (category symbology) + heatmap; protected areas outlined.
5. Hotspots: clusters with ≥ 3 reports in 90 days (location, categories, trend).
6. Agency accountability: per agency — received, acknowledged within SLA, acknowledged late, still unacknowledged, overdue list with days, median time to ack, resolved/no action, declined.
7. **Shortlist of cases for possible prosecution** (§12.4.3): per case one page with summary, evidence thumbnails, location map, cluster info, agency status, score breakdown, reviewer note.
8. Methodology & caveats: anonymity, AI assistance, provisional boundaries, reports are unverified signals, not findings.
9. Annex (separate ZIP, `annex_zip_key`): per shortlisted case the incident PDF(s), redacted derivatives, a hash manifest (SHA-256 of each original in the vault), and a chain-of-custody extract (vault receipt time, accesses). Originals are released to the OM only via a separate, logged request (§13.3).

#### 12.4.2 Approval and delivery
- Default: status `pending_approval`; admin(s) get an email. The approver reviews the shortlist (include/exclude, notes), approves; system delivers by email (PDF + secure download link for the annex, 14-day expiry) and makes it visible to OM users in the portal. Status `delivered`, then `om_ack_at` when the OM clicks acknowledge.
- `automation.auto_om_delivery_enabled = true`: delivered immediately after generation with the auto-shortlist as-is; the cover says "Automatically generated and delivered."
- Format: the OM's preferred format is an open item (§16). PDF + CSV of all cases are produced regardless; the template is isolated in `packages/reports/monthly/` so it can change without touching data logic.

#### 12.4.3 Shortlist scoring (`core/shortlist.ts`)
Score 0–100 for each forwarded report of the month (and still-open reports from earlier months whose cluster grew):

| Factor | Points | Rule |
|---|---|---|
| Category severity | 0–25 | `25 × severity_weight` |
| Moderator/AI severity | 0–15 | `(severity − 1) / 4 × 15` |
| Protected area | 0–15 | 15 inside national/marine park or Ramsar site, 8 other protected area, 0 outside |
| Repetition | 0–15 | cluster size in last 90 days: 1→0, 2→5, 3–4→10, ≥5→15 |
| Evidence quality | 0–10 | ≥2 good photos with EXIF time consistent with observation = 10; one usable = 5; poor = 0 |
| Ongoing / recent | 0–5 | `is_ongoing` or observed within 48 h of submission |
| Agency non-response | 0–10 | primary overdue and unacknowledged = 10; acknowledged late = 5 |
| Agency outcome | −10–+5 | resolved with "referred to police/OM" outcome = +5; resolved as remedied = −10; no_action = 0 |

Shortlist = score ≥ `om.shortlist_threshold` (60), max `om.shortlist_max_cases` (15), ordered by score. Each case carries its full `score_breakdown` so the OM sees *why* it's listed. Weights are config and covered by unit tests with worked examples.

---

## 13. Security, privacy and evidence integrity

### 13.1 Reporter anonymity
- **No reporter IP stored anywhere**: reverse proxy (e.g. Caddy/nginx) access logs either disabled for public routes or with the client address field removed; app logger has a redaction list (`req.ip`, `x-forwarded-for`, `x-real-ip`, `user-agent`, `cf-connecting-ip`), and a test asserts that log output for a submission contains none of them (§14.6).
- No third-party scripts on public pages (no analytics, no external fonts, no CDN-hosted map styles that leak requests; tiles are self-hosted or proxied).
- Uploads go to storage via presigned URLs; storage access logging disabled for `rocan-incoming`.
- EXIF device data never stored (§9.2). EXIF GPS and capture time are kept as evidence because they describe the incident, not the reporter. The `/privacy` page states this plainly.
- Tracking secret is the only link between a person and a report, and it lives only on their device.
- Text guidance warns reporters not to identify themselves; the scrubber removes contact details anyway.

### 13.2 Staff security
- Magic-link login + mandatory TOTP for admin/moderator; sessions 12 h, re-auth for vault access and settings changes.
- Role and agency scoping enforced in the data-access layer; integration tests try cross-agency access and must get 404.
- CSRF protection on all mutations, strict CSP, HSTS, `Referrer-Policy: no-referrer`, `Permissions-Policy` limited to camera/geolocation on `/report`.
- Secrets via environment/secret manager; nothing in the repo.
- Dependency scanning and `pnpm audit` in CI.

### 13.3 Evidence and chain of custody
- SHA-256 computed on the exact bytes received; stored in DB and in the vault object key; printed on every PDF.
- Vault bucket: versioning + Object Lock in compliance mode (retention per §13.4), SSE-KMS with a dedicated key, no delete permission for the app role, separate read role used only by the vault service.
- Every read logged (`vault_access_log`, purpose required) and mirrored in the hash-chained `audit_log`.
- Release to OM/police: staff "evidence package" action produces a ZIP with originals, hash manifest, and custody log extract; logged; download link expires after 7 days.
- `audit_log` hash chain verified nightly; mismatch → alert.

### 13.4 Retention (defaults, to be confirmed by the controller in §16)
| Data | Retention |
|---|---|
| Rejected reports (not withdrawn) | 90 days, then archived: media and text purged, aggregate stats kept |
| Withdrawn reports | 30 days, then purged |
| Closed reports, derivatives | 5 years after closure |
| Vault originals | Object Lock 5 years; extended per case on legal hold request |
| Classification raw output | 2 years |
| Audit log | 10 years |
Retention runs as `retention.sweep` and writes an audit entry per purge.

### 13.5 Data protection
The controller (§16) must confirm the legal basis under Aruban data-protection law and document the processing (purpose, categories, recipients, retention). The system supports this with: minimisation by design, no reporter personal data, redaction of third parties, a processing register export (admin), and a DPIA template in `docs/` (to be written in Phase 8).

### 13.6 Hosting
Data residency is a controller decision (§16). The system runs on any container host. AI calls send redacted derivatives (not originals) and scrubbed text to the Claude API; this must be covered in the controller's processing documentation. The classifier can be switched to `mock` or disabled (`CLASSIFIER_PROVIDER=none`), in which case everything goes to human review.

---

## 14. Mock-up and testing system

Full detail in **`docs/MOCK_TESTING.md`**. Summary:

- **One command local stack** (`pnpm dev:mock`): Postgres+PostGIS, RustFS (S3-compatible storage), Mailpit (catches all outgoing email; each agency's inbox visible in a web UI), web, worker, all with `MOCK_MODE=1`.
- **Mock classifier** (`CLASSIFIER_PROVIDER=mock`): deterministic output derived from fixture metadata or filename conventions, configurable latency/failures/refusals, so the whole pipeline runs with no API key.
- **Controllable clock** (`packages/clock`): real, offset or frozen; the dev control panel and tests can jump forward to test the 7-day SLA, daily digests and the monthly OM report in seconds.
- **Synthetic data generator**: realistic reports across Aruba (`fixtures/aruba-places.yaml`), images with EXIF (incl. GPS and fake camera serials, to prove stripping), configurable volume and time span.
- **Scenario runner**: named end-to-end stories (turtle nest at Eagle Beach, DOW ignores a dumping report until overdue, offline burst from Arikok, photo with a child, injection attempt in description, month-end OM report…) each with assertions.
- **Mock agency actors**: scripted DNM/ACF/DOW behaviour (fast, slow, never acknowledges) driven by clicking the real ack links from Mailpit.
- **Dev control panel** (`/dev`): advance clock, run any cron job now, toggle automation switches, seed/reset data, open Mailpit, view the job queue.
- **Test layers**: unit (core logic, exhaustive state machine and routing tables), integration (DB + worker + object storage + Mailpit), e2e (Playwright on mobile viewports incl. offline), PDF content tests, security/privacy tests (no-IP-in-logs, EXIF-stripped, cross-agency access), accessibility (axe), classifier eval.

---

## 15. Build plan

Eight phases. Each ends with green CI and the listed acceptance criteria demonstrated by automated tests (and, where noted, by a scenario in the mock system). Do not start a phase before the previous one's criteria pass. Claude Code: see `CLAUDE.md` for working rules.

### Phase 1: Foundation and mock environment
Build: monorepo (§4.3), TypeScript strict, lint/format, Vitest, Playwright skeleton; `docker-compose.yml` with postgis, S3-compatible storage (buckets incl. Object Lock vault), mailpit; Drizzle schema + migrations matching `db/schema.sql`; seed from `config/*.yaml` + placeholder `config/areas/*.geojson` + districts; `packages/clock`; `packages/core` with the state machine (§8) and routing engine (§10.2); CI workflow (GitHub Actions) running lint, typecheck, unit, integration with services.
Acceptance:
- [x] `pnpm i && pnpm dev:mock` brings up all services; `/healthz` and `/readyz` return 200.
- [x] `pnpm db:reset` creates schema + seeds 4 agencies, 13 categories, routing rules, districts, placeholder areas.
- [x] State machine: property test covers every (state, event) pair; invalid pairs throw.
- [x] Routing: table-driven test for every place in `fixtures/aruba-places.yaml` × its `likely` categories matches expected agencies/roles (expected table committed).
- [x] Clock: frozen/offset modes proven by tests.
- [x] CI green on a clean checkout.

### Phase 2: Citizen PWA and submission API
Build: public pages (§5.1), wizard (§5.2), i18n in 4 languages, MapLibre map with Aruba bounds, presigned upload + report API (§5.3), tracking page, rate limiting (§5.5), privacy page.
Acceptance:
- [ ] Playwright (Pixel 7 + iPhone 14 viewports): complete a report in each language; receive code + secret; `/track` shows "Received".
- [ ] Pin outside Aruba (each `outside_points` fixture) is blocked client-side and rejected server-side (400).
- [ ] Re-POST with same `idempotency_key` returns the same `public_code`; DB has one row.
- [ ] 11th report within an hour from the same connection gets 429.
- [ ] axe: no serious/critical violations on all public pages.
- [ ] Lighthouse PWA installable; performance ≥ 80 on mobile emulation.

### Phase 3: Offline mode, media pipeline and evidence vault
Build: service worker + precache + Aruba tile pack; encrypted IndexedDB outbox with Background Sync / foreground flush; worker with `report.ingest`, `media.process` (§9.2); vault with Object Lock; derivative generation.
Acceptance:
- [ ] Playwright offline test: go offline, compose 3 reports, go online → 3 reports received exactly once each, `submitted_offline = true`, `client_created_at` preserved.
- [ ] Fixture image with EXIF make/model/serial/GPS: derivative has **no** EXIF/XMP/IPTC (verified with exiftool in test); DB keeps capture time + GPS only.
- [ ] Vault object SHA-256 equals `original_sha256` equals SHA-256 of the fixture file; app role cannot delete it (test expects AccessDenied).
- [ ] Non-image upload (renamed .exe, zero bytes) → `rejected` with reason `no_valid_image`.

### Phase 4: Enrichment, classification, scrubbing and dedupe
Build: `report.enrich` (§9.3), `packages/classifier` with real Claude client + mock (§11), `report.scrub` (§9.4), `report.dedupe` (§9.5), `report.route`, `report.gate`; classifier eval harness.
Acceptance:
- [ ] Every place fixture gets the expected district / area / marine values.
- [ ] Mock classifier drives every flag path; flagged reports land in `pending_review` even with auto-dispatch on.
- [ ] Structured-output validation failure and refusal both produce `classifier_failed` and no crash.
- [ ] Scrubber removes Aruban plates, phone numbers (+297 …), emails and names in the test corpus; `named_individual` flag set when names removed.
- [ ] Two reports 40 m apart, same category, 2 h apart → same `cluster_id`, both flagged `possible_duplicate`, neither merged.
- [ ] With `ANTHROPIC_API_KEY` set, `pnpm eval:classifier` runs on the eval set and writes a confusion matrix (not required in CI).

### Phase 5: Staff portal and moderation
Build: auth (magic link + TOTP), roles/scoping, dashboard, moderation queue and detail (§6), redaction tool (blur boxes applied to derivative, new derivative hash), routing override, reporter messaging, admin pages (users, categories, routing rules + tester, areas upload, settings/switches with accuracy panel), audit log with hash chain.
Acceptance:
- [ ] Moderator approves/rejects/merges via UI; history + audit rows written; audit chain verifies.
- [ ] Agency user of DOW cannot read a DNM-only report (404) via UI or API.
- [ ] Redaction: applying a blur box changes derivative hash; original hash unchanged; PDF uses redacted derivative.
- [ ] Toggling `auto_dispatch_enabled` requires reason; with it on, a clean high-confidence mock report goes straight to `approved`.
- [ ] Vault original view requires purpose and logs it.

### Phase 6: Agency dispatch, digest, reminders and accountability
Build: incident PDF (§12.1) incl. static map rendering; email templates (NL/EN); `dispatch.render`, `dispatch.send`; signed ack links and page; agency inbox actions; `sla.check`; `digest.send`.
Acceptance:
- [ ] Approving a report produces one PDF per routed agency; Mailpit receives one email per agency with the PDF attached and a working ack link.
- [ ] PDF text extraction contains code, category, coordinates, original hashes, routing explanation; contains **no** unscrubbed PII from the fixture description.
- [ ] Scenario `overdue-dow`: clock +3d → reminder; +7d → overdue flag + email; ack at +9d → acknowledged, `overdue_since` retained; digest lists it correctly on each simulated morning.
- [ ] Ack link: expired, tampered, or reused-for-another-dispatch tokens are rejected.
- [ ] Agency decline sends the report back to `pending_review` with a moderator notification.

### Phase 7: Monthly OM report
Build: `monthly.generate`, snapshot builder, shortlist scoring (§12.4.3), monthly PDF + charts + map, CSV export, annex ZIP with hash manifest and custody extract, approval workflow, OM portal view and ack, `auto_om_delivery_enabled`.
Acceptance:
- [ ] Scenario `month-end`: generate 90 days of synthetic data, advance to the 1st 06:00 AST → draft v1 exists with correct totals (cross-checked by an independent SQL query in the test).
- [ ] Shortlist scoring unit tests reproduce the worked examples in `docs/MOCK_TESTING.md`.
- [ ] Approver excludes one case, approves → OM email in Mailpit; OM user sees it in portal; annex manifest hashes match vault objects.
- [ ] Re-generate → v2, v1 `superseded`; re-rendering v1 from its snapshot produces a byte-identical PDF.
- [ ] Agency accountability table matches dispatch data (on-time, late, unacknowledged).

### Phase 8: Hardening, operations and launch readiness
Build: security headers/CSP, no-IP logging verification, retention sweep, audit chain nightly check, backups (pg_dump + bucket replication), monitoring and alerts (job failures, queue depth, bounce rate, overdue spikes), load test, production Docker images and deployment guide, runbooks (incident, data request, evidence release, key rotation), DPIA template, translation review hooks.
Acceptance:
- [ ] Privacy test suite (§14.6) green, including the log scan.
- [ ] Load test: 50 concurrent submissions with 3 photos each, p95 API < 800 ms, pipeline completes < 2 min per report with mock classifier.
- [ ] Restore drill: backup restored into a fresh stack, scenario `smoke` passes against it.
- [ ] Retention: with clock advanced, rejected report media purged after 90 days, vault untouched until lock expiry, audit entries present.
- [ ] `docs/runbooks/*` exist and are linked from README; ZAP baseline scan has no high findings.

---

## 16. Decisions to settle outside the code

These block launch (not development). The build proceeds with placeholders and config switches.

| # | Decision | Owner | Placeholder used in the build |
|---|---|---|---|
| 1 | **Which entity operates the system and is data controller** (staffs moderators, holds keys, signs agreements). | Project owner | "ROCAN operator" in texts; config `OPERATOR_NAME`. |
| 2 | **Agreements with DNM, ACF, DOW** to receive reports: intake email addresses, named contacts, escalation contacts, the 7-day acknowledgement commitment, how they report outcomes. | Operator + agencies | `example.aw` addresses in `config/agencies.yaml`. |
| 3 | **Agreement with OM Aruba**: whether they want the monthly report, preferred format (PDF/CSV/other), delivery channel, who approves, how evidence requests work, and whether the shortlist is welcome. | Operator + OM | PDF + CSV by email. |
| 4 | **Legal check** of the laws and articles listed per category; wording of disclaimers; whether "crime" is the right term per category. | Jurist | All `legal_refs` `verified: false`; PDF prints a neutral placeholder. |
| 5 | **Native-speaker review** of all Papiamento (and Spanish) text. | Translator | Draft strings in `apps/web/messages/pap.json` and `config/categories.yaml`. |
| 6 | **Official name** of DNM ("Directie Natuur en Milieu" vs. "Dienst Natuur & Milieu") and confirmation that DOW is the right public-works recipient under its current name. | Operator | `official_name` config values. |
| 7 | **Official GIS polygons** for Parke Nacional Arikok, Parke Marino Aruba zones, Ramsar sites, Bubali and other protected areas; coastline and district boundaries. | DNM / ACF / DIP | Hand-drawn placeholder GeoJSON with `is_placeholder = true`. |
| 8 | **Retention periods and legal basis** under Aruban data-protection law; DPIA sign-off. | Controller | Defaults in §13.4. |
| 9 | **Hosting location / data residency** and whether sending redacted images to the Claude API is acceptable. | Controller | Container-portable; classifier can be `none`. |
| 10 | **Criteria for enabling the automation switches** (who decides, which thresholds). | Operator + agencies | §11.6 suggested policy. |
| 11 | **Branding**: final product name, logo, domain (e.g. `rocan.aw`). | Project owner | "ROCAN", placeholder logo. |

---

## Appendix A: Configuration

### A.1 Environment variables
| Variable | Example | Notes |
|---|---|---|
| `DATABASE_URL` | `postgres://rocan:rocan@localhost:5432/rocan` | |
| `S3_ENDPOINT`, `S3_REGION`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | RustFS in dev/CI | |
| `S3_BUCKET_INCOMING` / `_VAULT` / `_DERIVATIVES` / `_REPORTS` | `rocan-incoming` … | |
| `VAULT_KMS_KEY_ID` | | SSE-KMS key for the vault |
| `VAULT_LOCK_DAYS` | `1825` | Object Lock retention |
| `SMTP_URL` | `smtp://localhost:1025` (Mailpit) | |
| `MAIL_FROM` | `ROCAN <no-reply@rocan.aw>` | |
| `PUBLIC_BASE_URL` | `https://rocan.aw` | used in ack links/QR |
| `ACK_LINK_SECRET` | 32+ random bytes | HMAC for `/a/{token}` |
| `AUTH_SECRET` | | Auth.js |
| `CLASSIFIER_PROVIDER` | `anthropic` \| `mock` \| `none` | |
| `CLASSIFIER_MODEL` | `claude-opus-5-5` | |
| `CLASSIFIER_EFFORT` | `low` | |
| `CLASSIFIER_DAILY_LIMIT` | `300` | |
| `ANTHROPIC_API_KEY` | | only when provider = anthropic |
| `TZ_DISPLAY` | `America/Aruba` | |
| `MOCK_MODE` | `0` / `1` | enables `/dev`, clock control, fixture endpoints. **Must be 0 in production; the app refuses to start with `MOCK_MODE=1` and `NODE_ENV=production`.** |
| `CLOCK_MODE` | `real` \| `offset` \| `frozen` | only honoured when `MOCK_MODE=1` |
| `OPERATOR_NAME` | `ROCAN operator` | |

### A.2 Runtime settings (`setting` table)
See `db/schema.sql` seed block: automation switches, SLA days, reminder schedule, dedupe radius/window, OM shortlist threshold/max, retention days.

## Appendix B: API surface (v1)

Public (no auth, rate-limited):
- `POST /api/v1/uploads`: presigned upload URLs.
- `POST /api/v1/reports`: create report (idempotent).
- `POST /api/v1/track`: `{code, secret}` → citizen-safe status + messages.
- `POST /api/v1/track/messages`: reporter reply.
- `POST /api/v1/track/withdraw`.
- `GET /api/v1/meta`: categories (localized), bounds, settings safe for clients.

Agency link (token):
- `GET /a/{token}`, `POST /a/{token}/ack`.

Staff (session + role):
- `GET/PATCH /api/v1/staff/reports[/:id]`, `POST /api/v1/staff/reports/:id/{approve|reject|merge|message|route-override|redactions}`.
- `GET/POST /api/v1/staff/dispatches[/:id]/{ack|progress|close|decline}`.
- `GET/POST /api/v1/staff/monthly[/:id]/{approve|regenerate|cases}`.
- `GET/PUT /api/v1/staff/admin/{users|categories|routing-rules|areas|settings}`.
- `POST /api/v1/staff/vault/:mediaId/access` (purpose) → presigned URL.

Dev only (`MOCK_MODE=1`):
- `POST /api/dev/clock` `{mode, offsetMs|at}`, `POST /api/dev/jobs/:name/run`, `POST /api/dev/seed`, `POST /api/dev/reset`, `POST /api/dev/scenario/:name`.

## Appendix C: Glossary
| Term | Meaning |
|---|---|
| ACF | Aruba Conservation Foundation, manages Parke Nacional Arikok and Parke Marino Aruba |
| AST | Atlantic Standard Time, Aruba local time (UTC−4, no DST) |
| Cluster | Set of reports likely describing the same incident/location |
| Cunucu | Aruban countryside |
| Derivative | EXIF-stripped, possibly redacted working copy of a photo |
| Dispatch | One delivery of one report to one agency |
| DNM | Directie Natuur en Milieu (name is a config value; see §16) |
| DOW | Directie Openbare Werken |
| OM | Openbaar Ministerie Aruba (Public Prosecution Service) |
| PMA | Parke Marino Aruba |
| SLA | Acknowledgement deadline (default 7 days) |
| Vault | Write-once encrypted storage of original photos |
