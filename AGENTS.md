# Contributor / agent contract

Rules that keep this action shippable. They apply to humans and coding
agents alike.

## The bundle is what runs

- Runners execute `dist/index.js` (plus `dist/licenses.txt` for
  attribution), not `src/`. After **every** change under `src/` (or to
  dependencies), run `npm run bundle` and commit the resulting `dist/`
  changes in the same PR. The `check-dist` job in ci.yml fails on drift.
- `dist/index.js` is an ESM bundle with a `createRequire` banner (esbuild
  `--format=esm`). The banner is mandatory: without it, transitive CJS
  deps (e.g. `tunnel` under `@actions/http-client`) crash at runtime with
  `Dynamic require of "net" is not supported`. Do not remove it, and do
  not change the output format without running the committed artifact
  under Node 24.

## Local gate

- `npm ci --ignore-scripts` then `npm run all` (format check, lint,
  typecheck, knip, tests, bundle) must pass before pushing.
- `actionlint` and `zizmor` run in CI only and are **not** covered by
  `npm run all`; workflow changes need a green `lint-workflows` job.

## Changing the action's interface

Changing inputs or outputs means updating **all** of: `action.yml`,
`action-types.yml`, `src/`, `__tests__/`, `README.md`, and
`.env.example` — together, in one PR.

## CI invariants

- Every job in `.github/workflows/ci.yml` must be listed in the `needs`
  of the `all-tests-passed` aggregation job (it is the branch-protection
  check). That includes `check-dist`, which lives in ci.yml for exactly
  this reason: the integration jobs run the committed bundle, so a stale
  `dist/` must fail the same gate. CodeQL reports through its own
  code-scanning checks.
- Workflow `uses:` references are pinned to full commit SHAs with a
  trailing `# vX.Y.Z` comment; keep that style for any new step.
- There is deliberately **no** `post:` entrypoint: the cached content is
  an immutable versioned archive saved inline in `src/install.ts`. Do not
  add one unless the action starts caching something that mutates during
  the consumer's job.

## Toolchain holds

- TypeScript stays on 6.x until typescript-eslint supports TS 7 (7.0
  ships no compiler API; Dependabot is configured to ignore TS majors).
- Keep `@types/node` aligned with `engines.node` (currently 24).
