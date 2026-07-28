set shell := ["sh", "-c"]

alias i := install

[private]
@help:
  just --list

# ============================== #
# =========== Setup ============ #
# ============================== #

# Install dependencies
[group('1. Setup')]
install:
  nub install

# ============================== #
# ======== Development ========= #
# ============================== #

# Run the action locally via @github/local-action (reads .env)
[group('2. Development')]
[positional-arguments]
local-action *args:
  nub run local-action "$@"

# ============================== #
# ========== Quality =========== #
# ============================== #

# Full gate: format check, lint, typecheck, knip, tests, bundle
[group('3. Quality')]
check:
  nub run all

# Run tests
[group('3. Quality')]
[positional-arguments]
test *args:
  nub run test "$@"

# Run tests with coverage
[group('3. Quality')]
coverage:
  nub run coverage

# Lint (oxlint, type-aware)
[group('3. Quality')]
lint:
  nub run lint

# Typecheck
[group('3. Quality')]
typecheck:
  nub run typecheck

# Find unused files, deps, and exports
[group('3. Quality')]
knip:
  nub run knip

# Fix formatting and autofixable lint issues
[group('3. Quality')]
fix:
  nub run format
  nub run lint:fix

# ============================== #
# ============ Build =========== #
# ============================== #

# Rebuild dist/ (required after any src/ or dependency change)
[group('4. Build')]
bundle:
  nub run bundle
