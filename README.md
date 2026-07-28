# Setup Infisical CLI

[![CI](https://github.com/jahands/infisical-cli-action/actions/workflows/ci.yml/badge.svg)](https://github.com/jahands/infisical-cli-action/actions/workflows/ci.yml)

GitHub Action that installs the [Infisical CLI](https://infisical.com/docs/cli/overview)
on the runner and adds it to `PATH`.

## Usage

```yaml
- uses: jahands/infisical-cli-action@v1
- run: infisical --version
```

Pin an exact CLI version, or a semver range resolved against the published
releases:

```yaml
- uses: jahands/infisical-cli-action@v1
  with:
    version: 0.43.114 # or a range like "0.43.x"
```

This action only installs the CLI. Authenticating (`infisical login`, machine
identities, OIDC) and fetching secrets are the workflow's job.

## Inputs

| Input          | Description                                                                                                                                                                                                                      | Default                                            |
| -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------- |
| `version`      | Version to install: an exact version (e.g. `0.43.114`), a semver range (e.g. `0.43.x`) resolved to the highest matching release, or `latest`.                                                                                    | `latest`                                           |
| `checksum`     | Expected SHA-256 (64 hex chars) of the release archive for this platform. When set, it is verified instead of the release checksum files, so the trusted digest lives in your workflow. Only meaningful with a pinned `version`. | none                                               |
| `github-token` | Token sent as the `Authorization` header on release-asset and checksum downloads from github.com, and on GitHub API calls when resolving a version range (unauthenticated API calls are rate limited).                           | `${{ github.token }}` on github.com; empty on GHES |

## Outputs

| Output           | Description                                                                                               |
| ---------------- | --------------------------------------------------------------------------------------------------------- |
| `version`        | The resolved CLI version that was installed (bare semver, e.g. `0.43.114`).                               |
| `cache-hit`      | `"true"` if the CLI came from the runner tool cache or the GitHub Actions cache; `"false"` if downloaded. |
| `infisical-path` | Absolute path to the installed `infisical` binary.                                                        |

## Supported runners

| OS      | Architectures | Release asset                   |
| ------- | ------------- | ------------------------------- |
| Linux   | x64, arm64    | `cli_<version>_linux_*.tar.gz`  |
| macOS   | x64, arm64    | `cli_<version>_darwin_*.tar.gz` |
| Windows | x64, arm64    | `cli_<version>_windows_*.zip`   |

The oldest installable version is `0.41.91` — earlier CLI builds were published
from the legacy `Infisical/infisical` monorepo with different tag and asset
naming, and are not supported.

## Caching

Two layers, both automatic:

- **Runner tool cache** — repeated invocations within a job (and self-hosted
  runners with a persistent `RUNNER_TOOL_CACHE`) reuse the installed binary
  without any network access.
- **GitHub Actions cache** — across jobs and runs, the verified release
  archive is cached per version, platform and architecture. A restored
  archive is re-verified against the release checksums before extraction.

On runners where the Actions cache service is unavailable (some self-hosted,
GHES, or `act` setups), the action silently falls back to downloading. Cache
failures never fail the job.

## Security

Every archive — freshly downloaded or restored from the GitHub Actions
cache — is verified against the SHA-256 checksum files published with the
GitHub release before extraction. There is no input to skip verification.

To remove even the trust in the release checksum files, pin the version
**and** the archive digest in your workflow (the digest is
platform-specific — take it from the release's checksum files once and
review it in your diff):

```yaml
- uses: jahands/infisical-cli-action@v1
  with:
    version: 0.43.114
    checksum: <sha256 of cli_0.43.114_<platform>_<arch> archive>
```

As with any action, consider pinning by commit SHA rather than a tag:

```yaml
- uses: jahands/infisical-cli-action@<commit-sha> # vX.Y.Z
```

## Development

This repo uses [nub](https://nubjs.com) as its package manager and script
runner (the lockfile stays in npm format, so `npm ci`/`npm run` also work).

```bash
nub ci --ignore-scripts  # install dependencies
nub run all              # format check, lint, typecheck, knip, tests, bundle
cp .env.example .env     # one-time setup for local-action
nub run local-action     # run the action locally via @github/local-action
```

Node 24 is required (see `.node-version`).

The bundled `dist/index.js` is what runners execute — rebuild it with
`nub run bundle` and commit `dist/` with your PR. The `check-dist` workflow
fails if the committed bundle does not match the source.

## License

[MIT](LICENSE)
