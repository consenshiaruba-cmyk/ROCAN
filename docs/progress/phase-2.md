# Phase 2: Citizen PWA and submission API

Status: **done** (SPEC §15 Phase 2, all acceptance criteria covered by automated tests).

## What was built
| Piece | Where |
|---|---|
| Shared request schemas (client + API) | `packages/core/src/schemas/report.ts` |
| Aruba geofence for the browser, public code, follow-up secret, citizen status wording, job names | `packages/core/src/{geo,codes,citizenStatus,jobs}.ts` |
| Report creation and status changes through `transition()`, with history, hash-chained audit row and jobs in one transaction | `packages/db/src/{reports,audit,jobs}.ts` |
| `report.upload_id` / `photo_count` columns (schema.sql + migration 0003) | `db/schema.sql`, `packages/db/migrations/0003_report_upload.sql` |
| Image type sniffing (magic bytes) | `packages/media/src/sniff.ts` |
| API handlers: `meta`, `uploads`, `uploads/:id/:n`, `reports`, `track`, `track/withdraw` | `apps/web/lib/api/*`, `apps/web/app/api/v1/**` |
| Rate limiting with a daily in-memory salt; signed upload URLs; argon2id secret hashing | `apps/web/lib/{rateLimit,uploadToken,secrets}.ts` |
| i18n: next-intl, cookie-based, `pap` default; 4 message files | `apps/web/i18n/*`, `apps/web/messages/*.json` |
| Pages: home, 4-step wizard, done, track (+ withdraw), about, privacy | `apps/web/app/(public)/**`, `apps/web/components/*` |
| Map: MapLibre with our own island and protected-area geometry; GPS; typed coordinates | `apps/web/components/LocationPicker.tsx` |
| PWA: manifest, icons, app-shell service worker | `apps/web/app/manifest.ts`, `apps/web/public/{sw.js,icons/}` |
| Test images (synthetic, no people) | `fixtures/images/` |

## Acceptance evidence
| Criterion | Test |
|---|---|
| Report in each language on Pixel 7 + iPhone 14; code + secret; `/track` shows "Received" | `e2e/report.spec.ts` (8 runs: 4 languages × 2 devices; also tracks from a fresh browser) |
| Pin outside Aruba blocked client-side and rejected server-side (400) | `e2e/report.spec.ts` (GPS, typed coordinates, API bypass), `apps/web/test/api.int.test.ts` (3 outside fixtures), `packages/core/test/geo.test.ts` |
| Same `idempotency_key` → same `public_code`, one row | `apps/web/test/api.int.test.ts` (sequential and 5 concurrent retries) |
| 11th report within an hour → 429 | `apps/web/test/api.int.test.ts` (other connections unaffected; resets after an hour), `apps/web/test/lib.test.ts` |
| axe: no serious/critical violations | `e2e/pwa.spec.ts` (all public pages and every wizard step, 4 languages × 2 devices) |
| Installable; Lighthouse performance ≥ 80 | `e2e/pwa.spec.ts` (Chrome reports no installability errors); `pnpm test:lighthouse`: performance 99–100, accessibility 100, best practices 100 on `/`, `/report`, `/track`, `/privacy` |

Also covered: uploads reject non-images, oversize/size-mismatch bodies, tampered or expired URLs; wrong secret and unknown code give the same 404; withdrawal goes through `transition()` and keeps the audit chain valid; no client address stored anywhere in the database; translations have identical keys and placeholders.

Totals: 344 unit, 66 integration, 30 e2e tests.

## Decisions
1. **Uploads go through the app, not straight to storage** (SPEC §5.3 said presigned storage URLs). Same-origin uploads need no storage CORS, keep the strict "own origin only" rule for the PWA, and avoid storage access logs that record client addresses. The app checks size and magic bytes before storing. Cost: upload bandwidth through the app, fine at the expected volume. SPEC §5.3 updated.
2. **The follow-up secret is generated on the device** (SPEC §5.3 had the server return it). The server stores only an argon2id hash. If a response is lost (bad signal, later the offline outbox), the reporter still has their secret; a server-generated secret would be lost with the response. SPEC §5.3 updated.
3. **The map draws only our own geometry** (island outline and protected areas from `/api/v1/meta`), with no tile server. That keeps the page free of third-party requests and works offline once cached; it has no streets or labels, so GPS and typed coordinates are offered alongside. A self-hosted vector tile pack (SPEC §5.4) can be layered in Phase 3.
4. **Rate-limit keys need a trusted proxy.** With `TRUST_PROXY=1` the first `X-Forwarded-For` hop is HMAC'd with an in-memory salt that rotates daily; without it, all requests share one bucket (errs towards limiting, never towards identifying). Production must run behind our reverse proxy with `TRUST_PROXY=1`.
5. **"Earlier today"** is sent as `observed_at = null` (unknown time). Only "now" and an explicit date set `observed_at`.
6. **"Use photo location"** (EXIF GPS in the browser) is deferred to Phase 3, where EXIF handling is built.
7. **Withdrawing a report** is available on `/track` now (SPEC §5.1), through `reporter.withdraw`. Adding photos after submission comes with Phase 3.
8. **Tracking attempts are rate limited** (30/hour per connection) against guessing.
9. **Drizzle and the raw client are separate connections.** `drizzle(client)` rewrites postgres.js parsers and serializers; sharing one client made raw queries return strings for dates and double-encode JSON. This also removes the Phase 1 workarounds.
10. The production server refuses the development `UPLOAD_TOKEN_SECRET`.
11. The privacy page says "a person checks the result before anything is sent", which holds while auto-dispatch is off. **If the switch is turned on, this text must change.**

## Notes for Phase 3
- `report.ingest` jobs are queued with every report; the worker has no handler yet.
- Incoming photos sit in `rocan-incoming/{upload_id}/{n}`, referenced by `report.upload_id` / `photo_count`.
- The service worker is a simple app-shell cache; replace it with the outbox design in SPEC §5.4.
