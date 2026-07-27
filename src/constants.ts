export const OWNER = 'Infisical'
export const REPO = 'cli'
export const TOOL_NAME = 'infisical'
// Oldest release in Infisical/cli. Older CLI versions live in the legacy
// Infisical/infisical monorepo with different tag and asset naming.
export const MIN_VERSION = '0.41.91'
// Trailing number = cache schema version. Bumped to 2 when the cached
// content changed from the extracted binary to the release archive.
export const CACHE_KEY_PREFIX = 'infisical-cli-2'
