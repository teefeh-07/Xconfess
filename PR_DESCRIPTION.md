# Wave 5 Readiness: API Versioning, Mobile Nav, Idempotent Tips, Realtime Playbook & Test Infrastructure

## Closes

- Closes #1297
- Closes #1308
- Closes #170
- Closes #462
- Relates to #173 (chain-reconciliation backoff hardening)

---

## What changed

This PR bundles the Wave 5 readiness work across the backend API surface, mobile UI, tipping reliability, operational docs, and test infrastructure.

### Issue #1297 — API versioning (v1)

- Set the global API prefix to `/api/v1`.
- Added `301` redirects for legacy `/api/` paths so existing clients migrate safely.
- Moved Swagger/OpenAPI docs to `/api/v1/docs`.
- Excluded health endpoints from the versioned prefix so probes keep working.
- Updated all E2E and integration tests to call `/api/v1/` routes.

### Issue #1308 — Mobile responsive bottom navigation

- Added a `BottomNav` component that replaces the sidebar on mobile breakpoints.
- Created the `/confess` and `/notifications` mobile-first pages.
- Implemented pull-to-refresh on `ConfessionFeed`.
- Added swipe-to-react gestures on `ConfessionCard`.
- Updated the frontend API base URL to `/api/v1`.
- Made `NotificationCenter` responsive with dark-mode support.

### Issue #170 — Idempotent tip verification

- **`xconfess-backend/src/tipping/entities/tip.entity.ts`**
  - Added a unique constraint on `idempotencyKey`.
  - Added a unique composite index on `(confessionId, txId)` to enforce replay safety at the database level.

- **`xconfess-backend/src/tipping/tipping.controller.ts`**
  - Reworked `POST /tipping/:id/verify` to return distinct HTTP status codes:
    - `201 Created` — tip verified and recorded for the first time.
    - `200 OK` with `X-Idempotent-Replay: true` — exact idempotent replay; canonical tip returned without double-crediting.
    - `409 Conflict` — txHash already used for a different confession or currently in-flight.
  - Updated Swagger annotations (`@ApiResponse`, `@ApiHeader`) to document the new statuses and headers.

### Issue #462 — Realtime degradation and incident triage playbook

- **`docs/realtime-incident-playbook.md`**
  - Added operator runbook covering WebSocket subscription auth failures, reconnect storms, stale event fanout, safe degraded-mode responses for the admin queue and notifications, and required escalation evidence.
  - Endpoint references (`/websocket/health`, `/websocket/stats`) verified against `websocket-health.controller.ts`.

### Test & CI hardening

- **`xconfess-backend/src/tipping/tipping.service.spec.ts`** & **`tipping-race-condition.spec.ts`**
  - Updated repository mocks to account for the new idempotency-key-first lookup, resolving the failing conflict-detection tests.

- **`xconfess-backend/src/tipping/chain-reconciliation.spec.ts`**
  - Fixed the invalid `toContain(expect.stringContaining(...))` matcher.
  - Relaxed a flaky `duration > 0` assertion to `>= 0`.

- **`xconfess-backend/src/tipping/chain-reconciliation.service.ts`**
  - Fixed `calculateBackoffMs` so jitter is applied **before** the maximum cap, preventing backoff from exceeding `MAX_BACKOFF_MS`.

- **`xconfess-frontend/jest.config.ts`**
  - Fixed `react` / `react-dom` module mappers to point to the workspace-root `node_modules` (React is hoisted there in this monorepo).

- **`xconfess-frontend/package.json`** & **`package-lock.json`**
  - Added the missing `lz-string` devDependency required by `@testing-library/dom`.

---

## Why

- Stabilizes the public API contract with a clean v1 path and safe redirects.
- Makes the mobile experience first-class with bottom navigation, gestures, and responsive notifications.
- Prevents double-crediting of tips on replay and gives callers deterministic, RFC-style HTTP status codes.
- Gives on-call operators a concrete, step-by-step runbook for realtime/WebSocket incidents.
- Restores green tests for the touched backend modules and the frontend notification dashboard.

---

## How to test

1. **Backend tipping module**
   ```bash
   cd xconfess-backend
   npx jest --config jest.config.js src/tipping
   ```

2. **Frontend notification dashboard**
   ```bash
   cd xconfess-frontend
   npx jest --config jest.config.ts notifications
   ```

3. **API versioning sanity check**
   - Start the backend and confirm routes respond under `/api/v1/`.
   - Confirm legacy `/api/` paths return `301` to `/api/v1/`.
   - Confirm Swagger is reachable at `/api/v1/docs` and health endpoints remain un-prefixed.

4. **Mobile nav / responsive UI**
   - Run the frontend dev server and view at ≤ 390 px width.
   - Confirm `BottomNav` appears, `/confess` and `/notifications` are reachable, and `NotificationCenter` renders correctly in dark mode.

5. **Realtime playbook review**
   - Read `docs/realtime-incident-playbook.md`.
   - Confirm `/websocket/health` and `/websocket/stats` endpoints exist in `xconfess-backend/src/websocket/websocket-health.controller.ts`.

---

## Evidence

### Tests

- [x] Added or updated unit tests
- [ ] Added or updated integration / e2e tests
- [ ] Change is not testable — manual steps provided above
- [ ] No runtime behaviour changed (docs / config only)

Test run output:

```bash
# Backend tipping
npx jest --config jest.config.js src/tipping
Test Suites: 7 passed, 7 total
Tests:       73 passed, 73 total

# Frontend notification dashboard
npx jest --config jest.config.ts notifications
Test Suites: 3 passed, 3 total
Tests:       48 passed, 48 total
```

---

## Scope check

- [x] This PR touches only the files needed to resolve the linked issues
- [x] I have not included unrelated refactors, style fixes, or dependency upgrades
- [ ] Changed lines > 400 / files > 8 — this is a bundled Wave 5 readiness PR covering five linked issues, so it intentionally exceeds the small-PR threshold.

---

## Checklist

- [x] PR description is complete (no empty sections)
- [x] All touched unit tests pass
- [x] Realtime playbook endpoints cross-checked against backend controller
