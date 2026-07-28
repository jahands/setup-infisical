# Security Policy

## Supported versions

Only the latest release of this action is supported. Consumers should pin
the action by commit SHA (with a `# vX.Y.Z` comment) or use the floating
`v1` major tag, which only ever points at released versions.

## Reporting a vulnerability

Please do **not** open a public issue for security reports. Instead, use
[GitHub private vulnerability reporting](https://github.com/jahands/setup-infisical/security/advisories/new)
to file a report. You should receive a response within a few days.

## What this action does (threat surface)

- Downloads Infisical CLI release archives from
  `github.com/Infisical/cli` and verifies every archive — freshly
  downloaded or restored from the GitHub Actions cache — against the
  SHA-256 checksum files published with the release (or against the
  `checksum` input, when provided) before extraction. There is no input to
  skip verification.
- Never handles Infisical credentials or secrets; authentication is the
  consuming workflow's responsibility.

Vulnerabilities in the Infisical CLI itself should be reported to
[Infisical](https://infisical.com), not to this repository.
