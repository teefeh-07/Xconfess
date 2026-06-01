## Wave 5 pull request

Closes #<!-- issue number -->

### Summary

<!-- One or two sentences: what changed and why -->

### Scope

- [ ] This PR addresses **only** the linked issue (no drive-by refactors or unrelated fixes)

### Validation

Check everything that applies to your change:

- [ ] `npm ci` (from repo root)
- [ ] `npm run backend:test` and/or `npm run backend:build` (backend changes)
- [ ] `npm run frontend:test` and/or `npm run frontend:build` (frontend changes)
- [ ] `npm run contract:test` and/or `cargo fmt --check` / `cargo clippy` under `xconfess-contracts/` (contracts changes)
- [ ] `npm run test:smoke --workspace=xconfess-frontend` (Playwright public-pages smoke, if touched)
- [ ] Screenshots or short screen recording attached (UI-visible changes)

### Notes for reviewers

<!-- Optional: env vars, follow-ups, known limitations -->
