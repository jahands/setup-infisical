# setup-infisical

- Runners execute the committed `dist/`, not `src/`. After ANY change to `src/` or dependencies, run `nub run bundle` and commit `dist/` in the same PR — the `check-dist` CI job fails on drift.
- NEVER remove the `createRequire` banner from `bundle:js` or change the esbuild output format — transitive CJS deps crash at runtime without it.
- Package manager / script runner is nub (`nub ci`, `nub run <script>`). The lockfile stays npm-format (`package-lock.json`).
- `just check` (= `nub run all`: format check, lint, typecheck, deps check, knip, tests, bundle) must pass before pushing. See `just --list` for other tasks.
- Do not worry about formatting while making edits. When you're done, run `just fix`.
- Lint is oxlint, type-aware, and every enabled rule is an error — there is no warn tier. `nub run lint:fix` autofixes.
- All dependency versions are pinned exactly (syncpack, no `^`/`~`). Use `just deps-update` to bump versions.
- Changing action inputs or outputs means updating ALL of `action.yml`, `action-types.yml`, `src/`, `__tests__/`, `README.md`, and `.env.example` in one PR.
- Node is pinned in `.node-version` (single source of truth — not `.mise.toml`); keep `@types/node` aligned with it (currently 24).
- The nub version is pinned in both `.mise.toml` and the `nub-version` inputs in ci.yml — bump them together.
- Every job in ci.yml must be listed in the `needs` of `all-tests-passed` (the branch-protection check).
- Pin workflow `uses:` references to full commit SHAs with a trailing `# vX.Y.Z` comment.
- `actionlint` and `zizmor` run in CI only (`lint-workflows` job), not in `nub run all` — workflow changes need that job green.
- There is deliberately no `post:` entrypoint: the cached archive is immutable. Do not add one.
